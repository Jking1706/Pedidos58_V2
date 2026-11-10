const { ensureDatabaseConnection } = require('../services/database.service');

async function healthCheck() {
  await ensureDatabaseConnection();

  return {
    statusCode: 200,
    payload: {
      status: 'ok',
      database: 'connected',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  };
}

module.exports = {
  healthCheck,
};
