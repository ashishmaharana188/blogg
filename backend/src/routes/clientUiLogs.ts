import { Router } from "express";
import logger from "../logs/logger.ts";

const router = Router();
const RATE_WINDOW_MS = 60_000;
const MAX_REPORTS_PER_WINDOW = 20;
const MAX_RATE_BUCKETS = 500;
type RateBucket = { startedAt: number; count: number };
const rateBuckets = new Map<string, RateBucket>();

function shortText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : undefined;
}

function tooManyReports(ip: string, now: number): boolean {
  if (!rateBuckets.has(ip) && rateBuckets.size >= MAX_RATE_BUCKETS) {
    const oldestKey = rateBuckets.keys().next().value;
    if (oldestKey) rateBuckets.delete(oldestKey);
  }
  let bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) {
    bucket = { startedAt: now, count: 0 };
    rateBuckets.set(ip, bucket);
  }
  bucket.count += 1;

  if (rateBuckets.size > MAX_RATE_BUCKETS) {
    for (const [key, item] of rateBuckets) {
      if (now - item.startedAt >= RATE_WINDOW_MS) rateBuckets.delete(key);
      if (rateBuckets.size <= MAX_RATE_BUCKETS) break;
    }
  }

  return bucket.count > MAX_REPORTS_PER_WINDOW;
}

/** Receives minimal client-side diagnostics so UI failures stay out of the rendered page. */
router.post("/ui-logs", (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  if (tooManyReports(ip, Date.now())) {
    return res.status(429).json({ success: false });
  }

  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const pathname = shortText(body.pathname, 300);
  const context = shortText(body.context, 100) || "frontend";
  const clientErrorName = shortText(body.name, 100) || "Error";
  const clientErrorMessage = shortText(body.message, 500) || "Client-side UI failure";
  const clientStack = shortText(body.stack, 6000);

  const record = {
    event: context.startsWith("console.warn") ? "CLIENT_UI_WARNING" : "CLIENT_UI_FAILURE",
    requestId: req.requestId,
    sessionId: req.sessionId,
    context,
    pathname: pathname?.startsWith("/") ? pathname : undefined,
    clientErrorName,
    clientErrorMessage,
    clientStack,
    userAgent: shortText(req.get("user-agent"), 250),
  };
  if (context.startsWith("console.warn")) logger.warn(record);
  else logger.error(record);

  return res.status(204).end();
});

export default router;
