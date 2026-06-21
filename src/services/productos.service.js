const { pool } = require('../database/connection');
const { getCategoryById, getCategoryByName, listCategories } = require('./categorias.service');
const { INITIAL_PRODUCTS } = require('../data/catalogo-inicial');

function toInt(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeNullableText(value) {
  const text = normalizeText(value);
  return text ? text : null;
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

function normalizeProductRow(row) {
  if (!row) return null;

  return {
    id: toInt(row.id),
    nombre: row.nombre,
    descripcion: row.descripcion ?? '',
    categoria_id: row.categoria_id != null ? toInt(row.categoria_id) : null,
    categoria: row.categoria_nombre ?? row.categoria ?? '',
    categoria_nombre: row.categoria_nombre ?? row.categoria ?? '',
    categoria_activo: row.categoria_activo != null ? normalizeBoolean(row.categoria_activo, true) : true,
    categoria_orden: row.categoria_orden != null ? toInt(row.categoria_orden) : 0,
    precio: toInt(row.precio),
    activo: normalizeBoolean(row.activo, true),
    imagen: row.imagen ?? null,
    orden: toInt(row.orden),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function resolveCategoryReference(data, existing = null) {
  const providedCategoryId = data.categoria_id !== undefined && data.categoria_id !== null && String(data.categoria_id).trim() !== ''
    ? toInt(data.categoria_id)
    : null;

  if (providedCategoryId) {
    const category = await getCategoryById(providedCategoryId);
    if (!category) {
      throw Object.assign(new Error('La categoría indicada no existe'), { statusCode: 404 });
    }
    return category;
  }

  const categoryName = data.categoria !== undefined
    ? normalizeText(data.categoria)
    : normalizeText(existing?.categoria_nombre || existing?.categoria);

  if (!categoryName) {
    throw Object.assign(new Error('La categoría es obligatoria'), { statusCode: 400 });
  }

  const category = await getCategoryByName(categoryName);
  if (!category) {
    throw Object.assign(new Error('La categoría indicada no existe'), { statusCode: 404 });
  }

  return category;
}

function buildProductPayload(data, existing = null) {
  const nombre = data.nombre !== undefined ? normalizeText(data.nombre) : normalizeText(existing?.nombre);
  if (!nombre) {
    throw Object.assign(new Error('El nombre es obligatorio'), { statusCode: 400 });
  }

  const precio = data.precio !== undefined ? toInt(data.precio) : toInt(existing?.precio);
  if (precio <= 0) {
    throw Object.assign(new Error('El precio debe ser mayor a 0'), { statusCode: 400 });
  }

  const descripcion = data.descripcion !== undefined
    ? normalizeText(data.descripcion)
    : normalizeText(existing?.descripcion);

  const imagen = data.imagen !== undefined
    ? normalizeNullableText(data.imagen)
    : existing?.imagen ?? null;

  const hasOrden = data.orden !== undefined && data.orden !== null && String(data.orden).trim() !== '';
  const orden = hasOrden
    ? toInt(data.orden)
    : (existing ? toInt(existing.orden) : null);

  if (hasOrden && orden <= 0) {
    throw Object.assign(new Error('El orden debe ser mayor a 0'), { statusCode: 400 });
  }

  const activo = data.activo !== undefined
    ? normalizeBoolean(data.activo, existing ? existing.activo : true)
    : (existing ? existing.activo : true);

  return {
    nombre,
    descripcion,
    precio,
    activo,
    imagen,
    orden,
  };
}

async function getNextProductOrder(categoryId) {
  const result = await pool.query(
    'SELECT COALESCE(MAX(orden), 0) + 1 AS next_order FROM productos WHERE categoria_id = $1',
    [categoryId]
  );
  return toInt(result.rows[0]?.next_order || 1);
}

async function listProducts({ includeInactive = false } = {}) {
  const result = await pool.query(
    `SELECT p.id,
            p.nombre,
            p.descripcion,
            p.categoria_id,
            c.nombre AS categoria_nombre,
            c.activo AS categoria_activo,
            c.orden AS categoria_orden,
            p.precio,
            p.activo,
            p.imagen,
            p.orden,
            p.created_at,
            p.updated_at
     FROM productos p
     JOIN categorias c ON c.id = p.categoria_id
     ${includeInactive ? '' : 'WHERE p.activo = TRUE AND c.activo = TRUE'}
     ORDER BY COALESCE(NULLIF(c.orden, 0), 2147483647), c.nombre ASC, COALESCE(NULLIF(p.orden, 0), 2147483647), p.nombre ASC, p.id ASC`
  );

  return result.rows.map(normalizeProductRow);
}

async function getProductById(id) {
  const result = await pool.query(
    `SELECT p.id,
            p.nombre,
            p.descripcion,
            p.categoria_id,
            c.nombre AS categoria_nombre,
            c.activo AS categoria_activo,
            c.orden AS categoria_orden,
            p.precio,
            p.activo,
            p.imagen,
            p.orden,
            p.created_at,
            p.updated_at
     FROM productos p
     JOIN categorias c ON c.id = p.categoria_id
     WHERE p.id = $1`,
    [id]
  );

  return normalizeProductRow(result.rows[0]);
}

async function createProduct(data) {
  const category = await resolveCategoryReference(data);
  const payload = buildProductPayload(data);
  const orden = payload.orden ?? await getNextProductOrder(category.id);

  const result = await pool.query(
    `INSERT INTO productos (nombre, descripcion, categoria_id, categoria, precio, activo, imagen, orden)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id,
               nombre,
               descripcion,
               categoria_id,
               categoria,
               precio,
               activo,
               imagen,
               orden,
               created_at,
               updated_at`,
    [
      payload.nombre,
      payload.descripcion,
      category.id,
      category.nombre,
      payload.precio,
      payload.activo,
      payload.imagen,
      orden,
    ]
  );

  return normalizeProductRow(result.rows[0]);
}

async function updateProduct(id, data) {
  const existing = await getProductById(id);
  if (!existing) {
    throw Object.assign(new Error('Producto no encontrado'), { statusCode: 404 });
  }

  const category = await resolveCategoryReference(data, existing);
  const payload = buildProductPayload(data, existing);
  const orden = payload.orden ?? existing.orden;

  const result = await pool.query(
    `UPDATE productos
     SET nombre = $1,
         descripcion = $2,
         categoria_id = $3,
         categoria = $4,
         precio = $5,
         activo = $6,
         imagen = $7,
         orden = $8,
         updated_at = NOW()
     WHERE id = $9
     RETURNING id,
               nombre,
               descripcion,
               categoria_id,
               categoria,
               precio,
               activo,
               imagen,
               orden,
               created_at,
               updated_at`,
    [
      payload.nombre,
      payload.descripcion,
      category.id,
      category.nombre,
      payload.precio,
      payload.activo,
      payload.imagen,
      orden,
      id,
    ]
  );

  return normalizeProductRow(result.rows[0]);
}

async function setProductActive(id, activo) {
  const existing = await getProductById(id);
  if (!existing) {
    throw Object.assign(new Error('Producto no encontrado'), { statusCode: 404 });
  }

  const nextActivo = normalizeBoolean(activo, !existing.activo);
  const result = await pool.query(
    `UPDATE productos
     SET activo = $1,
         updated_at = NOW()
     WHERE id = $2
     RETURNING id,
               nombre,
               descripcion,
               categoria_id,
               categoria,
               precio,
               activo,
               imagen,
               orden,
               created_at,
               updated_at`,
    [nextActivo, id]
  );

  return normalizeProductRow(result.rows[0]);
}

async function deleteProduct(id) {
  const result = await pool.query('DELETE FROM productos WHERE id = $1 RETURNING id', [id]);

  if (!result.rowCount) {
    throw Object.assign(new Error('Producto no encontrado'), { statusCode: 404 });
  }

  return { ok: true };
}

async function syncProductCategoryLinks() {
  const linked = await pool.query(
    `UPDATE productos p
     SET categoria_id = c.id,
         categoria = c.nombre,
         updated_at = NOW()
     FROM categorias c
     WHERE p.categoria_id IS NULL
       AND p.categoria = c.nombre
     RETURNING p.id`
  );

  const normalized = await pool.query(
    `UPDATE productos p
     SET categoria = c.nombre,
         updated_at = NOW()
     FROM categorias c
     WHERE p.categoria_id = c.id
       AND COALESCE(p.categoria, '') <> c.nombre
     RETURNING p.id`
  );

  return {
    linked: linked.rowCount,
    normalized: normalized.rowCount,
  };
}

async function seedProductosInicialesIfEmpty() {
  const result = await pool.query('SELECT COUNT(*)::int AS count FROM productos');
  const count = Number(result.rows[0]?.count || 0);

  if (count === 0) {
    const categories = await listCategories({ includeInactive: true });
    const categoryByName = new Map(categories.map((category) => [category.nombre, category]));

    const rows = INITIAL_PRODUCTS.map((producto) => {
      const category = categoryByName.get(producto.categoriaNombre);
      if (!category) {
        throw new Error(`No existe la categoría semilla: ${producto.categoriaNombre}`);
      }

      return {
        nombre: producto.nombre,
        descripcion: producto.descripcion,
        categoria_id: category.id,
        categoria: category.nombre,
        precio: producto.precio,
        activo: producto.activo,
        imagen: producto.imagen,
        orden: producto.orden,
      };
    });

    const values = rows.flatMap((producto) => [
      producto.nombre,
      producto.descripcion,
      producto.categoria_id,
      producto.categoria,
      producto.precio,
      producto.activo,
      producto.imagen,
      producto.orden,
    ]);

    const placeholders = rows.map((_, index) => {
      const offset = index * 8;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`;
    }).join(', ');

    await pool.query(
      `INSERT INTO productos (nombre, descripcion, categoria_id, categoria, precio, activo, imagen, orden)
       VALUES ${placeholders}`,
      values
    );

    return true;
  }

  let updatedCount = 0;

  for (const producto of INITIAL_PRODUCTS) {
    const existing = await pool.query(
      'SELECT id, descripcion, orden FROM productos WHERE nombre = $1 LIMIT 1',
      [producto.nombre]
    );

    if (!existing.rowCount) {
      continue;
    }

    const row = existing.rows[0];
    const needsDescripcion = !normalizeText(row.descripcion);
    const needsOrden = toInt(row.orden) <= 0;

    if (!needsDescripcion && !needsOrden) {
      continue;
    }

    await pool.query(
      `UPDATE productos
       SET descripcion = CASE WHEN COALESCE(descripcion, '') = '' THEN $1 ELSE descripcion END,
           orden = CASE WHEN COALESCE(orden, 0) = 0 THEN $2 ELSE orden END,
           updated_at = NOW()
       WHERE id = $3`,
      [producto.descripcion, producto.orden, row.id]
    );
    updatedCount += 1;
  }

  return updatedCount > 0;
}

module.exports = {
  deleteProduct,
  getProductById,
  listProducts,
  seedProductosInicialesIfEmpty,
  setProductActive,
  syncProductCategoryLinks,
  updateProduct,
  createProduct,
};
