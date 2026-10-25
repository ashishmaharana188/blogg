import { useEffect, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../context/authContext";
import { API_BASE_URL } from "../services/apiBase";
import "./feedBackgroundAdminPanel.css";

type BackgroundSetting = { url?: string | null; updatedAt?: string | null };
const FEED_BACKGROUND_PREFERENCE_KEY = "blogg-feed-background-enabled";

function readBackgroundPreference(): boolean {
  try {
    const storedPreference = window.localStorage.getItem(
      FEED_BACKGROUND_PREFERENCE_KEY,
    );
    return storedPreference === null ? true : storedPreference === "true";
  } catch {
    return true;
  }
}

export default function FeedBackgroundAdminPanel() {
  const { isAdmin } = useAuth();
  const [mountNode, setMountNode] = useState<HTMLElement | null>(null);
  const [backgroundEnabled, setBackgroundEnabled] = useState<boolean>(
    readBackgroundPreference,
  );
  const [currentUrl, setCurrentUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Attach directly below the Activity selector inside the Admin Status card.
  // This component is rendered beside AccountPage, so the portal keeps the
  // upload UI inside the status card without replacing the large account page.
  useEffect(() => {
    if (!isAdmin) {
      setMountNode(null);
      return;
    }

    let mount: HTMLElement | null = null;
    let observer: MutationObserver | null = null;
    let disposed = false;

    const tryAttach = () => {
      if (disposed || mount) return Boolean(mount);
      const statusCard = document.querySelector<HTMLElement>(
        ".account-dashboard-status",
      );
      if (!statusCard) return false;

      const activitySelect =
        statusCard.querySelector<HTMLSelectElement>("#admin-activity");
      mount = document.createElement("div");
      mount.className = "feed-background-admin-mount";
      if (activitySelect?.parentElement === statusCard) {
        activitySelect.insertAdjacentElement("afterend", mount);
      } else {
        statusCard.appendChild(mount);
      }
      setMountNode(mount);
      observer?.disconnect();
      return true;
    };

    if (!tryAttach()) {
      observer = new MutationObserver(() => {
        tryAttach();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      disposed = true;
      observer?.disconnect();
      if (mount) mount.remove();
      setMountNode((current) => (current === mount ? null : current));
    };
  }, [isAdmin]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        FEED_BACKGROUND_PREFERENCE_KEY,
        String(backgroundEnabled),
      );
    } catch {
      // The preference remains usable for this session if browser storage is unavailable.
    }
  }, [backgroundEnabled]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`${API_BASE_URL}/api/showcase/feed-background`, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            `Could not load feed background (${response.status}).`,
          );
        return response.json() as Promise<BackgroundSetting>;
      })
      .then((setting) => {
        if (!cancelled) setCurrentUrl(setting.url || "/feed-background.jpg");
      })
      .catch((reason) => {
        if (!cancelled)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load the current background.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  if (!isAdmin || !mountNode) return null;

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const allowedTypes = new Set([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/avif",
      "image/gif",
    ]);
    if (!allowedTypes.has(file.type)) {
      setError("Choose a PNG, JPEG, WebP, AVIF, or GIF image.");
      setMessage("");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setError("The image must be 12 MB or smaller.");
      setMessage("");
      return;
    }

    setUploading(true);
    setMessage("");
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(
        `${API_BASE_URL}/api/admin/showcase/feed-background`,
        {
          method: "POST",
          credentials: "include",
          body,
        },
      );
      const result = (await response.json().catch(() => ({}))) as {
        url?: string;
        message?: string;
      };
      if (!response.ok || !result.url) {
        throw new Error(
          result.message || `Background upload failed (${response.status}).`,
        );
      }
      setCurrentUrl(result.url);
      setMessage("Background image replaced successfully.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not upload the background image.",
      );
    } finally {
      setUploading(false);
    }
  };

  return createPortal(
    <section
      className="feed-background-admin-panel"
      aria-labelledby="feed-background-admin-title"
    >
      <div className="feed-background-admin-heading">
        <div className="feed-background-admin-title-copy">
          <p className="feed-background-admin-eyebrow">APPEARANCE</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-label="Feed and Note View background"
          aria-checked={backgroundEnabled}
          className={`feed-background-admin-switch${backgroundEnabled ? " is-on" : ""}`}
          onClick={() => setBackgroundEnabled((enabled) => !enabled)}
        >
          <span aria-hidden="true" />
        </button>
      </div>

      <div className="feed-background-admin-upload-area">
        <div className="feed-background-admin-upload-copy">
          <strong>Background image</strong>
        </div>
        {loading ? (
          <p className="feed-background-admin-status">Loading current image…</p>
        ) : currentUrl ? (
          <img
            className="feed-background-admin-preview"
            src={currentUrl}
            alt="Current Feed and Note View background preview"
          />
        ) : null}
        <label className="feed-background-admin-upload">
          <span>
            {uploading ? "Replacing background…" : "Choose replacement image"}
          </span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
            disabled={uploading}
            onChange={(event) => void handleUpload(event)}
          />
        </label>
      </div>
      {message && (
        <p className="feed-background-admin-status" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="feed-background-admin-error" role="alert">
          {error}
        </p>
      )}
    </section>,
    mountNode,
  );
}
