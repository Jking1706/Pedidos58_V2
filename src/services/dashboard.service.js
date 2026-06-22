const { pool } = require('../database/connection');

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_ITEM_ID_SQL = "(CASE WHEN NULLIF(item->>'id', '') ~ '^[0-9]+$' THEN (item->>'id')::int END)";
const SAFE_ITEM_PRICE_SQL = "(CASE WHEN NULLIF(item->>'precio', '') ~ '^-?[0-9]+([.][0-9]+)?$' THEN (item->>'precio')::numeric ELSE 0 END)";
const SAFE_ITEM_QTY_SQL = "(CASE WHEN NULLIF(item->>'qty', '') ~ '^-?[0-9]+([.][0-9]+)?$' THEN (item->>'qty')::numeric ELSE 1 END)";

function pad(value) {
  return String(value).padStart(2, '0');
}

function toInt(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function toAmount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function shiftDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function formatIsoDate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatOrderDate(date = new Date()) {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function parseIsoDate(value, fallback, label) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }

  const text = String(value).trim();
  if (!ISO_DATE_RE.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00`))) {
    throw Object.assign(new Error(`${label} debe tener formato YYYY-MM-DD`), { statusCode: 400 });
  }

  return text;
}

function resolveRange(query = null) {
  const baseDate = new Date();
  const defaultDesde = formatIsoDate(startOfMonth(baseDate));
  const defaultHasta = formatIsoDate(baseDate);

  let desde = parseIsoDate(query?.get?.('desde'), defaultDesde, 'La fecha inicial');
  let hasta = parseIsoDate(query?.get?.('hasta'), defaultHasta, 'La fecha final');

  if (desde > hasta) {
    [desde, hasta] = [hasta, desde];
  }

  return { desde, hasta };
}

function orderRangeFromIso(desde, hasta) {
  const desdeDate = new Date(`${desde}T00:00:00`);
  const hastaDate = new Date(`${hasta}T00:00:00`);

  return {
    desde: formatOrderDate(desdeDate),
    hasta: formatOrderDate(hastaDate),
  };
}

function buildOrderRangeClause(startIndex = 1) {
  return `to_date(fecha, 'DD/MM/YYYY') BETWEEN to_date($${startIndex}, 'DD/MM/YYYY') AND to_date($${startIndex + 1}, 'DD/MM/YYYY')`;
}

async function getDashboardResumen() {
  const now = new Date();
  const todayOrder = formatOrderDate(now);
  const weekStartOrder = formatOrderDate(shiftDays(now, -6));
  const monthStartOrder = formatOrderDate(startOfMonth(now));
  const todayIso = formatIsoDate(now);
  const monthStartIso = formatIsoDate(startOfMonth(now));

  const ventasHoyResult = await pool.query(
    'SELECT COALESCE(SUM(total), 0)::numeric AS total, COUNT(*)::int AS pedidos FROM pedidos WHERE fecha = $1',
    [todayOrder]
  );

  const ventasSemanaResult = await pool.query(
    `SELECT COALESCE(SUM(total), 0)::numeric AS total
     FROM pedidos
     WHERE fecha ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
       AND ${buildOrderRangeClause(1)}`,
    [weekStartOrder, todayOrder]
  );

  const ventasMesResult = await pool.query(
    `SELECT COALESCE(SUM(total), 0)::numeric AS total, COUNT(*)::int AS pedidos
     FROM pedidos
     WHERE fecha ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
       AND ${buildOrderRangeClause(1)}`,
    [monthStartOrder, todayOrder]
  );

  const gastosHoyResult = await pool.query(
    'SELECT COALESCE(SUM(valor), 0)::numeric AS total FROM gastos WHERE fecha = $1::date',
    [todayIso]
  );

  const gastosMesResult = await pool.query(
    'SELECT COALESCE(SUM(valor), 0)::numeric AS total FROM gastos WHERE fecha BETWEEN $1::date AND $2::date',
    [monthStartIso, todayIso]
  );

  const utilidadMesResult = await pool.query(
    `WITH pedidos_mes AS (
       SELECT items
       FROM pedidos
       WHERE fecha ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
         AND ${buildOrderRangeClause(1)}
     )
      SELECT COALESCE(SUM((${SAFE_ITEM_PRICE_SQL} - COALESCE(pr.costo, 0)) * ${SAFE_ITEM_QTY_SQL}), 0)::numeric AS utilidad
     FROM pedidos_mes pm
     CROSS JOIN LATERAL jsonb_array_elements(pm.items) AS item
      LEFT JOIN productos pr ON pr.id = ${SAFE_ITEM_ID_SQL}`,
    [monthStartOrder, todayOrder]
  );

  const ventasHoy = toAmount(ventasHoyResult.rows[0]?.total);
  const pedidosHoy = toInt(ventasHoyResult.rows[0]?.pedidos);
  const ventasSemana = toAmount(ventasSemanaResult.rows[0]?.total);
  const ventasMes = toAmount(ventasMesResult.rows[0]?.total);
  const pedidosMes = toInt(ventasMesResult.rows[0]?.pedidos);
  const gastosHoy = toAmount(gastosHoyResult.rows[0]?.total);
  const gastosMes = toAmount(gastosMesResult.rows[0]?.total);
  const utilidadEstimada = toAmount(utilidadMesResult.rows[0]?.utilidad);
  const ticketPromedio = pedidosMes > 0 ? toAmount(ventasMes / pedidosMes) : 0;

  return {
    ventas_hoy: ventasHoy,
    ventas_semana: ventasSemana,
    ventas_mes: ventasMes,
    ingresos_mes: ventasMes,
    pedidos_hoy: pedidosHoy,
    pedidos_mes: pedidosMes,
    gastos_hoy: gastosHoy,
    gastos_mes: gastosMes,
    ticket_promedio: ticketPromedio,
    utilidad_estimada: utilidadEstimada,
  };
}

async function getProductosTop(query) {
  const { desde, hasta } = resolveRange(query);
  const limitValue = Math.min(50, Math.max(1, Math.trunc(Number(query?.get?.('limit') || 10) || 10)));
  const orderRange = orderRangeFromIso(desde, hasta);
  const result = await pool.query(
    `WITH pedidos_filtrados AS (
       SELECT items
       FROM pedidos
       WHERE fecha ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
         AND ${buildOrderRangeClause(1)}
     )
     SELECT COALESCE(pr.nombre, item->>'nombre') AS producto,
            SUM(${SAFE_ITEM_QTY_SQL})::numeric AS cantidad_vendida,
            COALESCE(SUM(${SAFE_ITEM_PRICE_SQL} * ${SAFE_ITEM_QTY_SQL}), 0)::numeric AS ingresos,
            COALESCE(SUM((${SAFE_ITEM_PRICE_SQL} - COALESCE(pr.costo, 0)) * ${SAFE_ITEM_QTY_SQL}), 0)::numeric AS utilidad
     FROM pedidos_filtrados pf
     CROSS JOIN LATERAL jsonb_array_elements(pf.items) AS item
      LEFT JOIN productos pr ON pr.id = ${SAFE_ITEM_ID_SQL}
      GROUP BY COALESCE(pr.id, ${SAFE_ITEM_ID_SQL}), COALESCE(pr.nombre, item->>'nombre')
      ORDER BY cantidad_vendida DESC, ingresos DESC, producto ASC
      LIMIT $3`,
    [orderRange.desde, orderRange.hasta, limitValue]
  );

  return result.rows.map((row) => ({
    producto: row.producto,
    cantidad_vendida: toInt(row.cantidad_vendida),
    ingresos: toAmount(row.ingresos),
    utilidad: toAmount(row.utilidad),
  }));
}

async function getVentasDiarias(query) {
  const { desde, hasta } = resolveRange(query);
  const result = await pool.query(
    `WITH serie AS (
       SELECT generate_series($1::date, $2::date, interval '1 day')::date AS fecha
     ),
     pedidos_filtrados AS (
       SELECT to_date(fecha, 'DD/MM/YYYY')::date AS fecha_dt, total
       FROM pedidos
       WHERE fecha ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
         AND to_date(fecha, 'DD/MM/YYYY') BETWEEN $1::date AND $2::date
     )
     SELECT serie.fecha,
            COALESCE(SUM(pedidos_filtrados.total), 0)::numeric AS ingresos,
            COALESCE(COUNT(pedidos_filtrados.total), 0)::int AS pedidos
     FROM serie
     LEFT JOIN pedidos_filtrados ON pedidos_filtrados.fecha_dt = serie.fecha
     GROUP BY serie.fecha
     ORDER BY serie.fecha`,
    [desde, hasta]
  );

  return result.rows.map((row) => ({
    fecha: row.fecha ? String(row.fecha) : null,
    ingresos: toAmount(row.ingresos),
    pedidos: toInt(row.pedidos),
  }));
}

async function getCategoriasDashboard(query) {
  const { desde, hasta } = resolveRange(query);
  const result = await pool.query(
    `WITH pedidos_filtrados AS (
       SELECT items
       FROM pedidos
       WHERE fecha ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
         AND to_date(fecha, 'DD/MM/YYYY') BETWEEN $1::date AND $2::date
     )
     SELECT COALESCE(c.nombre, 'Sin categoría') AS categoria,
            COALESCE(SUM(${SAFE_ITEM_PRICE_SQL} * ${SAFE_ITEM_QTY_SQL}), 0)::numeric AS ingresos
     FROM pedidos_filtrados pf
     CROSS JOIN LATERAL jsonb_array_elements(pf.items) AS item
      LEFT JOIN productos pr ON pr.id = ${SAFE_ITEM_ID_SQL}
      LEFT JOIN categorias c ON c.id = pr.categoria_id
      GROUP BY COALESCE(c.id, 0), COALESCE(c.nombre, 'Sin categoría')
      ORDER BY ingresos DESC, categoria ASC`,
    [desde, hasta]
  );

  return result.rows.map((row) => ({
    categoria: row.categoria,
    ingresos: toAmount(row.ingresos),
  }));
}

module.exports = {
  getCategoriasDashboard,
  getDashboardResumen,
  getProductosTop,
  getVentasDiarias,
};
