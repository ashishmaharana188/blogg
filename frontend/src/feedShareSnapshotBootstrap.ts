import { API_BASE_URL } from "./services/apiBase";
import { capturePublicDashboardPngBase64 } from "./utils/domSnapshot";

let activeCaptureLocation = "";
const STATUS_ID = "feed-share-snapshot-status";

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

function showCaptureStatus(message: string, isError = false) {
  let status = document.getElementById(STATUS_ID);
  if (!status) {
    status = document.createElement("div");
    status.id = STATUS_ID;
    status.setAttribute("role", "status");
    status.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:10000;max-width:min(440px,calc(100vw - 36px));box-sizing:border-box;padding:12px 15px;border:1px solid #d7dee7;border-radius:12px;background:#fff;color:#273246;box-shadow:0 8px 28px rgb(15 23 42 / 16%);font:13px/1.5 Arial,sans-serif";
    document.body.appendChild(status);
  }
  status.textContent = message;
  status.style.borderColor = isError ? "#e4a2a2" : "#d7dee7";
  status.style.color = isError ? "#9b2c2c" : "#273246";
}

async function waitForRenderedFeed(page: HTMLElement) {
  const startedAt = Date.now();
  let lastMutationAt = startedAt;
  const observer = new MutationObserver(() => {
    lastMutationAt = Date.now();
  });
  observer.observe(page, { childList: true, subtree: true, characterData: true });

  try {
    const maximumTime = startedAt + 18_000;
    while (Date.now() < maximumTime) {
      await wait(250);
      const contentLoaded = Boolean(page.querySelector(".blog-feed-post-list, .blog-feed-state"));
      if (contentLoaded && Date.now() - startedAt >= 2_500 && Date.now() - lastMutationAt >= 1_000) break;
    }
  } finally {
    observer.disconnect();
  }

  // Do not save a random loading/error illustration as the feed preview. The
  // snapshot should represent actual feed posts or the intentional empty-feed state.
  if (!page.querySelector(".blog-feed-post-list, .blog-feed-state")) {
    throw new Error("The feed did not finish loading. The previous snapshot was kept; retry when the feed is available.");
  }

  const frame = page.getBoundingClientRect();
  const visibleImages = Array.from(page.querySelectorAll("img")).filter((image) => {
    const rect = image.getBoundingClientRect();
    return rect.right > frame.left && rect.left < frame.right && rect.bottom > frame.top && rect.top < frame.bottom;
  });
  await Promise.race([
    Promise.all(visibleImages.map((image) => image.decode().catch(() => undefined))).then(() => undefined),
    wait(2_500),
  ]);
}

async function captureAndSaveFeedSnapshot(page: HTMLElement) {
  showCaptureStatus("Preparing the feed snapshot…");
  try {
    await waitForRenderedFeed(page);
    showCaptureStatus("Capturing the rendered feed as a 1200 × 630 image…");
    const pngBase64 = await capturePublicDashboardPngBase64(page);
    showCaptureStatus("Saving the new feed preview and replacing the previous snapshot…");
    const response = await fetch(`${API_BASE_URL}/api/admin/share/feed-snapshot`, {
      method: "PUT",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ pngBase64 }),
    });
    const result = await response.json().catch(() => ({})) as { message?: string; updatedAt?: number };
    if (!response.ok) throw new Error(result.message || `Feed snapshot upload failed (${response.status}).`);
    const version = String(result.updatedAt || Date.now());
    showCaptureStatus("Snapshot saved. The rich preview now uses the actual feed; no image history is kept.");
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: "blogg-feed-snapshot-updated", version }, window.location.origin);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update the feed preview snapshot.";
    showCaptureStatus(message, true);
  }
}

function syncFeedSnapshotCapture() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(window.location.search);
  const wantsSnapshot = path === "/feed" && params.get("captureFeedSnapshot") === "1";
  if (!wantsSnapshot) {
    activeCaptureLocation = "";
    return;
  }

  const captureLocation = `${window.location.pathname}${window.location.search}`;
  const page = document.querySelector<HTMLElement>(".blog-feed-page");
  if (!page || activeCaptureLocation === captureLocation) return;

  activeCaptureLocation = captureLocation;
  void captureAndSaveFeedSnapshot(page);
}

if (typeof document !== "undefined" && document.body) {
  const observer = new MutationObserver(syncFeedSnapshotCapture);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  syncFeedSnapshotCapture();
}
