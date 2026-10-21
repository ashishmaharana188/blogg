import { createRoot, type Root } from "react-dom/client";
import CurrentReadingWidget from "./components/CurrentReadingWidget";

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let renderedAdminMode: boolean | null = null;

function unmountWidget() {
  if (root) root.unmount();
  root = null;
  renderedAdminMode = null;
  host?.remove();
  host = null;
}

function syncCurrentReadingWidget() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/account") {
    if (host && !host.isConnected) {
      unmountWidget();
    } else if (host) {
      unmountWidget();
    }
    return;
  }

  const base = document.querySelector<HTMLElement>(".account-dashboard-left-base");
  const status = base?.querySelector<HTMLElement>(":scope > .account-dashboard-status");
  if (!base || !status) return;

  if (host && !host.isConnected) {
    root?.unmount();
    root = null;
    host = null;
    renderedAdminMode = null;
  }

  if (!host) {
    host = document.createElement("div");
    host.className = "current-reading-bootstrap-host";
    host.setAttribute("data-current-reading-host", "true");
  }
  if (host.parentElement !== base || status.nextElementSibling !== host) {
    status.insertAdjacentElement("afterend", host);
  }

  const isPublicShareView = new URLSearchParams(window.location.search).get("view") === "public";
  // AccountPage renders this select only for the authenticated administrator.
  // Protected backend endpoints remain the actual security boundary.
  const isAdmin = !isPublicShareView && Boolean(document.querySelector(".account-activity-select"));

  if (!root) root = createRoot(host);
  if (renderedAdminMode !== isAdmin) {
    renderedAdminMode = isAdmin;
    root.render(<CurrentReadingWidget isAdmin={isAdmin} />);
  }
}

if (typeof document !== "undefined" && document.body) {
  const observer = new MutationObserver(syncCurrentReadingWidget);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("popstate", syncCurrentReadingWidget);
  syncCurrentReadingWidget();
}
