const { errorResult, sendJson } = require('../utils/http');

function handleError(res, error) {
  const result = errorResult(error);
  sendJson(res, result.statusCode, result.payload);
}

module.exports = {
  handleError,
};
