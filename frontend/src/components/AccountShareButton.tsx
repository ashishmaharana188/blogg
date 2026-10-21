import { useState } from "react";
import "./accountShareButton.css";

const SHARE_TITLE = "Blogg · Public Dashboard";
const SHARE_DESCRIPTION =
  "Explore the public Blogg dashboard: admin presence, music, public YouTube playlists, featured links, and Samsung Health metrics.";

export default function AccountShareButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const shareUrl = `${window.location.origin}/share/account`;

  const copyLink = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(shareUrl);
      setFeedback("Share link copied.");
    } catch {
      setFeedback("Copy was blocked. Select the link field and copy it manually.");
    }
  };

  const shareLink = async () => {
    if (!navigator.share) {
      await copyLink();
      return;
    }
    try {
      await navigator.share({ title: SHARE_TITLE, text: SHARE_DESCRIPTION, url: shareUrl });
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") {
        setFeedback("Sharing was unavailable. Copy the link below instead.");
      }
    }
  };

  return (
    <>
      <button
        type="button"
        className="account-share-trigger"
        onClick={() => { setFeedback(""); setIsOpen(true); }}
        aria-label="Share the public dashboard"
        title="Share the public dashboard"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="m8.7 10.6 6.6-4.2M8.7 13.4l6.6 4.2" />
        </svg>
        <span>Share</span>
      </button>

      {isOpen && (
        <div
          className="account-share-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsOpen(false);
          }}
        >
          <section
            className="account-share-dialog typewriter-font"
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-share-dialog-title"
          >
            <header className="account-share-dialog-header">
              <div>
                <p className="account-share-eyebrow">PUBLIC DASHBOARD</p>
                <h2 id="account-share-dialog-title">Share the public view</h2>
                <p>One link to the public status, music, playlists, featured links, and health overview.</p>
              </div>
              <button type="button" className="account-share-close" onClick={() => setIsOpen(false)} aria-label="Close share dialog">×</button>
            </header>

            <article className="account-share-preview-card">
              <img src="/og-dashboard.png" alt="Blogg public dashboard preview" />
              <div className="account-share-preview-copy">
                <p className="account-share-preview-kicker">BLOGG <span>·</span> PUBLIC PROFILE</p>
                <h3>Blogg Public Dashboard</h3>
                <p>Admin status, music, public YouTube playlists, featured links, and Samsung Health.</p>
                <small>{window.location.host}</small>
              </div>
            </article>

            <label className="account-share-link-label" htmlFor="account-share-url">Share link with rich preview</label>
            <div className="account-share-url-row">
              <input id="account-share-url" readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} />
              <button type="button" onClick={() => void copyLink()}>Copy link</button>
            </div>
            <div className="account-share-actions">
              <button type="button" className="account-share-primary" onClick={() => void shareLink()}>Share link…</button>
              <button type="button" className="account-share-secondary" onClick={() => void copyLink()}>Copy link</button>
            </div>
            {feedback && <p className="account-share-feedback" role="status">{feedback}</p>}
          </section>
        </div>
      )}
    </>
  );
}
