const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const helpers = require('../report-tools');

function dashboardFixture() {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '', classList: { toggle() {} } });
    return elements.get(id);
  };
  get('range-from').value = '2026-11-01';
  get('range-to').value = '2026-11-09';
  const requests = [];
  const books = [];
  const context = vm.createContext({
    URLSearchParams, Intl, Date,
    window: { location: { origin: 'http://test.local' } },
    document: { body: { classList: { toggle() {} } }, getElementById: get, querySelectorAll: () => [] },
    ReportTools: { ...helpers, load: async () => {} },
    XLSX: { utils: {
      book_new: () => ({ sheets: {} }), json_to_sheet: (rows) => ({ rows }),
      book_append_sheet: (book, sheet, name) => { book.sheets[name] = sheet; },
    }, writeFile: (book, name) => books.push({ book, name }) },
    fetch: async (url) => {
      requests.push(url);
      let payload;
      if (url.includes('productos-ranking')) payload = { reporte: [{ producto: 'Nuevo', cantidad_vendida: 3, costo: 20, precio: 40, utilidad: 60 }] };
      else if (url.includes('/gastos/')) payload = { items: [{ fecha: '2026-11-09', valor: 20 }] };
      else payload = [{ fecha: '09/11/2026', numero: 1, total: 100 }, { fecha: '09/11/2026', numero: 2, total: 50 }];
      return { ok: true, text: async () => JSON.stringify(payload) };
    },
  });
  const html = fs.readFileSync(path.join(__dirname, '../admin-dashboard.html'), 'utf8');
  const script = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1];
  vm.runInContext(script.slice(0, script.indexOf("    presetButtons.forEach((button) => {\n      button.addEventListener")), context);
  return { context, requests, books, get };
}

test('Excel ventas separa detalle y gastos diarios sin multiplicar egresos', async () => {
  const fixture = dashboardFixture();
  await fixture.context.exportVentasExcel();
  const { book, name } = fixture.books[0];
  assert.equal(name, 'ventas-20261101_20261109.xlsx');
  assert.equal(book.sheets.Ventas.rows.length, 2);
  assert.equal(book.sheets.Ventas.rows[0].Gastos, undefined);
  assert.equal(book.sheets['Resumen diario'].rows[0].Gastos, 20);
  assert.equal(book.sheets['Resumen diario'].rows[0].Ventas, 150);
  assert.equal(fixture.get('export-ventas-btn').disabled, false);
});

test('Excel productos consulta el rango actual en lugar de reutilizar ranking viejo', async () => {
  const fixture = dashboardFixture();
  vm.runInContext("state.ranking = { reporte: [{ producto: 'Obsoleto' }] }", fixture.context);
  await fixture.context.exportProductosExcel();
  assert.ok(fixture.requests[0].includes('desde=2026-11-01'));
  assert.equal(fixture.books[0].book.sheets.Productos.rows[0].Producto, 'Nuevo');
});
