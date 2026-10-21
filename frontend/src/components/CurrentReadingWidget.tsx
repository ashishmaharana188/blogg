import { useEffect, useState, type FormEvent } from "react";
import { API_BASE_URL } from "../services/apiBase";
import AssetStateBox from "./AssetStateBox";
import { reportUiFailure } from "../utils/uiDiagnostics";
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
type ReadingTarget = "current" | "other";
type WidgetVariant = "account" | "feed";

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as T & { message?: string };
  if (!response.ok) throw new Error(payload.message || `Request failed (${response.status}).`);
  return payload;
}

function BookCover({ book }: { book: ReadingBook }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [book.identifier, book.coverUrl]);

  return (
    <a className={`current-reading-cover${failed ? " has-no-cover" : ""}`} href={book.itemUrl} target="_blank" rel="noreferrer" aria-label={`Open ${book.title} on Internet Archive`}>
      {!failed && <img src={book.coverUrl} alt={`Cover of ${book.title}`} loading="lazy" onError={() => setFailed(true)} />}
      <span className="current-reading-cover-fallback" aria-hidden="true">BOOK</span>
    </a>
  );
}

function BookDetails({ book }: { book: ReadingBook }) {
  return (
    <div className="current-reading-book">
      <BookCover book={book} />
      <div className="current-reading-book-copy">
        <a className="current-reading-title" href={book.itemUrl} target="_blank" rel="noreferrer">{book.title}</a>
        <p>{book.author}</p>
        {book.year && <span>{book.year}</span>}
        <a className="current-reading-source" href={book.itemUrl} target="_blank" rel="noreferrer">Internet Archive ↗</a>
      </div>
    </div>
  );
}

function FeedReadingWidget({ book }: { book: ReadingBook | null }) {
  const [coverFailed, setCoverFailed] = useState(false);
  useEffect(() => setCoverFailed(false), [book?.identifier, book?.coverUrl]);
  const title = book?.title || "NO CURRENT READING";
  const artwork = book?.coverUrl && !coverFailed
    ? <img className="blog-feed-now-playing-artwork" src={book.coverUrl} alt="" loading="lazy" onError={() => setCoverFailed(true)} />
    : <span className="blog-feed-now-playing-placeholder" aria-hidden="true">▤</span>;

  return (
    <aside className="blog-feed-now-playing-teaser blog-feed-current-reading-teaser" aria-label={`Current reading: ${title}`}>
      {book ? (
        <a className="blog-feed-now-playing-artwork-frame" href={book.itemUrl} target="_blank" rel="noreferrer" aria-label={`Open ${book.title} on Internet Archive`}>
          {artwork}
        </a>
      ) : (
        <div className="blog-feed-now-playing-artwork-frame">{artwork}</div>
      )}
      <div className="blog-feed-now-playing-marquee" aria-hidden="true">
        <div className="blog-feed-now-playing-marquee-track">
          <span className="blog-feed-now-playing-marquee-run">{title}</span>
          <span className="blog-feed-now-playing-marquee-run">{title}</span>
        </div>
      </div>
      <span className="blog-feed-now-playing-sr-only">{title}</span>
    </aside>
  );
}

export default function CurrentReadingWidget({
  isAdmin,
  variant = "account",
}: {
  isAdmin: boolean;
  variant?: WidgetVariant;
}) {
  const idPrefix = "account-current-reading";
  const [book, setBook] = useState<ReadingBook | null>(null);
  const [otherBook, setOtherBook] = useState<ReadingBook | null>(null);
  const [loadingBook, setLoadingBook] = useState(true);
  const [loadingOtherBook, setLoadingOtherBook] = useState(variant === "account");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ReadingBook[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState("");
  const [clearing, setClearing] = useState<ReadingTarget | "">("");
  const [error, setError] = useState("");
  const [bookLoadFailed, setBookLoadFailed] = useState(false);
  const [otherBookLoadFailed, setOtherBookLoadFailed] = useState(false);
  const [requestFailed, setRequestFailed] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetch(`${API_BASE_URL}/api/current-reading`, {
      credentials: "omit", cache: "no-store", headers: { Accept: "application/json" },
    })
      .then(parseResponse<{ book: ReadingBook | null }>)
      .then((payload) => { if (!cancelled) setBook(payload.book); })
      .catch((reason: unknown) => {
        reportUiFailure("CurrentReadingWidget.loadCurrentBook", reason);
        if (!cancelled) setBookLoadFailed(true);
      })
      .finally(() => { if (!cancelled) setLoadingBook(false); });

    if (variant === "account") {
      void fetch(`${API_BASE_URL}/api/other-reading`, {
        credentials: "omit", cache: "no-store", headers: { Accept: "application/json" },
      })
        .then(parseResponse<{ book: ReadingBook | null }>)
        .then((payload) => { if (!cancelled) setOtherBook(payload.book); })
        .catch((reason: unknown) => {
          reportUiFailure("CurrentReadingWidget.loadOtherBook", reason);
          if (!cancelled) setOtherBookLoadFailed(true);
        })
        .finally(() => { if (!cancelled) setLoadingOtherBook(false); });
    }
    return () => { cancelled = true; };
  }, [variant]);

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
    setRequestFailed(false);
    setResults([]);
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/current-reading/search?q=${encodeURIComponent(trimmed)}`, {
        credentials: "include", cache: "no-store", headers: { Accept: "application/json" },
      });
      const payload = await parseResponse<SearchResponse>(response);
      setResults(payload.results || []);
      if (!payload.results?.length) setMessage("No matching books found. Try a shorter title or the author's name.");
    } catch (reason) {
      reportUiFailure("CurrentReadingWidget.searchBooks", reason);
      setRequestFailed(true);
    } finally {
      setSearching(false);
    }
  };

  const selectBook = async (candidate: ReadingBook, target: ReadingTarget) => {
    setSaving(`${target}:${candidate.identifier}`);
    setError("");
    setMessage("");
    setRequestFailed(false);
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/${target}-reading`, {
        method: "PUT", credentials: "include", cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ book: candidate }),
      });
      const payload = await parseResponse<{ book: ReadingBook }>(response);
      if (target === "current") setBook(payload.book);
      else setOtherBook(payload.book);
      setResults([]);
      setQuery("");
      setMessage(target === "current" ? "Current reading updated." : "Other reading updated.");
    } catch (reason) {
      reportUiFailure("CurrentReadingWidget.saveBook", reason);
      setRequestFailed(true);
    } finally {
      setSaving("");
    }
  };

  const clearBook = async (target: ReadingTarget) => {
    setClearing(target);
    setError("");
    setMessage("");
    setRequestFailed(false);
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/${target}-reading`, {
        method: "DELETE", credentials: "include", cache: "no-store", headers: { Accept: "application/json" },
      });
      await parseResponse<{ book: null }>(response);
      if (target === "current") setBook(null);
      else setOtherBook(null);
      setMessage(target === "current" ? "Current reading cleared." : "Other reading cleared.");
    } catch (reason) {
      reportUiFailure("CurrentReadingWidget.clearBook", reason);
      setRequestFailed(true);
    } finally {
      setClearing("");
    }
  };

  if (variant === "feed") {
    if (bookLoadFailed) return <AssetStateBox status="error" compact onRetry={() => window.location.reload()} />;
    if (loadingBook) return <AssetStateBox status="loading" compact />;
    return <FeedReadingWidget book={book} />;
  }

  return (
    <section className="current-reading-panel" aria-labelledby={`${idPrefix}-heading`}>
      <div className="current-reading-heading">
        <div>
          <p className="current-reading-eyebrow">READING</p>
          <h2 id={`${idPrefix}-heading`}>Currently reading</h2>
        </div>
        {isAdmin && book && (
          <button type="button" className="current-reading-clear" onClick={() => void clearBook("current")} disabled={Boolean(clearing)}>
            {"Clear"}
          </button>
        )}
      </div>

      {bookLoadFailed ? <AssetStateBox status="error" compact onRetry={() => window.location.reload()} />
        : loadingBook ? <AssetStateBox status="loading" compact />
          : book ? <BookDetails book={book} />
            : <p className="current-reading-muted">No current book selected.</p>}

      <section className="current-reading-other-section" aria-labelledby={`${idPrefix}-other-heading`}>
        <div className="current-reading-heading current-reading-other-heading">
          <h3 id={`${idPrefix}-other-heading`}>Other reading</h3>
          {isAdmin && otherBook && (
            <button type="button" className="current-reading-clear" onClick={() => void clearBook("other")} disabled={Boolean(clearing)}>
              {"Clear"}
            </button>
          )}
        </div>
        {otherBookLoadFailed ? <AssetStateBox status="error" compact onRetry={() => window.location.reload()} />
          : loadingOtherBook ? <AssetStateBox status="loading" compact />
            : otherBook ? <BookDetails book={otherBook} />
              : <p className="current-reading-muted">No other reading selected.</p>}
      </section>

      {isAdmin && (
        <div className="current-reading-admin">
          <form className="current-reading-search-form" onSubmit={(event) => void searchBooks(event)}>
            <label htmlFor={`${idPrefix}-admin-query`}>Find a book by title or author</label>
            <div className="current-reading-search-row">
              <input
                id={`${idPrefix}-admin-query`} type="search" value={query}
                onChange={(event) => setQuery(event.target.value)} maxLength={150}
                placeholder="Book title or author" autoComplete="off"
              />
              <button type="submit" disabled={searching || query.trim().length < 2}>
                {"Search"}
              </button>
            </div>
          </form>

          {(searching || Boolean(saving) || Boolean(clearing)) && <AssetStateBox status="loading" compact />}
          {requestFailed && <AssetStateBox status="error" compact onRetry={() => window.location.reload()} />}
          {results.length > 0 && (
            <div className="current-reading-results" aria-label="Internet Archive search results">
              {results.map((result) => (
                <article className="current-reading-result" key={result.identifier}>
                  <BookCover book={result} />
                  <div className="current-reading-result-copy">
                    <strong>{result.title}</strong>
                    <span>{result.author}{result.year ? ` · ${result.year}` : ""}</span>
                    <div className="current-reading-result-actions">
                      <button type="button" onClick={() => void selectBook(result, "current")} disabled={Boolean(saving) || Boolean(clearing)}>
                        {"Set as current reading"}
                      </button>
                      <button type="button" onClick={() => void selectBook(result, "other")} disabled={Boolean(saving) || Boolean(clearing)}>
                        {"Set as other reading"}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <p className="current-reading-status is-error" role="alert">{error}</p>}
      {message && <p className="current-reading-status" role="status">{message}</p>}
    </section>
  );
}
