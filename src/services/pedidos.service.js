const { pool } = require('../database/connection');
const { formatOrderDate, parseIsoDate, resolveRange, isoToOrderDate } = require('./reporting.utils');

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
  estado,
  preparacion_at,
  listo_at
`;

function hoy() {
  return formatOrderDate();
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
  const total = parseItems(items).reduce((total, item) => {
    return total + Number(item.precio) * Number(item.qty ?? 1);
  }, 0);
  if (!Number.isSafeInteger(total) || total < 0 || total > 2147483647) {
    throw Object.assign(new Error('El total del pedido está fuera del rango permitido'), { statusCode: 400 });
  }
  return total;
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

async function listarCola(fecha = hoy()) {
  const result = await pool.query(
    `SELECT ${PEDIDO_COLUMNS} FROM pedidos WHERE fecha = $1 ORDER BY id DESC`,
    [fecha]
  );
  const pedidos = mapRows(result.rows);
  const contadores = { Nuevo: 0, 'En preparación': 0, Listo: 0, Entregado: 0, Cancelado: 0 };
  let totalActivo = 0;
  for (const pedido of pedidos) {
    if (Object.prototype.hasOwnProperty.call(contadores, pedido.estado)) contadores[pedido.estado] += 1;
    if (pedido.estado === 'Nuevo' || pedido.estado === 'En preparación' || pedido.estado === 'Listo') {
      totalActivo += Number(pedido.total) || 0;
    }
  }
  return { fecha, pedidos, contadores, totalActivo };
}

const COLA_TRANSITION_FROM = {
  prep: ['Nuevo'],
  ready: ['En preparación'],
};
const COLA_TRANSITION_TARGET = {
  prep: 'En preparación',
  ready: 'Listo',
};
const COLA_TRANSITION_COLUMN = {
  prep: 'preparacion_at',
  ready: 'listo_at',
};

async function transicionarPedido(id, transicion) {
  if (!Object.prototype.hasOwnProperty.call(COLA_TRANSITION_FROM, transicion)) {
    throw Object.assign(new Error('Transición inválida (usa "prep" o "ready")'), { statusCode: 400 });
  }
  const current = await obtenerPedidoPorId(id);
  if (!current) {
    throw Object.assign(new Error('Pedido no encontrado'), { statusCode: 404 });
  }
  if (current.estado === COLA_TRANSITION_TARGET[transicion]) {
    return current;
  }
  const previous = COLA_TRANSITION_FROM[transicion][0];
  if (current.estado !== previous) {
    throw Object.assign(
      new Error(`Transición inválida: ${current.estado} → ${COLA_TRANSITION_TARGET[transicion]}`),
      { statusCode: 409, payload: { from: current.estado, to: COLA_TRANSITION_TARGET[transicion] } }
    );
  }
  const result = await pool.query(
    `UPDATE pedidos SET estado = $1, ${COLA_TRANSITION_COLUMN[transicion]} = NOW()
     WHERE id = $2 AND estado = $3
     RETURNING ${PEDIDO_COLUMNS}`,
    [COLA_TRANSITION_TARGET[transicion], id, previous]
  );
  if (!result.rowCount) {
    const fresh = await obtenerPedidoPorId(id);
    throw Object.assign(
      new Error('Transición inválida: pedido modificado por otra operación'),
      { statusCode: 409, payload: { from: fresh?.estado || null, to: COLA_TRANSITION_TARGET[transicion] } }
    );
  }
  return normalizarPedido(result.rows[0]);
}

async function listarPedidosRango(desde = hoy(), hasta = hoy()) {
  const toIso = (value) => {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value));
    if (!match) throw Object.assign(new Error('La fecha debe tener formato DD/MM/YYYY'), { statusCode: 400 });
    return parseIsoDate(`${match[3]}-${match[2]}-${match[1]}`, undefined, 'La fecha');
  };
  const range = resolveRange({ desde: toIso(desde), hasta: toIso(hasta) });
  desde = isoToOrderDate(range.desde);
  hasta = isoToOrderDate(range.hasta);
  const result = await pool.query(
    `SELECT ${PEDIDO_COLUMNS}
     FROM pedidos
     WHERE fecha ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
       AND (split_part(fecha, '/', 3) || '-' || split_part(fecha, '/', 2) || '-' || split_part(fecha, '/', 1))
           BETWEEN (split_part($1, '/', 3) || '-' || split_part($1, '/', 2) || '-' || split_part($1, '/', 1))
               AND (split_part($2, '/', 3) || '-' || split_part($2, '/', 2) || '-' || split_part($2, '/', 1))
     ORDER BY (split_part(fecha, '/', 3) || '-' || split_part(fecha, '/', 2) || '-' || split_part(fecha, '/', 1)) DESC, id DESC`,
    [desde, hasta]
  );

  return mapRows(result.rows);
}

async function obtenerResumen(fecha = hoy()) {
  const total = await pool.query(
    'SELECT COUNT(*)::int AS total_pedidos, COALESCE(SUM(total), 0)::bigint AS ventas, COUNT(*) FILTER (WHERE entregado = TRUE)::int AS entregados FROM pedidos WHERE fecha = $1',
    [fecha]
  );

  return {
    fecha,
    ...total.rows[0],
    ventas: Number(total.rows[0]?.ventas || 0),
    entregados: total.rows[0]?.entregados ?? 0,
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
  const fechaParts = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fecha);
  if (!fechaParts) throw Object.assign(new Error('La fecha debe tener formato DD/MM/YYYY'), { statusCode: 400 });
  parseIsoDate(`${fechaParts[3]}-${fechaParts[2]}-${fechaParts[1]}`, undefined, 'La fecha');
  for (const amount of [data.total, data.subtotal]) {
    if (amount !== undefined && (!Number.isFinite(Number(amount)) || Number(amount) < 0)) {
      throw Object.assign(new Error('Los importes deben ser números mayores o iguales a cero'), { statusCode: 400 });
    }
  }
  const hora = String(data.hora || existing?.hora || '').trim();

  if (!items.length) {
    throw Object.assign(new Error('El pedido debe tener al menos un item'), { statusCode: 400 });
  }
  if (items.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw Object.assign(new Error('Los productos del pedido deben ser objetos válidos'), { statusCode: 400 });
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

async function snapshotItemCosts(items, previous = []) {
  const key = (item) => String(item.id ?? item.nombre ?? '');
  const previousCosts = new Map(previous.map((item) => [key(item), item.costo_unitario]));
  const ids = [...new Set(items.map((item) => Number(item.id)).filter((id) => Number.isSafeInteger(id) && id > 0 && id <= 2147483647))];
  const catalog = ids.length ? await pool.query('SELECT id, costo FROM productos WHERE id = ANY($1::int[])', [ids]) : { rows: [] };
  const costs = new Map(catalog.rows.map((row) => [Number(row.id), Number(row.costo)]));
  return items.map((item) => {
    const qty = Number(item.qty ?? 1);
    const precio = Number(item.precio);
    if (!Number.isSafeInteger(qty) || qty <= 0 || !Number.isSafeInteger(precio) || precio < 0) {
      throw Object.assign(new Error('Cada producto necesita cantidad positiva y precio válido'), { statusCode: 400 });
    }
    const previousCost = previousCosts.get(key(item));
    const cost = previousCost !== undefined && previousCost !== null && Number.isFinite(Number(previousCost))
      ? Number(previousCost) : costs.get(Number(item.id)) ?? 0;
    return { ...item, qty, precio, costo_unitario: cost };
  });
}

async function crearPedido(data) {
  const payload = buildPedidoPayload(data);
  payload.items = await snapshotItemCosts(payload.items);
  payload.subtotal = calcularSubtotal(payload.items);
  payload.total = payload.subtotal;
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
  payload.items = await snapshotItemCosts(payload.items, actual.items);
  payload.subtotal = calcularSubtotal(payload.items);
  payload.total = payload.subtotal;
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
  actualizarPedido,
  calcularSubtotal,
  crearPedido,
  eliminarPedido,
  exportarPedidosCsv,
  hoy,
  listarCola,
  listarPedidos,
  listarPedidosRango,
  obtenerPedidoPorId,
  obtenerResumen,
  obtenerStats,
  transicionarPedido,
};
