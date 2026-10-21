import { Router } from "express";
import { getDB } from "../db/mongoDBConnect.ts";
import { authenticationMiddleware } from "../middleware/authenticationMiddleware.ts";
import { adminMiddleware } from "../middleware/adminMiddleware.ts";

const router = Router();
const ADMIN_GUARD = [authenticationMiddleware, adminMiddleware] as const;
const CURRENT_READING_KEY = "current-reading-book";
const ARCHIVE_SEARCH_URL = "https://archive.org/advancedsearch.php";
const FETCH_TIMEOUT_MS = 6500;
const MAX_QUERY_LENGTH = 150;
const MAX_RESULTS = 12;

type CurrentReadingBook = {
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

function mapArchiveBook(document: ArchiveSearchDocument): Omit<CurrentReadingBook, "selectedAt"> | null {
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

async function readCurrentBook(): Promise<CurrentReadingBook | null> {
  const stored = await getDB().collection("adminIntegrationSettings").findOne({ key: CURRENT_READING_KEY });
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

// Public view reads only the one selected book. It never searches Internet Archive.
router.get("/current-reading", async (_req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    return res.json({ book: await readCurrentBook() });
  } catch (error) {
    return next(error);
  }
});

// Search is performed only after an authenticated administrator submits a query.
router.get("/admin/current-reading/search", ...ADMIN_GUARD, async (req, res, next) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (query.length < 2 || query.length > MAX_QUERY_LENGTH) {
      return res.status(400).json({ message: `Enter a search query between 2 and ${MAX_QUERY_LENGTH} characters.` });
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
      headers: {
        Accept: "application/json",
        "User-Agent": "BloggCurrentReading/1.0",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return res.status(502).json({ message: `Internet Archive search failed (${response.status}). Try again later.` });
    }

    const payload = await response.json() as {
      response?: { docs?: ArchiveSearchDocument[]; numFound?: number };
    };
    const documents = Array.isArray(payload.response?.docs) ? payload.response!.docs! : [];
    const results = documents
      .map(mapArchiveBook)
      .filter((book): book is Omit<CurrentReadingBook, "selectedAt"> => Boolean(book));

    res.setHeader("Cache-Control", "private, no-store");
    return res.json({ results, total: Number(payload.response?.numFound || 0) });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return res.status(504).json({ message: "Internet Archive search timed out. Try again." });
    }
    return next(error);
  }
});

router.put("/admin/current-reading", ...ADMIN_GUARD, async (req, res, next) => {
  try {
    const supplied = req.body?.book as Partial<CurrentReadingBook> | undefined;
    const identifier = fieldText(supplied?.identifier, 200);
    const title = fieldText(supplied?.title, 240);
    const author = fieldText(supplied?.author, 300) || "Author unknown";
    const year = yearFrom(supplied?.year);

    if (!validIdentifier(identifier) || !title) {
      return res.status(400).json({ message: "Choose a valid Internet Archive book result." });
    }

    const book: CurrentReadingBook = {
      identifier,
      title,
      author,
      year,
      coverUrl: `https://archive.org/services/img/${encodeURIComponent(identifier)}`,
      itemUrl: `https://archive.org/details/${encodeURIComponent(identifier)}`,
      selectedAt: new Date().toISOString(),
    };
    await getDB().collection("adminIntegrationSettings").updateOne(
      { key: CURRENT_READING_KEY },
      { $set: { key: CURRENT_READING_KEY, ...book, updatedAt: new Date() } },
      { upsert: true },
    );
    res.setHeader("Cache-Control", "no-store");
    return res.json({ book });
  } catch (error) {
    return next(error);
  }
});

router.delete("/admin/current-reading", ...ADMIN_GUARD, async (_req, res, next) => {
  try {
    await getDB().collection("adminIntegrationSettings").deleteOne({ key: CURRENT_READING_KEY });
    res.setHeader("Cache-Control", "no-store");
    return res.json({ book: null });
  } catch (error) {
    return next(error);
  }
});

export default router;
