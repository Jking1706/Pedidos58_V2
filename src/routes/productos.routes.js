const productosController = require('../controllers/productos.controller');

function parseId(pathname) {
  const id = Number(pathname.split('/').pop());
  if (!Number.isInteger(id) || id <= 0) {
    throw Object.assign(new Error('ID inválido'), { statusCode: 400 });
  }
  return id;
}

async function handleProductos(context) {
  const { method, pathname, query, body } = context;

  if (method === 'GET' && pathname === '/api/productos') {
    return productosController.getProductos(query, context.headers || {});
  }

  if (method === 'GET' && /^\/api\/productos\/\d+$/.test(pathname)) {
    const id = parseId(pathname);
    return productosController.getProducto(id);
  }

  if (method === 'POST' && pathname === '/api/productos') {
    return productosController.postProducto(body);
  }

  if (method === 'PUT' && /^\/api\/productos\/\d+$/.test(pathname)) {
    const id = parseId(pathname);
    return productosController.putProducto(id, body);
  }

  if (method === 'DELETE' && /^\/api\/productos\/\d+$/.test(pathname)) {
    const id = parseId(pathname);
    return productosController.deleteProducto(id);
  }

  if (method === 'PATCH' && /^\/api\/productos\/\d+\/activo$/.test(pathname)) {
    const id = Number(pathname.split('/')[3]);
    if (!Number.isInteger(id) || id <= 0) {
      throw Object.assign(new Error('ID inválido'), { statusCode: 400 });
    }
    return productosController.patchProductoActivo(id, body);
  }

  return null;
}

module.exports = {
  handleProductos,
};
