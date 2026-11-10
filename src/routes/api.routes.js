const { errorResult, sendJson, sendText } = require('../utils/http');
const { handleApiRoute: dispatch } = require('./index');

function respondApiResult(res, result) {
  if (!result) {
    sendJson(res, 404, { error: 'Ruta no encontrada' });
    return;
  }

  if (result.contentType && result.contentType.startsWith('text/')) {
    sendText(res, result.statusCode || 200, result.payload ?? '', result.contentType, result.headers || {});
    return;
  }

  sendJson(res, result.statusCode || 200, result.payload ?? {}, result.headers || {});
}

async function handleApiRoute(context) {
  try {
    const result = await dispatch(context);
    return result;
  } catch (error) {
    return errorResult(error);
  }
}

module.exports = {
  handleApiRoute,
  respondApiResult,
};
