const { test } = require('node:test');
const assert = require('node:assert/strict');
let query;
const pool = {
  query: (...args) => query(...args),
  connect: async () => ({
    query: async (...args) => query(...args),
    release: () => {},
  }),
};
require.cache[require.resolve('../src/database/connection')] = { exports: { pool } };
const pedidos = require('../src/services/pedidos.service');

const baseRow = {
  id: 1,
  numero: 7,
  cliente: 'Prueba Cola',
  telefono: null,
  direccion: null,
  metodoPago: null,
  notas: null,
  items: [{ id: 1, nombre: 'Arepa Dominó', qty: 1, precio: 10000, costo_unitario: 0 }],
  subtotal: 10000,
  total: 10000,
  fecha: '10/11/2026',
  hora: '10:00:00',
  entregado: false,
  estado: 'Nuevo',
  preparacion_at: null,
  listo_at: null,
};

function rowWith(overrides) {
  return { ...baseRow, ...overrides };
}

test('listarCola agrupa pedidos del día por estado y devuelve contadores y total activo', async () => {
  const todayRows = [
    rowWith({ id: 1, numero: 1, estado: 'Nuevo', total: 10000 }),
    rowWith({ id: 2, numero: 2, estado: 'En preparación', total: 12000 }),
    rowWith({ id: 3, numero: 3, estado: 'Listo', total: 9000 }),
    rowWith({ id: 4, numero: 4, estado: 'Entregado', entregado: true, total: 7000 }),
  ];
  query = async (sql) => {
    if (/^SELECT\s/i.test(sql)) return { rows: todayRows };
    throw new Error('Consulta inesperada: ' + sql);
  };

  const result = await pedidos.listarCola('10/11/2026');

  assert.equal(result.fecha, '10/11/2026');
  assert.equal(result.pedidos.length, 4);
  assert.equal(result.contadores['Nuevo'], 1);
  assert.equal(result.contadores['En preparación'], 1);
  assert.equal(result.contadores['Listo'], 1);
  assert.equal(result.contadores['Entregado'], 1);
  assert.equal(result.totalActivo, 31000);
});

test('transicionarPedido avanza Nuevo → En preparación y marca preparacion_at', async () => {
  const updateRow = rowWith({
    id: 11,
    numero: 22,
    estado: 'En preparación',
    preparacion_at: '2026-11-10T14:00:00Z',
  });
  const todayRows = [
    rowWith({ id: 11, numero: 22, estado: 'Nuevo', total: 10000 }),
  ];
  let updated = null;
  query = async (sql) => {
    if (/^SELECT\s/i.test(sql)) return { rows: [rowWith({ id: 11, numero: 22, estado: 'Nuevo', total: 10000 })] };
    if (/^UPDATE pedidos SET estado = \$1/i.test(sql)) {
      updated = { sql, params: sql.match(/\$\d+/g) };
      return { rowCount: 1, rows: [updateRow] };
    }
    throw new Error('Consulta inesperada: ' + sql);
  };

  const result = await pedidos.transicionarPedido(11, 'prep');

  assert.equal(result.estado, 'En preparación');
  assert.equal(result.numero, 22);
  assert.ok(updated, 'se ejecutó el UPDATE de transicionarPedido');
});

test('transicionarPedido avanza En preparación → Listo y marca listo_at', async () => {
  const updateRow = rowWith({
    id: 21,
    numero: 33,
    estado: 'Listo',
    listo_at: '2026-11-10T15:00:00Z',
  });
  query = async (sql) => {
    if (/^SELECT\s/i.test(sql)) return { rows: [rowWith({ id: 21, numero: 33, estado: 'En preparación' })] };
    if (/^UPDATE pedidos SET estado = \$1/i.test(sql)) return { rowCount: 1, rows: [updateRow] };
    throw new Error('Consulta inesperada: ' + sql);
  };

  const result = await pedidos.transicionarPedido(21, 'ready');

  assert.equal(result.estado, 'Listo');
  assert.equal(result.listo_at, '2026-11-10T15:00:00Z');
});

test('transicionarPedido rechaza transicion con estado incorrecto con 409', async () => {
  query = async (sql) => {
    if (/^SELECT\s/i.test(sql)) return { rows: [rowWith({ id: 31, numero: 44, estado: 'Entregado' })] };
    throw new Error('Consulta inesperada: ' + sql);
  };

  await assert.rejects(pedidos.transicionarPedido(31, 'prep'), (error) => {
    assert.equal(error.statusCode, 409);
    assert.equal(error.payload?.from, 'Entregado');
    assert.equal(error.payload?.to, 'En preparación');
    return true;
  });
});

test('transicionarPedido rechaza transición desconocida con 400', async () => {
  await assert.rejects(pedidos.transicionarPedido(1, 'cancelar'), { statusCode: 400 });
});

test('transicionarPedido es idempotente si ya está en el estado objetivo', async () => {
  const updateRow = rowWith({ id: 41, numero: 55, estado: 'En preparación', preparacion_at: '2026-11-10T16:00:00Z' });
  query = async (sql) => {
    if (/^SELECT\s/i.test(sql)) return { rows: [rowWith({ id: 41, numero: 55, estado: 'En preparación' })] };
    return { rows: [updateRow] };
  };

  const result = await pedidos.transicionarPedido(41, 'prep');
  assert.equal(result.estado, 'En preparación');
});

test('transicionarPedido 404 si el pedido no existe', async () => {
  query = async (sql) => {
    if (/^SELECT\s/i.test(sql)) return { rows: [] };
    throw new Error('Consulta inesperada: ' + sql);
  };

  await assert.rejects(pedidos.transicionarPedido(999, 'ready'), { statusCode: 404 });
});
