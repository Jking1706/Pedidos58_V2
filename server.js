const { startServer } = require('./src/server');

startServer().catch((error) => {
  console.error('Error fatal:', error);
  process.exit(1);
});
