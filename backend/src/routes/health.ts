import { createHash } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { getPgClient } from "../db/postgres.ts";
import { authenticationMiddleware } from "../middleware/authenticationMiddleware.ts";
import { adminMiddleware } from "../middleware/adminMiddleware.ts";

const router = Router();
const ADMIN_GUARD = [authenticationMiddleware, adminMiddleware] as const;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 40, fileSize: 12 * 1024 * 1024, fieldSize: 1024 * 1024 },
});
const INDIA_TZ = "Asia/Kolkata";

type CsvRow = Record<string, string>;
type StepDay = {
  day: string;
  steps: number;
  runSteps: number | null;
  walkSteps: number | null;
  distanceM: number | null;
  calories: number | null;
  activeTimeSeconds: number | null;
  priority: number;
};
type HeartRatePoint = { time: string; bpm?: number; speedMps?: number; distanceM?: number; cadence?: number };
type Run = {
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  distanceM: number | null;
  calories: number | null;
  avgHeartRate: number | null;
  minHeartRate: number | null;
  maxHeartRate: number | null;
  avgSpeedMps: number | null;
  maxSpeedMps: number | null;
  avgCadence: number | null;
  samples: HeartRatePoint[];
};
type HrReading = { sampleId: string; measuredAt: string; bpm: number };

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/^\uFEFF/, "").trim() : value == null ? "" : String(value).trim();
}

function numeric(value: unknown): number | null {
  const raw = clean(value);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCsvRecords(input: string): string[][] {
  const source = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  }
  return rows;
}

function csvTable(fileName: string, input: string): CsvRow[] {
  const parsed = parseCsvRecords(input);
  const lowerName = fileName.toLowerCase();
  const headerIndex = parsed.findIndex((row) => {
    const fields = row.map((item) => item.trim().toLowerCase());
    const hasDay = fields.includes("day_time");
    const hasStepField = fields.includes("step_count") || fields.includes("count") || fields.some((name) => name.endsWith(".step_count"));
    const hasExerciseStart = fields.includes("com.samsung.health.exercise.start_time") || fields.includes("start_time");
    const hasExerciseId = fields.some((name) => name.includes("exercise.datauuid")) || fields.includes("datauuid");
    const hasHeartRate = fields.some((name) => name === "heart_rate" || name.endsWith(".heart_rate"));
    const hasTime = fields.some((name) => /start_time|measured_at|timestamp|create_time/.test(name));
    return (hasDay && hasStepField)
      || (lowerName.includes("exercise") && hasExerciseStart && hasExerciseId)
      || (lowerName.includes("heart_rate") && hasHeartRate && hasTime);
  });
  if (headerIndex < 0) return [];
  const headers = parsed[headerIndex].map((header) => header.trim());
  return parsed.slice(headerIndex + 1).map((values) => {
    const record: CsvRow = {};
    headers.forEach((header, index) => { if (header) record[header] = values[index] ?? ""; });
    return record;
  });
}

function field(row: CsvRow, ...keys: string[]): string {
  for (const key of keys) {
    const found = row[key];
    if (found !== undefined && clean(found) !== "") return clean(found);
  }
  return "";
}

function dateOnly(value: unknown): string | null {
  const match = clean(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}


function parseTimestamp(value: unknown, _timeOffset?: unknown): string | null {
  const raw = clean(value);
  if (!raw) return null;
  if (/^\d{10,13}$/.test(raw)) {
    const numericTime = Number(raw);
    const date = new Date(raw.length <= 10 ? numericTime * 1000 : numericTime);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  const normalized = raw.replace(/\s+/, "T");
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  // Samsung Health writes these CSV timestamp strings as UTC wall time and
  // records the original local offset in a separate column. Do not apply it twice.
  const candidate = hasZone ? normalized : normalized + "Z";
  const date = new Date(candidate);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function secondsFromSamsung(value: unknown): number | null {
  const parsed = numeric(value);
  if (parsed === null) return null;
  // These Samsung export fields are milliseconds; session values are rounded to whole seconds.
  return Math.max(0, Math.round(parsed / 1000));
}

function parseStepDays(files: Express.Multer.File[]): StepDay[] {
  const candidates = files.map((file) => {
    const name = file.originalname.toLowerCase();
    const priority = name.includes("tracker.pedometer_day_summary") ? 3
      : name.includes("activity.day_summary") ? 2
      : name.includes("step_daily_trend") ? 1 : 0;
    return { file, priority };
  }).filter((candidate) => candidate.priority > 0);
  const byDay = new Map<string, StepDay>();
  for (const { file, priority } of candidates) {
    for (const row of csvTable(file.originalname, file.buffer.toString("utf8"))) {
      const day = dateOnly(field(row, "day_time", "com.samsung.health.step_count.start_time"));
      const stepValue = numeric(field(row, "step_count", "count", "com.samsung.health.step_count.count"));
      if (!day || stepValue === null || stepValue < 0) continue;
      const existing = byDay.get(day);
      if (existing && existing.priority > priority) continue;
      byDay.set(day, {
        day,
        steps: Math.max(0, Math.round(stepValue)),
        runSteps: numeric(field(row, "run_step_count", "run_step")) === null ? null : Math.max(0, Math.round(numeric(field(row, "run_step_count", "run_step"))!)),
        walkSteps: numeric(field(row, "walk_step_count", "walk_step")) === null ? null : Math.max(0, Math.round(numeric(field(row, "walk_step_count", "walk_step"))!)),
        distanceM: numeric(field(row, "distance", "com.samsung.health.step_count.distance")),
        calories: numeric(field(row, "calorie", "calories", "com.samsung.health.step_count.calorie")),
        activeTimeSeconds: secondsFromSamsung(field(row, "active_time")),
        priority,
      });
    }
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

function jsonFileMap(files: Express.Multer.File[]): Map<string, string> {
  return new Map(files.filter((file) => file.originalname.toLowerCase().endsWith(".json"))
    .map((file) => [file.originalname.split(/[\\/]/).pop()!.toLowerCase(), file.buffer.toString("utf8")]));
}

function parseRunSamples(raw: string | undefined): HeartRatePoint[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const samples: HeartRatePoint[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const time = parseTimestamp(record.start_time ?? record.timestamp);
    if (!time) continue;
    const point: HeartRatePoint = { time };
    const bpm = numeric(record.heart_rate);
    const speed = numeric(record.speed);
    const distance = numeric(record.distance);
    const cadence = numeric(record.cadence);
    if (bpm !== null && bpm > 0 && bpm < 300) point.bpm = bpm;
    if (speed !== null && speed >= 0) point.speedMps = speed;
    if (distance !== null && distance >= 0) point.distanceM = distance;
    if (cadence !== null && cadence >= 0) point.cadence = cadence;
    if (point.bpm !== undefined || point.speedMps !== undefined || point.distanceM !== undefined || point.cadence !== undefined) samples.push(point);
  }
  return samples.sort((a, b) => a.time.localeCompare(b.time));
}

function parseRuns(files: Express.Multer.File[]): Run[] {
  const jsonFiles = jsonFileMap(files);
  const runs: Run[] = [];
  for (const file of files) {
    if (!file.originalname.toLowerCase().includes("exercise") || !file.originalname.toLowerCase().endsWith(".csv")) continue;
    for (const row of csvTable(file.originalname, file.buffer.toString("utf8"))) {
      if (numeric(field(row, "com.samsung.health.exercise.exercise_type", "exercise_type")) !== 1002) continue;
      const offset = field(row, "com.samsung.health.exercise.time_offset", "time_offset");
      const startedAt = parseTimestamp(field(row, "com.samsung.health.exercise.start_time", "start_time"), offset);
      if (!startedAt) continue;
      const endedAt = parseTimestamp(field(row, "com.samsung.health.exercise.end_time", "end_time"), offset);
      const rawId = field(row, "com.samsung.health.exercise.datauuid", "datauuid");
      const sessionId = rawId || createHash("sha256").update(`${file.originalname}|${startedAt}`).digest("hex");
      const duration = secondsFromSamsung(field(row, "com.samsung.health.exercise.duration", "duration"));
      const liveFile = field(row, "com.samsung.health.exercise.live_data", "live_data").split(/[\\/]/).pop()?.toLowerCase();
      runs.push({
        sessionId, startedAt, endedAt,
        durationSeconds: duration ?? (endedAt ? Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000)) : null),
        distanceM: numeric(field(row, "com.samsung.health.exercise.distance", "distance")),
        calories: numeric(field(row, "com.samsung.health.exercise.calorie", "calorie")),
        avgHeartRate: numeric(field(row, "com.samsung.health.exercise.mean_heart_rate", "mean_heart_rate")),
        minHeartRate: numeric(field(row, "com.samsung.health.exercise.min_heart_rate", "min_heart_rate")),
        maxHeartRate: numeric(field(row, "com.samsung.health.exercise.max_heart_rate", "max_heart_rate")),
        avgSpeedMps: numeric(field(row, "com.samsung.health.exercise.mean_speed", "mean_speed")),
        maxSpeedMps: numeric(field(row, "com.samsung.health.exercise.max_speed", "max_speed")),
        avgCadence: numeric(field(row, "com.samsung.health.exercise.mean_cadence", "mean_cadence")),
        samples: parseRunSamples(liveFile ? jsonFiles.get(liveFile) : undefined),
      });
    }
  }
  const deduped = new Map<string, Run>();
  for (const run of runs) {
    const current = deduped.get(run.sessionId);
    if (!current || run.samples.length > current.samples.length) deduped.set(run.sessionId, run);
  }
  return [...deduped.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

function parseStandaloneHeartRate(files: Express.Multer.File[]): HrReading[] {
  const readings: HrReading[] = [];
  for (const file of files) {
    if (!file.originalname.toLowerCase().includes("heart_rate") || !file.originalname.toLowerCase().endsWith(".csv")) continue;
    const parsed = parseCsvRecords(file.buffer.toString("utf8"));
    const headerIndex = parsed.findIndex((row) => {
      const fields = row.map((item) => item.trim().toLowerCase());
      return fields.some((name) => name === "heart_rate" || name.endsWith(".heart_rate")) && fields.some((name) => /start_time|measured_at|timestamp|create_time/.test(name));
    });
    if (headerIndex < 0) continue;
    const headers = parsed[headerIndex].map((item) => item.trim());
    const hrKey = headers.find((key) => key.toLowerCase() === "heart_rate" || key.toLowerCase().endsWith(".heart_rate"));
    if (!hrKey) continue;
    for (const values of parsed.slice(headerIndex + 1)) {
      const row: CsvRow = {};
      headers.forEach((header, index) => { row[header] = values[index] ?? ""; });
      const bpm = numeric(row[hrKey]);
      const timestamp = field(row, "start_time", "com.samsung.health.heart_rate.start_time", "measured_at", "timestamp", "create_time", "com.samsung.health.heart_rate.create_time");
      const measuredAt = parseTimestamp(timestamp, field(row, "time_offset", "com.samsung.health.heart_rate.time_offset"));
      if (bpm === null || bpm < 25 || bpm > 250 || !measuredAt) continue;
      const rawId = field(row, "datauuid", "com.samsung.health.heart_rate.datauuid");
      const sampleId = rawId || createHash("sha256").update(`${file.originalname}|${measuredAt}|${bpm}`).digest("hex");
      readings.push({ sampleId, measuredAt, bpm: Math.round(bpm) });
    }
  }
  return [...new Map(readings.map((reading) => [reading.sampleId, reading])).values()].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
}

function safeJsonArray(value: unknown): HeartRatePoint[] {
  if (Array.isArray(value)) return value as HeartRatePoint[];
  if (typeof value === "string") {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed as HeartRatePoint[] : []; } catch { return []; }
  }
  return [];
}

function sampleHeartRates(samples: HeartRatePoint[], limit = 36): Array<{ time: string; bpm: number }> {
  const points = samples.filter((sample) => typeof sample.bpm === "number" && Number.isFinite(sample.bpm));
  if (points.length <= limit) return points.map((point) => ({ time: point.time, bpm: point.bpm! }));
  const selected: Array<{ time: string; bpm: number }> = [];
  for (let index = 0; index < limit; index += 1) {
    const point = points[Math.round(index * (points.length - 1) / (limit - 1))];
    selected.push({ time: point.time, bpm: point.bpm! });
  }
  return selected;
}

function runSummary(row: any, sampleLimit = 24) {
  const samples = safeJsonArray(row.samples_json);
  return {
    sessionId: String(row.session_id),
    startedAt: new Date(row.started_at).toISOString(),
    endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
    durationSeconds: numeric(row.duration_seconds),
    distanceM: numeric(row.distance_m),
    calories: numeric(row.calories),
    avgHeartRate: numeric(row.avg_hr),
    minHeartRate: numeric(row.min_hr),
    maxHeartRate: numeric(row.max_hr),
    avgSpeedMps: numeric(row.avg_speed_mps),
    maxSpeedMps: numeric(row.max_speed_mps),
    avgCadence: numeric(row.avg_cadence),
    heartRateSamples: sampleHeartRates(samples, sampleLimit),
  };
}

async function loadHealthSummary(client: any) {
  const daysResult = await client.query(
    "SELECT day::text AS day, steps, run_steps, walk_steps, distance_m, calories, active_time_seconds, imported_at FROM health_step_days WHERE day <= (NOW() AT TIME ZONE 'Asia/Kolkata')::date AND day >= ((NOW() AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '6 days')::date ORDER BY day DESC",
  );
  const recentDays = daysResult.rows.map((row: any) => ({
    day: row.day, steps: Number(row.steps || 0),
    runSteps: row.run_steps === null ? null : Number(row.run_steps),
    walkSteps: row.walk_steps === null ? null : Number(row.walk_steps),
    distanceM: numeric(row.distance_m), calories: numeric(row.calories),
    activeTimeSeconds: row.active_time_seconds === null ? null : Number(row.active_time_seconds),
    importedAt: row.imported_at ? new Date(row.imported_at).toISOString() : null,
  }));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: INDIA_TZ });
  const todayRow = recentDays.find((row: any) => row.day === today);
  const averageSteps7d = recentDays.length
    ? Math.round(recentDays.reduce((sum: number, row: any) => sum + row.steps, 0) / recentDays.length)
    : null;
  const recentRunsResult = await client.query(
    "SELECT session_id, started_at, ended_at, duration_seconds, distance_m, calories, avg_hr, min_hr, max_hr, avg_speed_mps, max_speed_mps, avg_cadence, samples_json FROM health_running_sessions ORDER BY started_at DESC LIMIT 12",
  );
  const hrResult = await client.query("SELECT sample_id, measured_at, bpm FROM health_heart_rate_samples ORDER BY measured_at DESC LIMIT 1");
  const latestRunRow = recentRunsResult.rows[0];
  const latestRun = latestRunRow ? runSummary(latestRunRow) : null;
  const newestRunHr = latestRunRow ? safeJsonArray(latestRunRow.samples_json)
    .filter((point) => typeof point.bpm === "number" && Number.isFinite(point.bpm))
    .sort((a, b) => b.time.localeCompare(a.time))[0] : null;
  const standaloneHr = hrResult.rows[0];
  const standaloneHrTime = standaloneHr ? new Date(standaloneHr.measured_at).getTime() : -1;
  const runHrTime = newestRunHr ? new Date(newestRunHr.time).getTime() : -1;
  const latestHeartRate = standaloneHrTime >= runHrTime && standaloneHr
    ? { bpm: Number(standaloneHr.bpm), measuredAt: new Date(standaloneHr.measured_at).toISOString() }
    : newestRunHr ? { bpm: Math.round(Number(newestRunHr.bpm)), measuredAt: newestRunHr.time } : null;
  const lastImportResult = await client.query(
    "SELECT created_at, filenames, step_days_processed, run_sessions_processed, heart_rate_samples_processed FROM health_imports ORDER BY created_at DESC LIMIT 1",
  );
  const lastImport = lastImportResult.rows[0];
  return {
    steps: { date: today, today: todayRow ? todayRow.steps : null, average7d: averageSteps7d, observedDays7d: recentDays.length, recentDays },
    latestHeartRate,
    latestRun,
    recentRuns: recentRunsResult.rows.map((row: any) => runSummary(row, 36)),
    latestImport: lastImport ? {
      createdAt: new Date(lastImport.created_at).toISOString(),
      filenames: Array.isArray(lastImport.filenames) ? lastImport.filenames : [],
      stepDaysProcessed: Number(lastImport.step_days_processed || 0),
      runSessionsProcessed: Number(lastImport.run_sessions_processed || 0),
      heartRateSamplesProcessed: Number(lastImport.heart_rate_samples_processed || 0),
    } : null,
  };
}

router.get("/health/public-summary", async (_req, res, next) => {
  const client = await getPgClient();
  try {
    const summary = await loadHealthSummary(client);
    // The Account page also has a read-only public mode. Share the actual health
    // metrics there, but keep import history and source filenames administrator-only.
    const standalone = await client.query(
      "SELECT sample_id, measured_at, bpm FROM health_heart_rate_samples ORDER BY measured_at DESC LIMIT 30",
    );
    const runSamplesResult = await client.query(
      "SELECT started_at, samples_json FROM health_running_sessions ORDER BY started_at DESC LIMIT 12",
    );
    const allSamples = standalone.rows.map((row: any) => ({
      measuredAt: new Date(row.measured_at).toISOString(),
      bpm: Number(row.bpm),
    }));
    for (const runRow of runSamplesResult.rows) {
      for (const point of safeJsonArray(runRow.samples_json)) {
        if (typeof point.bpm === "number" && Number.isFinite(point.bpm)) {
          allSamples.push({ measuredAt: point.time, bpm: point.bpm });
        }
      }
    }
    allSamples.sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
    const recentHeartRates = [...new Map(
      allSamples.map((sample) => [`${sample.measuredAt}|${sample.bpm}`, sample]),
    ).values()].slice(0, 30);

    return res.setHeader("Cache-Control", "public, max-age=60").json({
      steps: {
        date: summary.steps.date,
        today: summary.steps.today,
        average7d: summary.steps.average7d,
        observedDays7d: summary.steps.observedDays7d,
        recentDays: summary.steps.recentDays.map((day: any) => ({ day: day.day, steps: day.steps })),
      },
      latestHeartRate: summary.latestHeartRate,
      latestRun: summary.latestRun,
      recentRuns: summary.recentRuns,
      recentHeartRates,
      // Deliberately omit latestImport: filenames and import audit details are private.
    });
  } catch (error) { next(error); }
  finally { client.release(); }
});

router.get("/health/admin/summary", ...ADMIN_GUARD, async (_req, res, next) => {
  const client = await getPgClient();
  try {
    const summary = await loadHealthSummary(client);
    const standalone = await client.query("SELECT sample_id, measured_at, bpm FROM health_heart_rate_samples ORDER BY measured_at DESC LIMIT 30");
    const runSamplesResult = await client.query("SELECT started_at, samples_json FROM health_running_sessions ORDER BY started_at DESC LIMIT 12");
    const allSamples = standalone.rows.map((row: any) => ({ measuredAt: new Date(row.measured_at).toISOString(), bpm: Number(row.bpm) }));
    for (const runRow of runSamplesResult.rows) {
      for (const point of safeJsonArray(runRow.samples_json)) {
        if (typeof point.bpm === "number" && Number.isFinite(point.bpm)) allSamples.push({ measuredAt: point.time, bpm: point.bpm });
      }
    }
    allSamples.sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
    const unique = [...new Map(allSamples.map((sample) => [`${sample.measuredAt}|${sample.bpm}`, sample])).values()].slice(0, 30);
    return res.json({ ...summary, recentHeartRates: unique });
  } catch (error) { next(error); }
  finally { client.release(); }
});

router.post("/health/admin/import", ...ADMIN_GUARD, upload.array("files", 40), async (req, res, next) => {
  const files = (req.files || []) as Express.Multer.File[];
  if (!files.length) return res.status(400).json({ message: "Choose one or more Samsung Health CSV or JSON files first." });
  if (files.some((file) => !/\.(csv|json)$/i.test(file.originalname))) return res.status(400).json({ message: "Only CSV and JSON files are accepted. ZIP files are not required." });

  const stepDays = parseStepDays(files);
  const runs = parseRuns(files);
  const heartRates = parseStandaloneHeartRate(files);
  if (!stepDays.length && !runs.length && !heartRates.length) {
    return res.status(400).json({ message: "No supported records found. Choose a pedometer_day_summary or activity.day_summary CSV, an exercise CSV with matching live_data JSON files, and/or a tracker.heart_rate CSV." });
  }

  const client = await getPgClient();
  try {
    await client.query("BEGIN");
    for (const day of stepDays) {
      await client.query(
        "INSERT INTO health_step_days (day, steps, run_steps, walk_steps, distance_m, calories, active_time_seconds, imported_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) ON CONFLICT (day) DO UPDATE SET steps = EXCLUDED.steps, run_steps = EXCLUDED.run_steps, walk_steps = EXCLUDED.walk_steps, distance_m = EXCLUDED.distance_m, calories = EXCLUDED.calories, active_time_seconds = EXCLUDED.active_time_seconds, imported_at = NOW()",
        [day.day, day.steps, day.runSteps, day.walkSteps, day.distanceM, day.calories, day.activeTimeSeconds],
      );
    }
    for (const run of runs) {
      await client.query(
        "INSERT INTO health_running_sessions (session_id, started_at, ended_at, duration_seconds, distance_m, calories, avg_hr, min_hr, max_hr, avg_speed_mps, max_speed_mps, avg_cadence, samples_json, imported_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, NOW()) ON CONFLICT (session_id) DO UPDATE SET started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at, duration_seconds = EXCLUDED.duration_seconds, distance_m = EXCLUDED.distance_m, calories = EXCLUDED.calories, avg_hr = EXCLUDED.avg_hr, min_hr = EXCLUDED.min_hr, max_hr = EXCLUDED.max_hr, avg_speed_mps = EXCLUDED.avg_speed_mps, max_speed_mps = EXCLUDED.max_speed_mps, avg_cadence = EXCLUDED.avg_cadence, samples_json = CASE WHEN jsonb_array_length(EXCLUDED.samples_json) > 0 THEN EXCLUDED.samples_json ELSE health_running_sessions.samples_json END, imported_at = NOW()",
        [run.sessionId, run.startedAt, run.endedAt, run.durationSeconds, run.distanceM, run.calories, run.avgHeartRate, run.minHeartRate, run.maxHeartRate, run.avgSpeedMps, run.maxSpeedMps, run.avgCadence, JSON.stringify(run.samples)],
      );
    }
    for (const reading of heartRates) {
      await client.query(
        "INSERT INTO health_heart_rate_samples (sample_id, measured_at, bpm, imported_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (sample_id) DO UPDATE SET measured_at = EXCLUDED.measured_at, bpm = EXCLUDED.bpm, imported_at = NOW()",
        [reading.sampleId, reading.measuredAt, reading.bpm],
      );
    }
    await client.query(
      "INSERT INTO health_imports (filenames, step_days_processed, run_sessions_processed, heart_rate_samples_processed, created_at) VALUES ($1::jsonb, $2, $3, $4, NOW())",
      [JSON.stringify(files.map((file) => file.originalname.slice(0, 240))), stepDays.length, runs.length, heartRates.length],
    );
    await client.query("COMMIT");
    return res.json({ success: true, message: "Samsung Health data imported.", filesProcessed: files.length, stepDaysProcessed: stepDays.length, runSessionsProcessed: runs.length, heartRateSamplesProcessed: heartRates.length });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    next(error);
  } finally { client.release(); }
});

export default router;
