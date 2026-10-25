import { createRoot, type Root } from "react-dom/client";
import BloggMindMapFeedWidget from "./pages/BloggFeed/BloggMindMapFeedWidget";

const roots = new Map<HTMLElement, Root>();

function removeWidget(host: HTMLElement) {
  const root = roots.get(host);
  if (root) {
    root.unmount();
    roots.delete(host);
  }
  host.remove();
}

function syncMindMapFeedWidget() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const existing = Array.from(document.querySelectorAll<HTMLElement>("[data-blogg-mindmap-feed-host='true']"));
  if (path !== "/feed") {
    existing.forEach(removeWidget);
    return;
  }

  const newsletterRail = document.querySelector<HTMLElement>(".blog-feed-newsletter-rail");
  if (!newsletterRail) return;

  let host = newsletterRail.querySelector<HTMLElement>(":scope > [data-blogg-mindmap-feed-host='true']");
  if (!host) {
    host = document.createElement("div");
    host.className = "blog-feed-mindmap-widget-host";
    host.dataset.bloggMindmapFeedHost = "true";
  }
  const newsletter = newsletterRail.querySelector<HTMLElement>(":scope > .blog-feed-newsletter-root");
  if (newsletter && host.nextElementSibling !== newsletter) newsletterRail.insertBefore(host, newsletter);
  else if (!newsletter && host.parentElement !== newsletterRail) newsletterRail.append(host);
  else if (host.parentElement !== newsletterRail) newsletterRail.append(host);

  if (!roots.has(host)) {
    const root = createRoot(host);
    roots.set(host, root);
    root.render(<BloggMindMapFeedWidget />);
  }
}

if (typeof document !== "undefined" && document.body) {
  const observer = new MutationObserver(syncMindMapFeedWidget);
  observer.observe(document.body, { childList: true, subtree: true });
  syncMindMapFeedWidget();
}
