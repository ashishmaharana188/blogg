import { createRoot, type Root } from "react-dom/client";
import CurrentReadingWidget from "./components/CurrentReadingWidget";

type Slot = "account" | "feed";
type MountedWidget = {
  host: HTMLDivElement;
  root: Root;
  isAdmin: boolean;
  variant: "account" | "feed";
};

const mounted = new Map<Slot, MountedWidget>();

function removeWidget(slot: Slot) {
  const instance = mounted.get(slot);
  if (!instance) return;
  instance.root.unmount();
  instance.host.remove();
  mounted.delete(slot);
}

function ensureWidget(slot: Slot, parent: HTMLElement, anchor: HTMLElement | null, isAdmin: boolean, variant: "account" | "feed") {
  let instance = mounted.get(slot);
  let shouldRender = false;
  if (instance && !instance.host.isConnected) {
    instance.root.unmount();
    mounted.delete(slot);
    instance = undefined;
  }

  if (!instance) {
    const host = document.createElement("div");
    host.className = slot === "account" ? "current-reading-bootstrap-host" : "current-reading-feed-bootstrap-host";
    host.dataset.currentReadingHost = slot;
    const root = createRoot(host);
    instance = { host, root, isAdmin, variant };
    mounted.set(slot, instance);
    shouldRender = true;
  }

  if (anchor) {
    if (anchor.nextElementSibling !== instance.host) anchor.insertAdjacentElement("afterend", instance.host);
  } else if (instance.host.parentElement !== parent) {
    parent.append(instance.host);
  }

  if (instance.isAdmin !== isAdmin || instance.variant !== variant) {
    instance.isAdmin = isAdmin;
    instance.variant = variant;
    shouldRender = true;
  }
  if (shouldRender) instance.root.render(<CurrentReadingWidget isAdmin={isAdmin} variant={variant} />);
}

function syncCurrentReadingWidgets() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";

  const accountBase = path === "/account"
    ? document.querySelector<HTMLElement>(".account-dashboard-left-base")
    : null;
  const accountStatus = accountBase?.querySelector<HTMLElement>(":scope > .account-dashboard-status") || null;
  if (accountBase && accountStatus) {
    const isPublicShareView = new URLSearchParams(window.location.search).get("view") === "public";
    const isAdmin = !isPublicShareView && Boolean(document.querySelector(".account-activity-select"));
    ensureWidget("account", accountBase, accountStatus, isAdmin, "account");
  } else {
    removeWidget("account");
  }

  const feedRail = path === "/feed"
    ? document.querySelector<HTMLElement>(".blog-feed-widget-rail")
    : null;
  const nowPlaying = feedRail?.querySelector<HTMLElement>(".blog-feed-now-playing-teaser") || null;
  if (feedRail) {
    ensureWidget("feed", feedRail, nowPlaying, false, "feed");
  } else {
    removeWidget("feed");
  }
}

if (typeof document !== "undefined" && document.body) {
  const observer = new MutationObserver(syncCurrentReadingWidgets);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("popstate", syncCurrentReadingWidgets);
  syncCurrentReadingWidgets();
}
