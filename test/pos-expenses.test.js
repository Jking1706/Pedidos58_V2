const { test } = require('node:test');
const assert = require('node:assert/strict');
let connect;
let syncCalls = 0;
require.cache[require.resolve('../src/database/connection')] = { exports: { pool: { connect: () => connect(), query: async () => ({ rows: [] }) } } };
require.cache[require.resolve('../src/services/googleSheets.service')] = { exports: { proxyGoogleSheets: async () => { syncCalls += 1; return { payload: { ok: false } }; } } };
const { registerPosExpense, normalizePurchase } = require('../src/services/pos-expenses.service');
const input = { operationId: '11111111-1111-4111-8111-111111111111', tipoEntrada: 'gasto', fecha: '09/11/2026', categoria: 'Insumos', descripcion: 'Compra de prueba', monto: 30 };

test('montos de carrito se calculan en servidor y se rechazan fechas o importes inválidos', () => {
  const purchase = normalizePurchase({ ...input, tipoEntrada: 'gasto_carrito', items: [{ categoria: 'Insumos', producto: 'Harina', cantidad: 3, precioFinal: 20, monto: 999 }] });
  assert.equal(purchase.lines[0].valor, 60);
  for (const data of [{ ...input, monto: -1 }, { ...input, fecha: '31/02/2026' }, { ...input, operationId: 'invalido' }]) {
    assert.throws(() => normalizePurchase(data), { statusCode: 400 });
  }
});

test('reintentos concurrentes no duplican gastos ni copias a Sheets', async () => {
  let record;
  let inserts = 0;
  let chain = Promise.resolve();
  const commands = [];
  connect = async () => {
    let unlock;
    return {
      query: async (sql, values) => {
        commands.push(sql);
        if (sql.includes('pg_advisory_xact_lock')) {
          const before = chain;
          chain = new Promise((resolve) => { unlock = resolve; });
          await before;
        } else if (sql === 'COMMIT' || sql === 'ROLLBACK') unlock?.();
        else if (sql.startsWith('SELECT payload_hash')) return { rows: record ? [record] : [] };
        else if (sql.startsWith('INSERT INTO gastos ')) return { rows: [{ id: ++inserts }] };
        else if (sql.startsWith('INSERT INTO gasto_operaciones')) record = { payload_hash: values[1], gasto_ids: values[2], sheets_status: 'pendiente' };
        return { rows: [] };
      }, release() {},
    };
  };
  const results = await Promise.all([registerPosExpense(input), registerPosExpense(input)]);
  assert.equal(inserts, 1);
  assert.equal(syncCalls, 1);
  assert.ok(results.every((result) => result.ok));
  assert.equal(results[0].sheets_status, 'revisar', 'un fallo de Sheets no pierde el gasto financiero');
  assert.equal(results[1].repetida, true);
  await assert.rejects(registerPosExpense({ ...input, monto: 99 }), { statusCode: 409 });
  assert.ok(commands.includes('ROLLBACK'));
  assert.equal(inserts, 1);
});
