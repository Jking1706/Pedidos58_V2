const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { hashPassword, verifyPassword, canAccess, sessionCookie, createAuth } = require('../src/services/auth.service');
const { createRequestHandler } = require('../src/server');

test('contraseñas con sal y verificación segura', async () => {
  const password = 'Prueba-local-12345';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('incorrecta', first), false);
  await assert.rejects(hashPassword('corta'), { statusCode: 400 });
});

test('roles: consulta sin escrituras, caja sin borrar ni alterar catálogo', () => {
  assert.equal(canAccess('consulta', 'GET', '/api/dashboard/resumen'), true);
  assert.equal(canAccess('consulta', 'POST', '/api/pedidos'), false);
  assert.equal(canAccess('caja', 'POST', '/api/pedidos'), true);
  assert.equal(canAccess('caja', 'POST', '/api/caja/cerrar'), true);
  assert.equal(canAccess('caja', 'DELETE', '/api/pedidos/1'), false);
  assert.equal(canAccess('caja', 'PUT', '/api/productos/1'), false);
  assert.equal(canAccess('caja', 'POST', '/api/google-sheets', new URLSearchParams(), { accion: 'upsert', operacion: 'delete' }), false);
  assert.equal(canAccess('admin', 'DELETE', '/api/pedidos/1'), true);
  assert.equal(canAccess('desconocido', 'GET', '/api/pedidos'), false);
});

test('cookies no accesibles a JS y expiración explícita', () => {
  const cookie = sessionCookie('abc');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Max-Age=28800/);
  assert.match(sessionCookie('', 0), /Max-Age=0/);
});

test('límite de acceso bloquea antes de verificar contraseña', async () => {
  let queries = 0;
  const auth = createAuth({ query: async () => { queries += 1; return { rows: [{ attempts: 101 }] }; } });
  await assert.rejects(auth.login({ username: 'admin', password: 'irrelevante' }, { headers: {} }), { statusCode: 429 });
  assert.equal(queries, 1);
});

test('sesiones: token opaco, almacenamiento hasheado y rechazo de cookies inválidas', async () => {
  const hash = await hashPassword('Prueba-local-12345');
  let storedHash;
  let queryCount = 0;
  const pool = { query: async (sql, params) => {
    queryCount += 1;
    if (sql.startsWith('INSERT INTO auth_login_limits')) return { rows: [{ attempts: 1 }] };
    if (sql.startsWith('SELECT id, username')) return { rows: [{ id: 1, username: 'admin', role: 'admin', active: true, password_hash: hash }] };
    if (sql.startsWith('INSERT INTO empleado_sesiones')) storedHash = params[0];
    if (sql.startsWith('SELECT e.id')) {
      assert.match(sql, /s.expires_at > NOW\(\) AND e.active = TRUE/);
      return { rows: storedHash === params[0] ? [{ id: 1, username: 'admin', role: 'admin' }] : [] };
    }
    if (sql.startsWith('DELETE FROM empleado_sesiones WHERE token_hash')) storedHash = null;
    return { rows: [] };
  } };
  const auth = createAuth(pool);
  const result = await auth.login({ username: 'admin', password: 'Prueba-local-12345' }, { headers: {} });
  assert.match(result.token, /^[a-f0-9]{64}$/);
  assert.notEqual(storedHash, result.token);
  assert.equal(result.user.password_hash, undefined);
  const req = { headers: { cookie: sessionCookie(result.token).split(';')[0] } };
  assert.equal((await auth.authenticate(req)).username, 'admin');
  await auth.logout(req);
  assert.equal(await auth.authenticate(req), null);
  const before = queryCount;
  assert.equal(await auth.authenticate({ headers: { cookie: 'pedidos58=invalid' } }), null);
  assert.equal(queryCount, before);
});

test('frontera HTTP: anónimo, CSRF, roles, errores y cierre de sesión', async (t) => {
  let loggedOut = false;
  let calls = 0;
  const handler = createRequestHandler({
    authService: {
      authenticate: async (req) => !loggedOut && req.headers.cookie === 'test=valid' ? { username: 'lector', role: 'consulta' } : null,
      login: async () => ({ token: 'a'.repeat(64), user: { username: 'lector', role: 'consulta' } }),
      logout: async () => { loggedOut = true; },
    },
    apiHandler: async ({ pathname }) => {
      calls += 1;
      if (pathname === '/api/fallo') throw new Error('detalle secreto de PostgreSQL');
      return { statusCode: 200, payload: { ok: true } };
    },
  });
  const server = http.createServer(handler).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const read = (url, options = {}) => fetch(`${base}${url}`, { redirect: 'manual', ...options });
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args);
  assert.equal((await read('/api/health')).status, 200);
  console.log = originalLog;
  const healthLog = JSON.parse(logs[logs.length - 1][0]);
  assert.equal(healthLog.event, 'http_request');
  assert.equal(healthLog.method, 'GET');
  assert.equal(healthLog.pathname, '/api/health');
  assert.equal(healthLog.statusCode, 200);
  assert.equal(typeof healthLog.durationMs, 'number');
  assert.equal((await read('/')).status, 303);
  assert.equal((await read('/admin-dashboard.html')).status, 303);
  assert.equal((await read('/api/pedidos')).status, 401);
  assert.equal(calls, 1);
  const login = await read('/api/auth/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  const headers = { Cookie: 'test=valid', Origin: base, 'Content-Type': 'application/json' };
  assert.equal((await read('/api/pedidos', { method: 'POST', headers, body: '{}' })).status, 403);
  assert.equal((await read('/api/auth/logout', { method: 'POST', headers: { ...headers, Origin: 'https://otro.test' }, body: '{}' })).status, 403);
  assert.equal(loggedOut, false);
  const error = await read('/api/fallo', { headers });
  assert.equal(error.status, 500);
  assert.deepEqual(await error.json(), { error: 'Error interno del servidor' });
  assert.equal((await read('/api/auth/me', { headers })).status, 200);
  const logout = await read('/api/auth/logout', { method: 'POST', headers, body: '{}' });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await read('/api/auth/me', { headers })).status, 401);
});
