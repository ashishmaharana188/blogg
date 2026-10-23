import { useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "../services/apiBase";
import "./accountShareButton.css";

const SHARE_TITLE = "Blogg · Public Dashboard";
const SHARE_DESCRIPTION =
  "Explore the public Blogg dashboard: admin presence, music, public YouTube playlists, featured links, and Samsung Health metrics.";
const SNAPSHOT_PROGRESS_MESSAGES = [
  "Preparing the public dashboard snapshot…",
  "Capturing the 1200 × 630 preview image…",
  "Saving the new preview and replacing the previous snapshot…",
];

export default function AccountShareButton({
  canUpdateSnapshot = false,
}: {
  canUpdateSnapshot?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [snapshotVersion, setSnapshotVersion] = useState(() =>
    String(Date.now()),
  );
  const [canManageSnapshot, setCanManageSnapshot] = useState(canUpdateSnapshot);
  const [snapshotCaptureUrl, setSnapshotCaptureUrl] = useState<string | null>(
    null,
  );
  const snapshotCaptureFrameRef = useRef<HTMLIFrameElement | null>(null);
  const shareUrl = `${window.location.origin}/share/account`;
  // The image endpoint belongs to the backend, not Vite. Use the configured API
  // origin so the preview works in localhost development as well as deployment.
  const snapshotImageUrl = `${API_BASE_URL}/share/account/og-image.png?v=${snapshotVersion}`;
  const fallbackImageUrl = `${window.location.origin}/og-dashboard.png`;
  const [previewImageUrl, setPreviewImageUrl] = useState(snapshotImageUrl);

  useEffect(() => {
    // Try the newly versioned saved snapshot after an update. If the API route is
    // unavailable, fall back to the bundled poster rather than showing broken alt text.
    setPreviewImageUrl(snapshotImageUrl);
  }, [snapshotImageUrl]);

  useEffect(() => {
    setCanManageSnapshot(canUpdateSnapshot);
  }, [canUpdateSnapshot]);

  // Use a hidden same-origin iframe to render the public view at the fixed landscape
  // dimensions needed for social previews. Poll the capture status in the frame so
  // this page can update the preview without opening a new tab or navigating away.
  useEffect(() => {
    if (!snapshotCaptureUrl) return;

    let attempts = 0;
    const poll = window.setInterval(() => {
      attempts += 1;
      let statusElement: HTMLElement | null = null;
      try {
        statusElement =
          snapshotCaptureFrameRef.current?.contentDocument?.getElementById(
            "account-share-snapshot-status",
          ) ?? null;
      } catch {
        // A navigation away from the same-origin account page is reported as a timeout below.
      }

      const message = statusElement?.textContent?.trim() || "";
      if (message.startsWith("Snapshot saved.")) {
        const version = String(Date.now());
        setSnapshotVersion(version);
        setPreviewImageUrl(
          `${API_BASE_URL}/share/account/og-image.png?v=${version}`,
        );

        setSnapshotCaptureUrl(null);
        return;
      }

      // The capture routine uses these three messages while it is working. Any
      // other non-empty message is its final error text and should be shown here.
      const isProgress = SNAPSHOT_PROGRESS_MESSAGES.some(
        (progress) => message === progress,
      );
      if (message && !isProgress) {
        setFeedback(message);
        setSnapshotCaptureUrl(null);
        return;
      }

      if (attempts >= 120) {
        setFeedback(
          "Snapshot capture timed out. No new preview was confirmed; check the account page and try again.",
        );
        setSnapshotCaptureUrl(null);
      }
    }, 500);

    return () => window.clearInterval(poll);
  }, [snapshotCaptureUrl]);

  // Keep compatibility with an already-open capture tab from an older version.
  useEffect(() => {
    const onSnapshotUpdated = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "blogg-account-snapshot-updated") return;
      const version = String(event.data.version || Date.now());
      setSnapshotVersion(version);
      setPreviewImageUrl(
        `${API_BASE_URL}/share/account/og-image.png?v=${version}`,
      );
      setFeedback("Snapshot saved. The rich-preview image has been refreshed.");
    };
    window.addEventListener("message", onSnapshotUpdated);
    return () => window.removeEventListener("message", onSnapshotUpdated);
  }, []);

  const updateSnapshot = () => {
    if (snapshotCaptureUrl) return;
    const captureUrl = new URL("/account", window.location.origin);
    captureUrl.searchParams.set("view", "public");
    captureUrl.searchParams.set("captureSnapshot", "1");
    setSnapshotCaptureUrl(captureUrl.toString());
  };

  const copyLink = async () => {
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(shareUrl);
      setFeedback("Share link copied.");
    } catch {
      setFeedback(
        "Copy was blocked. Select the link field and copy it manually.",
      );
    }
  };

  const shareLink = async () => {
    if (!navigator.share) {
      await copyLink();
      return;
    }
    try {
      await navigator.share({
        title: SHARE_TITLE,
        text: SHARE_DESCRIPTION,
        url: shareUrl,
      });
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
        onClick={() => {
          setFeedback("");
          setIsOpen(true);
        }}
        aria-label="Share the public dashboard"
        title="Share the public dashboard"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
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
              <button
                type="button"
                className="account-share-close"
                onClick={() => setIsOpen(false)}
                aria-label="Close share dialog"
              >
                ×
              </button>
            </header>

            <article className="account-share-preview-card">
              <img
                src={previewImageUrl}
                alt="Blogg public dashboard preview"
                onError={() => {
                  if (previewImageUrl !== fallbackImageUrl)
                    setPreviewImageUrl(fallbackImageUrl);
                }}
              />
              <div className="account-share-preview-copy">
                <p className="account-share-preview-kicker">
                  BLOGG <span>·</span> PUBLIC PROFILE
                </p>
              </div>
            </article>

            <label
              className="account-share-link-label"
              htmlFor="account-share-url"
            ></label>
            <div className="account-share-url-row">
              <input
                id="account-share-url"
                readOnly
                value={shareUrl}
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                type="button"
                className="account-share-primary"
                onClick={() => void shareLink()}
              >
                Share link
              </button>
            </div>
            <div className="account-share-actions">
              <button
                type="button"
                className="account-share-primary"
                onClick={() => void shareLink()}
              >
                Share link
              </button>
            </div>
            {canManageSnapshot && (
              <div className="account-share-snapshot-actions">
                <button
                  type="button"
                  className="account-share-snapshot-button"
                  onClick={updateSnapshot}
                  disabled={Boolean(snapshotCaptureUrl)}
                >
                  {snapshotCaptureUrl
                    ? "Updating snapshot…"
                    : "Update rich-preview snapshot"}
                </button>
              </div>
            )}
            {feedback && (
              <p
                className="account-share-feedback typewriter-font"
                role="status"
              >
                {feedback}
              </p>
            )}
          </section>
        </div>
      )}

      {snapshotCaptureUrl && (
        <iframe
          ref={snapshotCaptureFrameRef}
          key={snapshotCaptureUrl}
          src={snapshotCaptureUrl}
          title="Background dashboard snapshot capture"
          aria-hidden="true"
          tabIndex={-1}
          loading="eager"
          style={{
            position: "fixed",
            left: "-1300px",
            top: 0,
            width: "1200px",
            height: "630px",
            border: 0,
            opacity: 0,
            pointerEvents: "none",
            zIndex: -1,
          }}
        />
      )}
    </>
  );
}
