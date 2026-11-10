const pedidosController = require('../controllers/pedidos.controller');

async function handlePedidos(context) {
  const { method, pathname, query, body } = context;

  if (method === 'GET' && pathname === '/api/resumen') {
    return pedidosController.getResumen(query);
  }

  if (method === 'GET' && pathname === '/api/stats') {
    return pedidosController.getStats();
  }

  if (method === 'GET' && pathname === '/api/pedidos') {
    return pedidosController.getPedidos(query);
  }

  if (method === 'GET' && pathname === '/api/pedidos/rango') {
    return pedidosController.getPedidosRango(query);
  }

  if (method === 'POST' && pathname === '/api/pedidos') {
    return pedidosController.postPedido(body);
  }

  if (method === 'PUT' && /^\/api\/pedidos\/\d+$/.test(pathname)) {
    const id = Number(pathname.split('/').pop());
    if (!Number.isInteger(id) || id <= 0) {
      throw Object.assign(new Error('ID inválido'), { statusCode: 400 });
    }
    return pedidosController.putPedido(id, body);
  }

  if (method === 'DELETE' && /^\/api\/pedidos\/\d+$/.test(pathname)) {
    const id = Number(pathname.split('/').pop());
    if (!Number.isInteger(id) || id <= 0) {
      throw Object.assign(new Error('ID inválido'), { statusCode: 400 });
    }
    return pedidosController.deletePedido(id);
  }

  if (method === 'GET' && pathname === '/api/export') {
    return pedidosController.getExport(query);
  }

  return null;
}

module.exports = {
  handlePedidos,
};
