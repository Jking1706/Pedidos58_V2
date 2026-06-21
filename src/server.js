const fs = require('fs');
const http = require('http');
const path = require('path');
const { initializeDatabase } = require('./services/database.service');
const { handleApiRoute, respondApiResult } = require('./routes/api.routes');
const { getCorsHeaders, readJsonBody, sendJson } = require('./utils/http');

const PORT = process.env.PORT || 3000;
const PORT_NUMBER = Number(PORT) || 3000;

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: 'Archivo no encontrado' });
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

async function startServer() {
  await initializeDatabase();

  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, `http://localhost:${PORT_NUMBER}`);
    const { pathname, searchParams } = requestUrl;
    const method = req.method || 'GET';

    if (method === 'OPTIONS') {
      res.writeHead(204, getCorsHeaders());
      res.end();
      return;
    }

    if (method === 'GET' && pathname === '/') {
      serveFile(res, path.resolve(__dirname, '../index.html'), 'text/html; charset=utf-8');
      return;
    }

    if (method === 'GET' && pathname === '/admin') {
      serveFile(res, path.resolve(__dirname, '../admin.html'), 'text/html; charset=utf-8');
      return;
    }

    if (method === 'GET' && (pathname === '/admin-productos' || pathname === '/admin-productos.html')) {
      serveFile(res, path.resolve(__dirname, '../admin-productos.html'), 'text/html; charset=utf-8');
      return;
    }

    if (method === 'GET' && (pathname === '/admin-categorias' || pathname === '/admin-categorias.html')) {
      serveFile(res, path.resolve(__dirname, '../admin-categorias.html'), 'text/html; charset=utf-8');
      return;
    }

    if (pathname.startsWith('/api/')) {
      const body = method === 'POST' || method === 'PUT' || method === 'PATCH' ? await readJsonBody(req) : undefined;
      const result = await handleApiRoute({
        method,
        pathname,
        query: searchParams,
        body,
        res,
      });

      respondApiResult(res, result);
      return;
    }

    sendJson(res, 404, { error: 'Ruta no encontrada' });
  });

  server.listen(PORT_NUMBER, '0.0.0.0', () => {
    console.log(`[OK] Servidor iniciado en puerto ${PORT_NUMBER}`);
  });

  return server;
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Error fatal:', error);
    process.exit(1);
  });
}

module.exports = {
  startServer,
};
