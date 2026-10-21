import { Router, type RequestHandler } from "express";
import { getDB } from "../db/mongoDBConnect.ts";
import { authenticationMiddleware } from "../middleware/authenticationMiddleware.ts";
import { adminMiddleware } from "../middleware/adminMiddleware.ts";

const router = Router();
const ADMIN_GUARD = [authenticationMiddleware, adminMiddleware] as const;
const CURRENT_READING_KEY = "current-reading-book";
const OTHER_READING_KEY = "other-reading-book";
const ARCHIVE_SEARCH_URL = "https://archive.org/advancedsearch.php";
const FETCH_TIMEOUT_MS = 6500;
const MAX_QUERY_LENGTH = 150;
const MAX_RESULTS = 12;

type ReadingBook = {
  identifier: string;
  title: string;
  author: string;
  year?: string;
  coverUrl: string;
  itemUrl: string;
  selectedAt: string;
};

type ArchiveSearchDocument = {
  identifier?: unknown;
  title?: unknown;
  creator?: unknown;
  date?: unknown;
};

function cleanText(value: unknown, maxLength = 240): string {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function fieldText(value: unknown, maxLength = 240): string {
  if (Array.isArray(value)) {
    return value.map((part) => cleanText(part, maxLength)).filter(Boolean).join(", ").slice(0, maxLength);
  }
  return cleanText(value, maxLength);
}

function validIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= 200 && /^[A-Za-z0-9._-]+$/.test(value);
}

function yearFrom(value: unknown): string | undefined {
  const source = fieldText(value, 80);
  const match = source.match(/\b(1[5-9]\d{2}|20\d{2}|2100)\b/);
  return match?.[1];
}

function mapArchiveBook(document: ArchiveSearchDocument): Omit<ReadingBook, "selectedAt"> | null {
  const identifier = fieldText(document.identifier, 200);
  if (!validIdentifier(identifier)) return null;
  const title = fieldText(document.title, 240) || "Untitled book";
  const author = fieldText(document.creator, 300) || "Author unknown";
  return {
    identifier,
    title,
    author,
    year: yearFrom(document.date),
    coverUrl: `https://archive.org/services/img/${encodeURIComponent(identifier)}`,
    itemUrl: `https://archive.org/details/${encodeURIComponent(identifier)}`,
  };
}

function escapeLucenePhrase(value: string): string {
  return value.replace(/[+\-&|!(){}\[\]^"~*?:\\/]/g, "\\$&");
}

async function readBook(key: string): Promise<ReadingBook | null> {
  const stored = await getDB().collection("adminIntegrationSettings").findOne({ key });
  if (!stored) return null;
  const identifier = fieldText(stored.identifier, 200);
  const title = fieldText(stored.title, 240);
  if (!validIdentifier(identifier) || !title) return null;
  const selectedAt = stored.selectedAt instanceof Date
    ? stored.selectedAt.toISOString()
    : fieldText(stored.selectedAt, 60) || new Date().toISOString();
  return {
    identifier,
    title,
    author: fieldText(stored.author, 300) || "Author unknown",
    year: yearFrom(stored.year),
    coverUrl: `https://archive.org/services/img/${encodeURIComponent(identifier)}`,
    itemUrl: `https://archive.org/details/${encodeURIComponent(identifier)}`,
    selectedAt,
  };
}

function publicBookRoute(key: string): RequestHandler {
  return async (_req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json({ book: await readBook(key) });
    } catch (error) {
      next(error);
    }
  };
}

// Public routes return only administrator-selected metadata. They never query the catalog.
router.get("/current-reading", publicBookRoute(CURRENT_READING_KEY));
router.get("/other-reading", publicBookRoute(OTHER_READING_KEY));

// Internet Archive search is on-demand and administrator-only. It returns metadata only.
const searchArchiveBooks: RequestHandler = async (req, res, next) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (query.length < 2 || query.length > MAX_QUERY_LENGTH) {
      res.status(400).json({ message: `Enter a search query between 2 and ${MAX_QUERY_LENGTH} characters.` });
      return;
    }

    const escaped = escapeLucenePhrase(query);
    const params = new URLSearchParams();
    params.set("q", `mediatype:(texts) AND (title:\"${escaped}\" OR creator:\"${escaped}\")`);
    for (const field of ["identifier", "title", "creator", "date"]) params.append("fl[]", field);
    params.set("rows", String(MAX_RESULTS));
    params.set("page", "1");
    params.set("output", "json");
    params.append("sort[]", "downloads desc");

    const response = await fetch(`${ARCHIVE_SEARCH_URL}?${params.toString()}`, {
      headers: { Accept: "application/json", "User-Agent": "BloggCurrentReading/1.0" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      res.status(502).json({ message: `Internet Archive search failed (${response.status}). Try again later.` });
      return;
    }

    const payload = await response.json() as { response?: { docs?: ArchiveSearchDocument[]; numFound?: number } };
    const documents = Array.isArray(payload.response?.docs) ? payload.response.docs : [];
    const results = documents
      .map(mapArchiveBook)
      .filter((book): book is Omit<ReadingBook, "selectedAt"> => Boolean(book));
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ results, total: Number(payload.response?.numFound || 0) });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      res.status(504).json({ message: "Internet Archive search timed out. Try again." });
      return;
    }
    next(error);
  }
};
router.get("/admin/current-reading/search", ...ADMIN_GUARD, searchArchiveBooks);

function saveBookRoute(key: string): RequestHandler {
  return async (req, res, next) => {
    try {
      const supplied = req.body?.book as Partial<ReadingBook> | undefined;
      const identifier = fieldText(supplied?.identifier, 200);
      const title = fieldText(supplied?.title, 240);
      const author = fieldText(supplied?.author, 300) || "Author unknown";
      const year = yearFrom(supplied?.year);
      if (!validIdentifier(identifier) || !title) {
        res.status(400).json({ message: "Choose a valid Internet Archive book result." });
        return;
      }

      const book: ReadingBook = {
        identifier,
        title,
        author,
        year,
        coverUrl: `https://archive.org/services/img/${encodeURIComponent(identifier)}`,
        itemUrl: `https://archive.org/details/${encodeURIComponent(identifier)}`,
        selectedAt: new Date().toISOString(),
      };
      await getDB().collection("adminIntegrationSettings").updateOne(
        { key },
        { $set: { key, ...book, updatedAt: new Date() } },
        { upsert: true },
      );
      res.setHeader("Cache-Control", "no-store");
      res.json({ book });
    } catch (error) {
      next(error);
    }
  };
}

function deleteBookRoute(key: string): RequestHandler {
  return async (_req, res, next) => {
    try {
      await getDB().collection("adminIntegrationSettings").deleteOne({ key });
      res.setHeader("Cache-Control", "no-store");
      res.json({ book: null });
    } catch (error) {
      next(error);
    }
  };
}

router.put("/admin/current-reading", ...ADMIN_GUARD, saveBookRoute(CURRENT_READING_KEY));
router.delete("/admin/current-reading", ...ADMIN_GUARD, deleteBookRoute(CURRENT_READING_KEY));
router.put("/admin/other-reading", ...ADMIN_GUARD, saveBookRoute(OTHER_READING_KEY));
router.delete("/admin/other-reading", ...ADMIN_GUARD, deleteBookRoute(OTHER_READING_KEY));

export default router;
