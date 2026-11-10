const { randomBytes, scrypt: scryptCallback, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(scryptCallback);
const SESSION_SECONDS = 8 * 60 * 60;
const ROLES = ['admin', 'caja', 'consulta'];
const digest = (value) => createHash('sha256').update(value).digest('hex');
const failure = (message, statusCode) => Object.assign(new Error(message), { statusCode });

async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw failure('La contraseña debe tener entre 12 y 128 caracteres', 400);
  }
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${key.toString('hex')}`;
}

async function verifyPassword(password, encoded) {
  const [, salt, hex] = String(encoded).split(':');
  if (!/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(hex || '')) return false;
  const key = await scrypt(password, salt, 64);
  return timingSafeEqual(key, Buffer.from(hex, 'hex'));
}

function normalizeUsername(value) {
  const username = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,64}$/.test(username)) throw failure('Usuario inválido', 400);
  return username;
}

function cookieName() {
  return process.env.NODE_ENV === 'production' ? '__Host-pedidos58' : 'pedidos58';
}

function sessionCookie(token, maxAge = SESSION_SECONDS) {
  return `${cookieName()}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

function readToken(req) {
  const value = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName()}=`));
  const token = value?.slice(cookieName().length + 1) || '';
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

function assertSameOrigin(req) {
  const expected = process.env.APP_ORIGIN || `${process.env.NODE_ENV === 'production' ? 'https' : 'http'}://${req.headers.host}`;
  if (!req.headers.origin || req.headers.origin !== new URL(expected).origin || req.headers['sec-fetch-site'] === 'cross-site') {
    throw failure('Origen de solicitud no permitido', 403);
  }
}

function canAccess(role, method, pathname, query = new URLSearchParams(), body = {}) {
  if (!ROLES.includes(role)) return false;
  if (role === 'admin') return true;
  if (method === 'GET' && pathname !== '/api/google-sheets') return true;
  if (role !== 'caja') return false;
  if (method === 'GET' && pathname === '/api/google-sheets') return query.get('action') === 'catalogo';
  if (method === 'POST' && ['/api/pedidos', '/api/gastos', '/api/gastos/pos', '/api/caja/abrir', '/api/caja/cerrar'].includes(pathname)) return true;
  if (method === 'PUT' && /^\/api\/(pedidos|gastos)\/\d+$/.test(pathname)) return true;
  if (role !== 'admin') return false;
  if (method === 'POST' && pathname === '/api/productos') return true;
  if (method === 'PUT' && /^\/api\/productos\/\d+$/.test(pathname)) return true;
  if (method === 'DELETE' && /^\/api\/productos\/\d+$/.test(pathname)) return true;
  if (method === 'PATCH' && /^\/api\/productos\/\d+\/activo$/.test(pathname)) return true;
  if (method === 'POST' && pathname === '/api/google-sheets') {
    const actions = [body.accion, body.action, body.operacion].filter(Boolean);
    return actions.every((action) => ['upsert', 'update', 'delivered'].includes(action)) &&
      [undefined, 'pedido', 'gasto', 'gasto_carrito', 'gastos_carrito', 'gasto_lote'].includes(body.tipoEntrada);
  }
  return false;
}

function createAuth(pool) {
  async function bootstrap() {
    const result = await pool.query('SELECT id FROM empleados LIMIT 1');
    if (result.rows.length) return;
    if (!process.env.AUTH_ADMIN_USER || !process.env.AUTH_ADMIN_PASSWORD) {
      throw new Error('Configura AUTH_ADMIN_USER y AUTH_ADMIN_PASSWORD para crear el primer administrador');
    }
    const username = normalizeUsername(process.env.AUTH_ADMIN_USER);
    const hash = await hashPassword(process.env.AUTH_ADMIN_PASSWORD);
    await pool.query("INSERT INTO empleados (username, password_hash, role) VALUES ($1, $2, 'admin') ON CONFLICT (username) DO NOTHING", [username, hash]);
  }

  async function consumeLimit(key, limit) {
    const result = await pool.query(`INSERT INTO auth_login_limits (key, attempts, expires_at)
      VALUES ($1, 1, NOW() + INTERVAL '15 minutes')
      ON CONFLICT (key) DO UPDATE SET
        attempts = CASE WHEN auth_login_limits.expires_at <= NOW() THEN 1 ELSE auth_login_limits.attempts + 1 END,
        expires_at = CASE WHEN auth_login_limits.expires_at <= NOW() THEN NOW() + INTERVAL '15 minutes' ELSE auth_login_limits.expires_at END
      RETURNING attempts`, [key]);
    if (result.rows[0].attempts > limit) throw failure('Demasiados intentos. Intenta de nuevo en 15 minutos', 429);
  }

  async function login(body, req) {
    await consumeLimit('global', 100);
    const username = normalizeUsername(body.username);
    if (typeof body.password !== 'string' || body.password.length > 128) throw failure('Usuario o contraseña incorrectos', 401);
    await consumeLimit(`user:${digest(username)}`, 10);
    const result = await pool.query('SELECT id, username, role, password_hash, active FROM empleados WHERE username = $1', [username]);
    const user = result.rows[0];
    // Igual coste criptográfico para cuentas inexistentes.
    const fallback = `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`;
    const valid = await verifyPassword(body.password, user?.password_hash || fallback);
    if (!valid || !user?.active) throw failure('Usuario o contraseña incorrectos', 401);
    const token = randomBytes(32).toString('hex');
    const oldToken = readToken(req);
    await pool.query('DELETE FROM empleado_sesiones WHERE expires_at <= NOW() OR token_hash = $1', [oldToken ? digest(oldToken) : '']);
    await pool.query("INSERT INTO empleado_sesiones (token_hash, empleado_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '8 hours')", [digest(token), user.id]);
    await pool.query('DELETE FROM auth_login_limits WHERE key = $1 OR expires_at <= NOW()', [`user:${digest(username)}`]);
    return { token, user: { username: user.username, role: user.role } };
  }

  async function authenticate(req) {
    const token = readToken(req);
    if (!token) return null;
    const result = await pool.query(`SELECT e.id, e.username, e.role FROM empleado_sesiones s
      JOIN empleados e ON e.id = s.empleado_id
      WHERE s.token_hash = $1 AND s.expires_at > NOW() AND e.active = TRUE`, [digest(token)]);
    return result.rows[0] || null;
  }

  async function logout(req) {
    const token = readToken(req);
    if (token) await pool.query('DELETE FROM empleado_sesiones WHERE token_hash = $1', [digest(token)]);
  }

  return { bootstrap, login, authenticate, logout };
}

module.exports = { createAuth, hashPassword, verifyPassword, normalizeUsername, sessionCookie, readToken, assertSameOrigin, canAccess, ROLES };
