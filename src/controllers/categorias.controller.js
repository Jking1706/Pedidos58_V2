const {
  createCategory,
  deleteCategory,
  getCategoryById,
  listCategories,
  setCategoryActive,
  updateCategory,
} = require('../services/categorias.service');

function parseIncludeInactive(query) {
  const value = String(query.get('includeInactive') || query.get('all') || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on', 'all'].includes(value);
}

async function getCategorias(query) {
  const categorias = await listCategories({ includeInactive: parseIncludeInactive(query) });

  return {
    statusCode: 200,
    payload: categorias,
  };
}

async function getCategoria(id) {
  const categoria = await getCategoryById(id);

  if (!categoria) {
    throw Object.assign(new Error('Categoría no encontrada'), { statusCode: 404 });
  }

  return {
    statusCode: 200,
    payload: categoria,
  };
}

async function postCategoria(body) {
  const categoria = await createCategory(body);

  return {
    statusCode: 201,
    payload: categoria,
  };
}

async function putCategoria(id, body) {
  const categoria = await updateCategory(id, body);

  return {
    statusCode: 200,
    payload: categoria,
  };
}

async function deleteCategoria(id) {
  const result = await deleteCategory(id);

  return {
    statusCode: 200,
    payload: result,
  };
}

async function patchCategoriaActivo(id, body) {
  const categoria = await setCategoryActive(id, body?.activo);

  return {
    statusCode: 200,
    payload: categoria,
  };
}

module.exports = {
  deleteCategoria,
  getCategoria,
  getCategorias,
  patchCategoriaActivo,
  postCategoria,
  putCategoria,
};
