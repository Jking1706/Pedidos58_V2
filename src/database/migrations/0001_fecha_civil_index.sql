-- Migracion 0001: indice funcional para los filtros de rango temporal del dashboard.
-- Los dashboard usan fecha TEXT 'DD/MM/YYYY' con validacion estricta y to_date()
-- es STABLE (no IMMUTABLE) porque depende del locale, asi que un indice sobre
-- esa expresion no se puede crear. En su lugar indexamos la expresion equivalente
-- (split_part es IMMUTABLE), que produce 'YYYY-MM-DD' ordenable lexicosamente
-- de la misma forma que el orden cronologico.
--
-- Requisito previo: todos los valores de `fecha` deben ser fechas civiles
-- validas en formato DD/MM/YYYY (la app las valida al escribir pedidos).
CREATE INDEX IF NOT EXISTS idx_pedidos_fecha_civil
  ON pedidos ((split_part(fecha, '/', 3) || '-' || split_part(fecha, '/', 2) || '-' || split_part(fecha, '/', 1)));
