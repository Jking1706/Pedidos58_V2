// Ejecutar desde un entorno autorizado con DATABASE_URL configurada.
const { pool } = require('../src/database/connection');
const { hashPassword, normalizeUsername, ROLES } = require('../src/services/auth.service');

async function main() {
  const action = process.argv[2];
  if (!['create', 'reset-password', 'disable'].includes(action)) throw new Error('Uso: node scripts/employee.js create|reset-password|disable');
  const username = normalizeUsername(process.env.EMPLOYEE_USERNAME);
  const role = process.env.EMPLOYEE_ROLE || 'caja';
  if (!ROLES.includes(role)) throw new Error('Rol inválido');
  const hash = action === 'disable' ? null : await hashPassword(process.env.EMPLOYEE_PASSWORD);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(58001)');
    if (action === 'create') {
      await client.query('INSERT INTO empleados (username, password_hash, role) VALUES ($1, $2, $3)', [username, hash, role]);
    } else {
      const { rows } = await client.query('SELECT id, role, active FROM empleados WHERE username = $1 FOR UPDATE', [username]);
      if (!rows[0]) throw new Error('Empleado no encontrado');
      if (action === 'disable' && rows[0].role === 'admin' && rows[0].active) {
        const admins = await client.query("SELECT COUNT(*)::int AS n FROM empleados WHERE role = 'admin' AND active = TRUE");
        if (admins.rows[0].n <= 1) throw new Error('No se puede desactivar el último administrador');
      }
      if (action === 'disable') await client.query('UPDATE empleados SET active = FALSE WHERE id = $1', [rows[0].id]);
      else await client.query('UPDATE empleados SET password_hash = $1 WHERE id = $2', [hash, rows[0].id]);
      await client.query('DELETE FROM empleado_sesiones WHERE empleado_id = $1', [rows[0].id]);
    }
    await client.query('COMMIT');
    console.log('Operación completada');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

main().catch((error) => {
  console.error(error.code === '23505' ? 'El usuario ya existe' : error.code ? `Error de base de datos (${error.code})` : error.message);
  process.exitCode = 1;
}).finally(() => pool.end());
