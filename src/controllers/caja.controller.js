const { abrirCaja, cerrarCaja, listCaja } = require('../services/caja.service');

async function getCaja(query) {
  const caja = await listCaja({ fecha: query.get('fecha') || undefined });

  return {
    statusCode: 200,
    payload: caja,
  };
}

async function postAbrirCaja(body) {
  const caja = await abrirCaja(body || {});

  return {
    statusCode: caja.status === 'ya_abierta' ? 200 : 201,
    payload: caja,
  };
}

async function postCerrarCaja(body) {
  const caja = await cerrarCaja(body || {});

  return {
    statusCode: caja.status === 'ya_cerrada' ? 200 : 200,
    payload: caja,
  };
}

module.exports = {
  getCaja,
  postAbrirCaja,
  postCerrarCaja,
};
