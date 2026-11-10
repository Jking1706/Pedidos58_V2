const categoriasController = require('../controllers/categorias.controller');

function parseId(pathname, index = 3) {
  const id = Number(pathname.split('/')[index]);
  if (!Number.isInteger(id) || id <= 0) {
    throw Object.assign(new Error('ID inválido'), { statusCode: 400 });
  }
  return id;
}

async function handleCategorias(context) {
  const { method, pathname, query, body } = context;

  if (method === 'GET' && pathname === '/api/categorias') {
    return categoriasController.getCategorias(query);
  }

  if (method === 'GET' && /^\/api\/categorias\/\d+$/.test(pathname)) {
    const id = parseId(pathname, 3);
    return categoriasController.getCategoria(id);
  }

  if (method === 'POST' && pathname === '/api/categorias') {
    return categoriasController.postCategoria(body);
  }

  if (method === 'PUT' && /^\/api\/categorias\/\d+$/.test(pathname)) {
    const id = parseId(pathname, 3);
    return categoriasController.putCategoria(id, body);
  }

  if (method === 'DELETE' && /^\/api\/categorias\/\d+$/.test(pathname)) {
    const id = parseId(pathname, 3);
    return categoriasController.deleteCategoria(id);
  }

  if (method === 'PATCH' && /^\/api\/categorias\/\d+\/activo$/.test(pathname)) {
    const id = parseId(pathname, 3);
    return categoriasController.patchCategoriaActivo(id, body);
  }

  return null;
}

module.exports = {
  handleCategorias,
};
