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
const MAX_ZIP_ENTRIES = 2_000;
const MAX_EXTRACTED_FILE_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_EXTRACTED_BYTES = 100 * 1024 * 1024;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;

class InvalidSleepArchiveError extends Error {}
type SleepSession = {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  sleepScore: number | null;
  efficiency: number | null;
};
type CsvRow = Record<string, string>;

function u16(buffer: Buffer, offset: number): number {
  if (offset < 0 || offset + 2 > buffer.length) throw new InvalidSleepArchiveError("The sleep ZIP archive is incomplete or malformed.");
  return buffer.readUInt16LE(offset);
}
function u32(buffer: Buffer, offset: number): number {
  if (offset < 0 || offset + 4 > buffer.length) throw new InvalidSleepArchiveError("The sleep ZIP archive is incomplete or malformed.");
  return buffer.readUInt32LE(offset);
}

function isSleepSummaryFile(name: string): boolean {
  const lowerName = name.toLowerCase();
  if (!lowerName.includes("sleep")) return false;
  // These files contain stage intervals, raw points, or goals, not sleep-session summaries.
  return !/sleep[_-]?(?:stage|raw[_-]?data|goal)/i.test(lowerName);
}

function zipSleepFiles(archiveFile: Express.Multer.File): Express.Multer.File[] {
  const archive = archiveFile.buffer;
  if (!Buffer.isBuffer(archive) || archive.length < 22) throw new InvalidSleepArchiveError(`"${archiveFile.originalname}" is not a valid ZIP archive.`);
  const searchStart = Math.max(0, archive.length - 22 - 0xffff);
  let eocd = -1;
  for (let offset = archive.length - 22; offset >= searchStart; offset -= 1) {
    if (archive.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY) {
      const commentLength = u16(archive, offset + 20);
      if (offset + 22 + commentLength === archive.length) { eocd = offset; break; }
    }
  }
  if (eocd < 0) throw new InvalidSleepArchiveError(`Could not read "${archiveFile.originalname}" as a standard ZIP archive.`);
  const disk = u16(archive, eocd + 4);
  const directoryDisk = u16(archive, eocd + 6);
  const entriesOnDisk = u16(archive, eocd + 8);
  const entryCount = u16(archive, eocd + 10);
  const directorySize = u32(archive, eocd + 12);
  const directoryOffset = u32(archive, eocd + 16);
  if (disk !== 0 || directoryDisk !== 0 || entriesOnDisk !== entryCount) throw new InvalidSleepArchiveError("Multi-disk ZIP archives are not supported.");
  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) throw new InvalidSleepArchiveError("ZIP64 sleep archives are not supported. Export a standard Samsung Health ZIP archive instead.");
  if (entryCount > MAX_ZIP_ENTRIES || directoryOffset + directorySize > eocd) throw new InvalidSleepArchiveError("The sleep ZIP archive has an invalid directory or too many entries.");

  const extracted: Express.Multer.File[] = [];
  let expandedBytes = 0;
  let cursor = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (u32(archive, cursor) !== ZIP_CENTRAL_DIRECTORY_ENTRY) throw new InvalidSleepArchiveError("The sleep ZIP central directory is malformed.");
    const flags = u16(archive, cursor + 8);
    const method = u16(archive, cursor + 10);
    const compressedSize = u32(archive, cursor + 20);
    const uncompressedSize = u32(archive, cursor + 24);
    const nameLength = u16(archive, cursor + 28);
    const extraLength = u16(archive, cursor + 30);
    const commentLength = u16(archive, cursor + 32);
    const localOffset = u32(archive, cursor + 42);
    const recordEnd = cursor + 46 + nameLength + extraLength + commentLength;
    if (recordEnd > directoryOffset + directorySize || recordEnd > archive.length) throw new InvalidSleepArchiveError("The sleep ZIP central directory is truncated.");
    const archiveName = archive.toString("utf8", cursor + 46, cursor + 46 + nameLength).replace(/\\/g, "/");
    cursor = recordEnd;
    if (!archiveName || archiveName.endsWith("/")) continue;
    const lowerName = archiveName.toLowerCase();
    const extension = lowerName.match(/\.(csv|json)$/)?.[1];
    // Ignore non-summary sleep artifacts before extracting or parsing them.
    if (!extension || !isSleepSummaryFile(lowerName)) continue;
    if (archiveName.startsWith("/") || /^[a-z]:/i.test(archiveName) || archiveName.split("/").some((part) => part === "..")) throw new InvalidSleepArchiveError("The sleep ZIP contains an unsafe file path.");
    if ((flags & 0x1) !== 0) throw new InvalidSleepArchiveError(`The sleep ZIP entry "${archiveName}" is encrypted and cannot be imported.`);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) throw new InvalidSleepArchiveError("ZIP64 entries are not supported.");
    if (uncompressedSize > MAX_EXTRACTED_FILE_BYTES || expandedBytes + uncompressedSize > MAX_TOTAL_EXTRACTED_BYTES) throw new InvalidSleepArchiveError("The sleep ZIP expands beyond the allowed size limit.");
    if (method !== 0 && method !== 8) throw new InvalidSleepArchiveError(`The sleep ZIP entry "${archiveName}" uses an unsupported compression method.`);
    if (u32(archive, localOffset) !== ZIP_LOCAL_FILE_HEADER) throw new InvalidSleepArchiveError(`The sleep ZIP entry "${archiveName}" has an invalid local header.`);
    const localNameLength = u16(archive, localOffset + 26);
    const localExtraLength = u16(archive, localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (dataOffset < localOffset || dataEnd > directoryOffset || dataEnd > archive.length) throw new InvalidSleepArchiveError(`The sleep ZIP entry "${archiveName}" has invalid compressed data bounds.`);
    let contents: Buffer;
    try {
      contents = method === 0 ? Buffer.from(archive.subarray(dataOffset, dataEnd)) : inflateRawSync(archive.subarray(dataOffset, dataEnd), { maxOutputLength: Math.min(MAX_EXTRACTED_FILE_BYTES, MAX_TOTAL_EXTRACTED_BYTES - expandedBytes) + 1 });
    } catch {
      throw new InvalidSleepArchiveError(`Could not decompress "${archiveName}". The ZIP may be damaged or too large.`);
    }
    if (contents.length !== uncompressedSize) throw new InvalidSleepArchiveError(`The extracted size of "${archiveName}" does not match the ZIP directory.`);
    expandedBytes += contents.length;
    extracted.push({
      fieldname: archiveFile.fieldname, originalname: archiveName, encoding: archiveFile.encoding,
      mimetype: extension === "json" ? "application/json" : "text/csv", size: contents.length, buffer: contents,
    } as unknown as Express.Multer.File);
  }
  return extracted;
}

function expandSleepFiles(uploadedFiles: Express.Multer.File[]): Express.Multer.File[] {
  const result: Express.Multer.File[] = [];
  for (const file of uploadedFiles) {
    const name = file.originalname.toLowerCase();
    if (name.endsWith(".zip")) result.push(...zipSleepFiles(file));
    else if (/\.(csv|json)$/i.test(name) && isSleepSummaryFile(name)) result.push(file);
  }
  return result;
}

function parseCsvRecords(input: string): string[][] {
  const source = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let currentField = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { currentField += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else currentField += char;
    } else if (char === '"' && currentField.length === 0) quoted = true;
    else if (char === ",") { row.push(currentField); currentField = ""; }
    else if (char === "\n") {
      row.push(currentField.replace(/\r$/, ""));
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = []; currentField = "";
    } else currentField += char;
  }
  if (currentField.length || row.length) {
    row.push(currentField.replace(/\r$/, ""));
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  }
  return rows;
}

function normalizedKey(value: string): string { return value.replace(/^\uFEFF/, "").toLowerCase().replace(/[^a-z0-9]/g, ""); }

// Try each requested alias in priority order. A suffix like "score" must not match
// "wake_score" before the more specific "sleep_score" field is checked.
function field(row: CsvRow, ...suffixes: string[]): string {
  const entries = Object.entries(row);
  for (const suffix of suffixes) {
    const wanted = normalizedKey(suffix);
    const exact = entries.find(([key, value]) => normalizedKey(key) === wanted && typeof value === "string" && value.trim() !== "");
    if (exact) return exact[1].trim();
    const qualified = entries.find(([key, value]) => normalizedKey(key).endsWith(wanted) && typeof value === "string" && value.trim() !== "");
    if (qualified) return qualified[1].trim();
  }
  return "";
}
function numeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const result = Number(value.trim());
  return Number.isFinite(result) ? result : null;
}
function timestamp(value: unknown): string | null {
  const raw = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!raw) return null;
  if (/^\d{10,13}$/.test(raw)) {
    const numericTime = Number(raw);
    const date = new Date(raw.length <= 10 ? numericTime * 1000 : numericTime);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  const normalized = raw.replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T");
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const parsed = new Date(hasZone ? normalized : `${normalized}Z`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
function localDay(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: INDIA_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function normalizedEfficiency(value: unknown): number | null {
  const raw = numeric(value);
  if (raw === null || raw < 0) return null;
  const percentage = raw <= 1 ? raw * 100 : raw;
  return Math.round(Math.max(0, Math.min(100, percentage)) * 10) / 10;
}
function normalizedScore(value: unknown): number | null {
  const raw = numeric(value);
  return raw === null || raw < 0 ? null : Math.round(Math.max(0, Math.min(100, raw)) * 10) / 10;
}

function sleepSessionFromRow(row: CsvRow): SleepSession | null {
  // Prefer the real start/end timestamps. The alias lookup now checks these ahead
  // of derived numeric fields such as original_bed_time and goal_wake_up_time.
  const startedAt = timestamp(field(row, "start_time", "startTime", "bed_time", "original_bed_time"));
  const endedAt = timestamp(field(row, "end_time", "endTime", "wake_up_time", "original_wake_up_time"));
  if (!startedAt || !endedAt) return null;
  const elapsed = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  // Ignore invalid records and durations greater than a full day. Naps and partial sleep sessions remain valid.
  if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed > 24 * 60 * 60 * 1000) return null;
  const sourceId = field(row, "datauuid", "combined_id", "combinedId");
  const sessionId = sourceId || createHash("sha256").update(`${startedAt}|${endedAt}`).digest("hex");
  return {
    sessionId, startedAt, endedAt, durationMinutes: Math.max(1, Math.round(elapsed / 60_000)),
    sleepScore: normalizedScore(field(row, "sleep_score", "sleepScore", "score")),
    efficiency: normalizedEfficiency(field(row, "efficiency", "original_efficiency", "sleep_efficiency")),
  };
}

function recordsFromJson(value: unknown, result: Record<string, unknown>[] = [], depth = 0): Record<string, unknown>[] {
  if (depth > 12 || value == null) return result;
  if (Array.isArray(value)) {
    for (const child of value) recordsFromJson(child, result, depth + 1);
    return result;
  }
  if (typeof value !== "object") return result;
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).map(normalizedKey);
  const hasStart = keys.some((key) => key.endsWith("starttime") || key.endsWith("bedtime"));
  const hasEnd = keys.some((key) => key.endsWith("endtime") || key.endsWith("wakeuptime"));
  if (hasStart && hasEnd) {
    result.push(object);
    return result;
  }
  for (const child of Object.values(object)) recordsFromJson(child, result, depth + 1);
  return result;
}
function objectField(row: Record<string, unknown>, ...suffixes: string[]): unknown {
  const entries = Object.entries(row);
  for (const suffix of suffixes) {
    const wanted = normalizedKey(suffix);
    const exact = entries.find(([key, value]) => normalizedKey(key) === wanted && value != null && String(value).trim() !== "");
    if (exact) return exact[1];
    const qualified = entries.find(([key, value]) => normalizedKey(key).endsWith(wanted) && value != null && String(value).trim() !== "");
    if (qualified) return qualified[1];
  }
  return undefined;
}
function parseSleepFile(file: Express.Multer.File): SleepSession[] {
  const name = file.originalname.toLowerCase();
  if (!isSleepSummaryFile(name)) return [];
  if (name.endsWith(".json")) {
    let payload: unknown;
    try { payload = JSON.parse(file.buffer.toString("utf8")); } catch { return []; }
    return recordsFromJson(payload).flatMap((record) => {
      const normalized: CsvRow = {};
      for (const [key, value] of Object.entries(record)) normalized[key] = value == null ? "" : String(value);
      // JSON exports can contain numeric timestamps; restore them to strings for the shared parser.
      const session = sleepSessionFromRow({
        ...normalized,
        _start_time: String(objectField(record, "start_time", "startTime", "bed_time", "original_bed_time") ?? ""),
        _end_time: String(objectField(record, "end_time", "endTime", "wake_up_time", "original_wake_up_time") ?? ""),
        _sleep_score: String(objectField(record, "sleep_score", "sleepScore", "score") ?? ""),
        _efficiency: String(objectField(record, "efficiency", "original_efficiency", "sleep_efficiency") ?? ""),
        _datauuid: String(objectField(record, "datauuid", "combined_id", "combinedId") ?? ""),
      });
      return session ? [session] : [];
    });
  }

  const rows = parseCsvRecords(file.buffer.toString("utf8"));
  const headerIndex = rows.findIndex((candidate) => {
    const keys = candidate.map(normalizedKey);
    const hasStart = keys.some((key) => key.endsWith("starttime") || key.endsWith("bedtime"));
    const hasEnd = keys.some((key) => key.endsWith("endtime") || key.endsWith("wakeuptime"));
    // Defensive guard for a renamed/loosely named sleep-stage CSV.
    const isStageTable = keys.some((key) => key.endsWith("sleepid")) && keys.some((key) => key === "stage" || key.endsWith("stage")) && !keys.some((key) => key.endsWith("sleepscore"));
    return hasStart && hasEnd && !isStageTable;
  });
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map((key) => key.trim());
  return rows.slice(headerIndex + 1).flatMap((values) => {
    const row: CsvRow = {};
    headers.forEach((header, columnIndex) => { if (header) row[header] = values[columnIndex] ?? ""; });
    const session = sleepSessionFromRow(row);
    return session ? [session] : [];
  });
}

let schemaReady: Promise<void> | null = null;
async function ensureSleepTable(client: Awaited<ReturnType<typeof getPgClient>>): Promise<void> {
  if (!schemaReady) {
    schemaReady = client.query(`
      CREATE TABLE IF NOT EXISTS health_sleep_sessions (
        session_id TEXT PRIMARY KEY,
        started_at TIMESTAMPTZ NOT NULL,
        ended_at TIMESTAMPTZ NOT NULL,
        duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
        sleep_score DOUBLE PRECISION,
        efficiency DOUBLE PRECISION,
        imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS health_sleep_sessions_ended_at_idx ON health_sleep_sessions (ended_at DESC);
    `).then(() => undefined).catch((error: unknown) => { schemaReady = null; throw error; });
  }
  await schemaReady;
}

async function loadSleepSummary(client: Awaited<ReturnType<typeof getPgClient>>) {
  await ensureSleepTable(client);
  const result = await client.query(
    "SELECT session_id, started_at, ended_at, duration_minutes, sleep_score, efficiency FROM health_sleep_sessions WHERE ended_at <= NOW() AND ended_at >= NOW() - INTERVAL '8 days' ORDER BY ended_at DESC",
  );
  const byDay = new Map<string, { day: string; minutes: number; scores: number[]; efficiencies: number[] }>();
  for (const row of result.rows as Array<Record<string, unknown>>) {
    const endedAt = new Date(String(row.ended_at)).toISOString();
    const day = localDay(endedAt);
    const entry = byDay.get(day) || { day, minutes: 0, scores: [], efficiencies: [] };
    entry.minutes += Number(row.duration_minutes || 0);
    const score = numeric(row.sleep_score);
    const efficiency = numeric(row.efficiency);
    if (score !== null) entry.scores.push(score);
    if (efficiency !== null) entry.efficiencies.push(efficiency);
    byDay.set(day, entry);
  }
  const today = localDay(new Date().toISOString());
  const days = [...byDay.values()]
    .filter((entry) => entry.day <= today)
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, 7)
    .map((entry) => ({
      day: entry.day,
      minutes: entry.minutes,
      efficiency: entry.efficiencies.length ? Math.round(entry.efficiencies.reduce((sum, value) => sum + value, 0) / entry.efficiencies.length * 10) / 10 : null,
      score: entry.scores.length ? Math.round(entry.scores.reduce((sum, value) => sum + value, 0) / entry.scores.length * 10) / 10 : null,
    }));
  const latest = days[0] || null;
  return {
    lastNightMinutes: latest?.minutes ?? null,
    average7dMinutes: days.length ? Math.round(days.reduce((sum, entry) => sum + entry.minutes, 0) / days.length) : null,
    observedNights7d: days.length,
    lastNightScore: latest?.score ?? null,
    lastNightEfficiency: latest?.efficiency ?? null,
    recentDays: days,
  };
}

router.get("/health/sleep-summary", async (_req, res, next) => {
  const client = await getPgClient();
  try {
    const sleep = await loadSleepSummary(client);
    res.setHeader("Cache-Control", "no-store");
    return res.json({ sleep: sleep.observedNights7d ? sleep : null });
  } catch (error) { return next(error); }
  finally { client.release(); }
});

router.post("/health/admin/sleep/import", ...ADMIN_GUARD, upload.array("files", 40), async (req, res, next) => {
  const uploadedFiles = (req.files || []) as Express.Multer.File[];
  if (!uploadedFiles.length) return res.status(400).json({ message: "Choose a Samsung Health ZIP or sleep CSV/JSON file." });
  let files: Express.Multer.File[];
  try { files = expandSleepFiles(uploadedFiles); }
  catch (error) {
    if (error instanceof InvalidSleepArchiveError) return res.status(400).json({ message: error.message });
    return next(error);
  }
  const sessions = files.flatMap((file) => parseSleepFile(file));
  const deduped = [...new Map(sessions.map((session) => [session.sessionId, session])).values()];
  if (!deduped.length) {
    res.setHeader("Cache-Control", "no-store");
    return res.json({ success: true, sessionsProcessed: 0, message: "No sleep summary records were found in this upload." });
  }
  const client = await getPgClient();
  try {
    await ensureSleepTable(client);
    await client.query("BEGIN");
    for (const session of deduped) {
      // Remove short stage fragments imported by earlier versions when they sit wholly
      // inside the proper summary interval. This repairs already-imported bad rows on re-import.
      await client.query(
        "DELETE FROM health_sleep_sessions WHERE session_id <> $1 AND duration_minutes <= 30 AND started_at >= $2 AND ended_at <= $3",
        [session.sessionId, session.startedAt, session.endedAt],
      );
      await client.query(
        "INSERT INTO health_sleep_sessions (session_id, started_at, ended_at, duration_minutes, sleep_score, efficiency, imported_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) ON CONFLICT (session_id) DO UPDATE SET started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at, duration_minutes = EXCLUDED.duration_minutes, sleep_score = EXCLUDED.sleep_score, efficiency = EXCLUDED.efficiency, imported_at = NOW()",
        [session.sessionId, session.startedAt, session.endedAt, session.durationMinutes, session.sleepScore, session.efficiency],
      );
    }
    await client.query("COMMIT");
    res.setHeader("Cache-Control", "no-store");
    return res.json({ success: true, sessionsProcessed: deduped.length, message: "Samsung Health sleep data imported." });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return next(error);
  } finally { client.release(); }
});

export default router;
