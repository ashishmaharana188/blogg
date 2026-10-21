import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { Router } from "express";
import multer from "multer";
import { getPgClient } from "../db/postgres.ts";
import { authenticationMiddleware } from "../middleware/authenticationMiddleware.ts";
import { adminMiddleware } from "../middleware/adminMiddleware.ts";

const router = Router();
const ADMIN_GUARD = [authenticationMiddleware, adminMiddleware] as const;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 40, fileSize: 20 * 1024 * 1024, fieldSize: 1024 * 1024 },
});
const MAX_ZIP_ENTRIES = 500;
const MAX_ZIP_ENTRY_BYTES = 24 * 1024 * 1024;
const MAX_ZIP_EXPANDED_BYTES = 100 * 1024 * 1024;
const EXERCISE_PUSH_UPS = 10004;

const METRICS = [
  { id: "repetitions", label: "Repetitions", description: "Total push-ups in the latest session", requires: "repetitions" },
  { id: "sets", label: "Set breakdown", description: "Repetitions recorded in each set", requires: "sets" },
  { id: "duration", label: "Workout duration", description: "Elapsed time for the latest session", requires: "duration_seconds" },
  { id: "heart_rate", label: "Heart rate", description: "Average and minimum/maximum BPM", requires: "avg_hr" },
  { id: "calories", label: "Calories", description: "Calories recorded for the latest session", requires: "calories" },
  { id: "history", label: "Workout history", description: "Number of sessions and total recorded repetitions", requires: "session_id" },
] as const;
type MetricId = (typeof METRICS)[number]["id"];
type UploadedTextFile = { originalname: string; buffer: Buffer };
type CsvRow = Record<string, string>;
type PushupSet = { reps: number; durationSeconds?: number; weight?: number; weightUnit?: string };
type PushupSession = {
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  repetitions: number | null;
  calories: number | null;
  avgHeartRate: number | null;
  minHeartRate: number | null;
  maxHeartRate: number | null;
  sets: PushupSet[];
  heartRateSamples: Array<{ time: string; bpm: number }>;
};

let tablesReady: Promise<void> | null = null;
async function ensureTables(client: Awaited<ReturnType<typeof getPgClient>>): Promise<void> {
  if (!tablesReady) {
    tablesReady = client.query(`
    CREATE TABLE IF NOT EXISTS health_pushup_sessions (
      session_id TEXT PRIMARY KEY,
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
    CREATE INDEX IF NOT EXISTS health_pushup_sessions_started_at_idx
      ON health_pushup_sessions (started_at DESC);
    CREATE TABLE IF NOT EXISTS health_pushup_widget_config (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      selected_metrics JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `).then(() => undefined).catch((error: unknown) => {
      tablesReady = null;
      throw error;
    });
  }
  await tablesReady;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/^\uFEFF/, "").trim() : value == null ? "" : String(value).trim();
}
function numeric(value: unknown): number | null {
  const text = clean(value);
  if (!text) return null;
  const valueNumber = Number(text);
  return Number.isFinite(valueNumber) ? valueNumber : null;
}
function field(row: CsvRow, ...keys: string[]): string {
  for (const key of keys) if (row[key] !== undefined && clean(row[key]) !== "") return clean(row[key]);
  return "";
}
function parseTimestamp(value: unknown): string | null {
  const raw = clean(value);
  if (!raw) return null;
  if (/^\d{10,13}$/.test(raw)) {
    const n = Number(raw);
    const date = new Date(raw.length <= 10 ? n * 1000 : n);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  const normalized = raw.replace(/\s+/, "T");
  const candidate = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`;
  const date = new Date(candidate);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function parseCsv(input: string): string[][] {
  const source = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [], value = "", quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { value += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"' && value.length === 0) quoted = true;
    else if (char === ",") { row.push(value); value = ""; }
    else if (char === "\n") { row.push(value.replace(/\r$/, "")); if (row.some((cell) => cell.trim())) rows.push(row); row = []; value = ""; }
    else value += char;
  }
  if (value.length || row.length) { row.push(value.replace(/\r$/, "")); if (row.some((cell) => cell.trim())) rows.push(row); }
  return rows;
}
function parseSets(raw: string): PushupSet[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): PushupSet[] => {
      if (!item || typeof item !== "object") return [];
      const set = item as Record<string, unknown>;
      const reps = numeric(set.reps);
      if (reps === null || reps < 0) return [];
      const duration = numeric(set.duration);
      const weight = numeric(set.weight);
      const weightUnit = typeof set.weight_unit === "string" ? set.weight_unit.slice(0, 12) : undefined;
      return [{ reps: Math.round(reps), ...(duration !== null && duration >= 0 ? { durationSeconds: duration } : {}), ...(weight !== null && weight >= 0 ? { weight } : {}), ...(weightUnit ? { weightUnit } : {}) }];
    });
  } catch { return []; }
}
function parseSamples(raw: string | undefined): Array<{ time: string; bpm: number }> {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): Array<{ time: string; bpm: number }> => {
      if (!item || typeof item !== "object") return [];
      const sample = item as Record<string, unknown>;
      const time = parseTimestamp(sample.start_time ?? sample.timestamp);
      const bpm = numeric(sample.heart_rate);
      return time && bpm !== null && bpm >= 25 && bpm <= 250 ? [{ time, bpm: Math.round(bpm) }] : [];
    }).sort((a, b) => a.time.localeCompare(b.time));
  } catch { return []; }
}

function safeZipTextFiles(zip: Buffer): UploadedTextFile[] {
  if (zip.length < 22 || zip.length > 20 * 1024 * 1024) throw new Error("ZIP file is empty or exceeds the 20 MB upload limit.");
  let eocd = -1;
  const searchFrom = Math.max(0, zip.length - 65_557);
  for (let offset = zip.length - 22; offset >= searchFrom; offset -= 1) {
    if (zip.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error("This file is not a valid ZIP archive.");
  const entryCount = zip.readUInt16LE(eocd + 10);
  let centralOffset = zip.readUInt32LE(eocd + 16);
  if (entryCount > MAX_ZIP_ENTRIES) throw new Error(`ZIP contains too many entries (maximum ${MAX_ZIP_ENTRIES}).`);
  const files: UploadedTextFile[] = [];
  let totalExpanded = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (centralOffset + 46 > zip.length || zip.readUInt32LE(centralOffset) !== 0x02014b50) throw new Error("ZIP directory is malformed.");
    const flags = zip.readUInt16LE(centralOffset + 8);
    const method = zip.readUInt16LE(centralOffset + 10);
    const compressedSize = zip.readUInt32LE(centralOffset + 20);
    const uncompressedSize = zip.readUInt32LE(centralOffset + 24);
    const nameLength = zip.readUInt16LE(centralOffset + 28);
    const extraLength = zip.readUInt16LE(centralOffset + 30);
    const commentLength = zip.readUInt16LE(centralOffset + 32);
    const localOffset = zip.readUInt32LE(centralOffset + 42);
    const endCentral = centralOffset + 46 + nameLength + extraLength + commentLength;
    if (endCentral > zip.length) throw new Error("ZIP directory entry is truncated.");
    const entryName = zip.subarray(centralOffset + 46, centralOffset + 46 + nameLength).toString("utf8").replace(/\\/g, "/");
    centralOffset = endCentral;
    if (!entryName || entryName.endsWith("/")) continue;
    if (flags & 1) throw new Error("Password-protected ZIP files are not supported.");
    if (!/\.(csv|json)$/i.test(entryName)) continue;
    if (uncompressedSize > MAX_ZIP_ENTRY_BYTES || totalExpanded + uncompressedSize > MAX_ZIP_EXPANDED_BYTES) throw new Error("ZIP expands beyond the supported size limit.");
    if (localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("ZIP file entry is malformed.");
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataStart > zip.length || dataEnd > zip.length) throw new Error("ZIP file data is truncated.");
    const compressed = zip.subarray(dataStart, dataEnd);
    let expanded: Buffer;
    if (method === 0) expanded = Buffer.from(compressed);
    else if (method === 8) expanded = inflateRawSync(compressed, { maxOutputLength: MAX_ZIP_ENTRY_BYTES });
    else throw new Error(`Unsupported ZIP compression method (${method}).`);
    if (expanded.length !== uncompressedSize) throw new Error("ZIP entry has an unexpected uncompressed size.");
    totalExpanded += expanded.length;
    const basename = entryName.split("/").pop()!;
    files.push({ originalname: basename, buffer: expanded });
  }
  if (!files.length) throw new Error("No CSV or JSON data files were found in the ZIP.");
  return files;
}
function normalizeUploadedFiles(uploaded: Express.Multer.File[]): UploadedTextFile[] {
  const result: UploadedTextFile[] = [];
  for (const file of uploaded) {
    if (/\.zip$/i.test(file.originalname)) result.push(...safeZipTextFiles(file.buffer));
    else if (/\.(csv|json)$/i.test(file.originalname)) result.push({ originalname: file.originalname.split(/[\\/]/).pop()!, buffer: file.buffer });
    else throw new Error("Only Samsung Health ZIP, CSV and JSON files are supported.");
  }
  if (result.length > MAX_ZIP_ENTRIES) throw new Error(`Upload contains more than ${MAX_ZIP_ENTRIES} source files.`);
  return result;
}
function parsePushupSessions(files: UploadedTextFile[]): PushupSession[] {
  const jsonFiles = new Map<string, string>();
  for (const file of files) if (/\.json$/i.test(file.originalname)) jsonFiles.set(file.originalname.toLowerCase(), file.buffer.toString("utf8"));
  const sessions = new Map<string, PushupSession>();
  for (const file of files) {
    if (!file.originalname.toLowerCase().includes("exercise") || !/\.csv$/i.test(file.originalname)) continue;
    const rows = parseCsv(file.buffer.toString("utf8"));
    const headerIndex = rows.findIndex((row) => {
      const names = row.map((name) => name.trim().toLowerCase());
      return names.some((name) => name === "com.samsung.health.exercise.exercise_type" || name === "exercise_type")
        && names.some((name) => name === "com.samsung.health.exercise.start_time" || name === "start_time");
    });
    if (headerIndex < 0) continue;
    const headers = rows[headerIndex].map((name) => name.trim());
    for (const values of rows.slice(headerIndex + 1)) {
      const row: CsvRow = {};
      headers.forEach((name, idx) => { if (name) row[name] = values[idx] ?? ""; });
      if (numeric(field(row, "com.samsung.health.exercise.exercise_type", "exercise_type")) !== EXERCISE_PUSH_UPS) continue;
      const startedAt = parseTimestamp(field(row, "com.samsung.health.exercise.start_time", "start_time"));
      if (!startedAt) continue;
      const endedAt = parseTimestamp(field(row, "com.samsung.health.exercise.end_time", "end_time"));
      const rawSessionId = field(row, "com.samsung.health.exercise.datauuid", "datauuid");
      const sessionId = rawSessionId || createHash("sha256").update(`${file.originalname}|${startedAt}`).digest("hex");
      const liveDataFilename = field(row, "com.samsung.health.exercise.live_data", "live_data").split(/[\\/]/).pop()?.toLowerCase();
      const samples = parseSamples(liveDataFilename ? jsonFiles.get(liveDataFilename) : undefined);
      const sets = parseSets(field(row, "subset_data", "com.samsung.health.exercise.subset_data"));
      let repetitions = numeric(field(row, "com.samsung.health.exercise.count", "count"));
      if (repetitions === null && sets.length) repetitions = sets.reduce((sum, item) => sum + item.reps, 0);
      const durationMs = numeric(field(row, "com.samsung.health.exercise.duration", "duration"));
      const durationSeconds = durationMs === null ? (endedAt ? Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000)) : null) : Math.max(0, Math.round(durationMs / 1000));
      const avgFromSamples = samples.length ? samples.reduce((sum, sample) => sum + sample.bpm, 0) / samples.length : null;
      const avgHr = numeric(field(row, "com.samsung.health.exercise.mean_heart_rate", "mean_heart_rate")) ?? avgFromSamples;
      const minHr = numeric(field(row, "com.samsung.health.exercise.min_heart_rate", "min_heart_rate")) ?? (samples.length ? Math.min(...samples.map((item) => item.bpm)) : null);
      const maxHr = numeric(field(row, "com.samsung.health.exercise.max_heart_rate", "max_heart_rate")) ?? (samples.length ? Math.max(...samples.map((item) => item.bpm)) : null);
      const session: PushupSession = {
        sessionId, startedAt, endedAt, durationSeconds,
        repetitions: repetitions === null ? null : Math.max(0, Math.round(repetitions)),
        calories: numeric(field(row, "com.samsung.health.exercise.calorie", "calorie", "total_calorie")),
        avgHeartRate: avgHr === null ? null : Math.round(avgHr),
        minHeartRate: minHr === null ? null : Math.round(minHr),
        maxHeartRate: maxHr === null ? null : Math.round(maxHr), sets, heartRateSamples: samples,
      };
      const existing = sessions.get(sessionId);
      if (!existing || session.heartRateSamples.length > existing.heartRateSamples.length) sessions.set(sessionId, session);
    }
  }
  return [...sessions.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

function decodeJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
  return [];
}
async function getAvailableMetrics(client: Awaited<ReturnType<typeof getPgClient>>) {
  const result = await client.query("SELECT session_id, repetitions, duration_seconds, calories, avg_hr, sets_json FROM health_pushup_sessions ORDER BY started_at DESC LIMIT 200");
  const rows = result.rows as Array<Record<string, unknown>>;
  return METRICS.filter((metric) => {
    if (!rows.length) return false;
    if (metric.id === "history") return true;
    if (metric.id === "sets") return rows.some((row) => decodeJsonArray(row.sets_json).length > 0);
    if (metric.id === "heart_rate") return rows.some((row) => [row.avg_hr, row.min_hr, row.max_hr].some((value) => value !== null && value !== undefined && value !== ""));
    return rows.some((row) => {
      const value = row[metric.requires];
      return value !== null && value !== undefined && value !== "";
    });
  }).map(({ id, label, description }) => ({ id, label, description }));
}
async function readConfig(client: Awaited<ReturnType<typeof getPgClient>>): Promise<MetricId[]> {
  const result = await client.query("SELECT selected_metrics FROM health_pushup_widget_config WHERE id = 1");
  const selected = result.rows[0]?.selected_metrics;
  const list = decodeJsonArray(selected);
  return list.filter((id): id is MetricId => typeof id === "string" && METRICS.some((metric) => metric.id === id)).slice(0, 3);
}
function sessionFromRow(row: Record<string, unknown>): PushupSession {
  const sets = decodeJsonArray(row.sets_json).filter((item): item is PushupSet => Boolean(item) && typeof item === "object" && typeof (item as PushupSet).reps === "number");
  const samples = decodeJsonArray(row.samples_json).filter((item): item is { time: string; bpm: number } => Boolean(item) && typeof item === "object" && typeof (item as { time?: unknown }).time === "string" && typeof (item as { bpm?: unknown }).bpm === "number");
  return {
    sessionId: String(row.session_id), startedAt: new Date(String(row.started_at)).toISOString(),
    endedAt: row.ended_at ? new Date(String(row.ended_at)).toISOString() : null,
    durationSeconds: numeric(row.duration_seconds), repetitions: numeric(row.repetitions), calories: numeric(row.calories),
    avgHeartRate: numeric(row.avg_hr), minHeartRate: numeric(row.min_hr), maxHeartRate: numeric(row.max_hr), sets, heartRateSamples: samples,
  };
}
async function loadPushupData(client: Awaited<ReturnType<typeof getPgClient>>) {
  const latestResult = await client.query("SELECT * FROM health_pushup_sessions ORDER BY started_at DESC LIMIT 30");
  const countResult = await client.query("SELECT COUNT(*)::int AS session_count, COALESCE(SUM(repetitions), 0)::int AS total_repetitions FROM health_pushup_sessions");
  return {
    sessions: (latestResult.rows as Array<Record<string, unknown>>).map(sessionFromRow),
    sessionCount: Number(countResult.rows[0]?.session_count || 0),
    totalRepetitions: Number(countResult.rows[0]?.total_repetitions || 0),
  };
}
async function withClient<T>(handler: (client: Awaited<ReturnType<typeof getPgClient>>) => Promise<T>): Promise<T> {
  const client = await getPgClient();
  try { await ensureTables(client); return await handler(client); }
  finally { client.release(); }
}

router.get("/health/pushups/admin/config", ...ADMIN_GUARD, async (_req, res, next) => {
  try {
    const result = await withClient(async (client) => ({
      selectedMetrics: await readConfig(client),
      availableMetrics: await getAvailableMetrics(client),
      ...(await loadPushupData(client)),
    }));
    res.setHeader("Cache-Control", "private, no-store");
    return res.json(result);
  } catch (error) { return next(error); }
});

router.put("/health/pushups/admin/config", ...ADMIN_GUARD, async (req, res, next) => {
  try {
    const candidate = req.body?.selectedMetrics;
    if (!Array.isArray(candidate) || candidate.length > 3 || candidate.some((item: unknown) => typeof item !== "string")) {
      return res.status(400).json({ message: "Select no more than three available push-up metrics." });
    }
    const selected = [...new Set(candidate)] as string[];
    if (selected.length !== candidate.length || selected.some((id) => !METRICS.some((metric) => metric.id === id))) {
      return res.status(400).json({ message: "The selected metric list contains an unknown or duplicate metric." });
    }
    const result = await withClient(async (client) => {
      const available = await getAvailableMetrics(client);
      const availableIds = new Set(available.map((metric) => metric.id));
      if (selected.some((id) => !availableIds.has(id))) {
        return { invalidSelection: true as const, availableMetrics: available };
      }
      await client.query("INSERT INTO health_pushup_widget_config (id, selected_metrics, updated_at) VALUES (1, $1::jsonb, NOW()) ON CONFLICT (id) DO UPDATE SET selected_metrics = EXCLUDED.selected_metrics, updated_at = NOW()", [JSON.stringify(selected)]);
      return { invalidSelection: false as const, selectedMetrics: selected, availableMetrics: available };
    });
    res.setHeader("Cache-Control", "private, no-store");
    if (result.invalidSelection) return res.status(400).json({ message: "One or more selected metrics are not present in the imported data.", availableMetrics: result.availableMetrics });
    return res.json({ success: true, selectedMetrics: result.selectedMetrics, availableMetrics: result.availableMetrics });
  } catch (error) { return next(error); }
});

router.post("/health/pushups/admin/import", ...ADMIN_GUARD, upload.array("files", 40), async (req, res, next) => {
  const uploaded = (req.files || []) as Express.Multer.File[];
  if (!uploaded.length) return res.status(400).json({ message: "Choose a Samsung Health ZIP, exercise CSV, and/or referenced JSON files." });
  let files: UploadedTextFile[];
  try { files = normalizeUploadedFiles(uploaded); }
  catch (error) { return res.status(400).json({ message: error instanceof Error ? error.message : "Could not read the uploaded archive." }); }
  const sessions = parsePushupSessions(files);
  if (!sessions.length) return res.status(400).json({ message: "No Push-ups sessions were found. The archive must include the Samsung Health exercise CSV with exercise type 10004." });
  try {
    const result = await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        for (const session of sessions) {
          await client.query(
            "INSERT INTO health_pushup_sessions (session_id, started_at, ended_at, duration_seconds, repetitions, calories, avg_hr, min_hr, max_hr, sets_json, samples_json, imported_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, NOW()) ON CONFLICT (session_id) DO UPDATE SET started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at, duration_seconds = EXCLUDED.duration_seconds, repetitions = EXCLUDED.repetitions, calories = EXCLUDED.calories, avg_hr = EXCLUDED.avg_hr, min_hr = EXCLUDED.min_hr, max_hr = EXCLUDED.max_hr, sets_json = CASE WHEN jsonb_array_length(EXCLUDED.sets_json) > 0 THEN EXCLUDED.sets_json ELSE health_pushup_sessions.sets_json END, samples_json = CASE WHEN jsonb_array_length(EXCLUDED.samples_json) > 0 THEN EXCLUDED.samples_json ELSE health_pushup_sessions.samples_json END, imported_at = NOW()",
            [session.sessionId, session.startedAt, session.endedAt, session.durationSeconds, session.repetitions, session.calories, session.avgHeartRate, session.minHeartRate, session.maxHeartRate, JSON.stringify(session.sets), JSON.stringify(session.heartRateSamples)],
          );
        }
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      return { availableMetrics: await getAvailableMetrics(client), ...await loadPushupData(client) };
    });
    res.setHeader("Cache-Control", "private, no-store");
    return res.json({ success: true, filesAnalyzed: files.length, sessionsProcessed: sessions.length, message: `Imported ${sessions.length} push-up session(s).`, ...result });
  } catch (error) { return next(error); }
});

router.get("/health/pushups/public", async (_req, res, next) => {
  try {
    const result = await withClient(async (client) => {
      const selectedMetrics = await readConfig(client);
      const data = await loadPushupData(client);
      const latestSession = data.sessions[0] || null;
      if (!selectedMetrics.length || !latestSession) return { selectedMetrics, latestSession: null };
      const exposed: Record<string, unknown> = {};
      for (const metricId of selectedMetrics) {
        switch (metricId) {
          case "repetitions": exposed.repetitions = latestSession.repetitions; break;
          case "sets": exposed.sets = latestSession.sets.map((set) => set.reps); break;
          case "duration": exposed.durationSeconds = latestSession.durationSeconds; break;
          case "heart_rate": exposed.heartRate = { average: latestSession.avgHeartRate, minimum: latestSession.minHeartRate, maximum: latestSession.maxHeartRate }; break;
          case "calories": exposed.calories = latestSession.calories; break;
          case "history": exposed.history = { sessionCount: data.sessionCount, totalRepetitions: data.totalRepetitions }; break;
        }
      }
      return { selectedMetrics, latestSession: { startedAt: latestSession.startedAt, values: exposed } };
    });
    res.setHeader("Cache-Control", "public, max-age=60");
    return res.json(result);
  } catch (error) { return next(error); }
});

export default router;
