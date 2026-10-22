import express from "express";
import { getDB } from "../db/mongoDBConnect.ts";
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
};

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
      getDB().collection<NewsletterSubscriber>("newsletterSubscribers").createIndex(
        { email: 1 },
        { unique: true, name: "newsletter_subscriber_email_unique" },
      ),
      getDB().collection("newsletterSendLog").createIndex(
        { createdAt: 1 },
        { expireAfterSeconds: 60 * 60 * 24 * 180, name: "newsletter_send_log_ttl" },
      ),
    ]).then(() => undefined).catch((error) => {
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
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? parsed
    : null;
}

function resolveFilters(body: Record<string, unknown>): NewsletterFilters | null {
  const fromDate = parseDate(body.fromDate);
  const endDate = parseDate(body.toDate);
  if (!fromDate || !endDate || fromDate.getTime() > endDate.getTime()) return null;
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
  if (!(value instanceof Date) && typeof value !== "string" && typeof value !== "number") return null;
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

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join(" ");
  if (!value || typeof value !== "object") return "";
  const item = value as Record<string, unknown>;
  const ownText = typeof item.text === "string" ? item.text : "";
  const nested = Object.entries(item)
    .filter(([key]) => key !== "text" && key !== "url" && key !== "href")
    .map(([, child]) => extractText(child))
    .filter(Boolean);
  return [ownText, ...nested].filter(Boolean).join(" ");
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
  return (process.env.BLOGG_PUBLIC_URL || process.env.FRONTEND_URL || "http://localhost:5173").trim().replace(/\/+$/, "");
}

async function getAvailableTopics(): Promise<string[]> {
  const rows = await getDB().collection("bloggs").find({}, { projection: { tags: 1 } }).toArray();
  const topics = new Map<string, string>();
  for (const row of rows) {
    for (const tag of getTags(row.tags)) {
      const key = tag.toLocaleLowerCase();
      if (!topics.has(key)) topics.set(key, tag);
    }
  }
  return [...topics.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
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
  const rows = await collection.find(
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
  ).toArray();

  const topicKey = filters.topic.toLocaleLowerCase();
  const matching: NewsletterArticle[] = rows.flatMap((row) => {
    const date = getCreatedDate(row.createdAt);
    if (!date || date < filters.fromDate || date >= filters.toDate) return [];
    const tags = getTags(row.tags);
    if (topicKey !== "all" && !tags.some((tag) => tag.toLocaleLowerCase() === topicKey)) return [];
    const text = extractText(row.content).replace(/\s+/g, " ").trim();
    return [{
      id: typeof row.blogg_id === "string" ? row.blogg_id : "",
      title: typeof row.title === "string" && row.title.trim() ? row.title.trim() : "Untitled note",
      subtitle: typeof row.subtitle === "string" ? row.subtitle.trim() : "",
      author: typeof row.author === "string" ? row.author.trim() : "",
      date,
      tags,
      excerpt: text.slice(0, 900),
    }];
  }).sort((a, b) => b.date.getTime() - a.date.getTime());

  if (!matching.length) {
    const error = new Error("No blogs matched the selected topic and written-date range.") as Error & { statusCode?: number };
    error.statusCode = 422;
    throw error;
  }

  const articles = matching.slice(0, MAX_ARTICLES_PER_EMAIL);
  const topicLabel = filters.topic === "all" ? "All topics" : filters.topic;
  const articleMarkup = articles.map((article) => {
    const link = article.id
      ? `<p style="margin:14px 0 0"><a href="${htmlEscape(`${publicSiteUrl()}/read/${encodeURIComponent(article.id)}`)}" style="color:#24364b;font-weight:600;text-decoration:underline">Read note</a></p>`
      : "";
    const tags = article.tags.length
      ? `<p style="margin:10px 0 0;color:#687586;font-size:12px">${article.tags.map(htmlEscape).join(" · ")}</p>`
      : "";
    const excerpt = article.excerpt
      ? `<p style="margin:12px 0 0;color:#475569;line-height:1.7;white-space:pre-wrap">${htmlEscape(article.excerpt)}${article.excerpt.length >= 900 ? "…" : ""}</p>`
      : "";
    return `<article style="padding:22px 0;border-bottom:1px solid #e6eaf0"><p style="margin:0 0 7px;color:#7b8797;font-size:12px">${htmlEscape(dateLabel(article.date))}${article.author ? ` · ${htmlEscape(article.author)}` : ""}</p><h2 style="margin:0;color:#182536;font-size:20px;line-height:1.4">${htmlEscape(article.title)}</h2>${article.subtitle ? `<p style="margin:8px 0 0;color:#344054;line-height:1.6">${htmlEscape(article.subtitle)}</p>` : ""}${excerpt}${tags}${link}</article>`;
  }).join("");

  const truncatedNotice = matching.length > articles.length
    ? `<p style="padding:12px 14px;border-radius:8px;background:#f4f6f8;color:#536174;font-size:13px">Showing the latest ${articles.length} of ${matching.length} matching notes.</p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif;color:#182536"><div style="max-width:680px;margin:0 auto;padding:28px 18px"><header style="padding:22px 24px;background:#182536;color:#fff;border-radius:12px 12px 0 0"><p style="margin:0 0 7px;font-size:11px;letter-spacing:2px">BLOGG</p><h1 style="margin:0;font-size:25px;line-height:1.3">Newsletter</h1><p style="margin:12px 0 0;color:#e0e7ef;font-size:13px;line-height:1.6">${htmlEscape(topicLabel)} · ${htmlEscape(filters.fromLabel)} to ${htmlEscape(filters.toLabel)}</p></header><main style="padding:0 24px 22px;background:#fff;border:1px solid #e1e6ed;border-top:0;border-radius:0 0 12px 12px">${truncatedNotice}${articleMarkup}<p style="margin:20px 0 0;color:#7b8797;font-size:11px">Selected by written date, not last-edited date.</p></main></div></body></html>`;
  const subject = `BLOGG Newsletter: ${topicLabel} (${filters.fromLabel} – ${filters.toLabel})`;
  return { html, subject, articleCount: matching.length, includedCount: articles.length };
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
  if (!user || !emailIsValid(user) || !clientId || !clientSecret || !refreshToken) return null;
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
    const nestedError = item.error && typeof item.error === "object"
      ? (item.error as { message?: unknown }).message
      : item.error;
    return [item.error_description, item.message, item.errorMessage, nestedError]
      .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
      .join(" ").slice(0, 1200);
  }
  return "";
}

function publicGmailError(status: number, message: string): string {
  if (status === 401 || status === 403 || /invalid_grant|invalid_client|unauthorized|insufficient authentication/i.test(message)) {
    return "Gmail OAuth authentication failed. Check GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN, and confirm the Google OAuth app still has Gmail send permission.";
  }
  if (status === 429 || /daily.*limit|sending.*limit|quota|rate.?limit|too many messages/i.test(message)) {
    return "Gmail's sending limit or quota was reached. Wait before retrying and keep newsletter sends within Gmail's daily limits.";
  }
  return `Gmail could not send the newsletter${status ? ` (HTTP ${status})` : ""}: ${message || "Unknown Gmail API error"}`;
}

async function getGmailAccessToken(credentials: GmailOAuthCredentials): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  const payload = await response.json().catch(() => ({})) as { access_token?: string; error?: string; error_description?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error(publicGmailError(response.status, payload.error_description || payload.error || "Could not refresh Gmail OAuth access token."));
  }
  return payload.access_token;
}

function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodeMimeBody(value: string): string {
  const encoded = Buffer.from(value, "utf8").toString("base64");
  return encoded.match(/.{1,76}/g)?.join("\r\n") || "";
}

function buildRawMessage(to: string, from: string, subject: string, html: string): string {
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
  const raw = base64Url(buildRawMessage(recipient, credentials.user, subject, html));
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ raw }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const detail = errorText(payload) || `Gmail API request failed (${response.status})`;
    throw new Error(publicGmailError(response.status, detail));
  }
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

async function sendBatch(recipients: string[], subject: string, html: string): Promise<{
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
    return { sent: 0, failed: recipients.length, providerError: error instanceof Error ? error.message : "Could not authenticate with Gmail." };
  }

  // Keep requests sequential to avoid triggering Gmail rate limits from a small personal account.
  for (let index = 0; index < recipients.length; index += 1) {
    try {
      await sendOneWithGmailApi(credentials, accessToken, recipients[index], subject, html);
      sent += 1;
    } catch (error) {
      failed += 1;
      providerError ||= error instanceof Error ? error.message : "Gmail could not send the newsletter.";
      if (/authentication failed|quota was reached|sending limit/i.test(providerError)) {
        failed += recipients.length - index - 1;
        break;
      }
    }
  }
  return { sent, failed, ...(providerError ? { providerError } : {}) };
}

function canPublicSend(key: string): boolean {
  const now = Date.now();
  const recent = (publicSendHistory.get(key) || []).filter((time) => now - time < SEND_WINDOW_MS);
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
      if (!times.some((time) => now - time < SEND_WINDOW_MS)) publicSendHistory.delete(mapKey);
    }
  }
  return true;
}

router.get("/newsletter/topics", async (_req, res, next) => {
  try {
    const topics = await getAvailableTopics();
    res.setHeader("Cache-Control", "no-store");
    res.json({ topics });
  } catch (error) {
    next(error);
  }
});

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
    await getDB().collection<NewsletterSubscriber>("newsletterSubscribers").updateOne(
      { email },
      {
        $set: { subscribed: true, updatedAt: now, source: "public-newsletter" },
        $setOnInsert: { email, subscribedAt: now },
      },
      { upsert: true },
    );
    res.json({ success: true, message: "You are subscribed to the newsletter." });
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
      res.status(503).json({ message: "Newsletter delivery is not configured on the server yet. Set GMAIL_USER, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN on the backend." });
      return;
    }
    const email = normalizeEmail(req.body.email);
    const requestKey = `${req.ip || req.socket.remoteAddress || "unknown"}:${email}`;
    if (!canPublicSend(requestKey)) {
      res.status(429).json({ message: "Please wait before requesting another newsletter for this email address." });
      return;
    }
    const issue = await buildNewsletter(filters);
    const result = await sendBatch([email], issue.subject, issue.html);
    if (result.failed) {
      res.status(502).json({ message: result.providerError || "The email provider could not accept the newsletter." });
      return;
    }
    if (req.body?.subscribe === true) {
      await ensureIndexes();
      const now = new Date();
      await getDB().collection<NewsletterSubscriber>("newsletterSubscribers").updateOne(
        { email },
        { $set: { subscribed: true, updatedAt: now, source: "newsletter-request" }, $setOnInsert: { email, subscribedAt: now } },
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
    res.json({ success: true, message: `Newsletter sent to ${email}.`, articleCount: issue.includedCount });
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
      const count = await getDB().collection<NewsletterSubscriber>("newsletterSubscribers").countDocuments({ subscribed: true });
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
      const subscribers = await getDB().collection<NewsletterSubscriber>("newsletterSubscribers")
        .find({ subscribed: true }, { projection: { _id: 0, email: 1, subscribedAt: 1, updatedAt: 1, source: 1 } })
        .sort({ subscribedAt: -1 })
        .toArray();
      const csvEscape = (value: unknown) => {
        const text = value instanceof Date ? value.toISOString() : String(value ?? "");
        return `"${text.replace(/"/g, '""')}"`;
      };
      const lines = ["email,subscribed_at,last_updated,source"];
      for (const row of subscribers) {
        lines.push([
          csvEscape(row.email),
          csvEscape(row.subscribedAt),
          csvEscape(row.updatedAt),
          csvEscape(row.source),
        ].join(","));
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="blogg-newsletter-emails-${new Date().toISOString().slice(0, 10)}.csv"`);
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
        res.status(400).json({ message: "Choose a valid topic and date range." });
        return;
      }
      if (!emailProviderConfigured()) {
        res.status(503).json({ message: "Newsletter delivery is not configured on the server yet. Set GMAIL_USER, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN on the backend." });
        return;
      }
      await ensureIndexes();
      const subscribers = await getDB().collection<NewsletterSubscriber>("newsletterSubscribers")
        .find({ subscribed: true }, { projection: { email: 1, _id: 0 } })
        .toArray();
      const recipients = subscribers.map((subscriber) => subscriber.email).filter(emailIsValid);
      if (!recipients.length) {
        res.status(400).json({ message: "There are no subscribed email addresses yet." });
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
        ...(result.providerError ? { providerError: result.providerError } : {}),
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
