import { getPgClient } from "./postgres.ts";
const client = await getPgClient();

export async function initializePostgresSchema() {
  await client.query(`
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name VARCHAR(100),
    avatar_url TEXT,
    bio TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS health_step_days (
  day DATE PRIMARY KEY,
  steps INTEGER NOT NULL CHECK (steps >= 0),
  run_steps INTEGER CHECK (run_steps >= 0),
  walk_steps INTEGER CHECK (walk_steps >= 0),
  distance_m DOUBLE PRECISION,
  calories DOUBLE PRECISION,
  active_time_seconds INTEGER,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS health_running_sessions (
  session_id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  distance_m DOUBLE PRECISION,
  calories DOUBLE PRECISION,
  avg_hr DOUBLE PRECISION,
  min_hr DOUBLE PRECISION,
  max_hr DOUBLE PRECISION,
  avg_speed_mps DOUBLE PRECISION,
  max_speed_mps DOUBLE PRECISION,
  avg_cadence DOUBLE PRECISION,
  samples_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS health_running_sessions_started_at_idx
  ON health_running_sessions (started_at DESC);
CREATE TABLE IF NOT EXISTS health_heart_rate_samples (
  sample_id TEXT PRIMARY KEY,
  measured_at TIMESTAMPTZ NOT NULL,
  bpm SMALLINT NOT NULL CHECK (bpm BETWEEN 25 AND 250),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS health_heart_rate_samples_measured_at_idx
  ON health_heart_rate_samples (measured_at DESC);
CREATE TABLE IF NOT EXISTS health_imports (
  id BIGSERIAL PRIMARY KEY,
  filenames JSONB NOT NULL DEFAULT '[]'::jsonb,
  step_days_processed INTEGER NOT NULL DEFAULT 0,
  run_sessions_processed INTEGER NOT NULL DEFAULT 0,
  heart_rate_samples_processed INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
  `);
}
