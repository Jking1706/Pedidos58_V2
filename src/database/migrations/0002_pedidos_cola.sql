-- Migracion 0002: estación de cocina (cola) en pedidos.
-- Añade las columnas timestamps de movimientos y el indice compuesto por
-- (fecha, estado, id) para que la cola actue sin escanear historico.
-- NO se añade estado Cancelado ni FK a empleados (decisiones acordadas
-- con el usuario: ciclo irreversible simple con timestamp seul para auditoria).

ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS preparacion_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS listo_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_pedidos_fecha_estado
  ON pedidos (fecha, estado, id DESC);
