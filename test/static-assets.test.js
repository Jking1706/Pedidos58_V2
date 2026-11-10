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

for (const pathname of ['/api-client.js', '/pos-core.js', '/pos-gastos.js', '/pos-pedidos.js', '/pos-ui.js']) {
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
