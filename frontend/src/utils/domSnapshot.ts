import { toPng } from "html-to-image";

export const DASHBOARD_SNAPSHOT_WIDTH = 1200;
export const DASHBOARD_SNAPSHOT_HEIGHT = 630;
const PNG_DATA_URL_PREFIX = "data:image/png;base64,";

const imagePlaceholder = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="#e8edf2"/><path d="M126 95l25-26 19 20 12-12 31 26H107z" fill="#c6d0dc"/><circle cx="129" cy="59" r="10" fill="#c6d0dc"/></svg>',
)}`;

function dataUrlToPngBase64(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = DASHBOARD_SNAPSHOT_WIDTH;
        canvas.height = DASHBOARD_SNAPSHOT_HEIGHT;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Could not create the preview canvas.");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const scaled = canvas.toDataURL("image/png");
        if (!scaled.startsWith(PNG_DATA_URL_PREFIX)) {
          throw new Error("The dashboard could not be encoded as a PNG image.");
        }
        resolve(scaled.slice(PNG_DATA_URL_PREFIX.length));
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error("The captured dashboard image could not be resized."));
    image.src = dataUrl;
  });
}

/**
 * Capture the actual browser-rendered public dashboard and rasterise it with
 * html-to-image. The initial render uses the current desktop layout dimensions
 * so the already-computed responsive grid is preserved; a second canvas pass
 * normalises the result to 1200 x 630 for Open Graph previews.
 */
export async function capturePublicDashboardPngBase64(
  element: HTMLElement,
): Promise<string> {
  if (!element.isConnected) {
    throw new Error("The dashboard is not mounted, so there is nothing to capture.");
  }

  if (document.fonts?.ready) {
    await Promise.race([
      document.fonts.ready,
      new Promise<void>((resolve) => window.setTimeout(resolve, 2500)),
    ]);
  }

  const frame = element.getBoundingClientRect();
  const sourceWidth = Math.round(frame.width);
  // A rich preview is landscape. Capturing at a narrow mobile breakpoint would
  // magnify a small-screen layout and make the final card unreadable, so fail
  // clearly rather than silently save a poor snapshot.
  if (sourceWidth < 1000) {
    throw new Error("Open the dashboard in a desktop-width browser (at least 1000 px) before updating its rich preview.");
  }
  const sourceHeight = Math.max(1, Math.round(sourceWidth * DASHBOARD_SNAPSHOT_HEIGHT / DASHBOARD_SNAPSHOT_WIDTH));
  element.scrollTop = 0;

  const visibleImages = Array.from(element.querySelectorAll("img")).filter((image) => {
    const rect = image.getBoundingClientRect();
    return rect.right > frame.left && rect.left < frame.right && rect.bottom > frame.top && rect.top < frame.bottom;
  });
  await Promise.race([
    Promise.all(visibleImages.map((image) => image.decode().catch(() => undefined))).then(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, 2500)),
  ]);

  const dataUrl = await toPng(element, {
    width: sourceWidth,
    height: sourceHeight,
    canvasWidth: sourceWidth,
    canvasHeight: sourceHeight,
    pixelRatio: 1,
    backgroundColor: "#ffffff",
    cacheBust: true,
    imagePlaceholder,
    preferredFontFormat: "woff2",
    style: {
      boxSizing: "border-box",
      width: `${sourceWidth}px`,
      minWidth: `${sourceWidth}px`,
      maxWidth: `${sourceWidth}px`,
      height: `${sourceHeight}px`,
      minHeight: `${sourceHeight}px`,
      maxHeight: `${sourceHeight}px`,
      overflow: "hidden",
      overflowX: "hidden",
      overflowY: "hidden",
      margin: "0",
      transform: "none",
      animation: "none",
      transition: "none",
      backgroundColor: "#ffffff",
    },
    filter: (node) => {
      if (!(node instanceof Element)) return true;
      return !node.matches(
        "#account-share-snapshot-status, [data-account-share-host='true'], .account-share-backdrop",
      );
    },
  });

  if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
    throw new Error("The dashboard could not be encoded as a PNG image.");
  }
  return dataUrlToPngBase64(dataUrl);
}
