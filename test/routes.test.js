const { test } = require('node:test');
const assert = require('node:assert/strict');
let query;
const pool = {
  query: (...args) => query(...args),
  connect: async () => ({ query: async () => ({ rows: [] }), release: () => {} }),
};
require.cache[require.resolve('../src/database/connection')] = { exports: { pool } };

const { handleApiRoute } = require('../src/routes/api.routes');
const { handleCaja } = require('../src/routes/caja.routes');
const { handleGastos } = require('../src/routes/gastos.routes');
const { handleProductos } = require('../src/routes/productos.routes');

function context(pathname, method = 'GET', queryString = '', body) {
  return {
    method,
    pathname,
    query: new URLSearchParams(queryString),
    body,
    res: {},
  };
}

test('handleApiRoute devuelve null para rutas no registradas', async () => {
  const result = await handleApiRoute(context('/api/rutas-inexistentes'));
  assert.equal(result, null);
});

test('handleProductos responde el catálogo con productos activos', async () => {
  query = async () => ({
    rows: [{ id: 1, nombre: 'Arepa', descripcion: '', categoria_id: 1, categoria_nombre: 'Comida', categoria_activo: true, categoria_orden: 1, precio: 8000, costo: 0, activo: true, imagen: null, orden: 1 }],
  });

  const result = await handleProductos(context('/api/productos'));
  assert.equal(result.statusCode, 200);
  assert.ok(Array.isArray(result.payload));
});

test('handleProductos rechaza identificadores no numéricos', async () => {
  assert.equal(await handleProductos(context('/api/productos/abc')), null);
  await assert.rejects(handleProductos(context('/api/productos/0')), { statusCode: 400 });
});

test('handleCaja responde la caja del día', async () => {
  query = async () => ({ rows: [] });

  const result = await handleCaja(context('/api/caja'));
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.fecha, '2026-11-10');
});

test('handleCaja cierra una fecha sin caja registrada', async () => {
  await assert.rejects(handleCaja(context('/api/caja/cerrar', 'POST', '', {})), { statusCode: 404 });
});

test('handleGastos responde el listado de gastos', async () => {
  query = async () => ({ rows: [] });

  const result = await handleGastos(context('/api/gastos'));
  assert.equal(result.statusCode, 200);
});
