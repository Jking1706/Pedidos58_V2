function getCorsHeaders(extraHeaders = {}) {
  return {
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extraHeaders,
  };
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, getCorsHeaders({ 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders }));
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8', extraHeaders = {}) {
  res.writeHead(statusCode, getCorsHeaders({ 'Content-Type': contentType, ...extraHeaders }));
  res.end(text);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    let failed = false;
    const fail = (message, statusCode) => {
      if (failed) return;
      failed = true;
      reject(Object.assign(new Error(message), { statusCode }));
    };
    const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/json') {
      req.resume();
      fail('Se requiere Content-Type application/json', 415);
      return;
    }
    req.setEncoding('utf8');

    req.on('data', (chunk) => {
      if (failed) return;
      bytes += Buffer.byteLength(chunk, 'utf8');
      if (bytes > 1024 * 1024) {
        body = '';
        fail('La solicitud supera el límite de 1 MiB', 413);
        return;
      }
      body += chunk;
    });

    req.on('end', () => {
      if (failed) return;
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        const data = JSON.parse(body);
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          fail('El cuerpo debe ser un objeto JSON', 400);
          return;
        }
        resolve(data);
      } catch {
        fail('JSON inválido', 400);
      }
    });
    req.on('aborted', () => fail('Solicitud interrumpida', 400));
    req.on('error', () => fail('Error al leer la solicitud', 400));
  });
}

function errorResult(error) {
  const code = Number(error.statusCode);
  const statusCode = Number.isInteger(code) && code >= 400 && code < 500 ? code : 500;
  if (statusCode === 500) console.error('[API] Error interno', { name: error.name, code: error.code });
  return { statusCode, payload: { error: statusCode === 500 ? 'Error interno del servidor' : error.message } };
}

module.exports = {
  errorResult,
  getCorsHeaders,
  readJsonBody,
  sendJson,
  sendText,
};
