const {
  createExpense,
  deleteExpense,
  getExpenseById,
  listGastos,
  updateExpense,
} = require('../services/gastos.service');

function parsePositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : fallback;
}

async function getGastos(query) {
  const gastos = await listGastos({
    page: parsePositiveInt(query.get('page'), 1),
    limit: parsePositiveInt(query.get('limit'), 10),
    preset: query.get('preset') || undefined,
    desde: query.get('desde') || undefined,
    hasta: query.get('hasta') || undefined,
    categoria: query.get('categoria') || undefined,
  });

  return {
    statusCode: 200,
    payload: gastos,
  };
}

async function getGastosExport(query) {
  const gastos = await listGastos({
    export: true,
    preset: query.get('preset') || undefined,
    desde: query.get('desde') || undefined,
    hasta: query.get('hasta') || undefined,
    categoria: query.get('categoria') || undefined,
  });

  return {
    statusCode: 200,
    payload: gastos,
  };
}

async function getGasto(id) {
  const gasto = await getExpenseById(id);

  if (!gasto) {
    throw Object.assign(new Error('Gasto no encontrado'), { statusCode: 404 });
  }

  return {
    statusCode: 200,
    payload: gasto,
  };
}

async function postGasto(body) {
  const gasto = await createExpense(body);

  return {
    statusCode: 201,
    payload: gasto,
  };
}

async function putGasto(id, body) {
  const gasto = await updateExpense(id, body);

  return {
    statusCode: 200,
    payload: gasto,
  };
}

async function deleteGasto(id) {
  const result = await deleteExpense(id);

  return {
    statusCode: 200,
    payload: result,
  };
}

module.exports = {
  deleteGasto,
  getGasto,
  getGastos,
  getGastosExport,
  postGasto,
  putGasto,
};
