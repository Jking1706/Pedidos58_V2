function getCorsHeaders(extraHeaders = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
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
  return new Promise((resolve) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

module.exports = {
  getCorsHeaders,
  readJsonBody,
  sendJson,
  sendText,
};
