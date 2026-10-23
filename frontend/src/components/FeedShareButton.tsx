import { useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "../services/apiBase";
import "./accountShareButton.css";
import "./feedShareButton.css";

const SHARE_TITLE = "Blogg Feed";
const SHARE_DESCRIPTION =
  "Recent notes and public updates from Blogg.";
const SNAPSHOT_PROGRESS_MESSAGES = [
  "Preparing the feed snapshot…",
  "Capturing the rendered feed as a 1200 × 630 image…",
  "Saving the new feed preview and replacing the previous snapshot…",
];

export default function FeedShareButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [snapshotVersion, setSnapshotVersion] = useState("initial");
  const [snapshotCaptureUrl, setSnapshotCaptureUrl] = useState<string | null>(null);
  const [previewAvailable, setPreviewAvailable] = useState(true);
  const snapshotCaptureFrameRef = useRef<HTMLIFrameElement | null>(null);
  const shareUrl = `${window.location.origin}/feed`;
  const previewImageUrl = `${API_BASE_URL}/share/feed/og-image.png?v=${snapshotVersion}`;

  useEffect(() => {
    setPreviewAvailable(true);
  }, [snapshotVersion]);

  useEffect(() => {
    if (!snapshotCaptureUrl) return;

    let attempts = 0;
    const poll = window.setInterval(() => {
      attempts += 1;
      let statusElement: HTMLElement | null = null;
      try {
        statusElement =
          snapshotCaptureFrameRef.current?.contentDocument?.getElementById(
            "feed-share-snapshot-status",
          ) ?? null;
      } catch {
        // If iframe navigation leaves this origin, timeout below reports failure.
      }

      const message = statusElement?.textContent?.trim() || "";
      if (message.startsWith("Snapshot saved.")) {
        setSnapshotVersion(String(Date.now()));
        setPreviewAvailable(true);
        setFeedback("Snapshot saved. The preview now uses the real rendered feed.");
        setSnapshotCaptureUrl(null);
        return;
      }

      const isProgress = SNAPSHOT_PROGRESS_MESSAGES.some((progress) => progress === message);
      if (message && !isProgress) {
        setFeedback(message);
        setSnapshotCaptureUrl(null);
        return;
      }

      if (attempts >= 120) {
        setFeedback("Feed snapshot capture timed out. No new preview was confirmed.");
        setSnapshotCaptureUrl(null);
      }
    }, 500);

    return () => window.clearInterval(poll);
  }, [snapshotCaptureUrl]);

  const updateSnapshot = () => {
    if (snapshotCaptureUrl) return;
    setFeedback("");
    const captureUrl = new URL("/feed", window.location.origin);
    captureUrl.searchParams.set("captureFeedSnapshot", "1");
    setSnapshotCaptureUrl(captureUrl.toString());
  };

  const copyLink = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(shareUrl);
      setFeedback("Feed link copied.");
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
        className="account-share-trigger feed-share-trigger"
        onClick={() => {
          setFeedback("");
          setIsOpen(true);
        }}
        aria-label="Share the Blogg feed"
        title="Share the Blogg feed"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="m8.7 10.6 6.6-4.2M8.7 13.4l6.6 4.2" />
        </svg>
        <span>Share Feed</span>
      </button>

      {isOpen && (
        <div
          className="account-share-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsOpen(false);
          }}
        >
          <section className="account-share-dialog typewriter-font" role="dialog" aria-modal="true" aria-labelledby="feed-share-dialog-title">
            <header className="account-share-dialog-header">
              <h2 id="feed-share-dialog-title" className="feed-share-dialog-title">Share Blogg Feed</h2>
              <button type="button" className="account-share-close" onClick={() => setIsOpen(false)} aria-label="Close share dialog">×</button>
            </header>

            <article className="account-share-preview-card">
              {previewAvailable ? (
                <img
                  src={previewImageUrl}
                  alt="Captured preview of the Blogg feed"
                  onError={() => setPreviewAvailable(false)}
                />
              ) : (
                <div className="feed-share-no-snapshot">
                  <strong>No feed snapshot saved yet</strong>
                  <span>Capture the rendered feed to create its rich preview.</span>
                </div>
              )}
              <div className="account-share-preview-copy">
                <p className="account-share-preview-kicker">BLOGG <span>·</span> FEED</p>
              </div>
            </article>

            <div className="account-share-url-row">
              <input id="feed-share-url" aria-label="Feed share link" readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} />
              <button type="button" onClick={() => void copyLink()}>Copy link</button>
            </div>
            <div className="account-share-actions">
              <button type="button" className="account-share-primary" onClick={() => void shareLink()}>Share link…</button>
              <button type="button" className="account-share-secondary" onClick={() => void copyLink()}>Copy link</button>
            </div>
            <div className="account-share-snapshot-actions">
              <button
                type="button"
                className="account-share-snapshot-button"
                onClick={updateSnapshot}
                disabled={Boolean(snapshotCaptureUrl)}
              >
                {snapshotCaptureUrl ? "Capturing feed…" : "Update rich-preview snapshot"}
              </button>
            </div>
            {feedback && <p className="account-share-feedback typewriter-font" role="status">{feedback}</p>}
          </section>
        </div>
      )}

      {snapshotCaptureUrl && (
        <iframe
          ref={snapshotCaptureFrameRef}
          key={snapshotCaptureUrl}
          src={snapshotCaptureUrl}
          title="Background feed snapshot capture"
          aria-hidden="true"
          tabIndex={-1}
          loading="eager"
          style={{ position: "fixed", left: "-1300px", top: 0, width: "1200px", height: "630px", border: 0, opacity: 0, pointerEvents: "none", zIndex: -1 }}
        />
      )}
    </>
  );
}
