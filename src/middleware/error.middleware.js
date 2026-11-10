const { errorResult, sendJson } = require('../utils/http');

function handleError(res, error, context = {}) {
  const result = errorResult(error, context);
  sendJson(res, result.statusCode, result.payload);
}

module.exports = {
  handleError,
};
