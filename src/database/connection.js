const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const databaseUrl = process.env.DATABASE_URL?.trim() || '';

function isPlaceholderDatabaseUrl(value) {
  if (!value) return true;
  return /USUARIO|PASSWORD|HOST|YOUR_/i.test(value);
}

function resolveSslConfig(value) {
  if (!value) return false;

  try {
    const parsed = new URL(value);
    const sslmode = String(parsed.searchParams.get('sslmode') || '').toLowerCase();

    if (sslmode === 'disable') {
      return false;
    }

    return { rejectUnauthorized: false };
  } catch {
    return { rejectUnauthorized: false };
  }
}

function normalizeDatabaseUrl(value) {
  if (!value) return '';

  try {
    const parsed = new URL(value);
    const sslmode = String(parsed.searchParams.get('sslmode') || '').toLowerCase();

    if (sslmode && sslmode !== 'disable' && !parsed.searchParams.has('uselibpqcompat')) {
      parsed.searchParams.set('uselibpqcompat', 'true');
    }

    return parsed.toString();
  } catch {
    return value;
  }
}

const pool = new Pool({
  connectionString: !isPlaceholderDatabaseUrl(databaseUrl) ? normalizeDatabaseUrl(databaseUrl) : undefined,
  ssl: !isPlaceholderDatabaseUrl(databaseUrl) ? resolveSslConfig(databaseUrl) : false,
  connectionTimeoutMillis: 10000,
});

module.exports = {
  databaseUrl,
  isPlaceholderDatabaseUrl,
  normalizeDatabaseUrl,
  pool,
};
