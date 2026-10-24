import { toPng } from "html-to-image";
import { API_BASE_URL } from "./services/apiBase";

const STATUS_ID = "blogg-share-snapshot-status";
const WIDTH = 1200;
const HEIGHT = 630;
const PNG_PREFIX = "data:image/png;base64,";
const IMAGE_PLACEHOLDER = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="#e8edf2"/><path d="M126 95l25-26 19 20 12-12 31 26H107z" fill="#c6d0dc"/><circle cx="129" cy="59" r="10" fill="#c6d0dc"/></svg>',
)}`;
const PROGRESS_MESSAGES = new Set([
  "Preparing the blog snapshot…",
  "Waiting for the rendered blog…",
  "Capturing the blog preview as a 1200 × 630 image…",
  "Saving the new blog preview and replacing the previous snapshot…",
]);

let activeCaptureLocation = "";
const wait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

function showCaptureStatus(message: string, isError = false) {
  let status = document.getElementById(STATUS_ID);
  if (!status) {
    status = document.createElement("div");
    status.id = STATUS_ID;
    status.setAttribute("role", "status");
    status.style.cssText = "position:fixed;left:-1200px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none";
    document.body.appendChild(status);
  }
  status.textContent = message;
  status.dataset.state = isError ? "error" : PROGRESS_MESSAGES.has(message) ? "progress" : "complete";
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: "blogg-note-snapshot-status", message, isError }, window.location.origin);
  }
}

function noteIdFromLocation(): string {
  const segments = window.location.pathname.split("/").filter(Boolean);
  if (segments.length !== 2 || segments[0] !== "read") return "";
  try { return decodeURIComponent(segments[1]); } catch { return ""; }
}

async function waitForRenderedBlogg(): Promise<HTMLElement> {
  const startedAt = Date.now();
  let lastMutationAt = startedAt;
  let card: HTMLElement | null = null;
  const observer = new MutationObserver(() => { lastMutationAt = Date.now(); });
  const page = document.querySelector<HTMLElement>(".blogg-reader-page");
  if (page) observer.observe(page, { childList: true, subtree: true, characterData: true });

  try {
    const maxTime = startedAt + 18_000;
    while (Date.now() < maxTime) {
      await wait(250);
      card = document.querySelector<HTMLElement>(".blogg-reader-card");
      if (card && card.querySelector(".blogg-reader-title")) {
        // The article shell and title can render before BlockNote has mounted its
        // read-only editor. Never capture during that gap: it produces a white
        // card because the cloned article has no rendered body content yet.
        const bodyReady = Boolean(card.querySelector(
          ".blogg-reader-body .bn-editor, .blogg-reader-body .blogg-reader-empty",
        ));
        const minimumTimePassed = Date.now() - startedAt >= 1_800;
        const quietEnough = Date.now() - lastMutationAt >= 900;
        if (bodyReady && minimumTimePassed && quietEnough) break;
      }
      const missingState = document.querySelector<HTMLElement>(".blogg-reader-state");
      if (missingState && Date.now() - startedAt > 1_500) {
        throw new Error("This note could not be rendered for a public preview. Check its visibility and try again.");
      }
    }
  } finally {
    observer.disconnect();
  }

  if (!card || !card.isConnected || !card.querySelector(".blogg-reader-title")) {
    throw new Error("The note did not finish loading. The previous preview was kept; try sharing again.");
  }

  if (document.fonts?.ready) await Promise.race([document.fonts.ready, wait(2_000)]);
  const images = Array.from(card.querySelectorAll("img"));
  await Promise.race([
    Promise.all(images.map((image) => image.decode().catch(() => undefined))).then(() => undefined),
    wait(2_500),
  ]);
  return card;
}

/**
 * Capture the actual rendered reader card, not a synthetic card assembled from
 * only the first content block. This preserves the visible combination of text,
 * images, link previews, tags, and other BlockNote content exactly as a reader
 * sees it when opening the note from the feed.
 */
function createRichPreviewCard(readerCard: HTMLElement): HTMLElement {
  const stage = document.createElement("div");
  stage.setAttribute("aria-hidden", "true");
  // IMPORTANT: keep the capture root at the origin. html-to-image serializes
  // computed positioning into an SVG foreignObject; leaving the live stage at
  // left:-1500px puts all of its contents outside the 1200px SVG viewport and
  // silently generates an all-white PNG. The parent iframe is already hidden
  // offscreen, so the stage itself does not need offscreen positioning.
  stage.style.cssText = [
    "position:relative", "left:0", "top:0", "z-index:0", "margin:0",
    "box-sizing:border-box", `width:${WIDTH}px`, `min-width:${WIDTH}px`,
    `height:${HEIGHT}px`, `min-height:${HEIGHT}px`, "overflow:hidden", "display:flex",
    "align-items:flex-start", "justify-content:center", "padding:24px 0 0",
    "background:#f8fafc", "color:#111827", "transform:none", "opacity:1",
  ].join(";");

  const snapshot = readerCard.cloneNode(true) as HTMLElement;
  snapshot.style.cssText = `${snapshot.style.cssText};${[
    "box-sizing:border-box", "width:900px", "min-width:900px", "max-width:900px",
    "height:606px", "min-height:606px", "max-height:606px", "margin:0",
    "flex:0 0 900px", "overflow:hidden", "background:#ffffff",
  ].join(";")}`;

  // Navigation and action controls are not part of the article preview. Keep
  // the actual note header and content area, clipped to the first 630px view.
  const actions = snapshot.querySelector<HTMLElement>(".blogg-reader-actions");
  if (actions) actions.style.display = "none";

  stage.appendChild(snapshot);
  document.body.appendChild(stage);
  return stage;
}

function dataUrlToBase64(dataUrl: string): string {
  if (!dataUrl.startsWith(PNG_PREFIX)) throw new Error("The note preview could not be encoded as a PNG.");
  return dataUrl.slice(PNG_PREFIX.length);
}

/** Reject an empty/white capture before it can overwrite a previously good preview. */
async function assertPngContainsRenderedContent(dataUrl: string): Promise<void> {
  const image = new Image();
  image.src = dataUrl;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("The generated blog snapshot could not be decoded."));
  });

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Could not validate the generated blog snapshot.");
  context.drawImage(image, 0, 0, WIDTH, HEIGHT);
  const pixels = context.getImageData(0, 0, WIDTH, HEIGHT).data;
  let foregroundPixels = 0;
  // Sample every fourth pixel. Ignore the near-white background; article text,
  // borders, and normal images should provide meaningful contrast.
  for (let pixel = 0; pixel < pixels.length; pixel += 16) {
    if (pixels[pixel] < 220 || pixels[pixel + 1] < 220 || pixels[pixel + 2] < 220) {
      foregroundPixels += 1;
      if (foregroundPixels >= 300) return;
    }
  }
  throw new Error("The blog snapshot came out blank. The previous preview was kept; retry Share after the note finishes loading.");
}

async function captureAndSaveBloggSnapshot(noteId: string) {
  showCaptureStatus("Preparing the blog snapshot…");
  let previewCard: HTMLElement | null = null;
  try {
    showCaptureStatus("Waiting for the rendered blog…");
    const readerCard = await waitForRenderedBlogg();
    previewCard = createRichPreviewCard(readerCard);
    const previewImages = Array.from(previewCard.querySelectorAll("img"));
    await Promise.race([
      Promise.all(previewImages.map((image) => image.decode().catch(() => undefined))).then(() => undefined),
      wait(2_000),
    ]);
    showCaptureStatus("Capturing the blog preview as a 1200 × 630 image…");

    // Capture the real reader card at the top of its rendered view. This includes
    // whatever content is actually visible first: text, images, link previews, or
    // a mixture. It deliberately does not substitute a default hero image.
    const dataUrl = await toPng(previewCard, {
      width: WIDTH,
      height: HEIGHT,
      canvasWidth: WIDTH,
      canvasHeight: HEIGHT,
      pixelRatio: 1,
      backgroundColor: "#ffffff",
      cacheBust: true,
      imagePlaceholder: IMAGE_PLACEHOLDER,
      style: {
        boxSizing: "border-box",
        width: `${WIDTH}px`,
        minWidth: `${WIDTH}px`,
        maxWidth: `${WIDTH}px`,
        height: `${HEIGHT}px`,
        minHeight: `${HEIGHT}px`,
        maxHeight: `${HEIGHT}px`,
        overflow: "hidden",
        transform: "none",
        animation: "none",
        transition: "none",
        backgroundColor: "#ffffff",
      },
    });

    // Never replace a good saved preview with an apparently successful but
    // visually blank PNG. This also gives a clear diagnostic if rendering fails.
    await assertPngContainsRenderedContent(dataUrl);
    const pngBase64 = dataUrlToBase64(dataUrl);
    showCaptureStatus("Saving the new blog preview and replacing the previous snapshot…");
    const response = await fetch(
      `${API_BASE_URL}/api/admin/share/blog-snapshot/${encodeURIComponent(noteId)}`,
      {
        method: "PUT",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ pngBase64 }),
      },
    );
    const result = await response.json().catch(() => ({})) as { message?: string; updatedAt?: number };
    if (!response.ok) throw new Error(result.message || `Blog snapshot upload failed (${response.status}).`);

    const version = String(result.updatedAt || Date.now());
    showCaptureStatus("Snapshot saved. The rich preview now matches the rendered note.");
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "blogg-note-snapshot-updated", bloggId: noteId, version }, window.location.origin);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update the blog rich-preview snapshot.";
    showCaptureStatus(message, true);
  } finally {
    previewCard?.remove();
  }
}

function syncBloggSnapshotCapture() {
  const params = new URLSearchParams(window.location.search);
  const wantsSnapshot = window.location.pathname.startsWith("/read/") && params.get("captureBloggSnapshot") === "1";
  if (!wantsSnapshot) {
    activeCaptureLocation = "";
    return;
  }

  const locationKey = `${window.location.pathname}${window.location.search}`;
  if (activeCaptureLocation === locationKey) return;
  const noteId = noteIdFromLocation();
  const card = document.querySelector<HTMLElement>(".blogg-reader-card");
  if (!noteId || !card) return;

  activeCaptureLocation = locationKey;
  void captureAndSaveBloggSnapshot(noteId);
}

if (typeof document !== "undefined" && document.body) {
  const observer = new MutationObserver(syncBloggSnapshotCapture);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  syncBloggSnapshotCapture();
}
