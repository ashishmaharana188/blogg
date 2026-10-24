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
        const minimumTimePassed = Date.now() - startedAt >= 1_800;
        const quietEnough = Date.now() - lastMutationAt >= 900;
        if (minimumTimePassed && quietEnough) break;
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

type FirstBlockPreview = { kind: "image"; imageUrl: string; alt: string } | { kind: "text"; text: string };

function topLevelBlockElements(card: HTMLElement): HTMLElement[] {
  const editor = card.querySelector<HTMLElement>(".blogg-reader-body .bn-editor");
  if (!editor) return [];
  const allBlocks = Array.from(editor.querySelectorAll<HTMLElement>(".bn-block-outer"));
  const topLevel = allBlocks.filter((block) => !block.parentElement?.closest(".bn-block-outer"));
  if (topLevel.length) return topLevel;

  // Fallback for a BlockNote version whose top-level wrappers use a different class.
  return Array.from(editor.children).filter((element): element is HTMLElement => element instanceof HTMLElement);
}

function firstBlockPreview(card: HTMLElement): FirstBlockPreview | null {
  for (const block of topLevelBlockElements(card)) {
    const imageContent = block.matches('[data-content-type="image"]')
      ? block
      : block.querySelector<HTMLElement>('[data-content-type="image"]');
    const image = imageContent?.querySelector<HTMLImageElement>("img") || block.querySelector<HTMLImageElement>("img");
    if (image) {
      const imageUrl = image.currentSrc || image.getAttribute("src") || image.src || "";
      if (imageUrl) {
        return {
          kind: "image",
          imageUrl,
          alt: image.getAttribute("alt") || "First image in this note",
        };
      }
    }

    const text = (block.innerText || block.textContent || "").replace(/\s+/g, " ").trim();
    if (text) return { kind: "text", text };
  }
  return null;
}

function addTextElement(parent: HTMLElement, text: string, styles: Partial<CSSStyleDeclaration>) {
  const element = document.createElement("div");
  element.textContent = text;
  Object.assign(element.style, styles);
  parent.appendChild(element);
  return element;
}

function createRichPreviewCard(readerCard: HTMLElement): HTMLElement {
  const title = readerCard.querySelector<HTMLElement>(".blogg-reader-title")?.innerText.trim() || "Untitled note";
  const author = readerCard.querySelector<HTMLElement>(".blogg-reader-author")?.innerText.trim() || "Blogg";
  const subtitle = readerCard.querySelector<HTMLElement>(".blogg-reader-subtitle")?.innerText.trim() || "";
  const firstBlock = firstBlockPreview(readerCard);

  const stage = document.createElement("div");
  stage.setAttribute("aria-hidden", "true");
  stage.style.cssText = [
    "position:fixed", "left:-1500px", "top:0", "z-index:-1", "box-sizing:border-box",
    `width:${WIDTH}px`, `height:${HEIGHT}px`, "overflow:hidden", "display:flex", "flex-direction:column",
    "gap:14px", "padding:42px 48px", "border:1px solid #e5e7eb", "border-radius:20px",
    "background:#ffffff", "color:#111827", "font-family:Arial,Helvetica,sans-serif",
  ].join(";");

  const topLine = document.createElement("div");
  topLine.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:20px;min-height:22px;color:#64748b;font-size:16px;line-height:1.3;letter-spacing:.02em";
  const brand = document.createElement("span");
  brand.textContent = "BLOGG  ·  NOTE";
  brand.style.cssText = "font-weight:700;letter-spacing:.14em;color:#475569";
  const authorLabel = document.createElement("span");
  authorLabel.textContent = author;
  authorLabel.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;max-width:55%";
  topLine.append(brand, authorLabel);
  stage.appendChild(topLine);

  addTextElement(stage, title, {
    margin: "0",
    color: "#111827",
    fontSize: "52px",
    fontWeight: "750",
    lineHeight: "1.12",
    letterSpacing: "-0.025em",
    maxHeight: "116px",
    overflow: "hidden",
    overflowWrap: "anywhere",
  });

  if (subtitle) {
    addTextElement(stage, subtitle, {
      margin: "-2px 0 0",
      color: "#64748b",
      fontSize: "20px",
      lineHeight: "1.35",
      maxHeight: "54px",
      overflow: "hidden",
      overflowWrap: "anywhere",
    });
  }

  const body = document.createElement("div");
  body.style.cssText = "box-sizing:border-box;flex:1 1 auto;min-height:0;width:100%;overflow:hidden;border-top:1px solid #e5e7eb;padding-top:16px;display:flex;align-items:stretch;justify-content:stretch";

  if (firstBlock?.kind === "image") {
    body.style.paddingTop = "12px";
    const imageFrame = document.createElement("div");
    imageFrame.style.cssText = "box-sizing:border-box;width:100%;height:100%;min-height:0;overflow:hidden;border-radius:12px;background:#f1f5f9;display:flex;align-items:center;justify-content:center";
    const image = document.createElement("img");
    image.crossOrigin = "anonymous";
    image.alt = firstBlock.alt;
    image.src = firstBlock.imageUrl;
    image.style.cssText = "display:block;width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain;object-position:center;border-radius:10px";
    imageFrame.appendChild(image);
    body.appendChild(imageFrame);
  } else {
    const text = firstBlock?.kind === "text" ? firstBlock.text : "Open this note on Blogg to read more.";
    const textBlock = document.createElement("div");
    textBlock.textContent = text;
    textBlock.style.cssText = "width:100%;height:100%;overflow:hidden;color:#334155;font-size:27px;line-height:1.42;white-space:pre-wrap;overflow-wrap:anywhere;display:block";
    body.appendChild(textBlock);
  }

  stage.appendChild(body);
  document.body.appendChild(stage);
  return stage;
}

function dataUrlToBase64(dataUrl: string): string {
  if (!dataUrl.startsWith(PNG_PREFIX)) throw new Error("The note preview could not be encoded as a PNG.");
  return dataUrl.slice(PNG_PREFIX.length);
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

    // Capture a purpose-built card containing the title and only the first actual
    // BlockNote content block. A first image is shown as an image; otherwise the
    // first text block is shown. The full reader page is never cropped or hidden.
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
    showCaptureStatus("Snapshot saved. The rich preview now shows the first content block.");
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
