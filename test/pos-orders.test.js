const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture(fetchWithTimeout) {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', disabled: false });
    return elements.get(id);
  };
  const context = vm.createContext({
    Date, TypeError, window: {},
    document: { getElementById: get }, fetchWithTimeout,
    API: '/api', carrito: { 1: { id: 1, nombre: 'Arepa', qty: 2, precio: 8000 } },
    pedidos: [], pedidoCount: 0,
    calcTotal: () => 16000, leerDatosPedido: () => ({ cliente: 'Prueba' }), fechaHoy: () => '09/11/2026',
    limpiarCamposPedido() {}, actualizarUI() {}, actualizarStatusBar() {}, mostrarToast() {},
    esVistaMovil: () => false, enviarPedidoASheets: async () => {},
  });
  const html = fs.readFileSync(path.join(__dirname, '../pos-pedidos.js'), 'utf8');
  const start = html.indexOf('let guardandoPedido = false;');
  const end = html.indexOf('// ─── STATUS BAR', start);
  vm.runInContext(html.slice(start, end), context);
  const mutationStart = html.indexOf('const pedidosEnProceso = new Set();');
  vm.runInContext(html.slice(mutationStart, html.indexOf('function filtrarEdit', mutationStart)), context);
  return { context, get };
}

test('POS conserva carrito y no anuncia un guardado cuando HTTP rechaza el pedido', async () => {
  const { context, get } = fixture(async () => ({ ok: false, status: 500 }));
  await context.confirmarPedido();
  assert.equal(context.carrito[1].qty, 2);
  assert.equal(context.pedidos.length, 0);
  assert.equal(context.pedidoCount, 0);
  assert.match(get('order-feedback').textContent, /rechazó/);
  assert.equal(get('btn-guardar').disabled, false);
});

test('POS conserva datos ante respuesta perdida y advierte de revisar antes de reintentar', async () => {
  const { context, get } = fixture(async () => { throw new TypeError('Failed to fetch'); });
  await context.confirmarPedido();
  assert.equal(context.carrito[1].qty, 2);
  assert.match(get('order-feedback').textContent, /evitar duplicados/);
});

test('POS bloquea doble envío y vacía el carrito solo tras confirmación', async () => {
  let resolve;
  let calls = 0;
  const { context } = fixture(() => { calls++; return new Promise(done => { resolve = done; }); });
  const first = context.confirmarPedido();
  await context.confirmarPedido();
  assert.equal(calls, 1);
  assert.equal(context.carrito[1].qty, 2);
  resolve({ ok: true, json: async () => ({ id: 7, numero: 1, total: 16000 }) });
  await first;
  assert.equal(Object.keys(context.carrito).length, 0);
  assert.equal(context.pedidos[0].id, 7);
});

test('POS no cambia un pedido ni envía a Sheets cuando falla su edición', async () => {
  const { context } = fixture(async () => ({ ok: false, status: 403 }));
  context.pedidos = [{ id: 1, total: 16000, entregado: false }];
  let sheets = 0;
  context.enviarPedidoASheets = async () => { sheets++; };
  const ok = await context.sincPedido({ id: 1, total: 24000, entregado: true });
  assert.equal(ok, false);
  assert.equal(context.pedidos[0].total, 16000);
  assert.equal(context.pedidos[0].entregado, false);
  assert.equal(sheets, 0);
});
