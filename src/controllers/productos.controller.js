const {
  createProduct,
  deleteProduct,
  getProductById,
  listProducts,
  setProductActive,
  updateProduct,
} = require('../services/productos.service');

function parseIncludeInactive(query) {
  const value = String(query.get('includeInactive') || query.get('all') || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on', 'all'].includes(value);
}

async function getProductos(query) {
  const productos = await listProducts({ includeInactive: parseIncludeInactive(query) });

  return {
    statusCode: 200,
    payload: productos,
  };
}

async function getProducto(id) {
  const producto = await getProductById(id);

  if (!producto) {
    throw Object.assign(new Error('Producto no encontrado'), { statusCode: 404 });
  }

  return {
    statusCode: 200,
    payload: producto,
  };
}

async function postProducto(body) {
  const producto = await createProduct(body);

  return {
    statusCode: 201,
    payload: producto,
  };
}

async function putProducto(id, body) {
  const producto = await updateProduct(id, body);

  return {
    statusCode: 200,
    payload: producto,
  };
}

async function deleteProducto(id) {
  const result = await deleteProduct(id);

  return {
    statusCode: 200,
    payload: result,
  };
}

async function patchProductoActivo(id, body) {
  const producto = await setProductActive(id, body?.activo);

  return {
    statusCode: 200,
    payload: producto,
  };
}

module.exports = {
  deleteProducto,
  getProducto,
  getProductos,
  patchProductoActivo,
  postProducto,
  putProducto,
};
