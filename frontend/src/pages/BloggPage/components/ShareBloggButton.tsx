import "./shareBlogg.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BloggItem } from "../../../types/pageTypes";
import { useAuth } from "../../../context/authContext";

type ShareBloggButtonProps = {
  blogg: BloggItem;
  stackName?: string;
  groupName?: string;
};

const absolutePath = (path: string) => new URL(path, window.location.origin).toString();
const SNAPSHOT_PROGRESS_MESSAGES = [
  "Preparing the blog snapshot…",
  "Waiting for the rendered blog…",
  "Capturing the blog preview as a 1200 × 630 image…",
  "Saving the new blog preview and replacing the previous snapshot…",
];

export default function ShareBloggButton({ blogg }: ShareBloggButtonProps) {
  const { isAdmin } = useAuth();
  const [feedback, setFeedback] = useState("");
  const [snapshotCaptureUrl, setSnapshotCaptureUrl] = useState<string | null>(null);
  const snapshotCaptureFrameRef = useRef<HTMLIFrameElement | null>(null);
  const captureResolveRef = useRef<((success: boolean) => void) | null>(null);
  const capturePromiseRef = useRef<Promise<boolean> | null>(null);

  const noteId = blogg.blogg_id || blogg._id;
  const directUrl = absolutePath(`/share/${encodeURIComponent(noteId)}`);

  const finishCapture = useCallback((success: boolean) => {
    setSnapshotCaptureUrl(null);
    const resolve = captureResolveRef.current;
    captureResolveRef.current = null;
    capturePromiseRef.current = null;
    resolve?.(success);
  }, []);

  useEffect(() => {
    if (!snapshotCaptureUrl) return;
    let attempts = 0;
    const poll = window.setInterval(() => {
      attempts += 1;
      let statusElement: HTMLElement | null = null;
      try {
        statusElement = snapshotCaptureFrameRef.current?.contentDocument?.getElementById(
          "blogg-share-snapshot-status",
        ) ?? null;
      } catch {
        // The capture frame is same-origin; frame navigation errors are handled as a timeout.
      }

      const message = statusElement?.textContent?.trim() || "";
      if (message.startsWith("Snapshot saved.")) {
        finishCapture(true);
        return;
      }
      if (message && !SNAPSHOT_PROGRESS_MESSAGES.includes(message)) {
        finishCapture(false);
        return;
      }
      if (attempts >= 90) finishCapture(false);
    }, 500);

    return () => window.clearInterval(poll);
  }, [snapshotCaptureUrl, finishCapture]);

  const refreshSnapshot = useCallback((): Promise<boolean> => {
    // Snapshot writes are administrator-only. Other visitors still copy the public URL normally.
    if (!isAdmin || !noteId) return Promise.resolve(false);
    if (capturePromiseRef.current) return capturePromiseRef.current;

    const captureUrl = new URL(`/read/${encodeURIComponent(noteId)}`, window.location.origin);
    captureUrl.searchParams.set("captureBloggSnapshot", "1");
    const promise = new Promise<boolean>((resolve) => {
      captureResolveRef.current = resolve;
      setSnapshotCaptureUrl(captureUrl.toString());
    });
    capturePromiseRef.current = promise;
    return promise;
  }, [isAdmin, noteId]);

  const copyLink = async () => {
    let copied = false;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(directUrl);
      copied = true;
    } catch {
      // Preserve copy behavior in browsers that deny the Clipboard API.
      const textarea = document.createElement("textarea");
      textarea.value = directUrl;
      textarea.readOnly = true;
      textarea.setAttribute("aria-hidden", "true");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      textarea.style.pointerEvents = "none";
      textarea.style.left = "-9999px";
      try {
        document.body.appendChild(textarea);
        textarea.select();
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      } finally {
        textarea.remove();
      }
    }

    setFeedback(copied ? "Copied link" : "Could not copy link");
  };

  const handleShare = () => {
    setFeedback("");
    // Start the clipboard operation directly from the click; do not wait for rendering.
    const copyTask = copyLink();
    // Refresh the Open Graph image silently in parallel. No share menu or second action.
    if (isAdmin) void refreshSnapshot();
    void copyTask;
  };

  return (
    <>
      <button
        className="blogg-share-trigger"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          handleShare();
        }}
        aria-label={`Copy share link for ${blogg.title || "note"}`}
        title="Copy share link"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="m8.7 10.6 6.6-4.2M8.7 13.4l6.6 4.2" />
        </svg>
        <span>Share</span>
      </button>
      {feedback && <span className="blogg-share-feedback" role="status" aria-live="polite">{feedback}</span>}

      {snapshotCaptureUrl && (
        <iframe
          ref={snapshotCaptureFrameRef}
          key={snapshotCaptureUrl}
          src={snapshotCaptureUrl}
          title="Background blog rich-preview snapshot capture"
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
