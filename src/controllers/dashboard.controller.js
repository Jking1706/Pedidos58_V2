const {
  getCategoriasDashboard,
  getDashboardResumen,
  getProductosTop,
  getVentasDiarias,
} = require('../services/dashboard.service');

async function getResumenDashboard() {
  const resumen = await getDashboardResumen();

  return {
    statusCode: 200,
    payload: resumen,
  };
}

async function getProductosTopDashboard(query) {
  const productos = await getProductosTop(query);

  return {
    statusCode: 200,
    payload: productos,
  };
}

async function getVentasDiariasDashboard(query) {
  const ventas = await getVentasDiarias(query);

  return {
    statusCode: 200,
    payload: ventas,
  };
}

async function getCategoriasDashboardData(query) {
  const categorias = await getCategoriasDashboard(query);

  return {
    statusCode: 200,
    payload: categorias,
  };
}

module.exports = {
  getCategoriasDashboardData,
  getProductosTopDashboard,
  getResumenDashboard,
  getVentasDiariasDashboard,
};
