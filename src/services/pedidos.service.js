const { pool } = require('../database/connection');

const PEDIDO_COLUMNS = `
  id,
  numero,
  cliente,
  telefono,
  direccion,
  metodo_pago AS "metodoPago",
  notas,
  items,
  subtotal,
  total,
  fecha,
  hora,
  entregado,
  estado
`;

function hoy() {
  const now = new Date();
  return `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

function toInt(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function normalizeNullableText(value, fallback = null) {
  if (value === undefined) {
    return fallback;
  }

  if (value === null) {
    return null;
  }

  const text = String(value).trim();
  return text ? text : null;
}

function parseItems(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function calcularSubtotal(items) {
  return parseItems(items).reduce((total, item) => {
    return total + toInt(item.precio) * toInt(item.qty || 1);
  }, 0);
}

function normalizarPedido(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    id: toInt(row.id),
    numero: toInt(row.numero),
    items: parseItems(row.items),
    subtotal: toInt(row.subtotal ?? row.total ?? 0),
    total: toInt(row.total ?? 0),
    entregado: Boolean(row.entregado),
  };
}

function mapRows(rows) {
  return rows.map(normalizarPedido);
}

async function obtenerPedidoPorId(id) {
  const result = await pool.query(`SELECT ${PEDIDO_COLUMNS} FROM pedidos WHERE id = $1`, [id]);
  return normalizarPedido(result.rows[0]);
}

async function listarPedidos(fecha = hoy()) {
  const result = await pool.query(
    `SELECT ${PEDIDO_COLUMNS} FROM pedidos WHERE fecha = $1 ORDER BY id DESC`,
    [fecha]
  );

  return mapRows(result.rows);
}

async function listarPedidosRango(desde = hoy(), hasta = hoy()) {
  const result = await pool.query(
    `SELECT ${PEDIDO_COLUMNS}
     FROM pedidos
     WHERE to_date(fecha, 'DD/MM/YYYY') BETWEEN to_date($1, 'DD/MM/YYYY') AND to_date($2, 'DD/MM/YYYY')
     ORDER BY to_date(fecha, 'DD/MM/YYYY') DESC, id DESC`,
    [desde, hasta]
  );

  return mapRows(result.rows);
}

async function obtenerResumen(fecha = hoy()) {
  const total = await pool.query(
    'SELECT COUNT(*)::int AS total_pedidos, COALESCE(SUM(total), 0)::int AS ventas FROM pedidos WHERE fecha = $1',
    [fecha]
  );
  const entregados = await pool.query(
    'SELECT COUNT(*)::int AS entregados FROM pedidos WHERE fecha = $1 AND entregado = TRUE',
    [fecha]
  );

  return {
    fecha,
    ...total.rows[0],
    entregados: entregados.rows[0]?.entregados ?? 0,
  };
}

async function obtenerStats() {
  const total = await pool.query('SELECT COUNT(*)::int AS n, COALESCE(SUM(total), 0)::int AS ventas FROM pedidos');
  const hoyData = await pool.query('SELECT COUNT(*)::int AS n, COALESCE(SUM(total), 0)::int AS ventas FROM pedidos WHERE fecha = $1', [hoy()]);
  const topItems = await pool.query(`
    SELECT item->>'nombre' AS nombre, SUM((item->>'qty')::int)::int AS cantidad
    FROM pedidos, jsonb_array_elements(items) AS item
    GROUP BY item->>'nombre'
    ORDER BY cantidad DESC
    LIMIT 5
  `);

  return {
    total: total.rows[0],
    hoy: hoyData.rows[0],
    top_productos: topItems.rows.map((row) => ({
      nombre: row.nombre,
      cantidad: toInt(row.cantidad),
    })),
  };
}

function buildPedidoPayload(data, existing = null) {
  const items = data.items !== undefined ? parseItems(data.items) : existing?.items || [];
  const subtotal = data.subtotal !== undefined
    ? toInt(data.subtotal)
    : (data.total !== undefined ? toInt(data.total) : calcularSubtotal(items));
  const total = data.total !== undefined ? toInt(data.total) : subtotal;
  const fecha = String(data.fecha || existing?.fecha || hoy()).trim() || hoy();
  const hora = String(data.hora || existing?.hora || '').trim();

  if (!items.length) {
    throw Object.assign(new Error('El pedido debe tener al menos un item'), { statusCode: 400 });
  }

  if (!hora) {
    throw Object.assign(new Error('La hora del pedido es obligatoria'), { statusCode: 400 });
  }

  const numero = data.numero !== undefined ? toInt(data.numero) : existing?.numero;
  if (numero === undefined || numero === null || Number.isNaN(numero) || numero <= 0) {
    throw Object.assign(new Error('El número de pedido es obligatorio'), { statusCode: 400 });
  }

  const entregado = data.entregado !== undefined ? Boolean(data.entregado) : Boolean(existing?.entregado);
  const estadoBase = data.estado !== undefined ? String(data.estado).trim() : '';
  const estado = estadoBase || (entregado ? 'Entregado' : existing?.estado || 'Nuevo');

  return {
    numero,
    cliente: normalizeNullableText(data.cliente, existing?.cliente ?? null),
    telefono: normalizeNullableText(data.telefono, existing?.telefono ?? null),
    direccion: normalizeNullableText(data.direccion, existing?.direccion ?? null),
    metodoPago: normalizeNullableText(data.metodoPago, existing?.metodoPago ?? null),
    notas: normalizeNullableText(data.notas, existing?.notas ?? null),
    items,
    subtotal,
    total,
    fecha,
    hora,
    entregado,
    estado,
  };
}

async function crearPedido(data) {
  const payload = buildPedidoPayload(data);
  const result = await pool.query(
    `INSERT INTO pedidos (
      numero,
      cliente,
      telefono,
      direccion,
      metodo_pago,
      notas,
      items,
      subtotal,
      total,
      fecha,
      hora,
      entregado,
      estado
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING ${PEDIDO_COLUMNS}`,
    [
      payload.numero,
      payload.cliente,
      payload.telefono,
      payload.direccion,
      payload.metodoPago,
      payload.notas,
      JSON.stringify(payload.items),
      payload.subtotal,
      payload.total,
      payload.fecha,
      payload.hora,
      payload.entregado,
      payload.estado,
    ]
  );

  return normalizarPedido(result.rows[0]);
}

async function actualizarPedido(id, data) {
  const actual = await obtenerPedidoPorId(id);
  if (!actual) {
    throw Object.assign(new Error('No encontrado'), { statusCode: 404 });
  }

  const payload = buildPedidoPayload(data, actual);
  const touchedFields = [
    'numero',
    'cliente',
    'telefono',
    'direccion',
    'metodoPago',
    'notas',
    'items',
    'subtotal',
    'total',
  ].some((field) => data[field] !== undefined);

  const estado = data.estado !== undefined
    ? normalizeNullableText(data.estado, actual.estado) || actual.estado
    : (data.entregado === true ? 'Entregado' : (touchedFields ? 'Editado' : actual.estado));

  const result = await pool.query(
    `UPDATE pedidos SET
      numero = $1,
      cliente = $2,
      telefono = $3,
      direccion = $4,
      metodo_pago = $5,
      notas = $6,
      items = $7,
      subtotal = $8,
      total = $9,
      fecha = $10,
      hora = $11,
      entregado = $12,
      estado = $13
     WHERE id = $14
     RETURNING ${PEDIDO_COLUMNS}`,
    [
      payload.numero,
      payload.cliente,
      payload.telefono,
      payload.direccion,
      payload.metodoPago,
      payload.notas,
      JSON.stringify(payload.items),
      payload.subtotal,
      payload.total,
      payload.fecha,
      payload.hora,
      payload.entregado,
      estado,
      id,
    ]
  );

  return normalizarPedido(result.rows[0]);
}

async function eliminarPedido(id) {
  await pool.query('DELETE FROM pedidos WHERE id = $1', [id]);
  return { ok: true };
}

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

async function exportarPedidosCsv(fecha = hoy()) {
  const pedidos = await listarPedidos(fecha);
  let csv = 'ID,Número,Cliente,Notas,Items,Total,Hora,Fecha,Entregado\n';

  pedidos.forEach((pedido) => {
    const items = (Array.isArray(pedido.items) ? pedido.items : parseItems(pedido.items))
      .map((item) => `${item.qty}x ${item.nombre}`)
      .join(' | ');

    csv += `${pedido.id},${pedido.numero},${csvEscape(pedido.cliente || '')},${csvEscape(pedido.notas || '')},${csvEscape(items)},${pedido.total},${pedido.hora},${pedido.fecha},${pedido.entregado ? 'Sí' : 'No'}\n`;
  });

  return csv;
}

module.exports = {
  calcularSubtotal,
  crearPedido,
  eliminarPedido,
  exportarPedidosCsv,
  hoy,
  listarPedidos,
  listarPedidosRango,
  obtenerPedidoPorId,
  obtenerResumen,
  obtenerStats,
  actualizarPedido,
};
