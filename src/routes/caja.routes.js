const cajaController = require('../controllers/caja.controller');

async function handleCaja(context) {
  const { method, pathname, query, body } = context;

  if (method === 'GET' && pathname === '/api/caja') {
    return cajaController.getCaja(query);
  }

  if (method === 'POST' && pathname === '/api/caja/abrir') {
    return cajaController.postAbrirCaja(body);
  }

  if (method === 'POST' && pathname === '/api/caja/cerrar') {
    return cajaController.postCerrarCaja(body);
  }

  return null;
}

module.exports = {
  handleCaja,
};
