const { proxyGoogleSheets } = require('../services/googleSheets.service');

async function handleGoogleSheets(context) {
  const { method, pathname, query, body } = context;

  if ((method === 'GET' || method === 'POST') && pathname === '/api/google-sheets') {
    return proxyGoogleSheets(method, query.toString() ? `?${query.toString()}` : '', body);
  }

  return null;
}

module.exports = {
  handleGoogleSheets,
};
