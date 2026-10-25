import { useEffect, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../context/authContext";
import { API_BASE_URL } from "../services/apiBase";
import "./feedBackgroundAdminPanel.css";

type BackgroundSetting = { url?: string | null; updatedAt?: string | null };

export default function FeedBackgroundAdminPanel() {
  const { isAdmin } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [currentUrl, setCurrentUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isAdmin || !isOpen) return;
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE_URL}/api/showcase/feed-background`, { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load feed background (${response.status}).`);
        return response.json() as Promise<BackgroundSetting>;
      })
      .then((setting) => { if (!cancelled) setCurrentUrl(setting.url || "/feed-background.jpg"); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load the current background."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isAdmin, isOpen]);

  if (!isAdmin) return null;

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif"]);
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
      const response = await fetch(`${API_BASE_URL}/api/admin/showcase/feed-background`, {
        method: "POST",
        credentials: "include",
        body,
      });
      const result = await response.json().catch(() => ({})) as { url?: string; message?: string };
      if (!response.ok || !result.url) throw new Error(result.message || `Background upload failed (${response.status}).`);
      setCurrentUrl(result.url);
      setMessage("Feed background replaced. The previous managed image was overwritten.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not upload the background image.");
    } finally {
      setUploading(false);
    }
  };

  return createPortal(
    <div className="feed-background-admin-root">
      <button type="button" className="feed-background-admin-launch" onClick={() => { setIsOpen(true); setMessage(""); setError(""); }}>
        Feed background
      </button>
      {isOpen && (
        <div className="feed-background-admin-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsOpen(false); }}>
          <section className="feed-background-admin-dialog" role="dialog" aria-modal="true" aria-labelledby="feed-background-admin-title">
            <header>
              <div>
                <p>ADMIN SETTINGS</p>
                <h2 id="feed-background-admin-title">Feed background</h2>
              </div>
              <button type="button" className="feed-background-admin-close" aria-label="Close feed background settings" onClick={() => setIsOpen(false)}>×</button>
            </header>
            <p className="feed-background-admin-description">Upload one background image for the full Feed viewport. A new upload replaces the existing managed image rather than creating a gallery.</p>
            {loading ? <p className="feed-background-admin-status">Loading current image…</p> : currentUrl && <img className="feed-background-admin-preview" src={currentUrl} alt="Current Feed background preview" />}
            <label className="feed-background-admin-upload">
              <span>{uploading ? "Replacing background…" : "Choose replacement image"}</span>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/gif" disabled={uploading} onChange={(event) => void handleUpload(event)} />
            </label>
            <p className="feed-background-admin-hint">PNG, JPEG, WebP, AVIF, or GIF · 12 MB maximum. The Feed on/off toggle remains per visitor.</p>
            {message && <p className="feed-background-admin-status" role="status">{message}</p>}
            {error && <p className="feed-background-admin-error" role="alert">{error}</p>}
          </section>
        </div>
      )}
    </div>,
    document.body,
  );
}
