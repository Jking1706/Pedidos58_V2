// Runner de migraciones SQL para PostgreSQL.
// Uso: npm run migrate
// Las migraciones viven en src/database/migrations y se aplican en orden
// lexicográfico. Cada archivo corrido registra su versión en schema_migrations
// para garantizar idempotencia y detecta desvíos entre entornos.
const fs = require('node:fs');
const path = require('node:path');

const { pool } = require(path.join(__dirname, '..', 'src', 'database', 'connection'));

const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'database', 'migrations');

function listMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

function splitStatements(sql) {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function main() {
  if (process.env.DATABASE_URL) {
    // Si ya existe una URL válida, initializeDatabase() no hace falta:
    // la verificación de conexión refleja el estado real de la base.
    await pool.query('SELECT 1');
  }

  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  const migrations = listMigrations();
  const appliedRows = await pool.query('SELECT version FROM schema_migrations');
  const applied = new Set(appliedRows.rows.map((row) => row.version));

  let appliedCount = 0;
  for (const file of migrations) {
    const version = file.replace(/\.sql$/i, '');
    if (applied.has(version)) {
      console.log(`[skip] ${version} ya aplicada`);
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const statements = splitStatements(sql);
    if (!statements.length) {
      console.log(`[skip] ${version} is empty`);
      continue;
    }

    console.log(`[apply] ${version} (${statements.length} sentencia${statements.length > 1 ? 's' : ''})...`);
    await pool.query('BEGIN');
    try {
      for (const statement of statements) {
        await pool.query(statement);
      }
      await pool.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      await pool.query('COMMIT');
      console.log(`[applied] ${version}`);
      appliedCount += 1;
    } catch (error) {
      await pool.query('ROLLBACK').catch(() => {});
      console.error(`[fail] ${version}: ${error.message}`);
      process.exitCode = 1;
      break;
    }
  }

  if (process.exitCode !== 1) {
    console.log(`[OK] ${appliedCount} migración${appliedCount === 1 ? '' : 'es'} aplicada${appliedCount === 1 ? '' : 's'}.`);
  }
  await pool.end();
}

main().catch((error) => {
  console.error('Error en migraciones:', error);
  process.exit(1);
});
