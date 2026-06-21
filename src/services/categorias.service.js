const { pool } = require('../database/connection');
const { INITIAL_CATEGORIES } = require('../data/catalogo-inicial');

function toInt(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  const text = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on', 'si', 'sí'].includes(text)) return true;
  if (['false', '0', 'no', 'off'].includes(text)) return false;
  return fallback;
}

function normalizeCategoryRow(row) {
  if (!row) return null;

  return {
    id: toInt(row.id),
    nombre: row.nombre,
    activo: normalizeBoolean(row.activo, true),
    orden: toInt(row.orden),
    created_at: row.created_at,
    updated_at: row.updated_at,
    producto_count: toInt(row.producto_count),
  };
}

function buildCategoryPayload(data, existing = null) {
  const nombre = data.nombre !== undefined ? normalizeText(data.nombre) : normalizeText(existing?.nombre);
  if (!nombre) {
    throw Object.assign(new Error('El nombre es obligatorio'), { statusCode: 400 });
  }

  const hasOrden = data.orden !== undefined && data.orden !== null && String(data.orden).trim() !== '';
  const orden = hasOrden ? toInt(data.orden) : (existing ? toInt(existing.orden) : null);

  if (hasOrden && orden <= 0) {
    throw Object.assign(new Error('El orden debe ser mayor a 0'), { statusCode: 400 });
  }

  return {
    nombre,
    activo: normalizeBoolean(data.activo, existing ? existing.activo : true),
    orden,
  };
}

async function getNextCategoryOrder() {
  const result = await pool.query('SELECT COALESCE(MAX(orden), 0) + 1 AS next_order FROM categorias');
  return toInt(result.rows[0]?.next_order || 1);
}

async function listCategories({ includeInactive = false } = {}) {
  const result = await pool.query(
    `SELECT c.id, c.nombre, c.activo, c.orden, c.created_at, c.updated_at, COUNT(p.id)::int AS producto_count
     FROM categorias c
     LEFT JOIN productos p ON p.categoria_id = c.id
     ${includeInactive ? '' : 'WHERE c.activo = TRUE'}
     GROUP BY c.id
     ORDER BY COALESCE(NULLIF(c.orden, 0), 2147483647), c.nombre ASC, c.id ASC`
  );

  return result.rows.map(normalizeCategoryRow);
}

async function getCategoryById(id) {
  const result = await pool.query(
    `SELECT c.id, c.nombre, c.activo, c.orden, c.created_at, c.updated_at, COUNT(p.id)::int AS producto_count
     FROM categorias c
     LEFT JOIN productos p ON p.categoria_id = c.id
     WHERE c.id = $1
     GROUP BY c.id`,
    [id]
  );

  return normalizeCategoryRow(result.rows[0]);
}

async function getCategoryByName(nombre) {
  const cleanName = normalizeText(nombre);
  if (!cleanName) return null;

  const result = await pool.query(
    `SELECT c.id, c.nombre, c.activo, c.orden, c.created_at, c.updated_at, COUNT(p.id)::int AS producto_count
     FROM categorias c
     LEFT JOIN productos p ON p.categoria_id = c.id
     WHERE c.nombre = $1
     GROUP BY c.id`,
    [cleanName]
  );

  return normalizeCategoryRow(result.rows[0]);
}

async function createCategory(data) {
  const payload = buildCategoryPayload(data);
  const orden = payload.orden ?? await getNextCategoryOrder();

  const result = await pool.query(
    `INSERT INTO categorias (nombre, activo, orden)
     VALUES ($1, $2, $3)
     RETURNING id, nombre, activo, orden, created_at, updated_at`,
    [payload.nombre, payload.activo, orden]
  );

  return normalizeCategoryRow({ ...result.rows[0], producto_count: 0 });
}

async function updateCategory(id, data) {
  const existing = await getCategoryById(id);
  if (!existing) {
    throw Object.assign(new Error('Categoría no encontrada'), { statusCode: 404 });
  }

  const payload = buildCategoryPayload(data, existing);
  const orden = payload.orden ?? existing.orden;

  const result = await pool.query(
    `UPDATE categorias
     SET nombre = $1,
         activo = $2,
         orden = $3,
         updated_at = NOW()
     WHERE id = $4
     RETURNING id, nombre, activo, orden, created_at, updated_at`,
    [payload.nombre, payload.activo, orden, id]
  );

  if (payload.nombre !== existing.nombre) {
    await pool.query(
      `UPDATE productos
       SET categoria = $1,
           updated_at = NOW()
       WHERE categoria_id = $2`,
      [payload.nombre, id]
    );
  }

  return normalizeCategoryRow({ ...result.rows[0], producto_count: existing.producto_count });
}

async function setCategoryActive(id, activo) {
  const existing = await getCategoryById(id);
  if (!existing) {
    throw Object.assign(new Error('Categoría no encontrada'), { statusCode: 404 });
  }

  const nextActivo = normalizeBoolean(activo, !existing.activo);
  const result = await pool.query(
    `UPDATE categorias
     SET activo = $1,
         updated_at = NOW()
     WHERE id = $2
     RETURNING id, nombre, activo, orden, created_at, updated_at`,
    [nextActivo, id]
  );

  return normalizeCategoryRow({ ...result.rows[0], producto_count: existing.producto_count });
}

async function deleteCategory(id) {
  const existing = await getCategoryById(id);
  if (!existing) {
    throw Object.assign(new Error('Categoría no encontrada'), { statusCode: 404 });
  }

  const linked = await pool.query('SELECT COUNT(*)::int AS count FROM productos WHERE categoria_id = $1', [id]);
  if (Number(linked.rows[0]?.count || 0) > 0) {
    throw Object.assign(new Error('No se puede eliminar una categoría con productos asociados'), { statusCode: 409 });
  }

  await pool.query('DELETE FROM categorias WHERE id = $1', [id]);
  return { ok: true };
}

async function seedCategoriasInicialesIfEmpty() {
  const result = await pool.query('SELECT COUNT(*)::int AS count FROM categorias');
  const count = Number(result.rows[0]?.count || 0);

  if (count > 0) {
    return false;
  }

  const legacy = await pool.query(
    `SELECT categoria AS nombre, MIN(id)::int AS first_id
     FROM productos
     WHERE COALESCE(categoria, '') <> ''
     GROUP BY categoria
     ORDER BY first_id ASC`
  );

  const source = legacy.rows.length
    ? legacy.rows.map((row, index) => ({ nombre: normalizeText(row.nombre), activo: true, orden: index + 1 }))
    : INITIAL_CATEGORIES;

  const values = source.flatMap((categoria) => [categoria.nombre, categoria.activo ?? true, categoria.orden]);
  const placeholders = source.map((_, index) => {
    const offset = index * 3;
    return `($${offset + 1}, $${offset + 2}, $${offset + 3})`;
  }).join(', ');

  await pool.query(
    `INSERT INTO categorias (nombre, activo, orden)
     VALUES ${placeholders}`,
    values
  );

  return true;
}

module.exports = {
  createCategory,
  deleteCategory,
  getCategoryById,
  getCategoryByName,
  listCategories,
  seedCategoriasInicialesIfEmpty,
  setCategoryActive,
  updateCategory,
};
