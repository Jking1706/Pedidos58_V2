const gastosController = require('../controllers/gastos.controller');
const { registerPosExpense } = require('../services/pos-expenses.service');

function parseId(pathname) {
  const id = Number(pathname.split('/').pop());
  if (!Number.isInteger(id) || id <= 0) {
    throw Object.assign(new Error('ID inválido'), { statusCode: 400 });
  }
  return id;
}

async function handleGastos(context) {
  const { method, pathname, query, body } = context;

  if (method === 'GET' && pathname === '/api/gastos') {
    return gastosController.getGastos(query);
  }

  if (method === 'GET' && pathname === '/api/gastos/export') {
    return gastosController.getGastosExport(query);
  }

  if (method === 'GET' && /^\/api\/gastos\/\d+$/.test(pathname)) {
    const id = parseId(pathname);
    return gastosController.getGasto(id);
  }

  if (method === 'POST' && pathname === '/api/gastos') {
    return gastosController.postGasto(body);
  }

  if (method === 'POST' && pathname === '/api/gastos/pos') {
    const result = await registerPosExpense(body);
    return { statusCode: result.repetida ? 200 : 201, payload: result };
  }

  if (method === 'PUT' && /^\/api\/gastos\/\d+$/.test(pathname)) {
    const id = parseId(pathname);
    return gastosController.putGasto(id, body);
  }

  if (method === 'DELETE' && /^\/api\/gastos\/\d+$/.test(pathname)) {
    const id = parseId(pathname);
    return gastosController.deleteGasto(id);
  }

  return null;
}

module.exports = {
  handleGastos,
};
