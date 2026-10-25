import express from "express";
import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDB } from "../db/mongoDBConnect.ts";
import { getPgClient } from "../db/postgres.ts";
import type { Document } from "mongodb";
import { authenticationMiddleware } from "../middleware/authenticationMiddleware.ts";
import { adminMiddleware } from "../middleware/adminMiddleware.ts";

type NewsletterSubscriber = Document & {
  email: string;
  subscribed: boolean;
  subscribedAt: Date;
  updatedAt: Date;
  source: string;
};

type BlogRecord = Document & {
  _id?: unknown;
  blogg_id?: string;
  author?: unknown;
  title?: unknown;
  subtitle?: unknown;
  tags?: unknown;
  createdAt?: Date | string | number;
  content?: unknown;
};

type NewsletterFilters = {
  topic: string;
  fromDate: Date;
  toDate: Date;
  fromLabel: string;
  toLabel: string;
};

type NewsletterArticle = {
  id: string;
  title: string;
  subtitle: string;
  author: string;
  date: Date;
  tags: string[];
  excerpt: string;
  previewHtml: string;
  previewImage: string;
};

type NewsletterHealthConfig = {
  enabled: boolean;
  steps: { poor: number; target: number };
  reps: { poor: number; target: number };
  sleep: {
    poorLow: number;
    goodLow: number;
    goodHigh: number;
    poorHigh: number;
  };
  bpm: { poorLow: number; goodLow: number; goodHigh: number; poorHigh: number };
};

type HealthMetrics = {
  steps: number | null;
  reps: number | null;
  sleepMinutes: number | null;
  bpm: number | null;
  observed: { steps: number; reps: number; sleep: number; bpmSamples: number };
};

const DEFAULT_HEALTH_CONFIG: NewsletterHealthConfig = {
  enabled: true,
  steps: { poor: 0, target: 10000 },
  reps: { poor: 0, target: 40 },
  sleep: { poorLow: 180, goodLow: 420, goodHigh: 540, poorHigh: 720 },
  bpm: { poorLow: 40, goodLow: 55, goodHigh: 85, poorHigh: 130 },
};
const NEWSLETTER_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".avif",
]);
const NEWSLETTER_SOURCE_DIR = dirname(fileURLToPath(import.meta.url));

const router = express.Router();
let indexesReady: Promise<void> | null = null;
const publicSendHistory = new Map<string, number[]>();
const SEND_WINDOW_MS = 60 * 60 * 1000;
const SEND_COOLDOWN_MS = 2 * 60 * 1000;
const MAX_PUBLIC_SENDS_PER_HOUR = 5;
const MAX_ARTICLES_PER_EMAIL = 80;

function ensureIndexes(): Promise<void> {
  if (!indexesReady) {
    indexesReady = Promise.all([
      getDB()
        .collection<NewsletterSubscriber>("newsletterSubscribers")
        .createIndex(
          { email: 1 },
          { unique: true, name: "newsletter_subscriber_email_unique" },
        ),
      getDB()
        .collection("newsletterSendLog")
        .createIndex(
          { createdAt: 1 },
          {
            expireAfterSeconds: 60 * 60 * 24 * 180,
            name: "newsletter_send_log_ttl",
          },
        ),
    ])
      .then(() => undefined)
      .catch((error) => {
        indexesReady = null;
        throw error;
      });
  }
  return indexesReady;
}

function emailIsValid(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const email = value.trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
    ? parsed
    : null;
}

function resolveFilters(
  body: Record<string, unknown>,
): NewsletterFilters | null {
  const fromDate = parseDate(body.fromDate);
  const endDate = parseDate(body.toDate);
  if (!fromDate || !endDate || fromDate.getTime() > endDate.getTime())
    return null;
  const topic = typeof body.topic === "string" ? body.topic.trim() : "all";
  if (topic.length > 150) return null;
  const toDate = new Date(endDate.getTime() + 24 * 60 * 60 * 1000);
  return {
    topic: topic || "all",
    fromDate,
    toDate,
    fromLabel: String(body.fromDate),
    toLabel: String(body.toDate),
  };
}

function getCreatedDate(value: unknown): Date | null {
  if (
    !(value instanceof Date) &&
    typeof value !== "string" &&
    typeof value !== "number"
  )
    return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function getTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 30);
}

function inlinePlainText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const item = part as Record<string, unknown>;
      return typeof item.text === "string" ? item.text : "";
    })
    .join("");
}

function extractText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const parts: string[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const block = raw as Record<string, unknown>;
    const type =
      typeof block.type === "string" ? block.type.toLowerCase() : "paragraph";
    if (
      [
        "image",
        "video",
        "audio",
        "file",
        "linkpreview",
        "link-preview",
        "embed",
        "bookmark",
        "table",
        "tablecell",
      ].includes(type)
    )
      continue;
    const text =
      typeof block.content === "string"
        ? block.content
        : inlinePlainText(block.content);
    if (text.trim()) parts.push(text.trim());
    if (Array.isArray(block.children)) parts.push(extractText(block.children));
  }
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function safeHttpUrl(value: unknown, base = ""): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4096)
    return "";
  try {
    const parsed = new URL(value.trim(), base || undefined);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : "";
  } catch {
    return "";
  }
}

function renderInline(value: unknown): string {
  if (typeof value === "string") return htmlEscape(value);
  if (!Array.isArray(value)) return "";
  return value
    .map((raw) => {
      if (typeof raw === "string") return htmlEscape(raw);
      if (!raw || typeof raw !== "object") return "";
      const part = raw as Record<string, unknown>;
      let text = htmlEscape(typeof part.text === "string" ? part.text : "");
      const styles =
        part.styles && typeof part.styles === "object"
          ? (part.styles as Record<string, unknown>)
          : {};
      if (styles.bold === true) text = `<strong>${text}</strong>`;
      if (styles.italic === true) text = `<em>${text}</em>`;
      if (styles.underline === true) text = `<u>${text}</u>`;
      if (styles.strike === true) text = `<s>${text}</s>`;
      if (styles.code === true)
        text = `<code style="font-family:Consolas,'Courier New',monospace;color:#a9cfff">${text}</code>`;
      const href = safeHttpUrl(part.href ?? part.url);
      if (href && text)
        text = `<a href="${htmlEscape(href)}" style="color:#8ebeff;text-decoration:underline">${text}</a>`;
      return text;
    })
    .join("");
}

function articlePreview(content: unknown): {
  text: string;
  html: string;
  image: string;
  suggestedTitle: string;
} {
  const blocks = Array.isArray(content) ? content : [];
  const text = extractText(blocks);
  let image = "";
  let suggestedTitle = "";
  const rendered: string[] = [];
  let chars = 0;

  const renderBlocks = (items: unknown[], depth = 0): void => {
    if (depth > 5 || chars >= 1500 || rendered.length >= 7) return;
    for (const raw of items) {
      if (
        !raw ||
        typeof raw !== "object" ||
        chars >= 1500 ||
        rendered.length >= 7
      )
        continue;
      const block = raw as Record<string, unknown>;
      const type =
        typeof block.type === "string"
          ? block.type.toLowerCase().replace(/[ _-]/g, "")
          : "paragraph";
      const props =
        block.props && typeof block.props === "object"
          ? (block.props as Record<string, unknown>)
          : {};

      if (type === "image") {
        const candidate = safeHttpUrl(
          props.url || props.src || props.imageUrl,
          publicSiteUrl(),
        );
        if (!image && candidate) image = candidate;
        // The first image is shown as a full-width hero preview; never print its
        // Cloudinary identifier, dimensions, or editor props as article text.
        continue;
      }

      if (type === "linkpreview" || type === "embed" || type === "bookmark") {
        const href = safeHttpUrl(props.url || props.href);
        const thumb = safeHttpUrl(
          props.image || props.thumbnail || props.imageUrl,
          publicSiteUrl(),
        );
        const provider =
          typeof props.provider === "string"
            ? props.provider.trim().slice(0, 90)
            : "";
        const title =
          typeof props.title === "string"
            ? props.title.trim().slice(0, 220)
            : "";
        const description =
          typeof props.description === "string"
            ? props.description.trim().slice(0, 420)
            : "";
        const linkTitle = title || provider || "Open linked article";
        if (!suggestedTitle) suggestedTitle = title;
        if (href && (title || description || thumb)) {
          const thumbMarkup = thumb
            ? `<td width="112" valign="top" style="padding:0 12px 0 0"><img src="${htmlEscape(thumb)}" alt="" width="100" style="display:block;width:100px;height:auto;max-height:82px;object-fit:cover;border:1px solid #34383d" /></td>`
            : "";
          const descriptionMarkup = description
            ? `<p style="margin:5px 0 0;color:#9ca9b6;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5">${htmlEscape(description)}</p>`
            : "";
          rendered.push(
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:7px 0 12px;border:1px solid #30343a;background:#191c1f"><tr>${thumbMarkup}<td valign="middle" style="padding:10px 11px"><p style="margin:0 0 4px;color:#778898;font-family:Consolas,'Courier New',monospace;font-size:9px;letter-spacing:.5px">${htmlEscape(provider || "LINK PREVIEW")}</p><p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45"><a href="${htmlEscape(href)}" style="color:#e5edf6;text-decoration:underline">${htmlEscape(linkTitle)}</a></p>${descriptionMarkup}</td></tr></table>`,
          );
          chars += (title + description).length;
        }
        continue;
      }

      if (["video", "audio", "file", "table", "tablecell"].includes(type))
        continue;
      const rawText =
        typeof block.content === "string"
          ? block.content
          : inlinePlainText(block.content);
      const plain = rawText.replace(/\s+/g, " ").trim();
      if (plain) {
        if (
          !suggestedTitle &&
          (type.startsWith("heading") ||
            type === "paragraph" ||
            type === "bulletlistitem" ||
            type === "numberedlistitem")
        ) {
          suggestedTitle = plain.slice(0, 220);
        }
        const allowance = Math.min(plain.length, 1500 - chars);
        const shownText = plain.slice(0, allowance);
        const inline =
          allowance < plain.length
            ? `${htmlEscape(shownText)}…`
            : renderInline(block.content);
        const style =
          "margin:0 0 9px;color:#bdc5ce;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.65;overflow-wrap:anywhere;word-break:break-word";
        let markup = `<p style="${style}">${inline}</p>`;
        if (type === "heading" || type === "heading2" || type === "heading3") {
          const size = type === "heading" ? 17 : type === "heading2" ? 15 : 13;
          markup = `<h3 style="margin:14px 0 8px;color:#f0f3f6;font-family:Arial,Helvetica,sans-serif;font-size:${size}px;line-height:1.45;font-weight:650">${inline}</h3>`;
        } else if (type === "quote" || type === "blockquote") {
          markup = `<blockquote style="margin:8px 0 12px;padding:4px 0 4px 12px;border-left:2px solid #5d86b4;color:#aebdcd;font-family:Georgia,serif;font-size:14px;line-height:1.65">${inline}</blockquote>`;
        } else if (type === "bulletlistitem") {
          markup = `<p style="${style};padding-left:14px">•&nbsp; ${inline}</p>`;
        } else if (type === "numberedlistitem") {
          markup = `<p style="${style};padding-left:14px">${rendered.length + 1}.&nbsp; ${inline}</p>`;
        } else if (type === "codeblock") {
          markup = `<pre style="margin:9px 0 12px;padding:10px;background:#181b1e;border:1px solid #30343a;color:#c8d9ed;font-family:Consolas,'Courier New',monospace;font-size:11px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere">${inline}</pre>`;
        }
        rendered.push(markup);
        chars += allowance;
      }
      if (Array.isArray(block.children))
        renderBlocks(block.children, depth + 1);
    }
  };

  renderBlocks(blocks);
  return { text, html: rendered.join(""), image, suggestedTitle };
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function numberFromConfig(value: unknown, fallback: number): number {
  const parsed = numberOrNull(value);
  return parsed !== null && Math.abs(parsed) <= 1_000_000 ? parsed : fallback;
}

function normalizeHealthConfig(value: unknown): NewsletterHealthConfig {
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const sub = (key: keyof NewsletterHealthConfig) =>
    source[key] && typeof source[key] === "object"
      ? (source[key] as Record<string, unknown>)
      : {};
  const steps = sub("steps"),
    reps = sub("reps"),
    sleep = sub("sleep"),
    bpm = sub("bpm");
  const config: NewsletterHealthConfig = {
    enabled:
      typeof source.enabled === "boolean"
        ? source.enabled
        : DEFAULT_HEALTH_CONFIG.enabled,
    steps: {
      poor: numberFromConfig(steps.poor, DEFAULT_HEALTH_CONFIG.steps.poor),
      target: numberFromConfig(
        steps.target,
        DEFAULT_HEALTH_CONFIG.steps.target,
      ),
    },
    reps: {
      poor: numberFromConfig(reps.poor, DEFAULT_HEALTH_CONFIG.reps.poor),
      target: numberFromConfig(reps.target, DEFAULT_HEALTH_CONFIG.reps.target),
    },
    sleep: {
      poorLow: numberFromConfig(
        sleep.poorLow,
        DEFAULT_HEALTH_CONFIG.sleep.poorLow,
      ),
      goodLow: numberFromConfig(
        sleep.goodLow,
        DEFAULT_HEALTH_CONFIG.sleep.goodLow,
      ),
      goodHigh: numberFromConfig(
        sleep.goodHigh,
        DEFAULT_HEALTH_CONFIG.sleep.goodHigh,
      ),
      poorHigh: numberFromConfig(
        sleep.poorHigh,
        DEFAULT_HEALTH_CONFIG.sleep.poorHigh,
      ),
    },
    bpm: {
      poorLow: numberFromConfig(bpm.poorLow, DEFAULT_HEALTH_CONFIG.bpm.poorLow),
      goodLow: numberFromConfig(bpm.goodLow, DEFAULT_HEALTH_CONFIG.bpm.goodLow),
      goodHigh: numberFromConfig(
        bpm.goodHigh,
        DEFAULT_HEALTH_CONFIG.bpm.goodHigh,
      ),
      poorHigh: numberFromConfig(
        bpm.poorHigh,
        DEFAULT_HEALTH_CONFIG.bpm.poorHigh,
      ),
    },
  };
  return config;
}

function validateHealthConfig(config: NewsletterHealthConfig): string | null {
  if (config.steps.poor < 0 || config.steps.target <= config.steps.poor)
    return "Steps need a non-negative poor threshold below the full-score target.";
  if (config.reps.poor < 0 || config.reps.target <= config.reps.poor)
    return "Repetitions need a non-negative poor threshold below the full-score target.";
  for (const [name, range] of [
    ["Sleep", config.sleep],
    ["Heart rate", config.bpm],
  ] as const) {
    if (
      range.poorLow < 0 ||
      range.goodLow < 0 ||
      range.goodHigh < 0 ||
      range.poorHigh < 0
    )
      return `${name} thresholds must be non-negative.`;
    if (
      !(
        range.poorLow < range.goodLow &&
        range.goodLow <= range.goodHigh &&
        range.goodHigh < range.poorHigh
      )
    ) {
      return `${name} thresholds must satisfy poor-low < good-low ≤ good-high < poor-high.`;
    }
  }
  return null;
}

async function readHealthConfig(): Promise<NewsletterHealthConfig> {
  const row = await getDB()
    .collection("newsletterHealthConfig")
    .findOne({ key: "default" });
  return normalizeHealthConfig(row?.config);
}

function upwardScore(value: number, poor: number, target: number): number {
  if (value <= poor) return 0;
  if (value >= target) return 100;
  return Math.round(((value - poor) / (target - poor)) * 100);
}

function rangeScore(
  value: number,
  range: NewsletterHealthConfig["sleep"],
): number {
  if (value < range.poorLow || value > range.poorHigh) return 0;
  if (value >= range.goodLow && value <= range.goodHigh) return 100;
  if (value < range.goodLow)
    return Math.round(
      ((value - range.poorLow) / (range.goodLow - range.poorLow)) * 100,
    );
  return Math.round(
    ((range.poorHigh - value) / (range.poorHigh - range.goodHigh)) * 100,
  );
}

function newsletterPublicDirectories(): string[] {
  return [
    ...new Set([
      resolve(NEWSLETTER_SOURCE_DIR, "../../../frontend/public"),
      // Retain backward compatibility with the project's existing source-media folder.
      resolve(NEWSLETTER_SOURCE_DIR, "../../../frontend/src/public"),
      resolve(process.cwd(), "../frontend/public"),
      resolve(process.cwd(), "frontend/public"),
      resolve(process.cwd(), "../frontend/src/public"),
      resolve(process.cwd(), "frontend/src/public"),
    ]),
  ];
}

function isMoodImageName(
  filename: string,
  tier?: "low" | "medium" | "high",
): boolean {
  if (basename(filename) !== filename || filename.includes("..")) return false;
  const tierPrefix = tier ? `${tier}_` : /^(?:low|medium|high)_/i;
  const startsCorrectly =
    typeof tierPrefix === "string"
      ? filename.toLowerCase().startsWith(tierPrefix)
      : tierPrefix.test(filename);
  return (
    startsCorrectly &&
    NEWSLETTER_IMAGE_EXTENSIONS.has(extname(filename).toLowerCase())
  );
}

async function findTierImages(
  tier: "low" | "medium" | "high",
): Promise<string[]> {
  const found: string[] = [];
  for (const directory of newsletterPublicDirectories()) {
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (
          !entry.isFile() ||
          !isMoodImageName(entry.name, tier) ||
          found.includes(entry.name)
        )
          continue;
        found.push(entry.name);
      }
      if (found.length) break;
    } catch {
      /* Frontend assets may not be present in this backend checkout. */
    }
  }
  return found;
}

async function findMoodImagePath(filename: string): Promise<string | null> {
  if (!isMoodImageName(filename)) return null;
  for (const directory of newsletterPublicDirectories()) {
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      if (entries.some((entry) => entry.isFile() && entry.name === filename))
        return resolve(directory, filename);
    } catch {
      /* Try the next known asset directory. */
    }
  }
  return null;
}

function publicApiUrl(): string {
  // API_PUBLIC_URL may have been entered as an API base including `/api`, while
  // Render also supplies a canonical service URL automatically. Try configured
  // values in order and normalize every valid candidate to its origin.
  const candidates = [
    process.env.API_PUBLIC_URL?.trim(),
    process.env.RENDER_EXTERNAL_URL?.trim(),
    process.env.RENDER_EXTERNAL_HOSTNAME?.trim()
      ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME.trim()}`
      : "",
  ].filter((value): value is string => Boolean(value));

  for (const configured of candidates) {
    try {
      const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(configured)
        ? configured
        : `https://${configured}`;
      const parsed = new URL(candidate);
      const localHttp =
        parsed.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(parsed.hostname);
      if (
        (!localHttp && parsed.protocol !== "https:") ||
        parsed.username ||
        parsed.password
      )
        continue;
      // URL.origin drops `/api`, `/feed`, query strings, and fragments if someone
      // pasted a full endpoint rather than the host. This avoids broken email links.
      return parsed.origin.replace(/\/+$/, "");
    } catch {
      // Try Render's platform URL if the explicit API_PUBLIC_URL is malformed.
    }
  }
  console.warn(
    "[newsletter:media] No valid public backend URL found; using the configured frontend origin for mood images.",
  );
  return "";
}

async function randomTierImage(
  tier: "low" | "medium" | "high",
): Promise<string> {
  const images = await findTierImages(tier);
  if (!images.length) return "";
  const filename = images[Math.floor(Math.random() * images.length)];
  // Gmail must receive an absolute publicly reachable image URL. Prefer the
  // Render-hosted media endpoint; fall back to the frontend root only when the
  // backend has no public URL configured. publicSiteUrl() strips route paths.
  const apiBase = publicApiUrl();
  if (apiBase)
    return `${apiBase}/api/newsletter/media/${encodeURIComponent(filename)}`;
  const siteBase = publicSiteUrl();
  return siteBase ? `${siteBase}/${encodeURIComponent(filename)}` : "";
}

async function collectHealthMetrics(): Promise<HealthMetrics> {
  const empty: HealthMetrics = {
    steps: null,
    reps: null,
    sleepMinutes: null,
    bpm: null,
    observed: { steps: 0, reps: 0, sleep: 0, bpmSamples: 0 },
  };
  let client: Awaited<ReturnType<typeof getPgClient>> | null = null;
  try {
    client = await getPgClient();
    const existsResult = await client.query(`
      SELECT
        to_regclass('public.health_step_days') IS NOT NULL AS has_steps,
        to_regclass('public.health_pushup_sessions') IS NOT NULL AS has_reps,
        to_regclass('public.health_sleep_sessions') IS NOT NULL AS has_sleep,
        to_regclass('public.health_heart_rate_samples') IS NOT NULL AS has_heart,
        to_regclass('public.health_running_sessions') IS NOT NULL AS has_runs
    `);
    const exists = existsResult.rows[0] || {};
    if (exists.has_steps) {
      const result = await client.query(`
        SELECT AVG(steps)::double precision AS average, COUNT(*)::int AS observed
        FROM health_step_days
        WHERE day >= ((NOW() AT TIME ZONE 'Asia/Kolkata')::date - 6)
          AND day <= (NOW() AT TIME ZONE 'Asia/Kolkata')::date
      `);
      empty.steps = numberOrNull(result.rows[0]?.average);
      empty.observed.steps = Number(result.rows[0]?.observed || 0);
    }
    if (exists.has_reps) {
      const result = await client.query(`
        SELECT AVG(daily_reps)::double precision AS average, COUNT(*)::int AS observed
        FROM (
          SELECT (started_at AT TIME ZONE 'Asia/Kolkata')::date AS day, SUM(repetitions)::double precision AS daily_reps
          FROM health_pushup_sessions
          WHERE started_at >= NOW() - INTERVAL '7 days' AND started_at <= NOW() AND repetitions IS NOT NULL
          GROUP BY (started_at AT TIME ZONE 'Asia/Kolkata')::date
        ) daily
      `);
      empty.reps = numberOrNull(result.rows[0]?.average);
      empty.observed.reps = Number(result.rows[0]?.observed || 0);
    }
    if (exists.has_sleep) {
      const result = await client.query(`
        SELECT AVG(daily_minutes)::double precision AS average, COUNT(*)::int AS observed
        FROM (
          SELECT (ended_at AT TIME ZONE 'Asia/Kolkata')::date AS day, SUM(duration_minutes)::double precision AS daily_minutes
          FROM health_sleep_sessions
          WHERE ended_at >= NOW() - INTERVAL '7 days' AND ended_at <= NOW()
          GROUP BY (ended_at AT TIME ZONE 'Asia/Kolkata')::date
        ) daily
      `);
      empty.sleepMinutes = numberOrNull(result.rows[0]?.average);
      empty.observed.sleep = Number(result.rows[0]?.observed || 0);
    }
    if (exists.has_heart || exists.has_runs) {
      const terms: string[] = [];
      if (exists.has_heart)
        terms.push(
          "SELECT bpm::double precision AS bpm, measured_at FROM health_heart_rate_samples WHERE measured_at >= NOW() - INTERVAL '7 days' AND measured_at <= NOW()",
        );
      if (exists.has_runs)
        terms.push(`
        SELECT CASE WHEN (sample.value->>'bpm') ~ '^[0-9]+([.][0-9]+)?$' THEN (sample.value->>'bpm')::double precision ELSE NULL END AS bpm,
          CASE WHEN (sample.value->>'time') ~ '^\\d{4}-\\d{2}-\\d{2}T'
            THEN (sample.value->>'time')::timestamptz ELSE NULL END AS measured_at
        FROM health_running_sessions AS session
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(session.samples_json) = 'array' THEN session.samples_json ELSE '[]'::jsonb END
        ) AS sample(value)
        WHERE session.started_at >= NOW() - INTERVAL '7 days' AND session.started_at <= NOW()
          AND (sample.value->>'bpm') ~ '^[0-9]+([.][0-9]+)?$'
      `);
      if (terms.length) {
        const result = await client.query(
          `SELECT AVG(bpm)::double precision AS average, COUNT(*)::int AS samples FROM (${terms.join(" UNION ALL ")}) heart_readings WHERE measured_at >= NOW() - INTERVAL '7 days' AND measured_at <= NOW()`,
        );
        empty.bpm = numberOrNull(result.rows[0]?.average);
        empty.observed.bpmSamples = Number(result.rows[0]?.samples || 0);
      }
    }
    return empty;
  } catch (error) {
    console.warn(
      "[newsletter:health] Metrics could not be fully loaded:",
      error instanceof Error ? error.message : "unknown error",
    );
    return empty;
  } finally {
    client?.release();
  }
}

async function getSongsForNewsletter(): Promise<
  Array<{ title: string; artists: string[]; url: string; thumbnail: string }>
> {
  try {
    const settings = getDB().collection("adminIntegrationSettings");
    const cache = getDB().collection("adminShowcaseCache");
    const [promoted, nowPlaying, spotifyCache, likedCache] = await Promise.all([
      settings.findOne({ key: "ytmusic-public-showcase" }),
      settings.findOne({ key: "ytmusic-now-playing" }),
      cache.findOne({
        key: "spotify-currently-playing-v2",
        expiresAt: { $gt: new Date() },
      }),
      cache.findOne({
        key: "youtube-liked-music-v1",
        expiresAt: { $gt: new Date() },
      }),
    ]);
    const candidates: unknown[] = [];
    const active = nowPlaying?.track;
    if (active && typeof active === "object") candidates.push(active);
    if (Array.isArray(promoted?.tracks)) candidates.push(...promoted.tracks);
    // Match the public YouTube Music widget's cached liked-track fallback when no
    // explicit now-playing selection is set. Never label it as recently played.
    if (!active && Array.isArray(likedCache?.value) && likedCache.value.length)
      candidates.push(likedCache.value[0]);
    const spotifyValue = spotifyCache?.value as
      | Record<string, unknown>
      | undefined;
    if (
      spotifyValue?.playing === true &&
      spotifyValue.track &&
      typeof spotifyValue.track === "object"
    )
      candidates.push(spotifyValue.track);
    const seen = new Set<string>();
    const tracks: Array<{
      title: string;
      artists: string[];
      url: string;
      thumbnail: string;
    }> = [];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object") continue;
      const track = candidate as Record<string, unknown>;
      const title = (
        typeof track.title === "string"
          ? track.title
          : typeof track.name === "string"
            ? track.name
            : ""
      )
        .trim()
        .slice(0, 240);
      const videoId = typeof track.videoId === "string" ? track.videoId : "";
      const url =
        safeHttpUrl(track.url) ||
        (videoId && /^[A-Za-z0-9_-]{6,20}$/.test(videoId)
          ? `https://music.youtube.com/watch?v=${encodeURIComponent(videoId)}`
          : "");
      // Gmail's remote-image proxy can fail against expiring or transformed image
      // URLs. YouTube Music records already contain the video ID, so build the
      // canonical public i.ytimg.com thumbnail URL from that stable ID.
      const stableVideoId = /^[A-Za-z0-9_-]{6,20}$/.test(videoId)
        ? videoId
        : "";
      const thumbnail = stableVideoId
        ? `https://i.ytimg.com/vi/${encodeURIComponent(stableVideoId)}/hqdefault.jpg`
        : safeHttpUrl(track.thumbnail ?? track.image);
      const artistsRaw = Array.isArray(track.artists)
        ? track.artists
        : typeof track.artist === "string"
          ? [track.artist]
          : [];
      const artists = artistsRaw
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 4);
      const key = videoId || url || title.toLowerCase();
      if (!title || !url || seen.has(key)) continue;
      seen.add(key);
      tracks.push({ title, artists, url, thumbnail });
      if (tracks.length >= 3) break;
    }
    return tracks;
  } catch (error) {
    console.warn(
      "[newsletter:songs] Public song picks unavailable:",
      error instanceof Error ? error.message : "unknown error",
    );
    return [];
  }
}

function formatSleepDuration(minutes: number | null): string {
  if (minutes === null) return "No data";
  const value = Math.round(minutes);
  return `${Math.floor(value / 60)}h ${String(value % 60).padStart(2, "0")}m`;
}

async function buildBooksForYouSection(): Promise<string> {
  try {
    const settings = getDB().collection("adminIntegrationSettings");
    const selected = await Promise.all([
      settings.findOne({ key: "current-reading-book" }),
      settings.findOne({ key: "other-reading-book" }),
    ]);
    const books = selected.flatMap((record) => {
      const identifier =
        typeof record?.identifier === "string" ? record.identifier.trim() : "";
      const title =
        typeof record?.title === "string" ? record.title.trim() : "";
      if (!identifier || !title || !/^[A-Za-z0-9._-]{1,200}$/.test(identifier))
        return [];
      const author =
        typeof record?.author === "string"
          ? record.author.trim().slice(0, 240)
          : "Author unknown";
      const year =
        typeof record?.year === "string" || typeof record?.year === "number"
          ? String(record.year).trim().slice(0, 20)
          : "";
      return [
        {
          identifier,
          title: title.slice(0, 240),
          author: author || "Author unknown",
          year,
        },
      ];
    });
    if (!books.length) return "";

    const rows = books
      .map((book, index) => {
        const id = encodeURIComponent(book.identifier);
        const bookUrl = "https://archive.org/details/" + id;
        const coverUrl = "https://archive.org/services/img/" + id;
        const metadata = [book.author, book.year].filter(Boolean).join(" · ");
        const border = index === books.length - 1 ? "0" : "1px dashed #35383c";
        return (
          '<tr><td width="72" valign="middle" style="padding:9px 10px 9px 0;border-bottom:' +
          border +
          '"><a href="' +
          bookUrl +
          '" style="text-decoration:none"><img src="' +
          coverUrl +
          '" alt="" width="58" height="76" style="display:block;width:58px;height:76px;object-fit:cover;border:1px solid #34383d" /></a></td><td valign="middle" style="padding:9px 10px 9px 0;border-bottom:' +
          border +
          '"><p style="margin:0;color:#e9edf2;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45">' +
          htmlEscape(book.title) +
          '</p><p style="margin:4px 0 0;color:#8795a4;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.4">' +
          htmlEscape(metadata) +
          '</p></td><td valign="middle" align="right" style="padding:9px 0;border-bottom:' +
          border +
          ';white-space:nowrap"><a href="' +
          bookUrl +
          '" style="color:#8ebeff;font-family:Consolas,Courier New,monospace;font-size:9px;text-decoration:none;letter-spacing:.5px">READ ↗</a></td></tr>'
        );
      })
      .join("");
    return (
      '<tr><td style="padding:20px 16px;border-bottom:1px dashed #35383c"><p style="margin:0 0 4px;color:#80b6f4;font-family:Consolas,Courier New,monospace;font-size:10px;letter-spacing:1.2px">[ BOOKS FOR YOU ]</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
      rows +
      "</table></td></tr>"
    );
  } catch (error) {
    console.warn(
      "[newsletter:books] Books For You unavailable:",
      error instanceof Error ? error.message : "unknown error",
    );
    return "";
  }
}

async function buildFeaturedLinksSection(): Promise<string> {
  try {
    // Use the same public/published links shown by the Featured Links widget.
    // Hidden drafts must not be sent to newsletter subscribers.
    const records = await getDB()
      .collection("adminShowcaseLinks")
      .find(
        { visible: true },
        {
          projection: {
            _id: 0,
            url: 1,
            title: 1,
            description: 1,
            image: 1,
            provider: 1,
            order: 1,
            createdAt: 1,
          },
        },
      )
      .sort({ order: 1, createdAt: -1 })
      .limit(80)
      .toArray();

    const links = records
      .flatMap((raw: unknown) => {
        if (!raw || typeof raw !== "object") return [];
        const record = raw as Record<string, unknown>;
        const url = safeHttpUrl(record.url);
        const title =
          typeof record.title === "string"
            ? record.title.trim().slice(0, 180)
            : "";
        if (!url || !title) return [];
        const description =
          typeof record.description === "string"
            ? record.description.trim().slice(0, 320)
            : "";
        const image = safeHttpUrl(record.image);
        const provider =
          typeof record.provider === "string"
            ? record.provider.trim().slice(0, 80)
            : "";
        return [{ url, title, description, image, provider }];
      })
      .slice(0, 6);

    if (!links.length) return "";

    const rows = links
      .map((link, index) => {
        const border = index === links.length - 1 ? "0" : "1px dashed #35383c";
        const imageMarkup = link.image
          ? `<img src="${htmlEscape(link.image)}" alt="" width="68" height="58" style="display:block;width:68px;height:58px;object-fit:cover;border:1px solid #34383d" />`
          : `<div style="width:68px;height:58px;border:1px dashed #454a50;color:#8ebeff;text-align:center;line-height:58px;font-family:Consolas,'Courier New',monospace;font-size:18px">↗</div>`;
        const providerMarkup = link.provider
          ? `<p style="margin:0 0 4px;color:#778898;font-family:Consolas,'Courier New',monospace;font-size:9px;letter-spacing:.5px">${htmlEscape(link.provider.toUpperCase())}</p>`
          : "";
        const descriptionMarkup = link.description
          ? `<p style="margin:4px 0 0;color:#9da8b3;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5">${htmlEscape(link.description)}</p>`
          : "";
        return `<tr><td width="80" valign="middle" style="padding:9px 10px 9px 0;border-bottom:${border}">${imageMarkup}</td><td valign="middle" style="padding:9px 10px 9px 0;border-bottom:${border}">${providerMarkup}<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45"><a href="${htmlEscape(link.url)}" style="color:#e5edf6;text-decoration:underline">${htmlEscape(link.title)}</a></p>${descriptionMarkup}</td><td valign="middle" align="right" style="padding:9px 0;border-bottom:${border};white-space:nowrap"><a href="${htmlEscape(link.url)}" style="color:#8ebeff;font-family:Consolas,'Courier New',monospace;font-size:9px;text-decoration:none;letter-spacing:.5px">OPEN ↗</a></td></tr>`;
      })
      .join("");

    return `<tr><td style="padding:20px 16px;border-bottom:1px dashed #35383c"><p style="margin:0 0 4px;color:#80b6f4;font-family:Consolas,'Courier New',monospace;font-size:10px;letter-spacing:1.2px">[ FEATURED LINKS ]</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr>`;
  } catch (error) {
    console.warn(
      "[newsletter:featured-links] Featured links unavailable:",
      error instanceof Error ? error.message : "unknown error",
    );
    return "";
  }
}

async function buildHealthSection(): Promise<string> {
  const config = await readHealthConfig();
  if (!config.enabled) return "";
  const metrics = await collectHealthMetrics();
  const items = [
    {
      key: "steps",
      label: "AVG DAILY STEPS",
      value:
        metrics.steps === null
          ? "No data"
          : Math.round(metrics.steps).toLocaleString(),
      unit: "steps/day",
      score:
        metrics.steps === null
          ? null
          : upwardScore(metrics.steps, config.steps.poor, config.steps.target),
    },
    {
      key: "reps",
      label: "AVG DAILY REPS",
      value:
        metrics.reps === null
          ? "No data"
          : Math.round(metrics.reps).toLocaleString(),
      unit: "reps/day",
      score:
        metrics.reps === null
          ? null
          : upwardScore(metrics.reps, config.reps.poor, config.reps.target),
    },
    {
      key: "sleep",
      label: "AVG SLEEP / NIGHT",
      value: formatSleepDuration(metrics.sleepMinutes),
      unit: "7-day average",
      score:
        metrics.sleepMinutes === null
          ? null
          : rangeScore(metrics.sleepMinutes, config.sleep),
    },
    {
      key: "bpm",
      label: "AVG RECORDED BPM",
      value:
        metrics.bpm === null ? "No data" : `${Math.round(metrics.bpm)} BPM`,
      unit: "not resting-only",
      score: metrics.bpm === null ? null : rangeScore(metrics.bpm, config.bpm),
    },
  ];
  const scored = items.filter((item) => item.score !== null);
  // A composite index needs at least two independent metrics. One reading alone
  // is not enough to pretend we have a whole-person wellness score.
  const score =
    scored.length >= 2
      ? Math.round(
          scored.reduce((sum, item) => sum + (item.score || 0), 0) /
            scored.length,
        )
      : null;
  const tier: "low" | "medium" | "high" =
    score !== null && score > 80
      ? "high"
      : score !== null && score >= 50
        ? "medium"
        : "low";
  const tierImage = score === null ? "" : await randomTierImage(tier);
  const tierTitle =
    score === null
      ? "AWAITING DATA"
      : tier === "high"
        ? "BIOLOGY IS SHOWING OFF"
        : tier === "medium"
          ? "SYSTEMS OPERATIONAL"
          : "MAINTENANCE MODE";

  const metricMarkup = items
    .map(
      (item) =>
        `<tr><td style="padding:9px 9px 9px 0;border-bottom:1px dashed #35383c;color:#8d99a5;font-family:Consolas,'Courier New',monospace;font-size:9px;letter-spacing:.6px;line-height:1.5">${item.label}</td><td align="right" style="padding:9px 0;border-bottom:1px dashed #35383c;color:#edf1f5;font-family:Consolas,'Courier New',monospace;font-size:12px;line-height:1.5;white-space:nowrap">${htmlEscape(item.value)}</td></tr>`,
    )
    .join("");
  const imageMarkup = tierImage
    ? `<img src="${htmlEscape(tierImage)}" alt="${tier} wellness mood" width="150" style="display:block;width:100%;max-width:150px;height:auto;margin:0 auto;border:1px solid #34383d;object-fit:cover" />`
    : `<div style="padding:25px 8px;border:1px dashed #454a50;color:#8c98a4;font-family:Consolas,'Courier New',monospace;font-size:10px;text-align:center">NO<br>MOOD IMAGE</div>`;
  return `<tr><td style="padding:20px 16px;border-bottom:1px dashed #35383c"><p style="margin:0 0 5px;color:#80b6f4;font-family:Consolas,'Courier New',monospace;font-size:10px;letter-spacing:1.2px">[ SENDER TELEMETRY · 7 DAYS ]</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="65%" valign="top" style="padding-right:14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${metricMarkup}</table></td><td width="35%" valign="middle" style="padding-left:12px;border-left:1px dashed #35383c">${imageMarkup}<p style="margin:12px 0 2px;color:#80b6f4;text-align:center;font-family:Consolas,'Courier New',monospace;font-size:19px;font-weight:bold">${score === null ? "N/A" : `${score}%`}</p></td></tr></table></td></tr>`;
}

async function buildSongsSection(): Promise<string> {
  const tracks = await getSongsForNewsletter();
  if (!tracks.length) return "";
  const rows = tracks
    .map((track, index) => {
      const image = track.thumbnail
        ? `<img src="${htmlEscape(track.thumbnail)}" alt="" width="58" height="58" style="display:block;width:58px;height:58px;object-fit:cover;border:1px solid #34383d" />`
        : `<div style="width:58px;height:58px;border:1px dashed #454a50;color:#6d9ad0;text-align:center;line-height:58px;font-family:Consolas,'Courier New',monospace;font-size:15px">♪</div>`;
      const artist = track.artists.length
        ? `<p style="margin:4px 0 0;color:#8795a4;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.4">${htmlEscape(track.artists.join(", "))}</p>`
        : "";
      return `<tr><td width="70" valign="middle" style="padding:9px 10px 9px 0;border-bottom:1px dashed #35383c">${image}</td><td valign="middle" style="padding:9px 10px 9px 0;border-bottom:1px dashed #35383c"><p style="margin:0;color:#e9edf2;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45">${String(index + 1).padStart(2, "0")} · ${htmlEscape(track.title)}</p>${artist}</td><td valign="middle" align="right" style="padding:9px 0;border-bottom:1px dashed #35383c;white-space:nowrap"><a href="${htmlEscape(track.url)}" style="color:#8ebeff;font-family:Consolas,'Courier New',monospace;font-size:9px;text-decoration:none;letter-spacing:.5px">LISTEN ↗</a></td></tr>`;
    })
    .join("");
  return `<tr><td style="padding:20px 16px;border-bottom:1px dashed #35383c"><p style="margin:0 0 4px;color:#80b6f4;font-family:Consolas,'Courier New',monospace;font-size:10px;letter-spacing:1.2px">[ SONGS FOR YOU ]</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr>`;
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dateLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function publicSiteUrl(): string {
  const configured = (
    process.env.BLOGG_PUBLIC_URL ||
    process.env.FRONTEND_URL ||
    "http://localhost:5173"
  ).trim();
  try {
    const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(configured)
      ? configured
      : `https://${configured}`;
    const parsed = new URL(candidate);
    if (
      (parsed.protocol !== "https:" &&
        parsed.hostname !== "localhost" &&
        parsed.hostname !== "127.0.0.1") ||
      parsed.username ||
      parsed.password
    )
      return "";
    // BLOGG_PUBLIC_URL identifies the site, not a page such as `/feed`.
    // URLs generated below append `/read/...` and static asset filenames.
    return parsed.origin.replace(/\/+$/, "");
  } catch {
    console.warn("[newsletter] Public site URL is not a valid absolute URL.");
    return "";
  }
}

async function getAvailableTopics(): Promise<string[]> {
  const rows = await getDB()
    .collection("bloggs")
    .find({}, { projection: { tags: 1 } })
    .toArray();
  const topics = new Map<string, string>();
  for (const row of rows) {
    for (const tag of getTags(row.tags)) {
      const key = tag.toLocaleLowerCase();
      if (!topics.has(key)) topics.set(key, tag);
    }
  }
  return [...topics.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

async function buildNewsletter(filters: NewsletterFilters): Promise<{
  html: string;
  subject: string;
  articleCount: number;
  includedCount: number;
}> {
  const collection = getDB().collection<BlogRecord>("bloggs");
  const fromIso = filters.fromDate.toISOString();
  const toIso = filters.toDate.toISOString();
  // Match both BSON Date values and legacy ISO date strings, while using createdAt
  // (the written date) rather than updatedAt (which changes when a note is edited).
  const rows = await collection
    .find(
      {
        $or: [
          { createdAt: { $gte: filters.fromDate, $lt: filters.toDate } },
          { createdAt: { $gte: fromIso, $lt: toIso } },
        ],
      },
      {
        projection: {
          blogg_id: 1,
          author: 1,
          title: 1,
          subtitle: 1,
          tags: 1,
          createdAt: 1,
          content: 1,
        },
      },
    )
    .toArray();

  const topicKey = filters.topic.toLocaleLowerCase();
  const matching: NewsletterArticle[] = rows
    .flatMap((row) => {
      const date = getCreatedDate(row.createdAt);
      if (!date || date < filters.fromDate || date >= filters.toDate) return [];
      const tags = getTags(row.tags);
      if (
        topicKey !== "all" &&
        !tags.some((tag) => tag.toLocaleLowerCase() === topicKey)
      )
        return [];
      const preview = articlePreview(row.content);
      const text = preview.text
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const storedTitle = typeof row.title === "string" ? row.title.trim() : "";
      const storedSubtitle =
        typeof row.subtitle === "string" ? row.subtitle.trim() : "";
      // Do not send a blank editor draft as a newsletter article. When a real note
      // has content but no explicit title, derive a human-readable title from it.
      if (
        !storedTitle &&
        !preview.suggestedTitle &&
        !storedSubtitle &&
        !text &&
        !preview.html &&
        !preview.image
      )
        return [];
      return [
        {
          id:
            typeof row.blogg_id === "string"
              ? row.blogg_id
              : row._id
                ? String(row._id)
                : "",
          title: storedTitle || preview.suggestedTitle || "Untitled note",
          subtitle: storedSubtitle,
          author: typeof row.author === "string" ? row.author.trim() : "",
          date,
          tags,
          excerpt: text.slice(0, 520),
          previewHtml: preview.html,
          previewImage: preview.image,
        },
      ];
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  if (!matching.length) {
    const error = new Error(
      "No blogs matched the selected topic and written-date range.",
    ) as Error & { statusCode?: number };
    error.statusCode = 422;
    throw error;
  }

  const articles = matching.slice(0, MAX_ARTICLES_PER_EMAIL);
  const topicLabel = filters.topic === "all" ? "All topics" : filters.topic;
  // The longer-form written preview is reserved for a single-day issue. For
  // ranges spanning multiple days, show the title/metadata/hero image/tags/link
  // without dumping the body text from every matching note into one email.
  const includeWrittenContent = filters.fromLabel === filters.toLabel;
  const issueDate = dateLabel(new Date());
  const articleMarkup = articles
    .map((article, index) => {
      const noteUrl = article.id
        ? `${publicSiteUrl()}/read/${encodeURIComponent(article.id)}`
        : "";
      const tagMarkup = article.tags.length
        ? `<p style="margin:12px 0 0;color:#7f8a96;font-family:Consolas,'Courier New',monospace;font-size:10px;line-height:1.8;letter-spacing:.25px">${article.tags.map((tag) => `<span style="display:inline-block;margin:0 6px 5px 0;padding:3px 7px;border:1px solid #34383d;color:#9da8b3">${htmlEscape(tag)}</span>`).join("")}</p>`
        : "";
      const bodyPreview = !includeWrittenContent
        ? ""
        : article.previewHtml
          ? `<div style="margin:14px 0 0;padding:13px 12px 5px;border:1px solid #25292e;background:#151719">${article.previewHtml}</div>`
          : article.excerpt
            ? `<p style="margin:13px 0 0;color:#bdc5ce;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.7">${htmlEscape(article.excerpt)}${article.excerpt.length >= 520 ? "…" : ""}</p>`
            : "";
      const imagePreview = article.previewImage
        ? `<img src="${htmlEscape(article.previewImage)}" alt="" width="520" style="display:block;width:100%;max-width:520px;height:auto;max-height:250px;object-fit:cover;margin:14px 0 0;border:1px solid #34383d" />`
        : "";
      const subtitle = article.subtitle
        ? `<p style="margin:8px 0 0;color:#d5dbe1;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.7">${htmlEscape(article.subtitle)}</p>`
        : "";
      const readLink = noteUrl
        ? `<p style="margin:16px 0 0;font-family:Consolas,'Courier New',monospace;font-size:10px;letter-spacing:.5px"><a href="${htmlEscape(noteUrl)}" style="color:#8ebeff;text-decoration:none;border-bottom:1px solid #5278a5;padding-bottom:3px">OPEN NOTE&nbsp; ↗</a></p>`
        : "";
      const articleMeta = `${dateLabel(article.date)}${article.author ? ` &nbsp;·&nbsp; ${htmlEscape(article.author)}` : ""}`;
      return `<tr><td style="padding:22px 0 24px;border-bottom:1px dashed #35383c"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="font-family:Consolas,'Courier New',monospace;color:#8c98a4;font-size:10px;line-height:1.6;letter-spacing:.4px;text-transform:uppercase">${String(index + 1).padStart(2, "0")} &nbsp; / &nbsp; ${articleMeta}</td><td align="right" style="font-family:Arial,Helvetica,sans-serif;color:#5e91ce;font-size:10px;white-space:nowrap">BLOGG NOTE</td></tr></table><h2 style="margin:12px 0 0;color:#f0f2f4;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:650;line-height:1.4;overflow-wrap:anywhere;word-break:break-word">${htmlEscape(article.title)}</h2>${subtitle}${imagePreview}${bodyPreview}${tagMarkup}${readLink}</td></tr>`;
    })
    .join("");

  const truncatedNotice =
    matching.length > articles.length
      ? `<tr><td style="padding:14px 16px;border-bottom:1px dashed #35383c;color:#aeb8c2;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6">Showing the latest ${articles.length} of ${matching.length} matching notes.</td></tr>`
      : "";
  const [
    healthSection,
    songsSection,
    booksForYouSection,
    featuredLinksSection,
  ] = await Promise.all([
    buildHealthSection(),
    buildSongsSection(),
    buildBooksForYouSection(),
    buildFeaturedLinksSection(),
  ]);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BLOGG Newsletter</title></head><body style="margin:0;padding:0;background:#262626;color:#e9edf1;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#262626" style="width:100%;background:#262626"><tr><td align="center" style="padding:28px 12px 36px"><table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background:#111213;border:1px solid #1b1d20"><tr><td style="padding:30px 30px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px dashed #35383c"><tr><td align="center" style="padding:17px 12px 27px;color:#80b6f4;font-family:Consolas,'Courier New',monospace;font-size:10px;letter-spacing:1.25px">[ NEWSLETTER &nbsp;·&nbsp; ${htmlEscape(issueDate.toUpperCase())} ]</td></tr><tr><td style="padding:0 16px 20px;border-bottom:1px dashed #35383c"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="top" style="color:#f4f5f6;font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:600;letter-spacing:-.3px">◉ Blogg</td><td align="right" valign="top" style="color:#a8b0b9;font-family:Consolas,'Courier New',monospace;font-size:10px;line-height:1.8"><span style="color:#707b87">ISSUED</span> &nbsp; ${htmlEscape(issueDate)}<br><span style="color:#707b87">TOPIC</span> &nbsp; ${htmlEscape(topicLabel)}<br><span style="color:#707b87">BLOGS</span> &nbsp; ${articles.length}${matching.length > articles.length ? ` / ${matching.length}` : ""}</td></tr></table></td></tr><tr><td style="padding:19px 16px 21px;border-bottom:1px dashed #35383c"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="top" width="48%" style="padding-right:14px"><p style="margin:0 0 9px;color:#77828d;font-family:Consolas,'Courier New',monospace;font-size:10px;letter-spacing:1px">[ EDITION ]</p><p style="margin:0;color:#e5e9ed;font-family:Consolas,'Courier New',monospace;font-size:12px;line-height:1.7">${htmlEscape(topicLabel)}</p></td><td valign="top" width="52%" style="padding-left:14px;border-left:1px dashed #35383c"><p style="margin:0 0 9px;color:#77828d;font-family:Consolas,'Courier New',monospace;font-size:10px;letter-spacing:1px">[ WRITTEN DATE RANGE ]</p><p style="margin:0;color:#e5e9ed;font-family:Consolas,'Courier New',monospace;font-size:11px;line-height:1.8;overflow-wrap:anywhere">${htmlEscape(filters.fromLabel)}<br>to&nbsp; ${htmlEscape(filters.toLabel)}</p></td></tr></table></td></tr>${healthSection}${songsSection}${booksForYouSection}${featuredLinksSection}<tr><td style="padding:22px 16px 4px"><p style="margin:0;color:#77828d;font-family:Consolas,'Courier New',monospace;font-size:10px;letter-spacing:1.2px">[ NOTES IN THIS ISSUE ]</p></td></tr>${truncatedNotice}<tr><td style="padding:0 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${articleMarkup}</table></td></tr><tr><td style="padding:25px 16px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px dashed #35383c;padding-top:16px;color:#717c87;font-family:Consolas,'Courier New',monospace;font-size:10px;line-height:1.8">[ DELIVERY ]<br>Selected by written date, not last-edited date.<br>Generated by BLOGG Newsletter</td><td align="right" valign="bottom" style="border-top:1px dashed #35383c;padding-top:16px;color:#80b6f4;font-family:Consolas,'Courier New',monospace;font-size:10px;white-space:nowrap">END OF ISSUE</td></tr></table></td></tr></table></td></tr></table></td></tr></table></body></html>`;

  const subject = `BLOGG Newsletter: ${topicLabel} (${filters.fromLabel} – ${filters.toLabel})`;
  return {
    html,
    subject,
    articleCount: matching.length,
    includedCount: articles.length,
  };
}

type GmailOAuthCredentials = {
  user: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

type GmailApiError = {
  code?: unknown;
  error?: unknown;
  error_description?: unknown;
  message?: unknown;
  errorMessage?: unknown;
};

function getGmailCredentials(): GmailOAuthCredentials | null {
  const user = process.env.GMAIL_USER?.trim();
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();
  if (
    !user ||
    !emailIsValid(user) ||
    !clientId ||
    !clientSecret ||
    !refreshToken
  )
    return null;
  return { user, clientId, clientSecret, refreshToken };
}

function emailProviderConfigured(): boolean {
  return getGmailCredentials() !== null;
}

function gmailSetupMessage(): string {
  return "Newsletter delivery is not configured. Set GMAIL_USER, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN on the backend.";
}

function errorText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const item = value as GmailApiError;
    const nestedError =
      item.error && typeof item.error === "object"
        ? (item.error as { message?: unknown }).message
        : item.error;
    return [
      item.error_description,
      item.message,
      item.errorMessage,
      nestedError,
    ]
      .filter(
        (part): part is string =>
          typeof part === "string" && Boolean(part.trim()),
      )
      .join(" ")
      .slice(0, 1200);
  }
  return "";
}

function logGmailFailure(event: {
  phase: "oauth-token-refresh" | "gmail-send";
  status?: number;
  errorCode?: string;
  message: string;
  sender?: string;
  recipient?: string;
}): void {
  // Never log OAuth secrets, access tokens, refresh tokens, or message content.
  console.error(
    "[newsletter:gmail]",
    JSON.stringify({
      timestamp: new Date().toISOString(),
      ...event,
    }),
  );
}

function googleErrorCode(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "unknown_error";
  const item = payload as Record<string, unknown>;
  if (typeof item.error === "string") return item.error;
  if (item.error && typeof item.error === "object") {
    const nested = item.error as Record<string, unknown>;
    if (typeof nested.status === "string") return nested.status;
    if (typeof nested.code === "number") return String(nested.code);
    if (Array.isArray(nested.errors)) {
      const first = nested.errors.find(
        (entry) => entry && typeof entry === "object",
      ) as Record<string, unknown> | undefined;
      if (first && typeof first.reason === "string") return first.reason;
    }
  }
  return typeof item.error_description === "string"
    ? item.error_description
    : "unknown_error";
}

function publicGmailError(
  status: number,
  message: string,
  code = "unknown_error",
  phase: "oauth-token-refresh" | "gmail-send" = "gmail-send",
): string {
  const normalized = `${code} ${message}`.toLowerCase();
  if (/invalid_client/.test(normalized)) {
    return "Google rejected the OAuth client credentials (invalid_client). Check that GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET belong to the same active OAuth client.";
  }
  if (/invalid_grant/.test(normalized)) {
    return "Google rejected the refresh token (invalid_grant). Regenerate GOOGLE_REFRESH_TOKEN using this exact OAuth client and the intended Gmail account, then update Render.";
  }
  if (/access_denied|unauthorized_client/.test(normalized)) {
    return "Google denied OAuth access. Check the OAuth app's audience/test-user settings and authorize the intended Gmail account again.";
  }
  if (
    /insufficientpermissions|insufficient authentication scopes|insufficient_permission/.test(
      normalized,
    )
  ) {
    return "The Gmail access token lacks permission to send mail. Reauthorize with https://www.googleapis.com/auth/gmail.send and replace GOOGLE_REFRESH_TOKEN.";
  }
  if (status === 403 && phase === "gmail-send") {
    return `Gmail API denied the send request (HTTP 403, ${code}). Check that Gmail API is enabled in the same Google Cloud project, the token has gmail.send scope, and the sender account matches the authorized account. Google detail: ${message}`;
  }
  if (status === 401) {
    return `Google rejected the ${phase === "oauth-token-refresh" ? "OAuth token refresh" : "Gmail API authorization"} (HTTP 401, ${code}). Google detail: ${message}`;
  }
  if (
    status === 429 ||
    /daily.*limit|sending.*limit|quota|rate.?limit|too many messages/.test(
      normalized,
    )
  ) {
    return "Gmail's sending limit or quota was reached. Wait before retrying and keep newsletter sends within Gmail's daily limits.";
  }
  return `Gmail ${phase === "oauth-token-refresh" ? "OAuth token refresh" : "send"} failed${status ? ` (HTTP ${status})` : ""}${code ? ` [${code}]` : ""}: ${message || "Unknown Google API error"}`;
}

async function getGmailAccessToken(
  credentials: GmailOAuthCredentials,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: credentials.refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Network request failed";
    logGmailFailure({
      phase: "oauth-token-refresh",
      message,
      sender: credentials.user,
    });
    throw new Error(
      `Could not reach Google's OAuth token endpoint: ${message}`,
    );
  }
  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !payload.access_token) {
    const code = payload.error || "unknown_error";
    const detail =
      payload.error_description ||
      code ||
      "Could not refresh Gmail OAuth access token.";
    logGmailFailure({
      phase: "oauth-token-refresh",
      status: response.status,
      errorCode: code,
      message: detail,
      sender: credentials.user,
    });
    throw new Error(
      publicGmailError(response.status, detail, code, "oauth-token-refresh"),
    );
  }
  console.info(
    "[newsletter:gmail]",
    JSON.stringify({
      timestamp: new Date().toISOString(),
      phase: "oauth-token-refresh",
      outcome: "success",
      sender: credentials.user,
    }),
  );
  return payload.access_token;
}

function base64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function encodeMimeBody(value: string): string {
  const encoded = Buffer.from(value, "utf8").toString("base64");
  return encoded.match(/.{1,76}/g)?.join("\r\n") || "";
}

function buildRawMessage(
  to: string,
  from: string,
  subject: string,
  html: string,
): string {
  const boundary = `blogg_${Buffer.from(`${Date.now()}_${Math.random()}`).toString("hex")}`;
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
  const text = htmlToPlainText(html);
  return [
    `From: "BLOGG Newsletter" <${from}>`,
    `To: ${to}`,
    `Reply-To: ${from}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    encodeMimeBody(text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    encodeMimeBody(html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

async function sendOneWithGmailApi(
  credentials: GmailOAuthCredentials,
  accessToken: string,
  recipient: string,
  subject: string,
  html: string,
): Promise<void> {
  const raw = base64Url(
    buildRawMessage(recipient, credentials.user, subject, html),
  );
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ raw }),
    },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const detail =
      errorText(payload) || `Gmail API request failed (${response.status})`;
    const code = googleErrorCode(payload);
    logGmailFailure({
      phase: "gmail-send",
      status: response.status,
      errorCode: code,
      message: detail,
      sender: credentials.user,
      recipient,
    });
    throw new Error(
      publicGmailError(response.status, detail, code, "gmail-send"),
    );
  }
  console.info(
    "[newsletter:gmail]",
    JSON.stringify({
      timestamp: new Date().toISOString(),
      phase: "gmail-send",
      outcome: "accepted",
      sender: credentials.user,
      recipient,
    }),
  );
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|article|h1|h2|header|main|li)>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function sendBatch(
  recipients: string[],
  subject: string,
  html: string,
): Promise<{
  sent: number;
  failed: number;
  providerError?: string;
}> {
  const credentials = getGmailCredentials();
  if (!credentials) throw new Error(gmailSetupMessage());

  let sent = 0;
  let failed = 0;
  let providerError = "";
  let accessToken: string;
  try {
    accessToken = await getGmailAccessToken(credentials);
  } catch (error) {
    return {
      sent: 0,
      failed: recipients.length,
      providerError:
        error instanceof Error
          ? error.message
          : "Could not authenticate with Gmail.",
    };
  }

  // Keep requests sequential to avoid triggering Gmail rate limits from a small personal account.
  for (let index = 0; index < recipients.length; index += 1) {
    try {
      await sendOneWithGmailApi(
        credentials,
        accessToken,
        recipients[index],
        subject,
        html,
      );
      sent += 1;
    } catch (error) {
      failed += 1;
      providerError ||=
        error instanceof Error
          ? error.message
          : "Gmail could not send the newsletter.";
      if (
        /authentication failed|quota was reached|sending limit/i.test(
          providerError,
        )
      ) {
        failed += recipients.length - index - 1;
        break;
      }
    }
  }
  return { sent, failed, ...(providerError ? { providerError } : {}) };
}

function canPublicSend(key: string): boolean {
  const now = Date.now();
  const recent = (publicSendHistory.get(key) || []).filter(
    (time) => now - time < SEND_WINDOW_MS,
  );
  if (recent.length >= MAX_PUBLIC_SENDS_PER_HOUR) {
    publicSendHistory.set(key, recent);
    return false;
  }
  if (recent.some((time) => now - time < SEND_COOLDOWN_MS)) {
    publicSendHistory.set(key, recent);
    return false;
  }
  recent.push(now);
  publicSendHistory.set(key, recent);
  if (publicSendHistory.size > 5000) {
    for (const [mapKey, times] of publicSendHistory) {
      if (!times.some((time) => now - time < SEND_WINDOW_MS))
        publicSendHistory.delete(mapKey);
    }
  }
  return true;
}

// Public, read-only endpoint for images bundled with the app. Only tier-prefixed
// image assets are served; all other filenames and path traversal attempts are rejected.
router.get("/newsletter/media/:filename", async (req, res, next) => {
  try {
    const filename = String(req.params.filename || "");
    if (!isMoodImageName(filename)) return res.status(404).end();
    const path = await findMoodImagePath(filename);
    if (!path) return res.status(404).end();
    const data = await readFile(path);
    const mime: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".avif": "image/avif",
    };
    res.setHeader(
      "Content-Type",
      mime[extname(filename).toLowerCase()] || "application/octet-stream",
    );
    res.setHeader("Content-Length", String(data.length));
    res.setHeader(
      "Cache-Control",
      "public, max-age=86400, s-maxage=604800, immutable",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).send(data);
  } catch (error) {
    return next(error);
  }
});

router.get("/newsletter/topics", async (_req, res, next) => {
  try {
    const topics = await getAvailableTopics();
    res.setHeader("Cache-Control", "no-store");
    res.json({ topics });
  } catch (error) {
    next(error);
  }
});

router.get(
  "/newsletter/admin/health-config",
  authenticationMiddleware,
  adminMiddleware,
  async (_req, res, next) => {
    try {
      const config = await readHealthConfig();
      const [low, medium, high] = await Promise.all([
        findTierImages("low"),
        findTierImages("medium"),
        findTierImages("high"),
      ]);
      res.setHeader("Cache-Control", "no-store");
      return res.json({
        config,
        moodImageCounts: {
          low: low.length,
          medium: medium.length,
          high: high.length,
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.put(
  "/newsletter/admin/health-config",
  authenticationMiddleware,
  adminMiddleware,
  async (req, res, next) => {
    try {
      const config = normalizeHealthConfig(req.body?.config);
      const invalidMessage = validateHealthConfig(config);
      if (invalidMessage)
        return res.status(400).json({ message: invalidMessage });
      await getDB()
        .collection("newsletterHealthConfig")
        .updateOne(
          { key: "default" },
          { $set: { key: "default", config, updatedAt: new Date() } },
          { upsert: true },
        );
      res.setHeader("Cache-Control", "no-store");
      return res.json({ success: true, config });
    } catch (error) {
      return next(error);
    }
  },
);

router.post("/newsletter/subscribe", async (req, res, next) => {
  try {
    if (typeof req.body?.website === "string" && req.body.website.trim()) {
      res.json({ success: true });
      return;
    }
    if (!emailIsValid(req.body?.email)) {
      res.status(400).json({ message: "Enter a valid email address." });
      return;
    }
    await ensureIndexes();
    const email = normalizeEmail(req.body.email);
    const now = new Date();
    await getDB()
      .collection<NewsletterSubscriber>("newsletterSubscribers")
      .updateOne(
        { email },
        {
          $set: {
            subscribed: true,
            updatedAt: now,
            source: "public-newsletter",
          },
          $setOnInsert: { email, subscribedAt: now },
        },
        { upsert: true },
      );
    res.json({
      success: true,
      message: "You are subscribed to the newsletter.",
    });
  } catch (error) {
    next(error);
  }
});

router.post("/newsletter/send", async (req, res, next) => {
  try {
    if (typeof req.body?.website === "string" && req.body.website.trim()) {
      res.json({ success: true, message: "Newsletter request received." });
      return;
    }
    if (!emailIsValid(req.body?.email)) {
      res.status(400).json({ message: "Enter a valid email address." });
      return;
    }
    const filters = resolveFilters(req.body || {});
    if (!filters) {
      res.status(400).json({ message: "Choose a valid topic and date range." });
      return;
    }
    if (!emailProviderConfigured()) {
      res.status(503).json({
        message:
          "Newsletter delivery is not configured on the server yet. Set GMAIL_USER, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN on the backend.",
      });
      return;
    }
    const email = normalizeEmail(req.body.email);
    const requestKey = `${req.ip || req.socket.remoteAddress || "unknown"}:${email}`;
    if (!canPublicSend(requestKey)) {
      res.status(429).json({
        message:
          "Please wait before requesting another newsletter for this email address.",
      });
      return;
    }
    const issue = await buildNewsletter(filters);
    const result = await sendBatch([email], issue.subject, issue.html);
    if (result.failed) {
      res.status(502).json({
        message:
          result.providerError ||
          "The email provider could not accept the newsletter.",
      });
      return;
    }
    if (req.body?.subscribe === true) {
      await ensureIndexes();
      const now = new Date();
      await getDB()
        .collection<NewsletterSubscriber>("newsletterSubscribers")
        .updateOne(
          { email },
          {
            $set: {
              subscribed: true,
              updatedAt: now,
              source: "newsletter-request",
            },
            $setOnInsert: { email, subscribedAt: now },
          },
          { upsert: true },
        );
    }
    await getDB().collection("newsletterSendLog").insertOne({
      kind: "public",
      email,
      topic: filters.topic,
      fromDate: filters.fromLabel,
      toDate: filters.toLabel,
      articleCount: issue.articleCount,
      createdAt: new Date(),
    });
    res.json({
      success: true,
      message: `Newsletter sent to ${email}.`,
      articleCount: issue.includedCount,
    });
  } catch (error) {
    const statusCode = (error as Error & { statusCode?: number })?.statusCode;
    if (statusCode === 422) {
      res.status(422).json({ message: (error as Error).message });
      return;
    }
    next(error);
  }
});

router.get(
  "/newsletter/admin/summary",
  authenticationMiddleware,
  adminMiddleware,
  async (_req, res, next) => {
    try {
      await ensureIndexes();
      const count = await getDB()
        .collection<NewsletterSubscriber>("newsletterSubscribers")
        .countDocuments({ subscribed: true });
      res.setHeader("Cache-Control", "no-store");
      res.json({ success: true, subscriberCount: count });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/newsletter/admin/subscribers.csv",
  authenticationMiddleware,
  adminMiddleware,
  async (_req, res, next) => {
    try {
      await ensureIndexes();
      const subscribers = await getDB()
        .collection<NewsletterSubscriber>("newsletterSubscribers")
        .find(
          { subscribed: true },
          {
            projection: {
              _id: 0,
              email: 1,
              subscribedAt: 1,
              updatedAt: 1,
              source: 1,
            },
          },
        )
        .sort({ subscribedAt: -1 })
        .toArray();
      const csvEscape = (value: unknown) => {
        const text =
          value instanceof Date ? value.toISOString() : String(value ?? "");
        return `"${text.replace(/"/g, '""')}"`;
      };
      const lines = ["email,subscribed_at,last_updated,source"];
      for (const row of subscribers) {
        lines.push(
          [
            csvEscape(row.email),
            csvEscape(row.subscribedAt),
            csvEscape(row.updatedAt),
            csvEscape(row.source),
          ].join(","),
        );
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="blogg-newsletter-emails-${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      res.setHeader("Cache-Control", "no-store");
      res.send(`\uFEFF${lines.join("\r\n")}\r\n`);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/newsletter/admin/send",
  authenticationMiddleware,
  adminMiddleware,
  async (req, res, next) => {
    try {
      const filters = resolveFilters(req.body || {});
      if (!filters) {
        res
          .status(400)
          .json({ message: "Choose a valid topic and date range." });
        return;
      }
      if (!emailProviderConfigured()) {
        res.status(503).json({
          message:
            "Newsletter delivery is not configured on the server yet. Set GMAIL_USER, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN on the backend.",
        });
        return;
      }
      await ensureIndexes();
      const subscribers = await getDB()
        .collection<NewsletterSubscriber>("newsletterSubscribers")
        .find({ subscribed: true }, { projection: { email: 1, _id: 0 } })
        .toArray();
      const recipients = subscribers
        .map((subscriber) => subscriber.email)
        .filter(emailIsValid);
      if (!recipients.length) {
        res
          .status(400)
          .json({ message: "There are no subscribed email addresses yet." });
        return;
      }
      const issue = await buildNewsletter(filters);
      const result = await sendBatch(recipients, issue.subject, issue.html);
      await getDB().collection("newsletterSendLog").insertOne({
        kind: "admin-broadcast",
        topic: filters.topic,
        fromDate: filters.fromLabel,
        toDate: filters.toLabel,
        articleCount: issue.articleCount,
        recipientCount: recipients.length,
        sent: result.sent,
        failed: result.failed,
        createdAt: new Date(),
      });
      res.status(result.failed > 0 && result.sent === 0 ? 502 : 200).json({
        success: result.failed === 0,
        sent: result.sent,
        failed: result.failed,
        articleCount: issue.includedCount,
        ...(result.providerError
          ? { providerError: result.providerError }
          : {}),
      });
    } catch (error) {
      const statusCode = (error as Error & { statusCode?: number })?.statusCode;
      if (statusCode === 422) {
        res.status(422).json({ message: (error as Error).message });
        return;
      }
      next(error);
    }
  },
);

export default router;
