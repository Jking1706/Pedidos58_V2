const dashboardController = require('../controllers/dashboard.controller');

async function handleDashboard(context) {
  const { method, pathname, query } = context;

  if (method === 'GET' && pathname === '/api/dashboard/resumen') {
    return dashboardController.getResumenDashboard(query);
  }

  if (method === 'GET' && pathname === '/api/dashboard/productos-top') {
    return dashboardController.getProductosTopDashboard(query);
  }

  if (method === 'GET' && pathname === '/api/dashboard/productos-ranking') {
    return dashboardController.getProductosRankingDashboard(query);
  }

  if (method === 'GET' && pathname === '/api/dashboard/ventas-diarias') {
    return dashboardController.getVentasDiarias(query);
  }

  if (method === 'GET' && pathname === '/api/dashboard/categorias') {
    return dashboardController.getCategoriasDashboardData(query);
  }

  return null;
}

module.exports = {
  handleDashboard,
};
