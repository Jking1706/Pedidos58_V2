const { pool } = require('../database/connection');

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad(value) {
  return String(value).padStart(2, '0');
}

function toInt(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function toAmount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function todayIso(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isValidIsoDate(value) {
  return ISO_DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00`));
}

function normalizeExpenseRow(row) {
  if (!row) return null;

  return {
    id: toInt(row.id),
    descripcion: row.descripcion ?? '',
    categoria: row.categoria ?? '',
    valor: toAmount(row.valor),
    fecha: row.fecha ? String(row.fecha) : todayIso(),
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

  const hasFecha = data.fecha !== undefined && data.fecha !== null && String(data.fecha).trim() !== '';
  const fecha = hasFecha
    ? normalizeText(data.fecha)
    : normalizeText(existing?.fecha) || todayIso();

  if (!isValidIsoDate(fecha)) {
    throw Object.assign(new Error('La fecha debe tener formato YYYY-MM-DD'), { statusCode: 400 });
  }

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

function buildFilters({ page = 1, limit = 10, desde, hasta, categoria } = {}) {
  const conditions = [];
  const params = [];

  const pageNumber = Math.max(1, Math.trunc(Number(page) || 1));
  const limitNumber = Math.min(100, Math.max(1, Math.trunc(Number(limit) || 10)));

  if (desde) {
    if (!isValidIsoDate(desde)) {
      throw Object.assign(new Error('La fecha inicial debe tener formato YYYY-MM-DD'), { statusCode: 400 });
    }

    params.push(desde);
    conditions.push(`g.fecha >= $${params.length}::date`);
  }

  if (hasta) {
    if (!isValidIsoDate(hasta)) {
      throw Object.assign(new Error('La fecha final debe tener formato YYYY-MM-DD'), { statusCode: 400 });
    }

    params.push(hasta);
    conditions.push(`g.fecha <= $${params.length}::date`);
  }

  const categoriaText = normalizeText(categoria);
  if (categoriaText) {
    params.push(`%${categoriaText}%`);
    conditions.push(`g.categoria ILIKE $${params.length}`);
  }

  if (conditions.length >= 2) {
    const dateConditions = conditions.filter((condition) => condition.startsWith('g.fecha'));
    if (dateConditions.length === 2 && desde && hasta && desde > hasta) {
      const fromIndex = params.findIndex((value) => value === desde);
      const toIndex = params.findIndex((value) => value === hasta);
      if (fromIndex !== -1 && toIndex !== -1) {
        [params[fromIndex], params[toIndex]] = [params[toIndex], params[fromIndex]];
      }
    }
  }

  return {
    pageNumber,
    limitNumber,
    conditions,
    params,
  };
}

function buildWhereSql(conditions) {
  return conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
}

async function listGastos(options = {}) {
  const { pageNumber, limitNumber, conditions, params } = buildFilters(options);
  const whereSql = buildWhereSql(conditions);

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total, COALESCE(SUM(g.valor), 0)::numeric AS total_valor
     FROM gastos g
     ${whereSql}`,
    params
  );

  const total = toInt(countResult.rows[0]?.total);
  const totalPages = Math.max(1, Math.ceil(total / limitNumber));
  const currentPage = Math.min(pageNumber, totalPages);
  const offset = (currentPage - 1) * limitNumber;

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
     LIMIT $${params.length + 1}
     OFFSET $${params.length + 2}`,
    [...params, limitNumber, offset]
  );

  return {
    items: rowsResult.rows.map(normalizeExpenseRow),
    pagination: {
      page: currentPage,
      limit: limitNumber,
      total,
      totalPages,
    },
    summary: {
      totalValor: toAmount(countResult.rows[0]?.total_valor),
      totalRegistros: total,
    },
    filters: {
      desde: options.desde ? String(options.desde) : null,
      hasta: options.hasta ? String(options.hasta) : null,
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
