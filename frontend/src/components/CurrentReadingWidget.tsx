import { useEffect, useState, type FormEvent } from "react";
import { API_BASE_URL } from "../services/apiBase";
import "./currentReadingWidget.css";

type ReadingBook = {
  identifier: string;
  title: string;
  author: string;
  year?: string;
  coverUrl: string;
  itemUrl: string;
  selectedAt?: string;
};

type SearchResponse = { results: ReadingBook[]; total: number };

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as T & { message?: string };
  if (!response.ok) {
    throw new Error(payload.message || `Request failed (${response.status}).`);
  }
  return payload;
}

function BookCover({ book }: { book: ReadingBook }) {
  return (
    <a className="current-reading-cover" href={book.itemUrl} target="_blank" rel="noreferrer" aria-label={`Open ${book.title} on Internet Archive`}>
      <img
        src={book.coverUrl}
        alt={`Cover of ${book.title}`}
        loading="lazy"
        onError={(event) => event.currentTarget.parentElement?.classList.add("has-no-cover")}
      />
      <span className="current-reading-cover-fallback" aria-hidden="true">BOOK</span>
    </a>
  );
}

export default function CurrentReadingWidget({ isAdmin }: { isAdmin: boolean }) {
  const [book, setBook] = useState<ReadingBook | null>(null);
  const [loadingBook, setLoadingBook] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ReadingBook[]>([]);
  const [searching, setSearching] = useState(false);
  const [savingIdentifier, setSavingIdentifier] = useState("");
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetch(`${API_BASE_URL}/api/current-reading`, {
      credentials: "omit",
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(parseResponse<{ book: ReadingBook | null }>)
      .then((payload) => { if (!cancelled) setBook(payload.book); })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load the current book.");
      })
      .finally(() => { if (!cancelled) setLoadingBook(false); });
    return () => { cancelled = true; };
  }, []);

  const searchBooks = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setError("Enter at least two characters to search.");
      return;
    }
    setSearching(true);
    setError("");
    setMessage("");
    setResults([]);
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/current-reading/search?q=${encodeURIComponent(trimmed)}`, {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const payload = await parseResponse<SearchResponse>(response);
      setResults(payload.results || []);
      if (!payload.results?.length) setMessage("No matching books found. Try a shorter title or the author's name.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Book search failed.");
    } finally {
      setSearching(false);
    }
  };

  const selectBook = async (candidate: ReadingBook) => {
    setSavingIdentifier(candidate.identifier);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/current-reading`, {
        method: "PUT",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ book: candidate }),
      });
      const payload = await parseResponse<{ book: ReadingBook }>(response);
      setBook(payload.book);
      setResults([]);
      setQuery("");
      setMessage("Current reading updated.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the selected book.");
    } finally {
      setSavingIdentifier("");
    }
  };

  const clearBook = async () => {
    setClearing(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/current-reading`, {
        method: "DELETE",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      await parseResponse<{ book: null }>(response);
      setBook(null);
      setMessage("Current reading cleared.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not clear the current book.");
    } finally {
      setClearing(false);
    }
  };

  return (
    <section className="current-reading-panel" aria-labelledby="current-reading-heading">
      <div className="current-reading-heading">
        <div>
          <p className="current-reading-eyebrow">READING</p>
          <h2 id="current-reading-heading">Currently reading</h2>
        </div>
        {isAdmin && book && (
          <button type="button" className="current-reading-clear" onClick={() => void clearBook()} disabled={clearing}>
            {clearing ? "Clearing…" : "Clear"}
          </button>
        )}
      </div>

      {loadingBook ? (
        <p className="current-reading-muted">Loading current book…</p>
      ) : book ? (
        <div className="current-reading-book">
          <BookCover book={book} />
          <div className="current-reading-book-copy">
            <a className="current-reading-title" href={book.itemUrl} target="_blank" rel="noreferrer">{book.title}</a>
            <p>{book.author}</p>
            {book.year && <span>{book.year}</span>}
            <a className="current-reading-source" href={book.itemUrl} target="_blank" rel="noreferrer">Internet Archive ↗</a>
          </div>
        </div>
      ) : (
        <p className="current-reading-muted">No current book selected.</p>
      )}

      {isAdmin && (
        <div className="current-reading-admin">
          <form className="current-reading-search-form" onSubmit={(event) => void searchBooks(event)}>
            <label htmlFor="current-reading-query">Find a book by title or author</label>
            <div className="current-reading-search-row">
              <input
                id="current-reading-query"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                maxLength={150}
                placeholder="Book title or author"
                autoComplete="off"
              />
              <button type="submit" disabled={searching || query.trim().length < 2}>
                {searching ? "Searching…" : "Search"}
              </button>
            </div>
          </form>

          {results.length > 0 && (
            <div className="current-reading-results" aria-label="Internet Archive search results">
              {results.map((result) => (
                <article className="current-reading-result" key={result.identifier}>
                  <BookCover book={result} />
                  <div className="current-reading-result-copy">
                    <strong>{result.title}</strong>
                    <span>{result.author}{result.year ? ` · ${result.year}` : ""}</span>
                    <button type="button" onClick={() => void selectBook(result)} disabled={Boolean(savingIdentifier) || clearing}>
                      {savingIdentifier === result.identifier ? "Saving…" : "Set as current reading"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {(error || message) && <p className={`current-reading-status ${error ? "is-error" : ""}`} role="status">{error || message}</p>}
    </section>
  );
}
