import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";
import HealthAdminPanel from "./pages/Account/HealthAdminPanel";
import HealthWidget from "./pages/BloggFeed/HealthWidget";
import AccountShareButton from "./components/AccountShareButton";
import { API_BASE_URL } from "./services/apiBase";

const mountedRoots = new Map<HTMLElement, Root>();
type AdminAccessState = "pending" | "allowed" | "denied" | "public";
const adminAccessByMain = new WeakMap<HTMLElement, AdminAccessState>();

function mountRoot(host: HTMLElement, element: ReactNode) {
  if (mountedRoots.has(host)) return;
  const root = createRoot(host);
  mountedRoots.set(host, root);
  root.render(element);
}

function createHost(className: string, attribute: string): HTMLDivElement {
  const host = document.createElement("div");
  host.className = className;
  host.setAttribute(attribute, "true");
  return host;
}

type HealthPanelSection = "overview" | "steps" | "running";

const adminHealthPlacements: Array<{
  columnSelector: string;
  section: HealthPanelSection;
  parentSelector?: string;
  beforeSelector: string;
}> = [
  {
    columnSelector: ".account-dashboard-left-column",
    section: "overview",
    // Keep the admin status first, then Health, then the Featured Links heading/form.
    parentSelector: ".account-dashboard-left-base",
    beforeSelector: ".account-showcase-featured-section",
  },
  {
    columnSelector: ".account-dashboard-youtube-column",
    section: "steps",
    beforeSelector: ".account-dashboard-featured-card-list",
  },
  {
    columnSelector: ".account-dashboard-media-column",
    section: "running",
    beforeSelector: ".account-dashboard-featured-card-list",
  },
];

function ensureAdminPanel(main: HTMLElement) {
  const dashboard = main.querySelector<HTMLElement>(".account-dashboard-grid");
  if (!dashboard) return;

  const state = adminAccessByMain.get(main);
  const forcePublicView = new URLSearchParams(window.location.search).get("view") === "public";

  const placements = adminHealthPlacements.map((placement) => {
    const column = dashboard.querySelector<HTMLElement>(placement.columnSelector);
    if (!column) return { ...placement, host: null as HTMLDivElement | null };

    const parent = placement.parentSelector
      ? column.querySelector<HTMLElement>(placement.parentSelector)
      : column;
    if (!parent) return { ...placement, host: null as HTMLDivElement | null };

    // Reuse existing hosts so subsequent MutationObserver passes can repair their
    // position if dashboard content changes, without creating another React root.
    let host = dashboard.querySelector<HTMLDivElement>(
      `[data-health-admin-host='true'][data-health-section='${placement.section}']`,
    );
    if (!host) {
      host = createHost("health-admin-bootstrap-root", "data-health-admin-host");
      host.setAttribute("data-health-section", placement.section);
    }

    if (host.parentElement !== parent) parent.append(host);
    const anchor = parent.querySelector<HTMLElement>(
      `:scope > ${placement.beforeSelector}`,
    );
    if (anchor && anchor !== host) {
      if (host.nextElementSibling !== anchor) parent.insertBefore(host, anchor);
    } else if (!anchor && parent.lastElementChild !== host) {
      // A Featured Links card list can be conditionally absent when there are no
      // cards. Append for now; the next observer pass moves Health before it if it appears.
      parent.append(host);
    }

    return { ...placement, host };
  });

  const hosts = placements.map((placement) => placement.host);
  if (hosts.some((host) => !host)) return;

  if (forcePublicView) {
    // Force every embedded health panel to read the public endpoint and remove any
    // already-mounted admin UI when an administrator opens their own shared link.
    if (state !== "public") {
      adminAccessByMain.set(main, "public");
      placements.forEach(({ host }) => {
        if (!host) return;
        const existingRoot = mountedRoots.get(host);
        if (existingRoot) {
          existingRoot.unmount();
          mountedRoots.delete(host);
        }
      });
    }
    placements.forEach(({ section, host }) => {
      if (host) mountRoot(host, <HealthAdminPanel isAdmin={false} section={section} />);
    });
    return;
  }

  // Support switching back from the public share URL to the owner's admin view
  // without requiring a full reload.
  if (state === "public") {
    adminAccessByMain.delete(main);
    placements.forEach(({ host }) => {
      if (!host) return;
      const existingRoot = mountedRoots.get(host);
      if (existingRoot) {
        existingRoot.unmount();
        mountedRoots.delete(host);
      }
    });
  }

  if (state === "pending") return;
  if (state === "denied") {
    placements.forEach(({ section, host }) => {
      if (host) mountRoot(host, <HealthAdminPanel isAdmin={false} section={section} />);
    });
    return;
  }
  if (state === "allowed") {
    placements.forEach(({ section, host }) => {
      if (host) mountRoot(host, <HealthAdminPanel isAdmin={true} section={section} />);
    });
    return;
  }

  adminAccessByMain.set(main, "pending");
  void fetch(`${API_BASE_URL}/api/health/admin/summary`, {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  }).then((response) => {
    const currentHosts = placements.map(({ host }) => host);
    if (currentHosts.some((host) => !host || !host.isConnected)) {
      adminAccessByMain.delete(main);
      currentHosts.forEach((host) => host?.remove());
      return;
    }
    // A request started in admin mode must not switch public mode back to admin
    // if its response arrives after the shared URL has been opened.
    if (adminAccessByMain.get(main) === "public") return;
    if (!response.ok) {
      adminAccessByMain.set(main, "denied");
      placements.forEach(({ section, host }) => {
        if (host) mountRoot(host, <HealthAdminPanel isAdmin={false} section={section} />);
      });
      return;
    }
    adminAccessByMain.set(main, "allowed");
    placements.forEach(({ section, host }) => {
      if (host) mountRoot(host, <HealthAdminPanel isAdmin={true} section={section} />);
    });
  }).catch(() => {
    if (adminAccessByMain.get(main) === "public") return;
    adminAccessByMain.set(main, "denied");
    placements.forEach(({ section, host }) => {
      if (host) mountRoot(host, <HealthAdminPanel isAdmin={false} section={section} />);
    });
  });
}

function ensureAccountShareButton(statusCard: HTMLElement) {
  let host = statusCard.querySelector<HTMLDivElement>(
    ":scope > [data-account-share-host='true']",
  );
  if (!host) {
    host = createHost("account-share-bootstrap-root", "data-account-share-host");
  }

  const presenceRow = statusCard.querySelector<HTMLElement>(
    ":scope > .account-presence-row",
  );
  if (presenceRow && presenceRow.parentElement === statusCard) {
    if (host.parentElement !== statusCard || host.previousElementSibling !== presenceRow) {
      presenceRow.insertAdjacentElement("afterend", host);
    }
  } else if (host.parentElement !== statusCard) {
    statusCard.append(host);
  }

  mountRoot(host, <AccountShareButton />);
}

function ensurePublicWidget(rail: HTMLElement) {
  if (rail.querySelector(":scope > [data-health-widget-host='true']")) return;
  const host = createHost("blog-feed-health-widget-root", "data-health-widget-host");
  rail.append(host);
  mountRoot(host, <HealthWidget />);
}

function syncHealthWidgets() {
  for (const [host, root] of mountedRoots) {
    if (!host.isConnected) {
      root.unmount();
      mountedRoots.delete(host);
    }
  }

  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/account") {
    const statusCard = document.querySelector<HTMLElement>(".account-dashboard-status");
    if (statusCard) ensureAccountShareButton(statusCard);
    const main = document.querySelector<HTMLElement>(".account-page-main");
    if (main) ensureAdminPanel(main);
  }
  if (path === "/feed") {
    const rail = document.querySelector<HTMLElement>(".blog-feed-widget-rail");
    if (rail) ensurePublicWidget(rail);
  }
}

if (typeof document !== "undefined" && document.body) {
  const observer = new MutationObserver(syncHealthWidgets);
  observer.observe(document.body, { childList: true, subtree: true });
  syncHealthWidgets();
}
