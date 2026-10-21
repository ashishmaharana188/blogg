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
const INDIA_TZ = "Asia/Kolkata";

// ZIP uploads are expanded in memory only. Entry count, per-file size, and total
// expanded size are bounded before and during decompression to avoid zip bombs.
const MAX_ZIP_ENTRIES = 2_000;
const MAX_EXTRACTED_FILE_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_EXTRACTED_BYTES = 100 * 1024 * 1024;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;

class InvalidHealthArchiveError extends Error {}

function readZipUInt16(buffer: Buffer, offset: number): number {
  if (offset < 0 || offset + 2 > buffer.length) {
    throw new InvalidHealthArchiveError("The ZIP archive is incomplete or malformed.");
  }
  return buffer.readUInt16LE(offset);
}

function readZipUInt32(buffer: Buffer, offset: number): number {
  if (offset < 0 || offset + 4 > buffer.length) {
    throw new InvalidHealthArchiveError("The ZIP archive is incomplete or malformed.");
  }
  return buffer.readUInt32LE(offset);
}

function extractHealthFilesFromZip(archiveFile: Express.Multer.File): Express.Multer.File[] {
  const archive = archiveFile.buffer;
  if (!Buffer.isBuffer(archive) || archive.length < 22) {
    throw new InvalidHealthArchiveError(`"${archiveFile.originalname}" is not a valid ZIP archive.`);
  }

  // EOCD is located within the last 65,557 bytes of a standard ZIP archive.
  const searchStart = Math.max(0, archive.length - 22 - 0xffff);
  let eocdOffset = -1;
  for (let offset = archive.length - 22; offset >= searchStart; offset -= 1) {
    if (archive.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY) {
      const commentLength = readZipUInt16(archive, offset + 20);
      if (offset + 22 + commentLength === archive.length) {
        eocdOffset = offset;
        break;
      }
    }
  }
  if (eocdOffset < 0) {
    throw new InvalidHealthArchiveError(`Could not read "${archiveFile.originalname}" as a standard ZIP archive.`);
  }

  const diskNumber = readZipUInt16(archive, eocdOffset + 4);
  const centralDirectoryDisk = readZipUInt16(archive, eocdOffset + 6);
  const entriesOnDisk = readZipUInt16(archive, eocdOffset + 8);
  const entryCount = readZipUInt16(archive, eocdOffset + 10);
  const centralDirectorySize = readZipUInt32(archive, eocdOffset + 12);
  const centralDirectoryOffset = readZipUInt32(archive, eocdOffset + 16);

  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new InvalidHealthArchiveError("Multi-disk ZIP archives are not supported.");
  }
  if (entryCount === 0xffff || centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff) {
    throw new InvalidHealthArchiveError("ZIP64 archives are not supported. Export a standard Samsung Health ZIP archive instead.");
  }
  if (entryCount > MAX_ZIP_ENTRIES) {
    throw new InvalidHealthArchiveError(`The ZIP contains too many entries. The limit is ${MAX_ZIP_ENTRIES}.`);
  }
  if (centralDirectoryOffset + centralDirectorySize > eocdOffset) {
    throw new InvalidHealthArchiveError("The ZIP central directory is invalid.");
  }

  const extracted: Express.Multer.File[] = [];
  let totalExpandedBytes = 0;
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (readZipUInt32(archive, cursor) !== ZIP_CENTRAL_DIRECTORY_ENTRY) {
      throw new InvalidHealthArchiveError("The ZIP central directory is malformed.");
    }
    const flags = readZipUInt16(archive, cursor + 8);
    const method = readZipUInt16(archive, cursor + 10);
    const compressedSize = readZipUInt32(archive, cursor + 20);
    const uncompressedSize = readZipUInt32(archive, cursor + 24);
    const fileNameLength = readZipUInt16(archive, cursor + 28);
    const extraLength = readZipUInt16(archive, cursor + 30);
    const commentLength = readZipUInt16(archive, cursor + 32);
    const localHeaderOffset = readZipUInt32(archive, cursor + 42);
    const recordEnd = cursor + 46 + fileNameLength + extraLength + commentLength;
    if (recordEnd > centralDirectoryOffset + centralDirectorySize || recordEnd > archive.length) {
      throw new InvalidHealthArchiveError("The ZIP central directory is truncated.");
    }

    const archiveName = archive.toString("utf8", cursor + 46, cursor + 46 + fileNameLength).replace(/\\/g, "/");
    cursor = recordEnd;
    if (!archiveName || archiveName.endsWith("/")) continue;

    const extension = archiveName.toLowerCase().match(/\.(csv|json)$/)?.[1];
    if (!extension) continue; // Ignore images, readmes, and other unrelated export files.

    if (archiveName.startsWith("/") || /^[a-z]:/i.test(archiveName) || archiveName.split("/").some((part) => part === "..")) {
      throw new InvalidHealthArchiveError("The ZIP contains an unsafe file path.");
    }
    if ((flags & 0x1) !== 0) {
      throw new InvalidHealthArchiveError(`The ZIP entry "${archiveName}" is encrypted and cannot be imported.`);
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw new InvalidHealthArchiveError("ZIP64 entries are not supported.");
    }
    if (uncompressedSize > MAX_EXTRACTED_FILE_BYTES) {
      throw new InvalidHealthArchiveError(`"${archiveName}" exceeds the ${MAX_EXTRACTED_FILE_BYTES / (1024 * 1024)} MB per-file extraction limit.`);
    }
    if (totalExpandedBytes + uncompressedSize > MAX_TOTAL_EXTRACTED_BYTES) {
      throw new InvalidHealthArchiveError(`The ZIP expands beyond the ${MAX_TOTAL_EXTRACTED_BYTES / (1024 * 1024)} MB total extraction limit.`);
    }
    if (method !== 0 && method !== 8) {
      throw new InvalidHealthArchiveError(`The ZIP entry "${archiveName}" uses an unsupported compression method.`);
    }

    if (readZipUInt32(archive, localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER) {
      throw new InvalidHealthArchiveError(`The ZIP entry "${archiveName}" has an invalid local header.`);
    }
    const localNameLength = readZipUInt16(archive, localHeaderOffset + 26);
    const localExtraLength = readZipUInt16(archive, localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (dataOffset < localHeaderOffset || dataEnd > centralDirectoryOffset || dataEnd > archive.length) {
      throw new InvalidHealthArchiveError(`The ZIP entry "${archiveName}" has invalid compressed data bounds.`);
    }

    const compressed = archive.subarray(dataOffset, dataEnd);
    let contents: Buffer;
    try {
      contents = method === 0
        ? Buffer.from(compressed)
        : inflateRawSync(compressed, { maxOutputLength: Math.min(MAX_EXTRACTED_FILE_BYTES, MAX_TOTAL_EXTRACTED_BYTES - totalExpandedBytes) + 1 });
    } catch {
      throw new InvalidHealthArchiveError(`Could not decompress "${archiveName}". The ZIP may be damaged or exceed the import limits.`);
    }
    if (contents.length !== uncompressedSize) {
      throw new InvalidHealthArchiveError(`The extracted size of "${archiveName}" does not match the ZIP directory.`);
    }
    totalExpandedBytes += contents.length;
    extracted.push({
      fieldname: archiveFile.fieldname,
      originalname: archiveName,
      encoding: archiveFile.encoding,
      mimetype: extension === "json" ? "application/json" : "text/csv",
      size: contents.length,
      buffer: contents,
    } as unknown as Express.Multer.File);
  }

  return extracted;
}

function expandUploadedHealthFiles(uploadedFiles: Express.Multer.File[]): Express.Multer.File[] {
  const expanded: Express.Multer.File[] = [];
  for (const file of uploadedFiles) {
    const name = file.originalname.toLowerCase();
    if (name.endsWith(".zip")) {
      expanded.push(...extractHealthFilesFromZip(file));
    } else if (/\.(csv|json)$/i.test(file.originalname)) {
      expanded.push(file);
    } else {
      throw new InvalidHealthArchiveError("Choose Samsung Health ZIP, CSV, or JSON files only.");
    }
  }
  return expanded;
}

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


// Exercise data is an extension of Samsung Health, using the existing uploader,
// archive expansion, database client, and import transaction.
const PUSHUPS_EXERCISE_TYPE = 10004;
const EXERCISE_METRICS = [
  { id: "repetitions", label: "Repetitions / count", description: "Exercise count recorded for the latest session", requires: "repetitions" },
  { id: "sets", label: "Set breakdown", description: "Repetitions recorded in each set", requires: "sets_json" },
  { id: "duration", label: "Workout duration", description: "Elapsed time for the latest session", requires: "duration_seconds" },
  { id: "heart_rate", label: "Heart rate", description: "Average and minimum/maximum BPM", requires: "avg_hr" },
  { id: "calories", label: "Calories", description: "Calories recorded for the latest session", requires: "calories" },
  { id: "history", label: "Workout history", description: "Number of recorded sessions and total count / repetitions", requires: "session_id" },
] as const;
type ExerciseMetricId = (typeof EXERCISE_METRICS)[number]["id"];
type ExerciseSet = { reps: number; durationSeconds?: number; weight?: number; weightUnit?: string };
type ExerciseSession = {
  sessionId: string; exerciseType: number; activityName: string; startedAt: string; endedAt: string | null; durationSeconds: number | null;
  repetitions: number | null; calories: number | null; avgHeartRate: number | null;
  minHeartRate: number | null; maxHeartRate: number | null; sets: ExerciseSet[];
  heartRateSamples: Array<{ time: string; bpm: number }>;
};
function exerciseActivityName(exerciseType: number): string {
  if (exerciseType === PUSHUPS_EXERCISE_TYPE) return "Push-ups";
  return `Exercise type ${exerciseType}`;
}

// The legacy table names are kept to preserve existing imported sessions and saved metric preferences.
let exerciseTablesReady: Promise<void> | null = null;
async function ensureExerciseTables(client: Awaited<ReturnType<typeof getPgClient>>): Promise<void> {
  if (!exerciseTablesReady) {
    exerciseTablesReady = client.query(`
      CREATE TABLE IF NOT EXISTS health_pushup_sessions (
        session_id TEXT PRIMARY KEY, exercise_type INTEGER NOT NULL DEFAULT 10004,
        started_at TIMESTAMPTZ NOT NULL, ended_at TIMESTAMPTZ,
        duration_seconds INTEGER, repetitions INTEGER CHECK (repetitions IS NULL OR repetitions >= 0),
        calories DOUBLE PRECISION, avg_hr DOUBLE PRECISION, min_hr DOUBLE PRECISION, max_hr DOUBLE PRECISION,
        sets_json JSONB NOT NULL DEFAULT '[]'::jsonb, samples_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE health_pushup_sessions ADD COLUMN IF NOT EXISTS exercise_type INTEGER NOT NULL DEFAULT 10004;
      CREATE INDEX IF NOT EXISTS health_pushup_sessions_started_at_idx ON health_pushup_sessions (started_at DESC);
      CREATE INDEX IF NOT EXISTS health_pushup_sessions_type_started_idx ON health_pushup_sessions (exercise_type, started_at DESC);
      CREATE TABLE IF NOT EXISTS health_pushup_widget_config (
        id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        selected_metrics JSONB NOT NULL DEFAULT '[]'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `).then(() => undefined).catch((error: unknown) => { exerciseTablesReady = null; throw error; });
  }
  await exerciseTablesReady;
}
function decodeJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") { try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
  return [];
}
function parseExerciseSets(raw: string): ExerciseSet[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): ExerciseSet[] => {
      if (!item || typeof item !== "object") return [];
      const set = item as Record<string, unknown>;
      const reps = numeric(set.reps);
      if (reps === null || reps < 0) return [];
      const duration = numeric(set.duration), weight = numeric(set.weight);
      const weightUnit = typeof set.weight_unit === "string" ? set.weight_unit.slice(0, 12) : undefined;
      return [{ reps: Math.round(reps), ...(duration !== null && duration >= 0 ? { durationSeconds: duration } : {}), ...(weight !== null && weight >= 0 ? { weight } : {}), ...(weightUnit ? { weightUnit } : {}) }];
    });
  } catch { return []; }
}
function parseExerciseSessions(files: Express.Multer.File[]): ExerciseSession[] {
  const jsonFiles = jsonFileMap(files);
  const sessions = new Map<string, ExerciseSession>();
  for (const file of files) {
    const name = file.originalname.toLowerCase();
    if (!name.includes("exercise") || !name.endsWith(".csv")) continue;
    for (const row of csvTable(file.originalname, file.buffer.toString("utf8"))) {
      const parsedExerciseType = numeric(field(row, "com.samsung.health.exercise.exercise_type", "exercise_type"));
      // Running (1002) is parsed into the established running-session section.
      // Other exercise types are stored here and rendered in the Exercise & Other Activities section.
      if (parsedExerciseType === null || Math.round(parsedExerciseType) === 1002) continue;
      const exerciseType = Math.round(parsedExerciseType);
      const offset = field(row, "com.samsung.health.exercise.time_offset", "time_offset");
      const startedAt = parseTimestamp(field(row, "com.samsung.health.exercise.start_time", "start_time"), offset);
      if (!startedAt) continue;
      const endedAt = parseTimestamp(field(row, "com.samsung.health.exercise.end_time", "end_time"), offset);
      const rawId = field(row, "com.samsung.health.exercise.datauuid", "datauuid");
      const sessionId = rawId || createHash("sha256").update(`${file.originalname}|${startedAt}`).digest("hex");
      const liveName = field(row, "com.samsung.health.exercise.live_data", "live_data").split(/[\\/]/).pop()?.toLowerCase();
      const samples = parseRunSamples(liveName ? jsonFiles.get(liveName) : undefined)
        .filter((point): point is HeartRatePoint & { bpm: number } => typeof point.bpm === "number")
        .map((point) => ({ time: point.time, bpm: Math.round(point.bpm) }));
      const sets = parseExerciseSets(field(row, "subset_data", "com.samsung.health.exercise.subset_data"));
      let repetitions = numeric(field(row, "com.samsung.health.exercise.count", "count"));
      if (repetitions === null && sets.length) repetitions = sets.reduce((sum, set) => sum + set.reps, 0);
      const durationSeconds = secondsFromSamsung(field(row, "com.samsung.health.exercise.duration", "duration")) ??
        (endedAt ? Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000)) : null);
      const avgSamples = samples.length ? samples.reduce((sum, item) => sum + item.bpm, 0) / samples.length : null;
      const avgHr = numeric(field(row, "com.samsung.health.exercise.mean_heart_rate", "mean_heart_rate")) ?? avgSamples;
      const minHr = numeric(field(row, "com.samsung.health.exercise.min_heart_rate", "min_heart_rate")) ?? (samples.length ? Math.min(...samples.map((item) => item.bpm)) : null);
      const maxHr = numeric(field(row, "com.samsung.health.exercise.max_heart_rate", "max_heart_rate")) ?? (samples.length ? Math.max(...samples.map((item) => item.bpm)) : null);
      const session: ExerciseSession = {
        sessionId, exerciseType, activityName: exerciseActivityName(exerciseType), startedAt, endedAt, durationSeconds,
        repetitions: repetitions === null ? null : Math.max(0, Math.round(repetitions)),
        calories: numeric(field(row, "com.samsung.health.exercise.calorie", "calorie", "total_calorie")),
        avgHeartRate: avgHr === null ? null : Math.round(avgHr), minHeartRate: minHr === null ? null : Math.round(minHr),
        maxHeartRate: maxHr === null ? null : Math.round(maxHr), sets, heartRateSamples: samples,
      };
      const previous = sessions.get(sessionId);
      if (!previous || session.heartRateSamples.length > previous.heartRateSamples.length) sessions.set(sessionId, session);
    }
  }
  return [...sessions.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
async function getAvailableExerciseMetrics(client: Awaited<ReturnType<typeof getPgClient>>) {
  const result = await client.query("SELECT session_id, repetitions, duration_seconds, calories, avg_hr, min_hr, max_hr, sets_json FROM health_pushup_sessions ORDER BY started_at DESC LIMIT 200");
  const rows = result.rows as Array<Record<string, unknown>>;
  return EXERCISE_METRICS.filter((metric) => {
    if (!rows.length) return false;
    if (metric.id === "history") return true;
    if (metric.id === "sets") return rows.some((row) => decodeJsonArray(row.sets_json).length > 0);
    if (metric.id === "heart_rate") return rows.some((row) => [row.avg_hr, row.min_hr, row.max_hr].some((value) => value !== null && value !== undefined && value !== ""));
    return rows.some((row) => { const value = row[metric.requires]; return value !== null && value !== undefined && value !== ""; });
  }).map(({ id, label, description }) => ({ id, label, description }));
}
async function readSelectedExerciseMetrics(client: Awaited<ReturnType<typeof getPgClient>>): Promise<ExerciseMetricId[]> {
  const result = await client.query("SELECT selected_metrics FROM health_pushup_widget_config WHERE id = 1");
  return decodeJsonArray(result.rows[0]?.selected_metrics).filter((id): id is ExerciseMetricId => typeof id === "string" && EXERCISE_METRICS.some((metric) => metric.id === id)).slice(0, 3);
}
function exerciseSessionFromRow(row: Record<string, unknown>): ExerciseSession {
  const sets = decodeJsonArray(row.sets_json).filter((item): item is ExerciseSet => Boolean(item) && typeof item === "object" && typeof (item as ExerciseSet).reps === "number");
  const samples = decodeJsonArray(row.samples_json).filter((item): item is { time: string; bpm: number } => Boolean(item) && typeof item === "object" && typeof (item as { time?: unknown }).time === "string" && typeof (item as { bpm?: unknown }).bpm === "number");
  const exerciseType = Math.round(numeric(row.exercise_type) ?? PUSHUPS_EXERCISE_TYPE);
  return {
    sessionId: String(row.session_id), exerciseType, activityName: exerciseActivityName(exerciseType),
    startedAt: new Date(String(row.started_at)).toISOString(), endedAt: row.ended_at ? new Date(String(row.ended_at)).toISOString() : null,
    durationSeconds: numeric(row.duration_seconds), repetitions: numeric(row.repetitions), calories: numeric(row.calories), avgHeartRate: numeric(row.avg_hr),
    minHeartRate: numeric(row.min_hr), maxHeartRate: numeric(row.max_hr), sets, heartRateSamples: samples,
  };
}
async function loadExerciseData(client: Awaited<ReturnType<typeof getPgClient>>) {
  const sessionsResult = await client.query("SELECT * FROM health_pushup_sessions ORDER BY started_at DESC LIMIT 30");
  const countResult = await client.query("SELECT COUNT(*)::int AS session_count, COALESCE(SUM(repetitions), 0)::int AS total_repetitions FROM health_pushup_sessions");
  return { sessions: (sessionsResult.rows as Array<Record<string, unknown>>).map(exerciseSessionFromRow), sessionCount: Number(countResult.rows[0]?.session_count || 0), totalRepetitions: Number(countResult.rows[0]?.total_repetitions || 0) };
}
function exerciseValuesForSession(session: ExerciseSession, selected: ExerciseMetricId[], sessionCount: number, totalRepetitions: number): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const id of selected) {
    switch (id) {
      case "repetitions": values.repetitions = session.repetitions; break;
      case "sets": values.sets = session.sets.map((set) => set.reps); break;
      case "duration": values.durationSeconds = session.durationSeconds; break;
      case "heart_rate": values.heartRate = { average: session.avgHeartRate, minimum: session.minHeartRate, maximum: session.maxHeartRate }; break;
      case "calories": values.calories = session.calories; break;
      case "history": values.history = { sessionCount, totalCount: totalRepetitions, totalRepetitions }; break;
    }
  }
  return values;
}

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
  const uploadedFiles = (req.files || []) as Express.Multer.File[];
  if (!uploadedFiles.length) return res.status(400).json({ message: "Choose one or more Samsung Health ZIP, CSV, or JSON files first." });

  let files: Express.Multer.File[];
  try {
    files = expandUploadedHealthFiles(uploadedFiles);
  } catch (error) {
    if (error instanceof InvalidHealthArchiveError) {
      return res.status(400).json({ message: error.message });
    }
    return next(error);
  }
  if (!files.length) {
    return res.status(400).json({ message: "No CSV or JSON files were found in the selected upload. Choose a Samsung Health ZIP archive containing exported CSV/JSON files, or select the files directly." });
  }

  const stepDays = parseStepDays(files);
  const runs = parseRuns(files);
  const heartRates = parseStandaloneHeartRate(files);
  const exerciseSessions = parseExerciseSessions(files);
  if (!stepDays.length && !runs.length && !heartRates.length && !exerciseSessions.length) {
    return res.status(400).json({ message: "No supported records found. The import needs daily steps, running, heart-rate records, or a supported Samsung Health exercise session." });
  }

  const client = await getPgClient();
  try {
    await ensureExerciseTables(client);
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
    for (const session of exerciseSessions) {
      await client.query(
        "INSERT INTO health_pushup_sessions (session_id, exercise_type, started_at, ended_at, duration_seconds, repetitions, calories, avg_hr, min_hr, max_hr, sets_json, samples_json, imported_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, NOW()) ON CONFLICT (session_id) DO UPDATE SET exercise_type = EXCLUDED.exercise_type, started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at, duration_seconds = EXCLUDED.duration_seconds, repetitions = EXCLUDED.repetitions, calories = EXCLUDED.calories, avg_hr = EXCLUDED.avg_hr, min_hr = EXCLUDED.min_hr, max_hr = EXCLUDED.max_hr, sets_json = CASE WHEN jsonb_array_length(EXCLUDED.sets_json) > 0 THEN EXCLUDED.sets_json ELSE health_pushup_sessions.sets_json END, samples_json = CASE WHEN jsonb_array_length(EXCLUDED.samples_json) > 0 THEN EXCLUDED.samples_json ELSE health_pushup_sessions.samples_json END, imported_at = NOW()",
        [session.sessionId, session.exerciseType, session.startedAt, session.endedAt, session.durationSeconds, session.repetitions, session.calories, session.avgHeartRate, session.minHeartRate, session.maxHeartRate, JSON.stringify(session.sets), JSON.stringify(session.heartRateSamples)],
      );
    }
    if (exerciseSessions.length) {
      const existingConfig = await client.query("SELECT id FROM health_pushup_widget_config WHERE id = 1");
      if (!existingConfig.rows.length) {
        const available = await getAvailableExerciseMetrics(client);
        const defaults = ["repetitions", "duration", "heart_rate", "sets", "calories", "history"]
          .filter((id) => available.some((metric) => metric.id === id))
          .slice(0, 3);
        await client.query(
          "INSERT INTO health_pushup_widget_config (id, selected_metrics, updated_at) VALUES (1, $1::jsonb, NOW()) ON CONFLICT (id) DO NOTHING",
          [JSON.stringify(defaults)],
        );
      }
    }
    await client.query(
      "INSERT INTO health_imports (filenames, step_days_processed, run_sessions_processed, heart_rate_samples_processed, created_at) VALUES ($1::jsonb, $2, $3, $4, NOW())",
      [JSON.stringify(uploadedFiles.map((file) => file.originalname.slice(0, 240))), stepDays.length, runs.length, heartRates.length],
    );
    await client.query("COMMIT");
    return res.json({ success: true, message: "Samsung Health data imported.", filesProcessed: uploadedFiles.length, sourceFilesProcessed: files.length, stepDaysProcessed: stepDays.length, runSessionsProcessed: runs.length, heartRateSamplesProcessed: heartRates.length, exerciseSessionsProcessed: exerciseSessions.length });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    next(error);
  } finally { client.release(); }
});



// Display configuration for the existing PERSONAL METRICS / Samsung Health card.
router.get("/health/exercises/admin/config", ...ADMIN_GUARD, async (_req, res, next) => {
  const client = await getPgClient();
  try {
    await ensureExerciseTables(client);
    const selectedMetrics = await readSelectedExerciseMetrics(client);
    const availableMetrics = await getAvailableExerciseMetrics(client);
    const data = await loadExerciseData(client);
    res.setHeader("Cache-Control", "private, no-store");
    return res.json({ selectedMetrics, availableMetrics, ...data });
  } catch (error) { return next(error); }
  finally { client.release(); }
});

router.put("/health/exercises/admin/config", ...ADMIN_GUARD, async (req, res, next) => {
  const client = await getPgClient();
  try {
    await ensureExerciseTables(client);
    const candidate = req.body?.selectedMetrics;
    if (!Array.isArray(candidate) || candidate.length > 3 || candidate.some((item: unknown) => typeof item !== "string")) {
      return res.status(400).json({ message: "Select no more than three available Samsung Health metrics." });
    }
    const selected = [...new Set(candidate)] as string[];
    if (selected.length !== candidate.length || selected.some((id) => !EXERCISE_METRICS.some((metric) => metric.id === id))) {
      return res.status(400).json({ message: "The selected metric list contains an unknown or duplicate metric." });
    }
    const available = await getAvailableExerciseMetrics(client);
    const availableIds = new Set(available.map((metric) => metric.id));
    if (selected.some((id) => !availableIds.has(id))) {
      return res.status(400).json({ message: "One or more selected metrics are not present in the imported Samsung Health data." });
    }
    await client.query("INSERT INTO health_pushup_widget_config (id, selected_metrics, updated_at) VALUES (1, $1::jsonb, NOW()) ON CONFLICT (id) DO UPDATE SET selected_metrics = EXCLUDED.selected_metrics, updated_at = NOW()", [JSON.stringify(selected)]);
    res.setHeader("Cache-Control", "private, no-store");
    return res.json({ success: true, selectedMetrics: selected, availableMetrics: available });
  } catch (error) { return next(error); }
  finally { client.release(); }
});

router.get("/health/exercises/public", async (_req, res, next) => {
  const client = await getPgClient();
  try {
    await ensureExerciseTables(client);
    const selectedMetrics = await readSelectedExerciseMetrics(client);
    const data = await loadExerciseData(client);
    const latest = data.sessions[0] || null;
    const result = {
      selectedMetrics,
      latestSession: latest && selectedMetrics.length ? { startedAt: latest.startedAt, exerciseType: latest.exerciseType, activityName: latest.activityName, values: exerciseValuesForSession(latest, selectedMetrics, data.sessionCount, data.totalRepetitions) } : null,
      recentSessions: selectedMetrics.length ? data.sessions.slice(0, 12).map((session) => ({ startedAt: session.startedAt, exerciseType: session.exerciseType, activityName: session.activityName, values: exerciseValuesForSession(session, selectedMetrics, data.sessionCount, data.totalRepetitions) })) : [],
      ...(selectedMetrics.includes("history") ? { sessionCount: data.sessionCount, totalRepetitions: data.totalRepetitions } : {}),
    };
    res.setHeader("Cache-Control", "public, max-age=60");
    return res.json(result);
  } catch (error) { return next(error); }
  finally { client.release(); }
});

export default router;
