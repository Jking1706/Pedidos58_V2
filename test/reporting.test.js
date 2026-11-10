const { test } = require('node:test');
const assert = require('node:assert/strict');
const reporting = require('../src/services/reporting.utils');
const client = require('../report-tools');

test('valida calendario real, año bisiesto y rango máximo', () => {
  assert.equal(reporting.parseIsoDate('2024-02-29'), '2024-02-29');
  for (const value of ['2025-02-29', '2026-04-31', '0000-01-01', '2026-13-01']) {
    assert.throws(() => reporting.parseIsoDate(value), { statusCode: 400 });
    assert.throws(() => client.range(value, '2026-11-09'));
  }
  assert.throws(() => reporting.resolveRange({ desde: '2020-01-01', hasta: '2026-01-01' }), { statusCode: 400 });
  assert.equal(reporting.rangeDays('2024-03-01', '2024-03-31'), 31);
});

test('Esta semana empieza el lunes y frontend/backend coinciden en Bogotá', () => {
  const now = new Date('2026-11-09T02:00:00Z'); // Sigue siendo domingo en Bogotá.
  assert.equal(client.today(now), '2026-11-08');
  const back = reporting.resolvePresetRange('semana', reporting.businessDate(now));
  assert.deepEqual(client.preset('semana', now), { from: back.desde, to: back.hasta });
  assert.equal(back.desde, '2026-11-02');
  assert.equal(reporting.resolvePresetRange('semana', new Date(2026, 10, 9)).desde, '2026-11-09');
});

test('resumen diario no duplica gastos y conserva días sin ventas', () => {
  const rows = client.dailySummary([
    { fecha: '08/11/2026', total: 100 }, { fecha: '08/11/2026', total: 200 },
  ], [{ fecha: '2026-11-08', valor: 40 }, { fecha: '2026-11-09', valor: 10 }]);
  assert.equal(rows.reduce((sum, row) => sum + row.Gastos, 0), 50);
  assert.deepEqual(rows[0], { Fecha: '2026-11-08', Ventas: 300, Gastos: 40, 'Saldo operativo': 260 });
  assert.equal(rows[1]['Saldo operativo'], -10);
});
