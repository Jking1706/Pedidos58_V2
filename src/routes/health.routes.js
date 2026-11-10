const healthController = require('../controllers/health.controller');

async function handleHealth(context) {
  if (context.method === 'GET' && context.pathname === '/api/health') {
    return healthController.healthCheck();
  }

  return null;
}

module.exports = {
  handleHealth,
};
