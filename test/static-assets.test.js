const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { createRequestHandler } = require('../src/server');

const STUBBED_USER = { username: 'qaadmin', role: 'admin' };

async function request(handler, method, pathname) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { method });
    const body = Buffer.from(await response.arrayBuffer());
    return { response, body };
  } finally {
    server.close();
    await once(server, 'close');
  }
}

for (const pathname of ['/api-client.js', '/pos-core.js', '/pos-gastos.js', '/pos-pedidos.js', '/pos-ui.js', '/pos-cola.js']) {
  test(`${pathname} responde 200 application/javascript para admin`, async () => {
    const handler = createRequestHandler({
      authService: {
        authenticate: async () => STUBBED_USER,
        logout: async () => {},
        login: async () => ({ token: 'a'.repeat(64), user: STUBBED_USER }),
      },
      apiHandler: async () => null,
    });
    const { response, body } = await request(handler, 'GET', pathname);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /application\/javascript/);
    const onDisk = fs.readFileSync(path.join(__dirname, '..', pathname));
    assert.equal(Buffer.compare(body, onDisk), 0);
  });
}

test('index.html tiene los delimitadores de plantilla completos (sin <style> abierto sin cerrar)', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const styleOpens = (html.match(/<style\b/gi) || []).length;
  const styleCloses = (html.match(/<\/style>/gi) || []).length;
  assert.equal(styleOpens, styleCloses, 'Etiquetas <style> desbalanceadas en index.html');
  const headOpen = html.indexOf('<head>');
  const headClose = html.indexOf('</head>');
  const bodyOpen = html.indexOf('<body>');
  assert.ok(headOpen >= 0 && headOpen < headClose && headClose < bodyOpen, 'head/body no están en orden esperado');
});
