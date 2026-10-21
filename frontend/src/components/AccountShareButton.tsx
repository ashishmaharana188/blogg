import { useEffect, useState } from "react";
import { API_BASE_URL } from "../services/apiBase";
import "./accountShareButton.css";

const SHARE_TITLE = "Blogg · Public Dashboard";
const SHARE_DESCRIPTION =
  "Explore the public Blogg dashboard: admin presence, music, public YouTube playlists, featured links, and Samsung Health metrics.";

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

  // Read the same session endpoint used by the main AuthProvider. The health
  // summary endpoint is not an authentication API, and using it here caused the
  // snapshot button to remain hidden when that separate health request failed.
  // The snapshot write endpoint still independently enforces admin permissions.
  useEffect(() => {
    if (canManageSnapshot) return;
    let active = true;
    void fetch(`${API_BASE_URL}/api/auth/me`, {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as {
          isAdmin?: boolean;
          user?: { isAdmin?: boolean } | null;
        };
      })
      .then((session) => {
        if (
          active &&
          (session?.isAdmin === true || session?.user?.isAdmin === true)
        ) {
          setCanManageSnapshot(true);
        }
      })
      .catch(() => {
        // Public visitors should not see an admin snapshot action.
      });
    return () => {
      active = false;
    };
  }, [canManageSnapshot]);

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
    const captureUrl = new URL("/account", window.location.origin);
    captureUrl.searchParams.set("view", "public");
    captureUrl.searchParams.set("captureSnapshot", "1");
    const captureWindow = window.open(captureUrl.toString(), "_blank");
    if (!captureWindow) {
      setFeedback(
        "The snapshot tab was blocked. Allow pop-ups for this site and try again.",
      );
      return;
    }
    setFeedback(
      "A public-view tab opened. It will replace the saved snapshot when capture finishes.",
    );
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
              <div>
                <p className="account-share-eyebrow">PUBLIC DASHBOARD</p>
                <h2 id="account-share-dialog-title">Share the public view</h2>
              </div>
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

                <small>{window.location.host}</small>
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
              <button type="button" onClick={() => void copyLink()}>
                Copy link
              </button>
            </div>
            <div className="account-share-actions">
              <button
                type="button"
                className="account-share-primary"
                onClick={() => void shareLink()}
              >
                Share link…
              </button>
              <button
                type="button"
                className="account-share-secondary"
                onClick={() => void copyLink()}
              >
                Copy link
              </button>
            </div>
            {canManageSnapshot && (
              <div className="account-share-snapshot-actions">
                <button
                  type="button"
                  className="account-share-snapshot-button"
                  onClick={updateSnapshot}
                >
                  Update rich-preview snapshot
                </button>
              </div>
            )}
            {feedback && (
              <p className="account-share-feedback" role="status">
                {feedback}
              </p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
