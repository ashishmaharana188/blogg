import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";
import HealthAdminPanel from "./pages/Account/HealthAdminPanel";
import HealthWidget from "./pages/BloggFeed/HealthWidget";
import AccountShareButton from "./components/AccountShareButton";
import { API_BASE_URL } from "./services/apiBase";
import { capturePublicDashboardPngBase64 } from "./utils/domSnapshot";

const mountedRoots = new Map<HTMLElement, Root>();
type AdminAccessState = "pending" | "allowed" | "denied" | "public";
const adminAccessByMain = new WeakMap<HTMLElement, AdminAccessState>();
let snapshotCaptureLocation = "";

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

function ensureAccountShareButton(statusCard: HTMLElement, canUpdateSnapshot: boolean) {
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

  const permissionValue = String(canUpdateSnapshot);
  const permissionChanged = host.dataset.canUpdateSnapshot !== permissionValue;
  host.dataset.canUpdateSnapshot = permissionValue;
  const existingRoot = mountedRoots.get(host);
  if (existingRoot && permissionChanged) {
    existingRoot.render(<AccountShareButton canUpdateSnapshot={canUpdateSnapshot} />);
  } else if (!existingRoot) {
    mountRoot(host, <AccountShareButton canUpdateSnapshot={canUpdateSnapshot} />);
  }
}

function ensurePublicWidget(rail: HTMLElement) {
  if (rail.querySelector(":scope > [data-health-widget-host='true']")) return;
  const host = createHost("blog-feed-health-widget-root", "data-health-widget-host");
  rail.append(host);
  mountRoot(host, <HealthWidget />);
}

/** Hide admin input forms while keeping their parent dashboard sections visible.
 * The Account page contains the Featured Links form and Samsung Health form. We
 * hide every form inside this page in public mode, not just two class names, and
 * apply the rule inline so component CSS cannot override it.
 */
let publicInputObserver: MutationObserver | null = null;
let publicInputObserverPage: HTMLElement | null = null;

function syncPublicAdminInputVisibility(page: HTMLElement, publicView: boolean) {
  const selector = "form, .health-import-form, .showcase-add-link-form";
  page.dataset.accountShareView = publicView ? "public" : "admin";
  page.querySelectorAll<HTMLElement>(selector).forEach((element) => {
    const isManaged = element.hasAttribute("data-public-view-hidden-input");

    if (publicView) {
      if (!isManaged) {
        element.dataset.publicViewOriginalDisplay = element.style.getPropertyValue("display");
        element.dataset.publicViewOriginalDisplayPriority = element.style.getPropertyPriority("display");
        element.setAttribute("data-public-view-hidden-input", "true");
      }
      element.style.setProperty("display", "none", "important");
      return;
    }

    if (!isManaged) return;
    const originalDisplay = element.dataset.publicViewOriginalDisplay || "";
    const originalPriority = element.dataset.publicViewOriginalDisplayPriority || "";
    if (originalDisplay) element.style.setProperty("display", originalDisplay, originalPriority);
    else element.style.removeProperty("display");
    delete element.dataset.publicViewOriginalDisplay;
    delete element.dataset.publicViewOriginalDisplayPriority;
    element.removeAttribute("data-public-view-hidden-input");
  });
}

function enforcePublicInputVisibility(page: HTMLElement, publicView: boolean) {
  syncPublicAdminInputVisibility(page, publicView);

  // The health panels are mounted into separate React roots after AccountPage
  // first renders. Watch for later form insertions so they are hidden immediately.
  if (publicView) {
    if (publicInputObserverPage !== page) {
      publicInputObserver?.disconnect();
      publicInputObserverPage = page;
      publicInputObserver = new MutationObserver(() => {
        syncPublicAdminInputVisibility(page, true);
      });
      publicInputObserver.observe(page, { childList: true, subtree: true });
    }
    return;
  }

  if (publicInputObserverPage === page) {
    publicInputObserver?.disconnect();
    publicInputObserver = null;
    publicInputObserverPage = null;
  }
}

function showSnapshotCaptureStatus(message: string, isError = false) {
  let status = document.getElementById("account-share-snapshot-status");
  if (!status) {
    status = document.createElement("div");
    status.id = "account-share-snapshot-status";
    status.setAttribute("role", "status");
    status.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:10000;max-width:min(440px,calc(100vw - 36px));box-sizing:border-box;padding:12px 15px;border:1px solid #d7dee7;border-radius:12px;background:#fff;color:#273246;box-shadow:0 8px 28px rgb(15 23 42 / 16%);font:13px/1.5 Arial,sans-serif";
    document.body.appendChild(status);
  }
  status.textContent = message;
  status.style.borderColor = isError ? "#e4a2a2" : "#d7dee7";
  status.style.color = isError ? "#9b2c2c" : "#273246";
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

async function waitForPublicDashboardToSettle(root: HTMLElement) {
  const startedAt = Date.now();
  let lastMutationAt = startedAt;
  const observer = new MutationObserver(() => { lastMutationAt = Date.now(); });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  try {
    // Give the public API calls and injected Samsung Health panels time to render,
    // then wait for a short quiet period (bounded so the capture cannot hang).
    const minimumTime = startedAt + 2800;
    const maximumTime = startedAt + 14000;
    while (Date.now() < maximumTime) {
      await wait(250);
      const hasAllHealthPanels = root.querySelectorAll("[data-health-admin-host='true']").length >= 3;
      if (Date.now() >= minimumTime && hasAllHealthPanels && Date.now() - lastMutationAt >= 1100) break;
    }
  } finally {
    observer.disconnect();
  }

  const frame = root.getBoundingClientRect();
  const visibleImages = Array.from(root.querySelectorAll("img")).filter((image) => {
    const rect = image.getBoundingClientRect();
    return rect.right > frame.left && rect.left < frame.right && rect.bottom > frame.top && rect.top < frame.bottom;
  });
  await Promise.race([
    Promise.all(visibleImages.map((image) => image.decode().catch(() => undefined))),
    wait(2500),
  ]);
}

async function captureAndSavePublicDashboardSnapshot() {
  showSnapshotCaptureStatus("Preparing the public dashboard snapshot…");
  try {
    const page = document.querySelector<HTMLElement>(".account-page");
    if (!page) throw new Error("The account dashboard was not found.");
    await waitForPublicDashboardToSettle(page);
    showSnapshotCaptureStatus("Capturing the 1200 × 630 preview image…");
    const pngBase64 = await capturePublicDashboardPngBase64(page);
    showSnapshotCaptureStatus("Saving the new preview and replacing the previous snapshot…");
    const response = await fetch(`${API_BASE_URL}/api/admin/share/account-snapshot`, {
      method: "PUT",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ pngBase64 }),
    });
    const result = await response.json().catch(() => ({})) as { message?: string; updatedAt?: number };
    if (!response.ok) throw new Error(result.message || `Snapshot upload failed (${response.status}).`);
    const version = String(result.updatedAt || Date.now());
    showSnapshotCaptureStatus("Snapshot saved. This replaces the previous image; no snapshot history is kept.");
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: "blogg-account-snapshot-updated", version }, window.location.origin);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update the preview snapshot.";
    showSnapshotCaptureStatus(message, true);
  }
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
    const params = new URLSearchParams(window.location.search);
    const forcePublicView = params.get("view") === "public";
    const wantsSnapshot = forcePublicView && params.get("captureSnapshot") === "1";
    const accountPage = document.querySelector<HTMLElement>(".account-page");
    const statusCard = document.querySelector<HTMLElement>(".account-dashboard-status");
    const main = document.querySelector<HTMLElement>(".account-page-main");
    if (main) ensureAdminPanel(main);

    // Public display mode also applies to anonymous/non-admin visitors on the
    // ordinary /account URL. The state is set after the admin-only summary
    // endpoint rejects their session; the body MutationObserver runs this sync
    // again, at which point the admin-only heading cards are removed as well.
    const adminState = main ? adminAccessByMain.get(main) : undefined;
    const publicDisplay = forcePublicView || adminState === "denied" || adminState === "public";
    accountPage?.classList.toggle("account-share-public-view", publicDisplay);
    if (accountPage) enforcePublicInputVisibility(accountPage, publicDisplay);

    if (forcePublicView) {
      if (statusCard) {
        const shareHost = statusCard.querySelector<HTMLElement>(":scope > [data-account-share-host='true']");
        if (shareHost) {
          const shareRoot = mountedRoots.get(shareHost);
          if (shareRoot) {
            shareRoot.unmount();
            mountedRoots.delete(shareHost);
          }
          shareHost.remove();
        }
      }
    }
    if (!forcePublicView && statusCard) {
      ensureAccountShareButton(statusCard, main ? adminAccessByMain.get(main) === "allowed" : false);
    }
    if (wantsSnapshot && main) {
      const captureLocation = `${window.location.pathname}${window.location.search}`;
      if (snapshotCaptureLocation !== captureLocation) {
        snapshotCaptureLocation = captureLocation;
        void captureAndSavePublicDashboardSnapshot();
      }
    } else if (!wantsSnapshot) {
      snapshotCaptureLocation = "";
    }
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
