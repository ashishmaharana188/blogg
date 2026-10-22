import { Router } from "express";
import { getPgClient } from "../db/postgres.ts";

const router = Router();
type MetricId = "repetitions" | "sets" | "duration" | "heart_rate" | "calories" | "history" | "sleep";
const VALID_METRICS = new Set<MetricId>(["repetitions", "sets", "duration", "heart_rate", "calories", "history", "sleep"]);

function decodeJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function numberValue(row: Record<string, unknown>, key: string): number {
  return numberOrNull(row[key]) ?? 0;
}

/**
 * Public all-history aggregates for the same exercise metrics selected in the
 * existing Personal Metrics configuration. Raw exercise sessions are not exposed.
 */
router.get("/health/exercises/public-aggregate", async (_req, res, next) => {
  const client = await getPgClient();
  try {
    // Keep this endpoint independently safe to call. The regular public exercise
    // endpoint creates these tables too, but clients can request this route alone.
    await client.query(`
      CREATE TABLE IF NOT EXISTS health_pushup_sessions (
        session_id TEXT PRIMARY KEY,
        exercise_type INTEGER NOT NULL DEFAULT 10004,
        started_at TIMESTAMPTZ NOT NULL,
        ended_at TIMESTAMPTZ,
        duration_seconds INTEGER,
        repetitions INTEGER CHECK (repetitions IS NULL OR repetitions >= 0),
        calories DOUBLE PRECISION,
        avg_hr DOUBLE PRECISION,
        min_hr DOUBLE PRECISION,
        max_hr DOUBLE PRECISION,
        sets_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        samples_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE health_pushup_sessions ADD COLUMN IF NOT EXISTS exercise_type INTEGER NOT NULL DEFAULT 10004;
      CREATE TABLE IF NOT EXISTS health_pushup_widget_config (
        id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        selected_metrics JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const configResult = await client.query(
      "SELECT selected_metrics FROM health_pushup_widget_config WHERE id = 1",
    );
    const selectedMetrics = decodeJsonArray(configResult.rows[0]?.selected_metrics)
      .filter((id): id is MetricId => typeof id === "string" && VALID_METRICS.has(id as MetricId));
    const selected = new Set(selectedMetrics);

    const aggregateResult = await client.query(`
      SELECT
        COUNT(*)::int AS session_count,
        COALESCE(SUM(repetitions), 0)::double precision AS total_repetitions,
        AVG(repetitions)::double precision AS average_repetitions,
        COUNT(repetitions)::int AS repetition_session_count,
        COALESCE(SUM(duration_seconds), 0)::double precision AS total_duration_seconds,
        AVG(duration_seconds)::double precision AS average_duration_seconds,
        COUNT(duration_seconds)::int AS duration_session_count,
        COALESCE(SUM(calories), 0)::double precision AS total_calories,
        AVG(calories)::double precision AS average_calories,
        COUNT(calories)::int AS calorie_session_count,
        AVG(avg_hr)::double precision AS average_heart_rate,
        MIN(min_hr)::double precision AS minimum_heart_rate,
        MAX(max_hr)::double precision AS maximum_heart_rate,
        COUNT(avg_hr)::int AS heart_rate_session_count
      FROM health_pushup_sessions
    `);
    const row = (aggregateResult.rows[0] || {}) as Record<string, unknown>;
    const aggregates: Record<string, unknown> = {};

    if (selected.has("repetitions")) {
      aggregates.repetitions = {
        total: numberValue(row, "total_repetitions"),
        average: numberOrNull(row.average_repetitions),
        sessionCount: numberValue(row, "repetition_session_count"),
      };
    }

    if (selected.has("sets")) {
      const setResult = await client.query(`
        SELECT
          item.ordinality::int AS set_number,
          COALESCE(SUM(
            CASE
              WHEN item.value ->> 'reps' ~ '^[0-9]+([.][0-9]+)?$'
                THEN (item.value ->> 'reps')::numeric
              ELSE 0
            END
          ), 0)::double precision AS total_repetitions,
          COUNT(DISTINCT session.session_id)::int AS sessions_with_set
        FROM health_pushup_sessions AS session
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(session.sets_json) = 'array'
            THEN session.sets_json ELSE '[]'::jsonb END
        ) WITH ORDINALITY AS item(value, ordinality)
        WHERE jsonb_typeof(item.value) = 'object'
        GROUP BY item.ordinality
        ORDER BY item.ordinality
      `);
      aggregates.sets = {
        byPosition: setResult.rows.map((setRow: Record<string, unknown>) => numberValue(setRow, "total_repetitions")),
        sessionCount: setResult.rows.reduce((maximum: number, setRow: Record<string, unknown>) => Math.max(maximum, numberValue(setRow, "sessions_with_set")), 0),
      };
    }

    if (selected.has("duration")) {
      aggregates.duration = {
        totalSeconds: numberValue(row, "total_duration_seconds"),
        averageSeconds: numberOrNull(row.average_duration_seconds),
        sessionCount: numberValue(row, "duration_session_count"),
      };
    }

    if (selected.has("calories")) {
      aggregates.calories = {
        total: numberValue(row, "total_calories"),
        average: numberOrNull(row.average_calories),
        sessionCount: numberValue(row, "calorie_session_count"),
      };
    }

    if (selected.has("heart_rate")) {
      aggregates.heart_rate = {
        average: numberOrNull(row.average_heart_rate),
        minimum: numberOrNull(row.minimum_heart_rate),
        maximum: numberOrNull(row.maximum_heart_rate),
        sessionCount: numberValue(row, "heart_rate_session_count"),
      };
    }

    if (selected.has("history")) {
      aggregates.history = {
        sessionCount: numberValue(row, "session_count"),
        totalRepetitions: numberValue(row, "total_repetitions"),
      };
    }

    res.setHeader("Cache-Control", "public, max-age=60");
    return res.json({ aggregates });
  } catch (error) {
    return next(error);
  } finally {
    client.release();
  }
});

export default router;
