CREATE TABLE IF NOT EXISTS stations (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lat  REAL NOT NULL,
  lng  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT NOT NULL,
  from_id    TEXT NOT NULL REFERENCES stations(id),
  to_id      TEXT NOT NULL REFERENCES stations(id),
  sec        INTEGER NOT NULL CHECK (sec > 0),
  ran_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runs_segment ON runs (
  LEAST(from_id, to_id),
  GREATEST(from_id, to_id)
);

CREATE OR REPLACE VIEW segments AS
SELECT
  LEAST(from_id, to_id)    AS from_id,
  GREATEST(from_id, to_id) AS to_id,
  COUNT(*)                  AS run_count,
  MIN(sec)                  AS record_sec
FROM runs
GROUP BY 1, 2;
