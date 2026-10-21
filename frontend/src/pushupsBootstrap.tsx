import { createRoot, type Root } from "react-dom/client";
import PushupsAdminPanel from "./components/PushupsAdminPanel";
import PushupsFeedWidget from "./components/PushupsFeedWidget";
import { API_BASE_URL } from "./services/apiBase";

const roots = new Map<HTMLElement, Root>();
const adminAttempted = new WeakSet<HTMLElement>();
let adminProbePending = false;
function createHost(className: string, attr: string): HTMLDivElement {
  const host = document.createElement("div");
  host.className = className;
  host.setAttribute(attr, "true");
  return host;
}
function unmountDetachedRoots() {
  for (const [host, root] of roots) {
    if (!host.isConnected) { root.unmount(); roots.delete(host); }
  }
}
async function mountPushupsAdmin() {
  if (window.location.pathname.replace(/\/+$/, "") !== "/account") return;
  if (new URLSearchParams(window.location.search).get("view") === "public") return;
  const main = document.querySelector<HTMLElement>(".account-page-main");
  const dashboard = main?.querySelector<HTMLElement>(".account-dashboard-grid");
  const column = dashboard?.querySelector<HTMLElement>(".account-dashboard-media-column");
  if (!main || !dashboard || !column || dashboard.querySelector("[data-pushups-admin-host='true']")) return;
  if (adminAttempted.has(main) || adminProbePending) return;
  adminProbePending = true;
  try {
    const response = await fetch(`${API_BASE_URL}/api/health/pushups/admin/config`, { credentials: "include", cache: "no-store", headers: { Accept: "application/json" } });
    adminAttempted.add(main);
    if (!response.ok || window.location.pathname.replace(/\/+$/, "") !== "/account" || !dashboard.isConnected) return;
    const host = createHost("health-admin-bootstrap-root pushups-admin-bootstrap-root", "data-pushups-admin-host");
    const runningHost = column.querySelector<HTMLElement>("[data-health-section='running']");
    const featureList = column.querySelector<HTMLElement>(".account-dashboard-featured-card-list");
    if (runningHost) runningHost.insertAdjacentElement("afterend", host);
    else if (featureList) column.insertBefore(host, featureList);
    else column.append(host);
    const root = createRoot(host);
    roots.set(host, root);
    root.render(<PushupsAdminPanel />);
  } catch {
    // Do not show administrative controls when the authenticated probe fails.
  } finally { adminProbePending = false; }
}
function ensureFeedWidget() {
  if (window.location.pathname.replace(/\/+$/, "") !== "/feed") return;
  const rail = document.querySelector<HTMLElement>(".blog-feed-widget-rail");
  if (!rail || rail.querySelector(":scope > [data-pushups-feed-host='true']")) return;
  const host = createHost("blog-feed-pushups-widget-root", "data-pushups-feed-host");
  rail.append(host);
  const root = createRoot(host);
  roots.set(host, root);
  root.render(<PushupsFeedWidget />);
}
function sync() {
  unmountDetachedRoots();
  if (window.location.pathname.replace(/\/+$/, "") === "/account") void mountPushupsAdmin();
  else void 0;
  ensureFeedWidget();
}
if (typeof document !== "undefined" && document.body) {
  const observer = new MutationObserver(sync);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("popstate", sync);
  sync();
}
