import "./shareBlogg.css";
import { useState } from "react";
import type { BloggItem } from "../../../types/pageTypes";

type ShareBloggButtonProps = {
  blogg: BloggItem;
  stackName?: string;
  groupName?: string;
};

const absolutePath = (path: string) => new URL(path, window.location.origin).toString();

function buildEmbedCode(embedUrl: string, title: string) {
  const safeTitle = title
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
  return `<iframe src="${embedUrl}" title="${safeTitle}" loading="lazy" width="640" height="420" style="max-width:100%;border:1px solid #d8dce2;border-radius:16px;overflow:hidden" allow="clipboard-write"></iframe>`;
}

export default function ShareBloggButton({
  blogg,
  stackName = "Unsorted stack",
  groupName = "Others",
}: ShareBloggButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const noteId = blogg.blogg_id || blogg._id;
  // Vercel proxies /share/:id to the backend. The public URL remains on the
  // frontend origin, while the backend returns note-specific Open Graph HTML.
  const directUrl = absolutePath(`/share/${encodeURIComponent(noteId)}`);
  const embedUrl = absolutePath(`/embed/${encodeURIComponent(noteId)}`);
  const embedCode = buildEmbedCode(embedUrl, blogg.title || "Shared note");

  const copyText = async (value: string, label: string) => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(value);
      setFeedback(`${label} copied`);
    } catch {
      setFeedback("Copy was blocked by this browser. Select and copy the field below.");
    }
  };

  const handleShare = async () => {
    if (!navigator.share) {
      await copyText(directUrl, "Share link");
      return;
    }
    try {
      await navigator.share({
        title: blogg.title || "Shared note",
        text: blogg.subtitle || `Read ${blogg.title || "this note"}`,
        url: directUrl,
      });
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") {
        setFeedback("Use the share link below to share this note.");
      }
    }
  };

  return (
    <>
      <button
        className="blogg-share-trigger"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setFeedback("");
          setIsOpen(true);
        }}
        aria-label={`Share ${blogg.title || "note"}`}
        title="Share note"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="m8.7 10.6 6.6-4.2M8.7 13.4l6.6 4.2" />
        </svg>
        <span>Share</span>
      </button>

      {isOpen && (
        <div
          className="blogg-share-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsOpen(false);
          }}
        >
          <section
            aria-labelledby="blogg-share-title"
            aria-modal="true"
            className="blogg-share-dialog typewriter-font"
            role="dialog"
          >
            <div className="blogg-share-dialog-heading">
              <div>
                <p className="blogg-share-eyebrow">SHARE NOTE</p>
                <h2 id="blogg-share-title">{blogg.title || "Untitled note"}</h2>
              </div>
              <button type="button" className="blogg-share-close" onClick={() => setIsOpen(false)} aria-label="Close share dialog">×</button>
            </div>

            <div className="blogg-share-preview" aria-label="Local share preview">
              <div className="blogg-share-preview-topline">
                <span>{blogg.author?.trim() || "Unknown author"}</span>
                <span>{stackName} › {groupName}</span>
              </div>
              <strong>{blogg.title || "Untitled note"}</strong>
              <p>{blogg.subtitle?.trim() || "Open the note to read its content."}</p>
              {!!blogg.tags?.length && (
                <div className="blogg-share-preview-tags">
                  {blogg.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
                </div>
              )}
              <small>blogg · note preview</small>
            </div>

            <button className="blogg-share-copy-code" type="button" onClick={() => void handleShare()}>Share link…</button>

            <label className="blogg-share-label" htmlFor={`share-url-${noteId}`}>Share link with rich preview</label>
            <div className="blogg-share-copy-row">
              <input id={`share-url-${noteId}`} readOnly value={directUrl} onFocus={(event) => event.currentTarget.select()} />
              <button type="button" onClick={() => void copyText(directUrl, "Share link")}>Copy link</button>
            </div>

            <label className="blogg-share-label" htmlFor={`embed-url-${noteId}`}>Embed thumbnail link</label>
            <div className="blogg-share-copy-row">
              <input id={`embed-url-${noteId}`} readOnly value={embedUrl} onFocus={(event) => event.currentTarget.select()} />
              <button type="button" onClick={() => void copyText(embedUrl, "Embed link")}>Copy</button>
            </div>

            <label className="blogg-share-label" htmlFor={`embed-code-${noteId}`}>Embed code</label>
            <textarea id={`embed-code-${noteId}`} readOnly value={embedCode} rows={3} onFocus={(event) => event.currentTarget.select()} />
            <button className="blogg-share-copy-code" type="button" onClick={() => void copyText(embedCode, "Embed code")}>Copy embed code</button>
            {feedback && <p className="blogg-share-feedback" role="status">{feedback}</p>}
          </section>
        </div>
      )}
    </>
  );
}
