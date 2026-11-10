const { handleCategorias } = require('./categorias.routes');
const { handleCaja } = require('./caja.routes');
const { handleDashboard } = require('./dashboard.routes');
const { handleGastos } = require('./gastos.routes');
const { handleGoogleSheets } = require('./sheets.routes');
const { handleHealth } = require('./health.routes');
const { handlePedidos } = require('./pedidos.routes');
const { handleProductos } = require('./productos.routes');

const routeHandlers = [
  handleHealth,
  handleProductos,
  handleGastos,
  handleDashboard,
  handleCategorias,
  handleCaja,
  handlePedidos,
  handleGoogleSheets,
];

async function handleApiRoute({ method, pathname, query, body, res, requestId, headers }) {
  for (const handler of routeHandlers) {
    const result = await handler({ method, pathname, query, body, res, requestId, headers });
    if (result) {
      return result;
    }
  }

  return null;
}

module.exports = {
  handleApiRoute,
};
