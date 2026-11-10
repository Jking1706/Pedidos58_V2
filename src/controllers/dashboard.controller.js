const {
  getCategoriasDashboard,
  getDashboardResumen,
  getProductosRanking,
  getProductosTop,
  getVentasDiarias,
} = require('../services/dashboard.service');

async function getResumenDashboard(query) {
  const resumen = await getDashboardResumen(query);

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

async function getProductosRankingDashboard(query) {
  const ranking = await getProductosRanking(query);

  return {
    statusCode: 200,
    payload: ranking,
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
  getProductosRankingDashboard,
  getProductosTopDashboard,
  getResumenDashboard,
  getVentasDiariasDashboard,
};
