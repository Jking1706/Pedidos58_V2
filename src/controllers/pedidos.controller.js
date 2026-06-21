const {
  actualizarPedido,
  crearPedido,
  eliminarPedido,
  exportarPedidosCsv,
  listarPedidos,
  listarPedidosRango,
  obtenerResumen,
  obtenerStats,
} = require('../services/pedidos.service');

async function getPedidos(query) {
  const fecha = query.get('fecha') || undefined;
  const pedidos = await listarPedidos(fecha);

  return {
    statusCode: 200,
    payload: pedidos,
  };
}

async function getPedidosRango(query) {
  const desde = query.get('desde') || undefined;
  const hasta = query.get('hasta') || undefined;
  const pedidos = await listarPedidosRango(desde, hasta);

  return {
    statusCode: 200,
    payload: pedidos,
  };
}

async function getResumen(query) {
  const fecha = query.get('fecha') || undefined;
  const resumen = await obtenerResumen(fecha);

  return {
    statusCode: 200,
    payload: resumen,
  };
}

async function getStats() {
  const stats = await obtenerStats();

  return {
    statusCode: 200,
    payload: stats,
  };
}

async function postPedido(body) {
  const pedido = await crearPedido(body);

  return {
    statusCode: 201,
    payload: pedido,
  };
}

async function putPedido(id, body) {
  const pedido = await actualizarPedido(id, body);

  return {
    statusCode: 200,
    payload: pedido,
  };
}

async function deletePedido(id) {
  await eliminarPedido(id);

  return {
    statusCode: 200,
    payload: { ok: true },
  };
}

async function getExport(query) {
  const fecha = query.get('fecha') || undefined;
  const csv = await exportarPedidosCsv(fecha);

  return {
    statusCode: 200,
    payload: csv,
    contentType: 'text/csv; charset=utf-8',
    headers: {
      'Content-Disposition': `attachment; filename="sabor58-${(fecha || '').replace(/\//g, '-') || 'hoy'}.csv"`,
    },
  };
}

module.exports = {
  deletePedido,
  getExport,
  getPedidos,
  getPedidosRango,
  getResumen,
  getStats,
  postPedido,
  putPedido,
};
