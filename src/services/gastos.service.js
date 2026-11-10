const { pool } = require('../database/connection');
const { formatIsoDate, parseIsoDate, resolveRange, toAmount, toInt } = require('./reporting.utils');

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeExpenseRow(row) {
  if (!row) return null;

  return {
    id: toInt(row.id),
    descripcion: row.descripcion ?? '',
    categoria: row.categoria ?? '',
    valor: toAmount(row.valor),
    fecha: row.fecha ? String(row.fecha) : null,
    observaciones: row.observaciones ?? '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function buildExpensePayload(data, existing = null) {
  const descripcion = data.descripcion !== undefined ? normalizeText(data.descripcion) : normalizeText(existing?.descripcion);
  if (!descripcion) {
    throw Object.assign(new Error('La descripción es obligatoria'), { statusCode: 400 });
  }

  const categoria = data.categoria !== undefined ? normalizeText(data.categoria) : normalizeText(existing?.categoria);
  if (!categoria) {
    throw Object.assign(new Error('La categoría es obligatoria'), { statusCode: 400 });
  }

  const hasValor = data.valor !== undefined && data.valor !== null && String(data.valor).trim() !== '';
  const valor = hasValor ? Number(data.valor) : toAmount(existing?.valor ?? 0);

  if (hasValor && !Number.isFinite(valor)) {
    throw Object.assign(new Error('El valor debe ser un número válido'), { statusCode: 400 });
  }

  if (valor <= 0) {
    throw Object.assign(new Error('El valor debe ser mayor a 0'), { statusCode: 400 });
  }

  const fecha = data.fecha !== undefined && String(data.fecha).trim() !== ''
    ? parseIsoDate(data.fecha, formatIsoDate(), 'La fecha')
    : normalizeText(existing?.fecha) || formatIsoDate();

  const observaciones = data.observaciones !== undefined
    ? normalizeText(data.observaciones)
    : normalizeText(existing?.observaciones ?? '');

  return {
    descripcion,
    categoria,
    valor: toAmount(valor),
    fecha,
    observaciones,
  };
}

function buildFilters(options = {}) {
  const range = resolveRange(options, { defaultPreset: 'mes' });
  const conditions = [];
  const params = [];

  if (range.desde) {
    params.push(range.desde);
    conditions.push(`g.fecha >= $${params.length}::date`);
  }

  if (range.hasta) {
    params.push(range.hasta);
    conditions.push(`g.fecha <= $${params.length}::date`);
  }

  const categoriaText = normalizeText(options.categoria);
  if (categoriaText) {
    params.push(`%${categoriaText}%`);
    conditions.push(`g.categoria ILIKE $${params.length}`);
  }

  return {
    range,
    conditions,
    params,
    pageNumber: Math.max(1, Math.trunc(Number(options.page) || 1)),
    limitNumber: Math.min(100, Math.max(1, Math.trunc(Number(options.limit) || 10))),
    exportMode: Boolean(options.export),
  };
}

function buildWhereSql(conditions) {
  return conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
}

async function listGastos(options = {}) {
  const { range, pageNumber, limitNumber, conditions, params, exportMode } = buildFilters(options);
  const whereSql = buildWhereSql(conditions);

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total, COALESCE(SUM(g.valor), 0)::numeric AS total_valor
     FROM gastos g
     ${whereSql}`,
    params
  );

  const total = toInt(countResult.rows[0]?.total);
  const totalPages = Math.max(1, Math.ceil(total / limitNumber));
  const currentPage = exportMode ? 1 : Math.min(pageNumber, totalPages);
  const effectiveLimit = exportMode ? Math.max(total, 1) : limitNumber;
  const offset = exportMode ? 0 : (currentPage - 1) * effectiveLimit;

  const rowsResult = await pool.query(
    `SELECT g.id,
            g.descripcion,
            g.categoria,
            g.valor,
            g.fecha,
            g.observaciones,
            g.created_at,
            g.updated_at
     FROM gastos g
     ${whereSql}
     ORDER BY g.fecha DESC, g.id DESC
     ${exportMode ? '' : `LIMIT $${params.length + 1} OFFSET $${params.length + 2}`}`,
    exportMode ? params : [...params, effectiveLimit, offset]
  );

  return {
    items: rowsResult.rows.map(normalizeExpenseRow),
    pagination: {
      page: currentPage,
      limit: exportMode ? total || 1 : effectiveLimit,
      total,
      totalPages,
    },
    summary: {
      totalValor: toAmount(countResult.rows[0]?.total_valor),
      totalRegistros: total,
    },
    filters: {
      preset: range.preset,
      desde: range.desde,
      hasta: range.hasta,
      categoria: normalizeText(options.categoria) || null,
    },
  };
}

async function getExpenseById(id) {
  const result = await pool.query(
    `SELECT g.id,
            g.descripcion,
            g.categoria,
            g.valor,
            g.fecha,
            g.observaciones,
            g.created_at,
            g.updated_at
     FROM gastos g
     WHERE g.id = $1`,
    [id]
  );

  return normalizeExpenseRow(result.rows[0]);
}

async function createExpense(data) {
  const payload = buildExpensePayload(data);
  const result = await pool.query(
    `INSERT INTO gastos (descripcion, categoria, valor, fecha, observaciones)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id,
               descripcion,
               categoria,
               valor,
               fecha,
               observaciones,
               created_at,
               updated_at`,
    [payload.descripcion, payload.categoria, payload.valor, payload.fecha, payload.observaciones]
  );

  return normalizeExpenseRow(result.rows[0]);
}

async function updateExpense(id, data) {
  const existing = await getExpenseById(id);
  if (!existing) {
    throw Object.assign(new Error('Gasto no encontrado'), { statusCode: 404 });
  }

  const payload = buildExpensePayload(data, existing);
  const result = await pool.query(
    `UPDATE gastos
     SET descripcion = $1,
         categoria = $2,
         valor = $3,
         fecha = $4,
         observaciones = $5,
         updated_at = NOW()
     WHERE id = $6
     RETURNING id,
               descripcion,
               categoria,
               valor,
               fecha,
               observaciones,
               created_at,
               updated_at`,
    [payload.descripcion, payload.categoria, payload.valor, payload.fecha, payload.observaciones, id]
  );

  return normalizeExpenseRow(result.rows[0]);
}

async function deleteExpense(id) {
  const result = await pool.query('DELETE FROM gastos WHERE id = $1 RETURNING id', [id]);

  if (!result.rowCount) {
    throw Object.assign(new Error('Gasto no encontrado'), { statusCode: 404 });
  }

  return { ok: true };
}

module.exports = {
  createExpense,
  deleteExpense,
  getExpenseById,
  listGastos,
  updateExpense,
};
