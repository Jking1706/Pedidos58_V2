const { pool } = require('../database/connection');
const {
  formatIsoDate,
  isoToOrderDate,
  parseIsoDate,
  resolveRange,
  toAmount,
  toInt,
} = require('./reporting.utils');

function normalizeCajaRow(row) {
  if (!row) return null;

  return {
    id: toInt(row.id),
    fecha: row.fecha ? String(row.fecha) : formatIsoDate(),
    monto_inicial: toAmount(row.monto_inicial),
    ventas: toAmount(row.ventas),
    gastos: toAmount(row.gastos),
    monto_final: toAmount(row.monto_final),
    estado: row.estado || 'abierta',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getMovimientoDiario(fechaIso, db = pool) {
  const fechaPedido = isoToOrderDate(fechaIso);

  // Una sola instantánea SQL para ventas y gastos, incluso con escrituras concurrentes.
  const ventasResult = await db.query(
    `SELECT v.*, g.* FROM
      (SELECT COALESCE(SUM(total), 0)::numeric AS ventas, COUNT(*)::int AS pedidos,
              COALESCE(SUM(jsonb_array_length(items)), 0)::int AS lineas
       FROM pedidos WHERE fecha = $1) v
      CROSS JOIN
      (SELECT COALESCE(SUM(valor), 0)::numeric AS gastos, COUNT(*)::int AS registros
       FROM gastos WHERE fecha = $2::date) g`,
    [fechaPedido, fechaIso]
  );
  const gastosResult = ventasResult;

  const ventas = toAmount(ventasResult.rows[0]?.ventas);
  const gastos = toAmount(gastosResult.rows[0]?.gastos);
  const pedidos = toInt(ventasResult.rows[0]?.pedidos);
  const lineas = toInt(ventasResult.rows[0]?.lineas);
  const registrosGastos = toInt(gastosResult.rows[0]?.registros);

  return {
    fecha: fechaIso,
    fecha_pedidos: fechaPedido,
    ventas,
    gastos,
    utilidad_operativa: toAmount(ventas - gastos),
    pedidos,
    lineas,
    registrosGastos,
  };
}

async function getCajaByFecha(fechaIso, db = pool) {
  const result = await db.query(
    `SELECT id,
            fecha,
            monto_inicial,
            ventas,
            gastos,
            monto_final,
            estado,
            created_at,
            updated_at
     FROM cajas
     WHERE fecha = $1::date
     LIMIT 1`,
    [fechaIso]
  );

  return normalizeCajaRow(result.rows[0]);
}

function buildCajaResponse(caja, movimiento) {
  const montoInicial = toAmount(caja?.monto_inicial ?? 0);
  const cerrada = caja?.estado === 'cerrada';
  const ventas = toAmount(cerrada ? caja.ventas : movimiento.ventas);
  const gastos = toAmount(cerrada ? caja.gastos : movimiento.gastos);
  const montoFinalCalculado = toAmount(montoInicial + ventas - gastos);

  return {
    caja: caja
      ? {
          ...caja,
          ventas_calculadas: ventas,
          gastos_calculados: gastos,
          monto_final_calculado: caja.estado === 'cerrada' ? toAmount(caja.monto_final) : montoFinalCalculado,
          utilidad_operativa: toAmount(ventas - gastos),
        }
      : null,
    resumen: {
      fecha: movimiento.fecha,
      fecha_pedidos: movimiento.fecha_pedidos,
      ventas,
      gastos,
      utilidad_operativa: toAmount(ventas - gastos),
      pedidos: movimiento.pedidos,
      lineas: movimiento.lineas,
      registros_gastos: movimiento.registrosGastos,
      monto_inicial: montoInicial,
      monto_final_estimado: montoFinalCalculado,
    },
    movimientos_actuales: movimiento,
    diferencia_desde_cierre: cerrada ? toAmount(montoInicial + movimiento.ventas - movimiento.gastos - caja.monto_final) : 0,
  };
}

function resolveCajaFecha(data = {}) {
  if (data.fecha !== undefined && String(data.fecha).trim() !== '') {
    return parseIsoDate(data.fecha, formatIsoDate(), 'La fecha de la caja');
  }

  return resolveRange(data, { defaultPreset: 'hoy' }).desde;
}

async function listCaja({ fecha } = {}) {
  const fechaIso = resolveRange({ desde: fecha, hasta: fecha }, { defaultPreset: 'hoy' }).desde;
  const [caja, movimiento, historialResult] = await Promise.all([
    getCajaByFecha(fechaIso),
    getMovimientoDiario(fechaIso),
    pool.query(
      `SELECT id,
              fecha,
              monto_inicial,
              ventas,
              gastos,
              monto_final,
              estado,
              created_at,
              updated_at
       FROM cajas
       WHERE estado = 'cerrada'
       ORDER BY fecha DESC, id DESC
       LIMIT 10`
    ),
  ]);

  const historial = historialResult.rows.map(normalizeCajaRow);
  return {
    fecha: fechaIso,
    ...buildCajaResponse(caja, movimiento),
    historial,
  };
}

async function abrirCajaCore(data, db) {
  const fechaIso = resolveCajaFecha(data);
  const rawAmount = Number(data.monto_inicial ?? data.montoInicial ?? data.monto ?? 0);
  if (!Number.isFinite(rawAmount)) throw Object.assign(new Error('El monto inicial debe ser un número válido'), { statusCode: 400 });
  const montoInicial = toAmount(rawAmount);

  if (montoInicial < 0) {
    throw Object.assign(new Error('El monto inicial no puede ser menor a 0'), { statusCode: 400 });
  }

  const existente = await getCajaByFecha(fechaIso, db);
  if (existente) {
    if (existente.estado === 'abierta') {
      const movimiento = await getMovimientoDiario(fechaIso, db);
      return {
        status: 'ya_abierta',
        ...buildCajaResponse(existente, movimiento),
      };
    }

    throw Object.assign(new Error('Ya existe una caja cerrada para esa fecha'), { statusCode: 409 });
  }

  const result = await db.query(
    `INSERT INTO cajas (fecha, monto_inicial, ventas, gastos, monto_final, estado)
     VALUES ($1::date, $2, 0, 0, $2, 'abierta')
     RETURNING id,
               fecha,
               monto_inicial,
               ventas,
               gastos,
               monto_final,
               estado,
               created_at,
               updated_at`,
    [fechaIso, montoInicial]
  );

  const caja = normalizeCajaRow(result.rows[0]);
  const movimiento = await getMovimientoDiario(fechaIso, db);

  return {
    status: 'abierta',
    ...buildCajaResponse(caja, movimiento),
  };
}

async function cerrarCajaCore(data, db) {
  const fechaIso = resolveCajaFecha(data);
  const caja = await getCajaByFecha(fechaIso, db);

  if (!caja) {
    throw Object.assign(new Error('No existe una caja abierta para esa fecha'), { statusCode: 404 });
  }

  if (caja.estado === 'cerrada') {
    const movimiento = await getMovimientoDiario(fechaIso, db);
    return {
      status: 'ya_cerrada',
      ...buildCajaResponse(caja, movimiento),
    };
  }

  const movimiento = await getMovimientoDiario(fechaIso, db);
  const montoFinal = toAmount(caja.monto_inicial + movimiento.ventas - movimiento.gastos);

  const result = await db.query(
    `UPDATE cajas
     SET ventas = $1,
         gastos = $2,
         monto_final = $3,
         estado = 'cerrada',
         updated_at = NOW()
     WHERE id = $4
     RETURNING id,
               fecha,
               monto_inicial,
               ventas,
               gastos,
               monto_final,
               estado,
               created_at,
               updated_at`,
    [movimiento.ventas, movimiento.gastos, montoFinal, caja.id]
  );

  return {
    status: 'cerrada',
    ...buildCajaResponse(normalizeCajaRow(result.rows[0]), movimiento),
  };
}

async function cajaTransaction(data, operation) {
  const fecha = resolveCajaFecha(data);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Mismo bloqueo para abrir y cerrar: serializa operaciones sobre una fecha.
    await client.query('SELECT pg_advisory_xact_lock(58002, hashtext($1))', [fecha]);
    const result = await operation({ ...data, fecha }, client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

const abrirCaja = (data = {}) => cajaTransaction(data, abrirCajaCore);
const cerrarCaja = (data = {}) => cajaTransaction(data, cerrarCajaCore);

module.exports = {
  abrirCaja,
  cerrarCaja,
  getCajaByFecha,
  getMovimientoDiario,
  listCaja,
};
