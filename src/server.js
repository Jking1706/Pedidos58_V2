const fs = require('fs');
const http = require('http');
const { randomUUID } = require('node:crypto');
const path = require('path');
const { logEvent } = require('./utils/logger');
const { initializeDatabase } = require('./services/database.service');
const { handleApiRoute, respondApiResult } = require('./routes/api.routes');
const { getCorsHeaders, readJsonBody, sendJson } = require('./utils/http');
const { handleError } = require('./middleware/error.middleware');
const { pool } = require('./database/connection');
const { createAuth, sessionCookie, assertSameOrigin, canAccess } = require('./services/auth.service');
const auth = createAuth(pool);

const PORT = process.env.PORT || 3000;
const PORT_NUMBER = Number(PORT) || 3000;

function serveFile(res, filePath, contentType, protectedPage = false) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: 'Archivo no encontrado' });
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    const timezone = JSON.stringify(process.env.BUSINESS_TIME_ZONE || 'America/Bogota').replace(/</g, '\\u003c');
    res.end(protectedPage ? data.toString('utf8').replace('</head>', `<script>window.__BUSINESS_TIME_ZONE__ = ${timezone};</script><script src="/auth-client.js" defer></script></head>`) : data);
  });
}

function createRequestHandler({ authService = auth, apiHandler = handleApiRoute } = {}) {
  async function handleRequest(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    const allowedOrigins = String(process.env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean);
    if (req.headers.origin && allowedOrigins.includes(req.headers.origin)) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Vary', 'Origin');
    }
    const requestId = req.requestId || randomUUID();
    const logPathname = String(req.url || '/').split('?')[0] || '/';
    const logMethod = req.method || 'GET';
    try {
    const requestUrl = new URL(req.url, `http://localhost:${PORT_NUMBER}`);
    const { pathname, searchParams } = requestUrl;
    const method = req.method || 'GET';

    if (method === 'OPTIONS') {
      res.writeHead(204, getCorsHeaders());
      res.end();
      return;
    }

    if (method === 'GET' && ['/login', '/mi-sesion'].includes(pathname)) {
      serveFile(res, path.resolve(__dirname, '../auth.html'), 'text/html; charset=utf-8');
      return;
    }
    if (method === 'GET' && pathname === '/auth-client.js') {
      serveFile(res, path.resolve(__dirname, '../auth-client.js'), 'application/javascript; charset=utf-8');
      return;
    }
    if (method === 'GET' && pathname === '/api/health') {
      respondApiResult(res, await apiHandler({ method, pathname, query: searchParams }));
      return;
    }
    if (!['GET', 'HEAD'].includes(method)) assertSameOrigin(req);
    if (method === 'POST' && pathname === '/api/auth/login') {
      const result = await authService.login(await readJsonBody(req), req);
      res.setHeader('Set-Cookie', sessionCookie(result.token));
      sendJson(res, 200, result.user);
      return;
    }
    const user = await authService.authenticate(req);
    if (!user) {
      if (pathname.startsWith('/api/')) sendJson(res, 401, { error: 'Inicia sesión para continuar' });
      else { res.writeHead(303, { Location: '/login' }); res.end(); }
      return;
    }
    if (method === 'GET' && pathname === '/api/auth/me') {
      sendJson(res, 200, { username: user.username, role: user.role });
      return;
    }
    if (method === 'GET' && pathname === '/report-tools.js') {
      serveFile(res, path.resolve(__dirname, '../report-tools.js'), 'application/javascript; charset=utf-8');
      return;
    }
    if (method === 'POST' && pathname === '/api/auth/logout') {
      await readJsonBody(req);
      await authService.logout(req);
      res.setHeader('Set-Cookie', sessionCookie('', 0));
      sendJson(res, 200, { ok: true });
      return;
    }
    if (method === 'GET' && !pathname.startsWith('/api/')) {
      const page = pathname.replace(/\.html$/, '');
      if (user.role === 'consulta' && !['/admin', '/admin-dashboard'].includes(page)) {
        res.writeHead(303, { Location: '/admin-dashboard' }); res.end(); return;
      }
      if (user.role === 'caja' && ['/admin-productos', '/admin-categorias'].includes(page)) {
        res.writeHead(303, { Location: '/' }); res.end(); return;
      }
    }

    if (method === 'GET' && pathname === '/') {
      serveFile(res, path.resolve(__dirname, '../index.html'), 'text/html; charset=utf-8', true);
      return;
    }

    if (method === 'GET' && pathname === '/admin') {
      serveFile(res, path.resolve(__dirname, '../admin.html'), 'text/html; charset=utf-8', true);
      return;
    }

    if (method === 'GET' && (pathname === '/admin-productos' || pathname === '/admin-productos.html')) {
      serveFile(res, path.resolve(__dirname, '../admin-productos.html'), 'text/html; charset=utf-8', true);
      return;
    }

    if (method === 'GET' && (pathname === '/admin-categorias' || pathname === '/admin-categorias.html')) {
      serveFile(res, path.resolve(__dirname, '../admin-categorias.html'), 'text/html; charset=utf-8', true);
      return;
    }

    if (method === 'GET' && (pathname === '/admin-dashboard' || pathname === '/admin-dashboard.html')) {
      serveFile(res, path.resolve(__dirname, '../admin-dashboard.html'), 'text/html; charset=utf-8', true);
      return;
    }

    if (method === 'GET' && (pathname === '/admin-gastos' || pathname === '/admin-gastos.html')) {
      serveFile(res, path.resolve(__dirname, '../admin-gastos.html'), 'text/html; charset=utf-8', true);
      return;
    }

    if (method === 'GET' && (pathname === '/admin-caja' || pathname === '/admin-caja.html')) {
      serveFile(res, path.resolve(__dirname, '../admin-caja.html'), 'text/html; charset=utf-8', true);
      return;
    }

    if (method === 'GET' && ['/api-client.js', '/pos-core.js', '/pos-gastos.js', '/pos-pedidos.js', '/pos-ui.js'].includes(pathname)) {
      serveFile(res, path.resolve(__dirname, '..', pathname), 'application/javascript; charset=utf-8');
      return;
    }
    if (pathname.startsWith('/api/')) {
      const body = method === 'POST' || method === 'PUT' || method === 'PATCH' ? await readJsonBody(req) : undefined;
      if (!canAccess(user.role, method, pathname, searchParams, body)) {
        sendJson(res, 403, { error: 'Tu rol no tiene permiso para esta operación' });
        return;
      }
      const result = await apiHandler({
        method,
        pathname,
        query: searchParams,
        body,
        res,
        requestId,
      });

      respondApiResult(res, result);
      return;
    }

    sendJson(res, 404, { error: 'Ruta no encontrada' });
    } catch (error) {
      if (!res.headersSent && !res.destroyed) handleError(res, error, { method: logMethod, pathname: logPathname, requestId });
      else res.destroy();
    }
  }

  return async (req, res) => {
    const startedAt = Date.now();
    const requestUrl = new URL(req.url, `http://localhost:${PORT_NUMBER}`);
    const { pathname, searchParams } = requestUrl;
    const method = req.method || 'GET';
    const incomingRequestId = String(req.headers['x-request-id'] || '').trim();
    const requestId = /^[a-f0-9]{8}-[a-z0-9]{4}-/.test(incomingRequestId) ? incomingRequestId : randomUUID();
    req.requestId = requestId;
    if (!res.headersSent) res.setHeader('X-Request-Id', requestId);
    try {
      await handleRequest(req, res);
    } finally {
      logEvent({ level: 'info', event: 'http_request', method, pathname, statusCode: res.statusCode || 0, durationMs: Date.now() - startedAt, timestamp: new Date().toISOString(), requestId });
    }
  };
}

async function startServer() {
  await initializeDatabase();
  await auth.bootstrap();
  const server = http.createServer(createRequestHandler());

  server.requestTimeout = 30000;
  server.headersTimeout = 15000;

  server.listen(PORT_NUMBER, '0.0.0.0', () => {
    console.log(`[OK] Servidor iniciado en puerto ${PORT_NUMBER}`);
  });

  const shutdown = (signal) => {
    console.log(`[OK] ${signal} recibido, cerrando servidor...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref?.();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Error fatal:', error);
    process.exit(1);
  });
}

module.exports = {
  createRequestHandler,
  startServer,
};
