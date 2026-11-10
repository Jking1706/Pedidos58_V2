const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Readable } = require('node:stream');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { readJsonBody, getCorsHeaders, errorResult } = require('../src/utils/http');

function request(body, contentType = 'application/json') {
  const req = Readable.from([Buffer.from(body)]);
  req.headers = { 'content-type': contentType };
  return req;
}

test('preserva caracteres UTF-8 y objetos JSON válidos', async () => {
  const req = Readable.from([...Buffer.from('{"cliente":"José"}')].map((byte) => Buffer.from([byte])));
  req.headers = { 'content-type': 'application/json; charset=utf-8' };
  assert.deepEqual(await readJsonBody(req), { cliente: 'José' });
});

test('rechaza JSON inválido y tipos no admitidos', async () => {
  for (const body of ['{', 'null', '[]', '"texto"', '123']) {
    await assert.rejects(readJsonBody(request(body)), { statusCode: 400 });
  }
  await assert.rejects(readJsonBody(request('{}', 'text/plain')), { statusCode: 415 });
});

test('limita solicitudes grandes', async () => {
  await assert.rejects(readJsonBody(request(JSON.stringify({ notas: 'a'.repeat(1024 * 1024) }))), { statusCode: 413 });
});

test('no expone errores internos ni permite CORS universal', () => {
  assert.equal(getCorsHeaders()['Access-Control-Allow-Origin'], undefined);
  assert.deepEqual(errorResult(new Error('password=secreto')), {
    statusCode: 500, payload: { error: 'Error interno del servidor' },
  });
  assert.equal(errorResult(Object.assign(new Error('Fecha inválida'), { statusCode: 400 })).statusCode, 400);
});

test('render de pedidos neutraliza HTML almacenado', () => {
  const html = fs.readFileSync(path.join(__dirname, '../admin.html'), 'utf8');
  const source = html.slice(html.indexOf('function esc('), html.indexOf('function renderResumenPeriodo('));
  const elements = { 'tbody-pedidos': {}, 'tabla-info': {}, 'tabla-sum': {} };
  const context = vm.createContext({ document: { getElementById: (id) => elements[id] }, fmt: String });
  vm.runInContext(source, context);
  const attack = '<img src=x onerror=alert(1)>';
  context.renderTabla([{ numero: 1, cliente: attack, notas: attack, items: [{ qty: 1, nombre: attack }], total: 10, hora: attack, fecha: attack }]);
  assert.ok(!elements['tbody-pedidos'].innerHTML.includes('<img'));
  assert.ok(elements['tbody-pedidos'].innerHTML.includes('&lt;img'));
});
