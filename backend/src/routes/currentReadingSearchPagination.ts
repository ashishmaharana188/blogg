import { Router, type RequestHandler } from "express";
import { authenticationMiddleware } from "../middleware/authenticationMiddleware.ts";
import { adminMiddleware } from "../middleware/adminMiddleware.ts";

const router = Router();
const ADMIN_GUARD = [authenticationMiddleware, adminMiddleware] as const;
const ARCHIVE_SEARCH_URL = "https://archive.org/advancedsearch.php";
const FETCH_TIMEOUT_MS = 15_000;
const MAX_QUERY_LENGTH = 150;
const PAGE_SIZE = 12;
const MAX_PAGE = 100_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 120;

type ArchiveDocument = { identifier?: unknown; title?: unknown; creator?: unknown; date?: unknown };
type Book = { identifier: string; title: string; author: string; year?: string; coverUrl: string; itemUrl: string };
type SearchResult = { results: Book[]; total: number; page: number; hasMore: boolean };
type CachedResult = { expiresAt: number; value: SearchResult };
const cache = new Map<string, CachedResult>();
const inFlight = new Map<string, Promise<SearchResult>>();

function cleanText(value: unknown, maxLength = 240): string {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}
function fieldText(value: unknown, maxLength = 240): string {
  if (Array.isArray(value)) return value.map((part) => cleanText(part, maxLength)).filter(Boolean).join(", ").slice(0, maxLength);
  return cleanText(value, maxLength);
}
function validIdentifier(value: string): boolean { return value.length > 0 && value.length <= 200 && /^[A-Za-z0-9._-]+$/.test(value); }
function yearFrom(value: unknown): string | undefined {
  const match = fieldText(value, 80).match(/\b(1[5-9]\d{2}|20\d{2}|2100)\b/);
  return match?.[1];
}
function mapBook(document: ArchiveDocument): Book | null {
  const identifier = fieldText(document.identifier, 200);
  if (!validIdentifier(identifier)) return null;
  return {
    identifier,
    title: fieldText(document.title, 240) || "Untitled book",
    author: fieldText(document.creator, 300) || "Author unknown",
    year: yearFrom(document.date),
    coverUrl: `https://archive.org/services/img/${encodeURIComponent(identifier)}`,
    itemUrl: `https://archive.org/details/${encodeURIComponent(identifier)}`,
  };
}
function escapeLucenePhrase(value: string): string { return value.replace(/[+\-&|!(){}\[\]^"~*?:\\/]/g, "\\$&"); }
function pruneCache(now: number) {
  for (const [key, entry] of cache) if (entry.expiresAt <= now) cache.delete(key);
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

async function fetchArchiveBooks(query: string, page: number): Promise<SearchResult> {
  const params = new URLSearchParams();
  params.set("q", `mediatype:texts AND (title:"${escapeLucenePhrase(query)}" OR creator:"${escapeLucenePhrase(query)}")`);
  for (const field of ["identifier", "title", "creator", "date"]) params.append("fl[]", field);
  params.set("rows", String(PAGE_SIZE));
  params.set("page", String(page));
  params.set("output", "json");

  const response = await fetch(`${ARCHIVE_SEARCH_URL}?${params.toString()}`, {
    headers: { Accept: "application/json", "User-Agent": "BloggCurrentReading/1.2" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    const error = new Error(`Internet Archive search failed (${response.status}).`);
    Object.assign(error, { statusCode: response.status });
    throw error;
  }
  const payload = await response.json() as { response?: { docs?: ArchiveDocument[]; numFound?: number } };
  const docs = Array.isArray(payload.response?.docs) ? payload.response.docs : [];
  const results = docs.map(mapBook).filter((book): book is Book => Boolean(book));
  const total = Math.max(0, Number(payload.response?.numFound || 0));
  return { results, total, page, hasMore: page * PAGE_SIZE < total };
}

const searchArchiveBooks: RequestHandler = async (req, res, next) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (query.length < 2 || query.length > MAX_QUERY_LENGTH) {
      res.status(400).json({ message: `Enter a search query between 2 and ${MAX_QUERY_LENGTH} characters.` });
      return;
    }
    const rawPage = req.query.page === undefined ? "1" : String(req.query.page);
    const page = Number(rawPage);
    if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
      res.status(400).json({ message: `Page must be an integer between 1 and ${MAX_PAGE}.` });
      return;
    }

    const key = `${query.toLocaleLowerCase()}\u0000${page}`;
    const now = Date.now();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now) {
      res.setHeader("Cache-Control", "private, no-store");
      res.json(cached.value);
      return;
    }
    let pending = inFlight.get(key);
    if (!pending) {
      pending = fetchArchiveBooks(query, page)
        .then((value) => { pruneCache(Date.now()); cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS }); return value; })
        .finally(() => { inFlight.delete(key); });
      inFlight.set(key, pending);
    }
    const result = await pending;
    res.setHeader("Cache-Control", "private, no-store");
    res.json(result);
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      res.status(504).json({ message: "Internet Archive is taking longer than expected. Please try again shortly." });
      return;
    }
    if (error instanceof Error && "statusCode" in error) { res.status(502).json({ message: error.message }); return; }
    if (error instanceof TypeError) { res.status(502).json({ message: "Could not connect to Internet Archive. Please try again shortly." }); return; }
    next(error);
  }
};

router.get("/admin/current-reading/search", ...ADMIN_GUARD, searchArchiveBooks);
export default router;
