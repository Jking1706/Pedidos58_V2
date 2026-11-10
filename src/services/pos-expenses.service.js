const { createHash } = require('node:crypto');
const { pool } = require('../database/connection');
const { parseIsoDate, toAmount } = require('./reporting.utils');
const { proxyGoogleSheets } = require('./googleSheets.service');

function normalizePurchase(data) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(data.operationId || ''))) throw Object.assign(new Error('Falta el identificador de la compra'), { statusCode: 400 });
  const parts = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(data.fecha || ''));
  if (!parts) throw Object.assign(new Error('Fecha inválida'), { statusCode: 400 });
  const fecha = parseIsoDate(`${parts[3]}-${parts[2]}-${parts[1]}`, undefined, 'La fecha');
  const manual = data.tipoEntrada === 'gasto';
  if (!manual && data.tipoEntrada !== 'gasto_carrito') throw Object.assign(new Error('Tipo de gasto inválido'), { statusCode: 400 });
  const raw = manual ? [{ categoria: data.categoria, producto: data.descripcion, cantidad: 1, precioFinal: data.monto }] : data.items;
  if (!Array.isArray(raw) || !raw.length || raw.length > 100) throw Object.assign(new Error('La compra debe tener entre 1 y 100 líneas'), { statusCode: 400 });
  const lines = raw.map((item) => {
    const descripcion = String(item?.producto || '').trim();
    const categoria = String(item?.categoria || '').trim();
    const qty = Number(item?.cantidad);
    const price = Number(item?.precioFinal);
    const valor = toAmount(qty * price);
    if (!descripcion || descripcion.length > 160 || !categoria || categoria.length > 80 || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price < 0 || valor <= 0 || valor >= 1e10) {
      throw Object.assign(new Error('Revisa descripción, categoría, cantidad y precio de cada gasto'), { statusCode: 400 });
    }
    return { descripcion, categoria, valor, cantidad: qty, precio: price };
  });
  return { fecha, metodoPago: String(data.metodoPago || '').slice(0, 80), lines };
}

async function registerPosExpense(data) {
  const purchase = normalizePurchase(data);
  data = { ...data, operationId: data.operationId.toLowerCase() };
  const hash = createHash('sha256').update(JSON.stringify(purchase)).digest('hex');
  const client = await pool.connect();
  let replay = false;
  let result;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(58003, hashtext($1))', [data.operationId]);
    const previous = await client.query('SELECT payload_hash, gasto_ids, sheets_status FROM gasto_operaciones WHERE id = $1', [data.operationId]);
    if (previous.rows[0]) {
      if (previous.rows[0].payload_hash !== hash) throw Object.assign(new Error('Esta operación ya corresponde a otra compra'), { statusCode: 409 });
      replay = true;
      result = previous.rows[0];
    } else {
      const ids = [];
      for (const line of purchase.lines) {
        const inserted = await client.query(`INSERT INTO gastos (descripcion, categoria, valor, fecha, observaciones)
          VALUES ($1, $2, $3, $4::date, $5) RETURNING id`,
        [line.descripcion, line.categoria, line.valor, purchase.fecha, `POS · ${line.cantidad} × ${line.precio} · ${purchase.metodoPago}`]);
        ids.push(inserted.rows[0].id);
      }
      await client.query(`INSERT INTO gasto_operaciones (id, payload_hash, gasto_ids, sheets_payload, sheets_status)
        VALUES ($1, $2, $3::int[], $4::jsonb, 'pendiente')`, [data.operationId, hash, ids, JSON.stringify(data)]);
      result = { gasto_ids: ids, sheets_status: 'pendiente' };
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
  // Una copia incierta en Sheets nunca repite el gasto financiero local.
  if (!replay) {
    try {
      const sync = await proxyGoogleSheets('POST', '', data);
      result.sheets_status = sync.payload?.ok ? 'enviado' : 'revisar';
      await pool.query('UPDATE gasto_operaciones SET sheets_status = $1 WHERE id = $2', [result.sheets_status, data.operationId]);
    } catch { result.sheets_status = 'revisar'; }
  }
  return { ok: true, gasto_ids: result.gasto_ids, repetida: replay, sheets_status: result.sheets_status };
}

module.exports = { registerPosExpense, normalizePurchase };
