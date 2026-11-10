const { test } = require('node:test');
const assert = require('node:assert/strict');
let query;
let connect;
const pool = { query: (...args) => query(...args), connect: (...args) => connect(...args) };
require.cache[require.resolve('../src/database/connection')] = { exports: { pool } };
const caja = require('../src/services/caja.service');
const dashboard = require('../src/services/dashboard.service');
const pedidos = require('../src/services/pedidos.service');

test('cierre concurrente guarda una sola instantánea y conserva importes después de ajustes', async () => {
  let record = { id: 1, fecha: '2026-11-09', monto_inicial: 20, ventas: 0, gastos: 0, monto_final: 20, estado: 'abierta' };
  let movement = { ventas: 100, gastos: 30, pedidos: 2, lineas: 2, registros: 1 };
  let chain = Promise.resolve();
  let updates = 0;
  let released = 0;
  connect = async () => {
    let unlock;
    return {
      query: async (sql, params) => {
        if (sql.includes('pg_advisory_xact_lock')) {
          const before = chain;
          chain = new Promise((resolve) => { unlock = resolve; });
          await before;
        } else if (sql === 'COMMIT' || sql === 'ROLLBACK') unlock?.();
        else if (sql.includes('FROM cajas')) return { rows: [{ ...record }] };
        else if (sql.includes('SELECT v.*, g.*')) return { rows: [{ ...movement }] };
        else if (sql.includes('UPDATE cajas')) {
          updates += 1;
          record = { ...record, ventas: params[0], gastos: params[1], monto_final: params[2], estado: 'cerrada' };
          return { rows: [{ ...record }] };
        }
        return { rows: [] };
      },
      release: () => { released += 1; },
    };
  };
  const results = await Promise.all([caja.cerrarCaja({ fecha: record.fecha }), caja.cerrarCaja({ fecha: record.fecha })]);
  assert.equal(updates, 1);
  assert.equal(released, 2);
  assert.deepEqual(results.map((result) => result.status), ['cerrada', 'ya_cerrada']);
  assert.equal(results[0].caja.monto_final, 90);
  movement = { ...movement, ventas: 150 };
  const after = await caja.cerrarCaja({ fecha: record.fecha });
  assert.equal(after.resumen.ventas, 100);
  assert.equal(after.resumen.monto_final_estimado, 90);
  assert.equal(after.diferencia_desde_cierre, 50);
});

test('error al cerrar revierte y libera conexión', async () => {
  const commands = [];
  let released = false;
  connect = async () => ({ query: async (sql) => { commands.push(sql); return { rows: [] }; }, release: () => { released = true; } });
  await assert.rejects(caja.cerrarCaja({ fecha: '2026-11-09' }), { statusCode: 404 });
  assert.ok(commands.includes('ROLLBACK'));
  assert.ok(!commands.includes('COMMIT'));
  assert.equal(released, true);
});

test('resumen evita consultas repetidas para el mismo rango', async () => {
  const calls = [];
  query = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ ventas: 100, pedidos: 2, unidades: 3, utilidad: 60, gastos: 20, registros: 1 }] };
  };
  const result = await dashboard.getDashboardResumen(new URLSearchParams('preset=mes'));
  assert.equal(result.ventas_rango, 100);
  const keys = calls.map(({ sql, params }) => `${sql.includes('FROM gastos') ? 'gastos' : 'pedidos'}:${params.join(':')}`);
  assert.equal(keys.length, new Set(keys).size);
  assert.ok(calls.length <= 6, 'antes eran ocho consultas por resumen');
});

test('nuevas ventas usan costo de catálogo y ediciones conservan el costo guardado', async () => {
  let catalogCost = 40;
  let saved;
  query = async (sql, params) => {
    if (sql.startsWith('SELECT id, costo')) return { rows: [{ id: 1, costo: catalogCost }] };
    if (sql.includes('FROM pedidos WHERE id')) return { rows: [saved] };
    if (sql.includes('INSERT INTO pedidos') || sql.includes('UPDATE pedidos SET')) {
      saved = { id: 1, numero: params[0], cliente: params[1], items: JSON.parse(params[6]), subtotal: params[7], total: params[8], fecha: params[9], hora: params[10], entregado: params[11] };
      return { rows: [saved] };
    }
    throw new Error('Consulta inesperada');
  };
  const input = { numero: 1, fecha: '09/11/2026', hora: '12:00', total: 100, items: [{ id: 1, nombre: 'Producto', precio: 100, qty: 1, costo_unitario: 999 }] };
  const created = await pedidos.crearPedido(input);
  assert.equal(created.items[0].costo_unitario, 40);
  const tampered = await pedidos.crearPedido({ ...input, total: 1, subtotal: 1 });
  assert.equal(tampered.total, 100);
  assert.equal(tampered.subtotal, 100);
  catalogCost = 70;
  const updated = await pedidos.actualizarPedido(1, { items: input.items });
  assert.equal(updated.items[0].costo_unitario, 40);
  assert.equal(updated.total, 100);
  await assert.rejects(pedidos.crearPedido({ ...input, fecha: '31/02/2026' }), { statusCode: 400 });
});
