const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isPlaceholderDatabaseUrl, normalizeDatabaseUrl } = require('../src/database/connection');

test('isPlaceholderDatabaseUrl detecta plantillas y localhost real', () => {
  assert.equal(isPlaceholderDatabaseUrl(''), true);
  assert.equal(isPlaceholderDatabaseUrl('postgresql://USUARIO:PASSWORD@HOST:5432/neondb'), true);
  assert.equal(isPlaceholderDatabaseUrl('postgres://usuario:x@host/db'), true);
  assert.equal(isPlaceholderDatabaseUrl('postgresql://testdb:CLAVE_TEST_123@localhost:55432/testdb?sslmode=disable'), false);
  assert.equal(isPlaceholderDatabaseUrl('postgresql://neondb_owner:secreto@ep-purple-firefly-atkmkmqm-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require'), false);
});

test('normalizeDatabaseUrl conserva host/puerto', () => {
  const url = normalizeDatabaseUrl('postgresql://u:p@host:55432/db?sslmode=require');
  const parsed = new URL(url);
  assert.equal(parsed.port, '55432');
  assert.equal(parsed.searchParams.get('uselibpqcompat'), 'true');
  assert.equal(parsed.searchParams.get('sslmode'), 'require');
});
