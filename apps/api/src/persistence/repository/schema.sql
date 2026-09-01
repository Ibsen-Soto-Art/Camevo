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
