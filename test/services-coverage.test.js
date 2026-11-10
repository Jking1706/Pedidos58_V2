const { test } = require('node:test');
const assert = require('node:assert/strict');
let query;
let connect;
const pool = { query: (...args) => query(...args), connect: (...args) => connect(...args) };
require.cache[require.resolve('../src/database/connection')] = { exports: { pool } };
const caja = require('../src/services/caja.service');
const gastos = require('../src/services/gastos.service');
const productos = require('../src/services/productos.service');
const categorias = require('../src/services/categorias.service');
const dashboard = require('../src/services/dashboard.service');
const { proxyGoogleSheets } = require('../src/services/googleSheets.service');
const { createAuth } = require('../src/services/auth.service');

test('listCaja arma resumen de caja abierta con movimiento del dia', async () => {
  query = async (sql) => {
    if (sql.includes("WHERE estado = 'cerrada'")) return { rows: [] };
    if (sql.includes('WHERE fecha = $1::date')) {
      return { rows: [{ id: 1, fecha: '2026-11-10', monto_inicial: '20', ventas: '0', gastos: '0', monto_final: '20', estado: 'abierta', created_at: null, updated_at: null }] };
    }
    if (sql.includes('CROSS JOIN')) return { rows: [{ ventas: '100', pedidos: 2, lineas: 2, gastos: '30', registros: 1 }] };
    throw new Error('Consulta inesperada: ' + sql);
  };

  const result = await caja.listCaja({ fecha: '2026-11-10' });

  assert.equal(result.fecha, '2026-11-10');
  assert.equal(result.caja.estado, 'abierta');
  assert.equal(result.caja.ventas_calculadas, 100);
  assert.equal(result.caja.gastos_calculados, 30);
  assert.equal(result.caja.monto_final_calculado, 90);
  assert.equal(result.caja.utilidad_operativa, 70);
  assert.equal(result.resumen.ventas, 100);
  assert.equal(result.resumen.gastos, 30);
  assert.equal(result.resumen.utilidad_operativa, 70);
  assert.equal(result.resumen.monto_final_estimado, 90);
  assert.equal(result.resumen.pedidos, 2);
  assert.equal(result.resumen.lineas, 2);
  assert.equal(result.resumen.registros_gastos, 1);
  assert.equal(result.resumen.monto_inicial, 20);
  assert.equal(result.diferencia_desde_cierre, 0);
  assert.deepEqual(result.historial, []);
});

test('abrirCaja con monto inicial negativo responde 400', async () => {
  connect = async () => ({
    query: async (sql) => {
      if (sql === 'BEGIN') return { rows: [] };
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (sql === 'ROLLBACK') return { rows: [] };
      throw new Error('Consulta inesperada: ' + sql);
    },
    release: () => {},
  });

  await assert.rejects(caja.abrirCaja({ fecha: '2026-11-10', monto_inicial: -5 }), { statusCode: 400 });
});

test('abrirCaja cuando ya hay caja abierta responde ya_abierta', async () => {
  connect = async () => ({
    query: async (sql) => {
      if (sql === 'BEGIN') return { rows: [] };
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (sql.includes('WHERE fecha = $1::date')) {
        return { rows: [{ id: 5, fecha: '2026-11-10', monto_inicial: '10', ventas: '0', gastos: '0', monto_final: '10', estado: 'abierta', created_at: null, updated_at: null }] };
      }
      if (sql.includes('CROSS JOIN')) return { rows: [{ ventas: '50', pedidos: 1, lineas: 1, gastos: '0', registros: 0 }] };
      if (sql === 'COMMIT') return { rows: [] };
      if (sql === 'ROLLBACK') return { rows: [] };
      throw new Error('Consulta inesperada: ' + sql);
    },
    release: () => {},
  });

  const result = await caja.abrirCaja({ fecha: '2026-11-10', monto_inicial: 10 });
  assert.equal(result.status, 'ya_abierta');
  assert.equal(result.caja.estado, 'abierta');
});

test('gastos.createExpense rechaza valor invalido', async () => {
  await assert.rejects(
    gastos.createExpense({ descripcion: 'Insumo de cocina', categoria: 'Insumos', valor: 0 }),
    { statusCode: 400 }
  );
});

test('gastos.listGastos aplica filtro de categoria y arma paginacion', async () => {
  query = async (sql) => {
    if (sql.includes('SELECT COUNT(*)')) return { rows: [{ total: 2, total_valor: '150' }] };
    if (sql.includes('FROM gastos g')) {
      return { rows: [
        { id: 2, descripcion: 'Pan', categoria: 'Insumos', valor: '80', fecha: '2026-11-08', observaciones: '', created_at: null, updated_at: null },
        { id: 1, descripcion: 'Madera', categoria: 'Insumos', valor: '70', fecha: '2026-11-07', observaciones: '', created_at: null, updated_at: null },
      ] };
    }
    throw new Error('Consulta inesperada: ' + sql);
  };

  const result = await gastos.listGastos({ categoria: 'Insumos', page: 1, limit: 10 });

  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].descripcion, 'Pan');
  assert.equal(result.items[0].valor, 80);
  assert.equal(result.pagination.total, 2);
  assert.equal(result.pagination.totalPages, 1);
  assert.equal(result.summary.totalValor, 150);
  assert.equal(result.summary.totalRegistros, 2);
  assert.equal(result.filters.categoria, 'Insumos');
});

test('productos.listProducts respeta includeInactive', async () => {
  const queries = [];
  query = async (sql) => {
    queries.push(sql);
    if (sql.includes('FROM productos p')) {
      return { rows: [{ id: 1, nombre: 'Coco', descripcion: '', categoria_id: 2, categoria: 'Bebidas', categoria_nombre: 'Bebidas', categoria_activo: true, categoria_orden: 1, precio: '5000', costo: '2000', activo: true, imagen: null, orden: 1, created_at: null, updated_at: null }] };
    }
    throw new Error('Consulta inesperada: ' + sql);
  };

  const activos = await productos.listProducts({ includeInactive: false });
  assert.equal(activos.length, 1);
  assert.equal(activos[0].nombre, 'Coco');
  assert.equal(activos[0].precio, 5000);
  assert.ok(queries[0].includes('WHERE p.activo = TRUE AND c.activo = TRUE'));

  const todos = await productos.listProducts({ includeInactive: true });
  assert.equal(todos.length, 1);
  assert.ok(!queries[1].includes('WHERE p.activo'), 'con includeInactive no debe filtrar activos');
});

test('productos.createProduct rechaza precio invalido', async () => {
  query = async (sql) => {
    if (sql.includes('WHERE c.id = $1')) {
      return { rows: [{ id: 1, nombre: 'Bebidas', activo: true, orden: 2, created_at: null, updated_at: null, producto_count: 0 }] };
    }
    throw new Error('Consulta inesperada: ' + sql);
  };

  await assert.rejects(productos.createProduct({ nombre: 'Coco', categoria_id: 1, precio: 0, costo: 10 }), { statusCode: 400 });
});

test('categorias.listCategories devuelve categorias activas', async () => {
  let sql = '';
  query = async (statement) => {
    sql = statement;
    return { rows: [{ id: 1, nombre: 'Bebidas', activo: true, orden: 2, created_at: null, updated_at: null, producto_count: 1 }] };
  };

  const activas = await categorias.listCategories({ includeInactive: false });
  assert.equal(activas.length, 1);
  assert.equal(activas[0].nombre, 'Bebidas');
  assert.equal(activas[0].producto_count, 1);
  assert.ok(sql.includes('WHERE c.activo = TRUE'));

  const todas = await categorias.listCategories({ includeInactive: true });
  assert.equal(todas.length, 1);
  assert.ok(!sql.includes('WHERE c.activo = TRUE'), 'con includeInactive no debe filtrar activos');
});

test('categorias.createCategory rechaza nombre vacio', async () => {
  await assert.rejects(categorias.createCategory({ nombre: '   ' }), { statusCode: 400 });
});

test('dashboard.getVentasDiarias arma serie diaria', async () => {
  query = async () => ({ rows: [
    { fecha: '2026-11-10', ingresos: '120', pedidos: 2 },
    { fecha: '2026-11-09', ingresos: '80', pedidos: 1 },
  ] });

  const rows = await dashboard.getVentasDiarias(new URLSearchParams('preset=hoy'));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ingresos, 120);
  assert.equal(rows[0].pedidos, 2);
});

test('proxyGoogleSheets sin web app configurada responde 500', async () => {
  delete process.env.GOOGLE_SHEETS_WEBAPP_URL;
  const result = await proxyGoogleSheets('get', '?action=catalogo');
  assert.equal(result.statusCode, 500);
  assert.equal(result.payload.ok, false);
});

test('proxyGoogleSheets con falla de red responde 502', async () => {
  const originalFetch = global.fetch;
  process.env.GOOGLE_SHEETS_WEBAPP_URL = 'https://sheets.example.com/salida';
  global.fetch = async () => { throw new Error('network down'); };

  const result = await proxyGoogleSheets('get', '?action=catalogo');
  assert.equal(result.statusCode, 502);
  assert.equal(result.payload.ok, false);

  global.fetch = originalFetch;
  delete process.env.GOOGLE_SHEETS_WEBAPP_URL;
});

test('http_error: errorResult emite log estructurado y oculta internos del 500', () => {
  const { errorResult } = require('../src/utils/http');
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args);
  try {
    const serverError = Object.assign(new Error('timeout de postgres'), { code: 'ETIMEDOUT' });
    const res500 = errorResult(serverError, { method: 'post', pathname: '/api/fallo' });
    const entry5xx = JSON.parse(logs[0][0]);
    assert.equal(res500.statusCode, 500);
    assert.equal(res500.payload.error, 'Error interno del servidor');
    assert.equal(entry5xx.event, 'http_error');
    assert.equal(entry5xx.level, 'error');
    assert.equal(entry5xx.statusCode, 500);
    assert.equal(entry5xx.errorCode, 'ETIMEDOUT');
    assert.equal(entry5xx.method, 'POST');
    assert.equal(entry5xx.pathname, '/api/fallo');
    assert.ok(entry5xx.stack && entry5xx.stack.includes('timeout de postgres'));

    const clientError = Object.assign(new Error('El valor es inválido'), { statusCode: 400 });
    const res400 = errorResult(clientError, { method: 'GET', pathname: '/api/x' });
    const entry4xx = JSON.parse(logs[1][0]);
    assert.equal(res400.statusCode, 400);
    assert.equal(res400.payload.error, 'El valor es inválido');
    assert.equal(entry4xx.level, 'warn');
    assert.equal(entry4xx.stack, undefined);
  } finally {
    console.log = originalLog;
  }
});

test('http_error: handleError responde con contrato y registra log', () => {
  const { handleError } = require('../src/middleware/error.middleware');
  const logs = [];
  const originalLog = console.log;
  const body = [];
  console.log = (...args) => logs.push(args);
  try {
    const res = {
      statusCode: 0,
      writeHead(code) { this.statusCode = code; },
      setHeader() {},
      end(chunk) { body.push(chunk); },
    };
    handleError(res, Object.assign(new Error('boom'), { statusCode: 400 }), { method: 'post', pathname: '/api/pedido' });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(JSON.parse(body.join('')), { error: 'boom' });
    const entry = JSON.parse(logs[0][0]);
    assert.equal(entry.event, 'http_error');
    assert.equal(entry.method, 'POST');
    assert.equal(entry.pathname, '/api/pedido');
  } finally {
    console.log = originalLog;
  }
});

test('login: rate-limit por IP se verifica antes de tocar cuentas existentes', async () => {
  let queries = 0;
  const stubPool = { async query(sql) {
    queries += 1;
    if (sql.startsWith('INSERT INTO auth_login_limits')) return { rows: [{ attempts: 21 }] };
    return { rows: [{ attempts: 1 }] };
  } };
  const auth = createAuth(stubPool);
  await assert.rejects(
    auth.login({ username: 'cualquiera', password: 'cualquierPassword123' }, { headers: {} }),
    { statusCode: 429 }
  );
  assert.equal(queries, 2, 'global + ip: la consulta por usuario nunca debe ejecutarse tras superar el límite de IP');
});
