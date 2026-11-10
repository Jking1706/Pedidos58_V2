const { pool } = require('../database/connection');
const {
  businessDate,
  formatIsoDate,
  resolveRange,
  shiftDays,
  startOfMonth,
  toAmount,
  toInt,
} = require('./reporting.utils');

const SAFE_ITEM_ID_SQL = "(CASE WHEN NULLIF(item->>'id', '') ~ '^[0-9]{1,10}$' THEN CASE WHEN (item->>'id')::bigint <= 2147483647 THEN (item->>'id')::int END END)";
const ITEM_COST_SQL = "(CASE WHEN NULLIF(item->>'costo_unitario', '') ~ '^[0-9]+([.][0-9]+)?$' THEN (item->>'costo_unitario')::numeric ELSE COALESCE(pr.costo, 0) END)";
const SAFE_ITEM_PRICE_SQL = "(CASE WHEN NULLIF(item->>'precio', '') ~ '^-?[0-9]+([.][0-9]+)?$' THEN (item->>'precio')::numeric ELSE 0 END)";
const SAFE_ITEM_QTY_SQL = "(CASE WHEN NULLIF(item->>'qty', '') ~ '^-?[0-9]+([.][0-9]+)?$' THEN (item->>'qty')::numeric ELSE 1 END)";

function buildRangeLabel({ desde, hasta }) {
  return `${desde} → ${hasta}`;
}

async function getOrderMetrics(desde, hasta) {
  const result = await pool.query(
    `WITH pedidos_filtrados AS (
       SELECT id, total, items
       FROM pedidos
       WHERE fecha ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
         AND to_date(fecha, 'DD/MM/YYYY') BETWEEN $1::date AND $2::date
     ),
     pedido_detalle AS (
       SELECT pf.id,
              pf.total,
               COALESCE(SUM(${SAFE_ITEM_QTY_SQL}) FILTER (WHERE item IS NOT NULL), 0)::numeric AS unidades,
               COALESCE(SUM((${SAFE_ITEM_PRICE_SQL} - ${ITEM_COST_SQL}) * ${SAFE_ITEM_QTY_SQL}) FILTER (WHERE item IS NOT NULL), 0)::numeric AS utilidad
       FROM pedidos_filtrados pf
        LEFT JOIN LATERAL jsonb_array_elements(pf.items) AS item ON TRUE
       LEFT JOIN productos pr ON pr.id = ${SAFE_ITEM_ID_SQL}
       GROUP BY pf.id, pf.total
     )
     SELECT COALESCE(SUM(total), 0)::numeric AS ventas,
            COUNT(*)::int AS pedidos,
            COALESCE(SUM(unidades), 0)::numeric AS unidades,
            COALESCE(SUM(utilidad), 0)::numeric AS utilidad
     FROM pedido_detalle`,
    [desde, hasta]
  );

  return {
    ventas: toAmount(result.rows[0]?.ventas),
    pedidos: toInt(result.rows[0]?.pedidos),
    unidades: toAmount(result.rows[0]?.unidades),
    utilidad: toAmount(result.rows[0]?.utilidad),
  };
}

async function getExpenseMetrics(desde, hasta) {
  const result = await pool.query(
    `SELECT COALESCE(SUM(valor), 0)::numeric AS gastos,
            COUNT(*)::int AS registros
     FROM gastos
     WHERE fecha BETWEEN $1::date AND $2::date`,
    [desde, hasta]
  );

  return {
    gastos: toAmount(result.rows[0]?.gastos),
    registros: toInt(result.rows[0]?.registros),
  };
}

async function getProductPerformance(desde, hasta) {
  const result = await pool.query(
    `WITH pedidos_filtrados AS (
       SELECT items
       FROM pedidos
       WHERE fecha ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
         AND to_date(fecha, 'DD/MM/YYYY') BETWEEN $1::date AND $2::date
     )
     SELECT COALESCE(pr.id::text, NULLIF(item->>'nombre', ''), NULLIF(item->>'id', ''), 'Sin nombre') AS producto_key,
            COALESCE(pr.nombre, item->>'nombre', item->>'id', 'Sin nombre') AS producto,
            COALESCE(c.nombre, 'Sin categoría') AS categoria,
             MAX(COALESCE(pr.precio, ${SAFE_ITEM_PRICE_SQL}))::numeric AS precio,
             COALESCE(SUM(${ITEM_COST_SQL} * ${SAFE_ITEM_QTY_SQL}) / NULLIF(SUM(${SAFE_ITEM_QTY_SQL}), 0), 0)::numeric AS costo,
            COALESCE(pr.activo, TRUE) AS activo,
            SUM(${SAFE_ITEM_QTY_SQL})::numeric AS cantidad_vendida,
            COALESCE(SUM(${SAFE_ITEM_PRICE_SQL} * ${SAFE_ITEM_QTY_SQL}), 0)::numeric AS ingresos,
             COALESCE(SUM((${SAFE_ITEM_PRICE_SQL} - ${ITEM_COST_SQL}) * ${SAFE_ITEM_QTY_SQL}), 0)::numeric AS utilidad
     FROM pedidos_filtrados pf
     CROSS JOIN LATERAL jsonb_array_elements(pf.items) AS item
     LEFT JOIN productos pr ON pr.id = ${SAFE_ITEM_ID_SQL}
     LEFT JOIN categorias c ON c.id = pr.categoria_id
      GROUP BY producto_key, producto, categoria, activo
     ORDER BY cantidad_vendida DESC, utilidad DESC, ingresos DESC, producto ASC`,
    [desde, hasta]
  );

  return result.rows.map((row) => ({
    producto: row.producto,
    categoria: row.categoria,
    precio: toAmount(row.precio),
    costo: toAmount(row.costo),
    activo: Boolean(row.activo),
    cantidad_vendida: toAmount(row.cantidad_vendida),
    ingresos: toAmount(row.ingresos),
    utilidad: toAmount(row.utilidad),
  }));
}

async function getDashboardResumen(query = null) {
  const range = resolveRange(query, { defaultPreset: 'mes' });
  const now = businessDate();
  const today = formatIsoDate(now);
  const weekStart = formatIsoDate(shiftDays(now, -((now.getDay() + 6) % 7)));
  const monthStart = formatIsoDate(startOfMonth(now));

  // Reutilizar promesas solo dentro de esta solicitud, sin servir resultados obsoletos.
  const pending = new Map();
  const metrics = (type, from, to) => {
    const key = `${type}:${from}:${to}`;
    if (!pending.has(key)) pending.set(key, type === 'orders' ? getOrderMetrics(from, to) : getExpenseMetrics(from, to));
    return pending.get(key);
  };
  const [dayMetrics, weekMetrics, monthMetrics, rangeMetrics, dayExpenses, weekExpenses, monthExpenses, rangeExpenses] = await Promise.all([
    metrics('orders', today, today),
    metrics('orders', weekStart, today),
    metrics('orders', monthStart, today),
    metrics('orders', range.desde, range.hasta),
    metrics('expenses', today, today),
    metrics('expenses', weekStart, today),
    metrics('expenses', monthStart, today),
    metrics('expenses', range.desde, range.hasta),
  ]);

  const ticketPromedio = monthMetrics.pedidos > 0 ? toAmount(monthMetrics.ventas / monthMetrics.pedidos) : 0;
  const ticketPromedioRango = rangeMetrics.pedidos > 0 ? toAmount(rangeMetrics.ventas / rangeMetrics.pedidos) : 0;
  const productosPromedioRango = rangeMetrics.pedidos > 0 ? toAmount(rangeMetrics.unidades / rangeMetrics.pedidos) : 0;
  const pedidosPorDiaRango = range.dias > 0 ? toAmount(rangeMetrics.pedidos / range.dias) : 0;

  return {
    rango: {
      desde: range.desde,
      hasta: range.hasta,
      preset: range.preset,
      dias: range.dias,
      label: buildRangeLabel(range),
    },
    ventas_hoy: dayMetrics.ventas,
    ventas_semana: weekMetrics.ventas,
    ventas_mes: monthMetrics.ventas,
    ingresos_mes: monthMetrics.ventas,
    ventas_rango: rangeMetrics.ventas,
    pedidos_hoy: dayMetrics.pedidos,
    pedidos_mes: monthMetrics.pedidos,
    pedidos_rango: rangeMetrics.pedidos,
    gastos_hoy: dayExpenses.gastos,
    gastos_semana: weekExpenses.gastos,
    gastos_mes: monthExpenses.gastos,
    gastos_rango: rangeExpenses.gastos,
    utilidad_hoy: dayMetrics.utilidad,
    utilidad_semana: weekMetrics.utilidad,
    utilidad_mes: monthMetrics.utilidad,
    utilidad_estimada: monthMetrics.utilidad,
    utilidad_rango: rangeMetrics.utilidad,
    ticket_promedio: ticketPromedio,
    ticket_promedio_rango: ticketPromedioRango,
    productos_rango: rangeMetrics.unidades,
    productos_promedio_rango: productosPromedioRango,
    productos_promedio_pedido: productosPromedioRango,
    pedidos_por_dia_rango: pedidosPorDiaRango,
  };
}

async function getProductosTop(query = null) {
  const limitValue = Math.min(50, Math.max(1, Math.trunc(Number(query?.get?.('limit') || 10) || 10)));
  const range = resolveRange(query, { defaultPreset: 'mes' });
  const performance = await getProductPerformance(range.desde, range.hasta);

  return performance
    .slice(0, limitValue)
    .map((row) => ({
      producto: row.producto,
      cantidad_vendida: toInt(row.cantidad_vendida),
      ingresos: toAmount(row.ingresos),
      utilidad: toAmount(row.utilidad),
      categoria: row.categoria,
      precio: toAmount(row.precio),
      costo: toAmount(row.costo),
    }));
}

async function getProductosRanking(query = null) {
  const range = resolveRange(query, { defaultPreset: 'mes' });
  const limitValue = Math.min(20, Math.max(1, Math.trunc(Number(query?.get?.('limit') || 10) || 10)));
  const performance = await getProductPerformance(range.desde, range.hasta);

  const topVendidos = [...performance]
    .sort((a, b) => b.cantidad_vendida - a.cantidad_vendida || b.ingresos - a.ingresos || a.producto.localeCompare(b.producto, 'es'))
    .slice(0, limitValue);

  const topRentables = [...performance]
    .sort((a, b) => b.utilidad - a.utilidad || b.cantidad_vendida - a.cantidad_vendida || a.producto.localeCompare(b.producto, 'es'))
    .slice(0, limitValue);

  const menosVendidos = [...performance]
    .filter((row) => row.cantidad_vendida > 0)
    .sort((a, b) => a.cantidad_vendida - b.cantidad_vendida || a.utilidad - b.utilidad || a.producto.localeCompare(b.producto, 'es'))
    .slice(0, limitValue);

  return {
    rango: {
      desde: range.desde,
      hasta: range.hasta,
      preset: range.preset,
      dias: range.dias,
      label: buildRangeLabel(range),
    },
    top_vendidos: topVendidos.map((row) => ({
      producto: row.producto,
      categoria: row.categoria,
      precio: toAmount(row.precio),
      costo: toAmount(row.costo),
      cantidad_vendida: toInt(row.cantidad_vendida),
      ingresos: toAmount(row.ingresos),
      utilidad: toAmount(row.utilidad),
    })),
    top_rentables: topRentables.map((row) => ({
      producto: row.producto,
      categoria: row.categoria,
      precio: toAmount(row.precio),
      costo: toAmount(row.costo),
      cantidad_vendida: toInt(row.cantidad_vendida),
      ingresos: toAmount(row.ingresos),
      utilidad: toAmount(row.utilidad),
    })),
    menos_vendidos: menosVendidos.map((row) => ({
      producto: row.producto,
      categoria: row.categoria,
      precio: toAmount(row.precio),
      costo: toAmount(row.costo),
      cantidad_vendida: toInt(row.cantidad_vendida),
      ingresos: toAmount(row.ingresos),
      utilidad: toAmount(row.utilidad),
    })),
    reporte: performance.map((row) => ({
      producto: row.producto,
      categoria: row.categoria,
      precio: toAmount(row.precio),
      costo: toAmount(row.costo),
      cantidad_vendida: toInt(row.cantidad_vendida),
      ingresos: toAmount(row.ingresos),
      utilidad: toAmount(row.utilidad),
    })),
  };
}

async function getVentasDiarias(query = null) {
  const range = resolveRange(query, { defaultPreset: 'mes' });
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
    [range.desde, range.hasta]
  );

  return result.rows.map((row) => ({
    fecha: row.fecha ? String(row.fecha) : null,
    ingresos: toAmount(row.ingresos),
    pedidos: toInt(row.pedidos),
  }));
}

async function getCategoriasDashboard(query = null) {
  const range = resolveRange(query, { defaultPreset: 'mes' });
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
    [range.desde, range.hasta]
  );

  return result.rows.map((row) => ({
    categoria: row.categoria,
    ingresos: toAmount(row.ingresos),
  }));
}

module.exports = {
  getCategoriasDashboard,
  getDashboardResumen,
  getProductosRanking,
  getProductosTop,
  getVentasDiarias,
};
