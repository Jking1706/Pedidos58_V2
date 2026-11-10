const assert = require('node:assert/strict');
const { test } = require('node:test');
const { handleHealth } = require('../src/routes/health.routes');

function context(pathname, method = 'GET') {
  return {
    method,
    pathname,
    query: new URLSearchParams(),
    body: undefined,
    res: {},
  };
}

test('health responde ok con estado y base de datos conectada', async () => {
  const result = await handleHealth(context('/api/health'));

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.status, 'ok');
  assert.equal(result.payload.database, 'connected');
});

test('health no responde otras rutas', async () => {
  const result = await handleHealth(context('/api/otra-ruta'));

  assert.equal(result, null);
});
