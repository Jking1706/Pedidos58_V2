-- Migración 0001: índice funcional para los filtros de rango temporal del dashboard.
-- Los queries del dashboard usan `to_date(fecha, 'DD/MM/YYYY') BETWEEN $1 AND $2`,
-- por lo que un índice simple sobre la columna `fecha` TEXT no puede usarse;
-- un índice funcional sobre la expresión to_date() sí lo permite.
--
-- Requisito previo: todos los valores de `fecha` deben ser fechas civiles válidas
-- en formato DD/MM/YYYY (la app las valida al escribir pedidos con regex).
CREATE INDEX IF NOT EXISTS idx_pedidos_fecha_civil
  ON pedidos ((to_date(fecha, 'DD/MM/YYYY')));
