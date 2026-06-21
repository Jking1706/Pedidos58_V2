const fs = require('fs/promises');
const path = require('path');
const { databaseUrl, isPlaceholderDatabaseUrl, pool } = require('../database/connection');
const { seedCategoriasInicialesIfEmpty } = require('./categorias.service');
const { seedProductosInicialesIfEmpty, syncProductCategoryLinks } = require('./productos.service');

const REQUIRED_TABLES = ['categorias', 'productos', 'pedidos', 'configuracion'];

async function runSchemaStatements(schemaSql) {
  const statements = schemaSql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await pool.query(statement);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(operation, { attempts = 5, baseDelayMs = 2000, label = 'operacion' } = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt === attempts) {
        break;
      }

      const waitMs = baseDelayMs * attempt;
      console.warn(`[WARN] ${label} fallo (intento ${attempt}/${attempts}): ${error.message}. Reintentando en ${waitMs} ms`);
      await delay(waitMs);
    }
  }

  throw lastError;
}

async function verifyRequiredTables() {
  const result = await pool.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])`,
    [REQUIRED_TABLES]
  );

  const foundTables = new Set(result.rows.map((row) => row.table_name));
  const missingTables = REQUIRED_TABLES.filter((tableName) => !foundTables.has(tableName));

  if (missingTables.length) {
    throw new Error(`Tablas faltantes: ${missingTables.join(', ')}`);
  }
}

async function initializeDatabaseCore() {
  if (!databaseUrl || isPlaceholderDatabaseUrl(databaseUrl)) {
    throw new Error('DATABASE_URL no configurada o sigue con el placeholder de .env');
  }

  await pool.query('SELECT 1');
  console.log('[OK] PostgreSQL conectado');

  const schemaPath = path.resolve(__dirname, '../database/schema.sql');
  const schemaSql = await fs.readFile(schemaPath, 'utf8');
  await runSchemaStatements(schemaSql);
  await pool.query('SELECT 1');
  await verifyRequiredTables();
  console.log('[OK] Tablas verificadas');

  const categoriesSeeded = await seedCategoriasInicialesIfEmpty();
  console.log(categoriesSeeded ? '[OK] Categorías iniciales cargadas' : '[OK] Categorías iniciales ya existentes');

  const initialSync = await syncProductCategoryLinks();
  if (initialSync.linked || initialSync.normalized) {
    console.log('[OK] Productos relacionados con categorías');
  }

  const seeded = await seedProductosInicialesIfEmpty();
  if (seeded) {
    console.log('[OK] Productos iniciales cargados');
  } else {
    console.log('[OK] Productos iniciales ya existentes');
  }

  const finalSync = await syncProductCategoryLinks();
  if (finalSync.linked || finalSync.normalized) {
    console.log('[OK] Productos sincronizados con categorías');
  }

  return {
    seededCategories: categoriesSeeded,
    seededProducts: seeded,
  };
}

async function initializeDatabase() {
  return withRetry(() => initializeDatabaseCore(), {
    attempts: 5,
    baseDelayMs: 2000,
    label: 'Inicializacion de la base de datos',
  });
}

async function ensureDatabaseConnection() {
  await withRetry(() => pool.query('SELECT 1'), {
    attempts: 3,
    baseDelayMs: 500,
    label: 'Verificacion de la base de datos',
  });

  return true;
}

module.exports = {
  ensureDatabaseConnection,
  initializeDatabase,
};
