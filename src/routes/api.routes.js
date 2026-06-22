const { sendJson, sendText } = require('../utils/http');
const categoriasController = require('../controllers/categorias.controller');
const dashboardController = require('../controllers/dashboard.controller');
const gastosController = require('../controllers/gastos.controller');
const healthController = require('../controllers/health.controller');
const pedidosController = require('../controllers/pedidos.controller');
const productosController = require('../controllers/productos.controller');
const { proxyGoogleSheets } = require('../services/googleSheets.service');

async function handleApiRoute({ method, pathname, query, body, res }) {
  try {
    if (method === 'GET' && pathname === '/api/health') {
      return healthController.healthCheck();
    }

    if (method === 'GET' && pathname === '/api/productos') {
      return productosController.getProductos(query);
    }

    if (method === 'GET' && pathname === '/api/gastos') {
      return gastosController.getGastos(query);
    }

    if (method === 'GET' && /^\/api\/gastos\/\d+$/.test(pathname)) {
      const id = Number(pathname.split('/').pop());
      if (!Number.isInteger(id) || id <= 0) {
        throw Object.assign(new Error('ID inválido'), { statusCode: 400 });
      }
      return gastosController.getGasto(id);
    }

    if (method === 'POST' && pathname === '/api/gastos') {
      return gastosController.postGasto(body);
    }

    if (method === 'PUT' && /^\/api\/gastos\/\d+$/.test(pathname)) {
      const id = Number(pathname.split('/').pop());
      if (!Number.isInteger(id) || id <= 0) {
        throw Object.assign(new Error('ID inválido'), { statusCode: 400 });
      }
      return gastosController.putGasto(id, body);
    }

    if (method === 'DELETE' && /^\/api\/gastos\/\d+$/.test(pathname)) {
      const id = Number(pathname.split('/').pop());
      if (!Number.isInteger(id) || id <= 0) {
        throw Object.assign(new Error('ID inválido'), { statusCode: 400 });
      }
      return gastosController.deleteGasto(id);
    }

    if (method === 'GET' && pathname === '/api/dashboard/resumen') {
      return dashboardController.getResumenDashboard();
    }

    if (method === 'GET' && pathname === '/api/dashboard/productos-top') {
      return dashboardController.getProductosTopDashboard(query);
    }

    if (method === 'GET' && pathname === '/api/dashboard/ventas-diarias') {
      return dashboardController.getVentasDiariasDashboard(query);
    }

    if (method === 'GET' && pathname === '/api/dashboard/categorias') {
      return dashboardController.getCategoriasDashboardData(query);
    }

    if (method === 'GET' && pathname === '/api/categorias') {
      return categoriasController.getCategorias(query);
    }

    if (method === 'GET' && /^\/api\/categorias\/\d+$/.test(pathname)) {
      const id = Number(pathname.split('/').pop());
      if (!Number.isInteger(id) || id <= 0) {
        throw Object.assign(new Error('ID inválido'), { statusCode: 400 });
      }
      return categoriasController.getCategoria(id);
    }

    if (method === 'POST' && pathname === '/api/categorias') {
      return categoriasController.postCategoria(body);
    }

    if (method === 'PUT' && /^\/api\/categorias\/\d+$/.test(pathname)) {
      const id = Number(pathname.split('/').pop());
      if (!Number.isInteger(id) || id <= 0) {
        throw Object.assign(new Error('ID inválido'), { statusCode: 400 });
      }
      return categoriasController.putCategoria(id, body);
    }

    if (method === 'DELETE' && /^\/api\/categorias\/\d+$/.test(pathname)) {
      const id = Number(pathname.split('/').pop());
      if (!Number.isInteger(id) || id <= 0) {
        throw Object.assign(new Error('ID inválido'), { statusCode: 400 });
      }
      return categoriasController.deleteCategoria(id);
    }

    if (method === 'PATCH' && /^\/api\/categorias\/\d+\/activo$/.test(pathname)) {
      const id = Number(pathname.split('/')[3]);
      if (!Number.isInteger(id) || id <= 0) {
        throw Object.assign(new Error('ID inválido'), { statusCode: 400 });
      }
      return categoriasController.patchCategoriaActivo(id, body);
    }

    if (method === 'GET' && /^\/api\/productos\/\d+$/.test(pathname)) {
      const id = Number(pathname.split('/').pop());
      if (!Number.isInteger(id) || id <= 0) {
        throw Object.assign(new Error('ID inválido'), { statusCode: 400 });
      }
      return productosController.getProducto(id);
    }

    if (method === 'POST' && pathname === '/api/productos') {
      return productosController.postProducto(body);
    }

    if (method === 'PUT' && /^\/api\/productos\/\d+$/.test(pathname)) {
      const id = Number(pathname.split('/').pop());
      if (!Number.isInteger(id) || id <= 0) {
        throw Object.assign(new Error('ID inválido'), { statusCode: 400 });
      }
      return productosController.putProducto(id, body);
    }

    if (method === 'DELETE' && /^\/api\/productos\/\d+$/.test(pathname)) {
      const id = Number(pathname.split('/').pop());
      if (!Number.isInteger(id) || id <= 0) {
        throw Object.assign(new Error('ID inválido'), { statusCode: 400 });
      }
      return productosController.deleteProducto(id);
    }

    if (method === 'PATCH' && /^\/api\/productos\/\d+\/activo$/.test(pathname)) {
      const id = Number(pathname.split('/')[3]);
      if (!Number.isInteger(id) || id <= 0) {
        throw Object.assign(new Error('ID inválido'), { statusCode: 400 });
      }
      return productosController.patchProductoActivo(id, body);
    }

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

    if (method === 'PUT' && pathname.startsWith('/api/pedidos/')) {
      const id = Number(pathname.split('/').pop());
      if (!Number.isInteger(id) || id <= 0) {
        throw Object.assign(new Error('ID inválido'), { statusCode: 400 });
      }
      return pedidosController.putPedido(id, body);
    }

    if (method === 'DELETE' && pathname.startsWith('/api/pedidos/')) {
      const id = Number(pathname.split('/').pop());
      if (!Number.isInteger(id) || id <= 0) {
        throw Object.assign(new Error('ID inválido'), { statusCode: 400 });
      }
      return pedidosController.deletePedido(id);
    }

    if (method === 'GET' && pathname === '/api/export') {
      return pedidosController.getExport(query);
    }

    if ((method === 'GET' || method === 'POST') && pathname === '/api/google-sheets') {
      return proxyGoogleSheets(method, query.toString() ? `?${query.toString()}` : '', body);
    }

    return null;
  } catch (error) {
    const statusCode = Number(error.statusCode) || 500;
    return {
      statusCode,
      payload: {
        error: error.message || 'Error interno del servidor',
      },
    };
  }
}

function respondApiResult(res, result) {
  if (!result) {
    sendJson(res, 404, { error: 'Ruta no encontrada' });
    return;
  }

  if (result.contentType && result.contentType.startsWith('text/')) {
    sendText(res, result.statusCode || 200, result.payload ?? '', result.contentType, result.headers || {});
    return;
  }

  sendJson(res, result.statusCode || 200, result.payload ?? {}, result.headers || {});
}

module.exports = {
  handleApiRoute,
  respondApiResult,
};
