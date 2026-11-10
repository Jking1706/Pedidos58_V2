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

// Huella ligera del catálogo para ETag/304 sin una segunda consulta a la base.
// Se basa en el mayor updated_at y en la cantidad de productos devueltos.
function productsFingerprint({ rows, includeInactive = false }) {
  let maxUpdated = 0;
  for (const row of rows || []) {
    const ts = new Date(row.updated_at || row.updatedAt || 0).getTime();
    if (Number.isFinite(ts) && ts > maxUpdated) maxUpdated = ts;
  }
  return `${maxUpdated}-${rows?.length ?? 0}-${includeInactive ? 'all' : 'active'}`;
}

function matchesIfNoneMatch(headerValue, etag) {
  if (!headerValue) return false;
  return String(headerValue)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .some((candidate) => candidate === etag || candidate === '*');
}

async function getProductos(query, contextHeaders = {}) {
  const includeInactive = parseIncludeInactive(query);
  const productos = await listProducts({ includeInactive });

  const fingerprint = productsFingerprint({ rows: productos, includeInactive });
  const etag = `W/"productos-${fingerprint}"`;

  if (matchesIfNoneMatch(contextHeaders['if-none-match'], etag)) {
    return {
      statusCode: 304,
      payload: undefined,
      headers: { 'ETag': etag },
    };
  }

  return {
    statusCode: 200,
    payload: productos,
    headers: { 'ETag': etag, 'Cache-Control': 'no-cache' },
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
