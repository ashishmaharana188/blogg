import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";
import NewsletterWidget from "./components/NewsletterWidget";
import NewsletterAdminPanel from "./components/NewsletterAdminPanel";
import { API_BASE_URL } from "./services/apiBase";

const roots = new Map<HTMLElement, Root>();
type AccessState = "pending" | "allowed" | "denied" | "public";
const accountAccess = new WeakMap<HTMLElement, AccessState>();

function mount(host: HTMLElement, element: ReactNode) {
  if (roots.has(host)) return;
  const root = createRoot(host);
  roots.set(host, root);
  root.render(element);
}

function unmount(host: HTMLElement) {
  const root = roots.get(host);
  if (root) {
    root.unmount();
    roots.delete(host);
  }
  host.remove();
}

function ensureFeedNewsletter() {
  const content = document.querySelector<HTMLElement>(".blog-feed-content");
  const widgetRail = content?.querySelector<HTMLElement>(".blog-feed-widget-rail");
  if (!content || !widgetRail) return;

  let group = content.querySelector<HTMLElement>(":scope > .blog-feed-side-rails");
  if (!group) {
    group = document.createElement("div");
    group.className = "blog-feed-side-rails";
    content.insertBefore(group, widgetRail);
  }
  if (widgetRail.parentElement !== group) group.appendChild(widgetRail);

  let newsletterRail = group.querySelector<HTMLElement>(":scope > .blog-feed-newsletter-rail");
  if (!newsletterRail) {
    newsletterRail = document.createElement("div");
    newsletterRail.className = "blog-feed-newsletter-rail";
    newsletterRail.setAttribute("aria-label", "Newsletter");
    group.appendChild(newsletterRail);
  }
  let host = newsletterRail.querySelector<HTMLElement>(":scope > [data-newsletter-public-host='true']");
  if (!host) {
    host = document.createElement("div");
    host.className = "blog-feed-newsletter-root";
    host.dataset.newsletterPublicHost = "true";
    newsletterRail.appendChild(host);
  }
  mount(host, <NewsletterWidget />);
}

function ensureAdminNewsletter() {
  const pageMain = document.querySelector<HTMLElement>(".account-page-main");
  const dashboard = pageMain?.querySelector<HTMLElement>(".account-dashboard-grid");
  const leftColumn = dashboard?.querySelector<HTMLElement>(".account-dashboard-left-column");
  const leftBase = leftColumn?.querySelector<HTMLElement>(".account-dashboard-left-base");
  if (!pageMain || !dashboard || !leftColumn || !leftBase) return;
  const forcePublic = new URLSearchParams(window.location.search).get("view") === "public";
  let host = dashboard.querySelector<HTMLElement>("[data-newsletter-admin-host='true']");

  if (forcePublic) {
    accountAccess.set(pageMain, "public");
    if (host) unmount(host);
    return;
  }

  const state = accountAccess.get(pageMain);
  if (state === "public") accountAccess.delete(pageMain);
  const access = accountAccess.get(pageMain);
  if (access === "denied" || access === "pending") return;

  // Keep this host outside .account-dashboard-left-base. The existing Health
  // bootstrap independently reorders children of left-base before Featured Links.
  const featuredCards = leftColumn.querySelector<HTMLElement>(":scope > .account-dashboard-featured-card-list");
  if (!host) {
    host = document.createElement("div");
    host.className = "newsletter-admin-bootstrap-root";
    host.dataset.newsletterAdminHost = "true";
  }
  if (host.parentElement !== leftColumn) leftColumn.insertBefore(host, featuredCards || null);
  else if (featuredCards && host.nextElementSibling !== featuredCards) leftColumn.insertBefore(host, featuredCards);

  if (access === "allowed") {
    mount(host, <NewsletterAdminPanel />);
    return;
  }

  accountAccess.set(pageMain, "pending");
  void fetch(`${API_BASE_URL}/api/newsletter/admin/summary`, {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  }).then((response) => {
    if (!pageMain.isConnected || !host?.isConnected) {
      accountAccess.delete(pageMain);
      host?.remove();
      return;
    }
    if (new URLSearchParams(window.location.search).get("view") === "public") {
      accountAccess.set(pageMain, "public");
      if (host) unmount(host);
      return;
    }
    if (!response.ok) {
      accountAccess.set(pageMain, "denied");
      if (host) unmount(host);
      return;
    }
    accountAccess.set(pageMain, "allowed");
    mount(host, <NewsletterAdminPanel />);
  }).catch(() => {
    accountAccess.set(pageMain, "denied");
    if (host) unmount(host);
  });
}

function syncNewsletterUi() {
  for (const [host, root] of roots) {
    if (!host.isConnected) {
      root.unmount();
      roots.delete(host);
    }
  }
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/feed") ensureFeedNewsletter();
  if (path === "/account") ensureAdminNewsletter();
}

if (typeof document !== "undefined" && document.body) {
  const observer = new MutationObserver(syncNewsletterUi);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("popstate", syncNewsletterUi);
  syncNewsletterUi();
}
