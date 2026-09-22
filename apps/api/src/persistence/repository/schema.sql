CREATE TABLE IF NOT EXISTS runs (
  id UUID PRIMARY KEY,
  config JSONB NOT NULL,
  seed BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS generation_snapshots (
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  PRIMARY KEY (run_id, generation)
);

-- Grupo 1 (identidad por navegador, RNF de privacidad): este proyecto no
-- tiene un sistema de migraciones — ensureSchema() corre este archivo
-- entero en cada arranque, y funciona porque todo acá es idempotente.
-- `CREATE TABLE IF NOT EXISTS` no alcanza para una columna nueva en una
-- tabla que ya existe, así que la migración real es este ALTER TABLE,
-- con el mismo patrón "se re-ejecuta siempre, no rompe si ya corrió".
-- NOT NULL sin DEFAULT es seguro acá porque la tabla se vació a propósito
-- (TRUNCATE en producción) antes de desplegar este cambio — no hay filas
-- viejas sin browser_id que backfillear. Si esto se corre alguna vez
-- contra una tabla con filas existentes, el ALTER TABLE fallará (es la
-- señal correcta: significa que hace falta backfillear primero, no que
-- haya que agregar un DEFAULT '' silencioso que le asignaría corridas
-- viejas a "nadie" de forma incorrecta).
ALTER TABLE runs ADD COLUMN IF NOT EXISTS browser_id TEXT NOT NULL;

-- RF-025/Grupo 1: GET /runs filtra por browser_id en cada consulta — sin
-- índice, eso es un scan completo de la tabla a medida que crece.
CREATE INDEX IF NOT EXISTS idx_runs_browser_id ON runs (browser_id);
