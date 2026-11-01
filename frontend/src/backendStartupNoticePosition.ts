/**
 * Keeps the fixed backend startup notice below the shared Blogg header.
 * Measures the real rendered header height so Feed/Profile layouts and the
 * mobile header's minimise/restore states do not make the notice overlap it.
 */

let observedHeader: HTMLElement | null = null;
let headerResizeObserver: ResizeObserver | null = null;

function updatePosition(): void {
  const header = document.querySelector<HTMLElement>(".blogg-shared-header");
  const notice = document.querySelector<HTMLElement>(".backend-startup-notice");

  if (header !== observedHeader) {
    headerResizeObserver?.disconnect();
    headerResizeObserver = null;
    observedHeader = header;
    if (observedHeader && typeof ResizeObserver !== "undefined") {
      headerResizeObserver = new ResizeObserver(updatePosition);
      headerResizeObserver.observe(observedHeader);
    }
  }

  if (!notice) return;
  const headerBottom = observedHeader?.getBoundingClientRect().bottom ?? 0;
  const top = Math.max(8, Math.ceil(headerBottom + 8));
  notice.style.setProperty("top", `${top}px`, "important");
}

const treeObserver = new MutationObserver(updatePosition);
treeObserver.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("resize", updatePosition, { passive: true });
window.addEventListener("scroll", updatePosition, { passive: true });
updatePosition();
