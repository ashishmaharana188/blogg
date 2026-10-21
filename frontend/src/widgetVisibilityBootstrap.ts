import { API_BASE_URL } from "./services/apiBase";

type WidgetKey = "music" | "health" | "reading";
type WidgetVisibility = Record<WidgetKey, boolean>;
type HealthAvailability = {
  hasAny: boolean;
  hasSteps: boolean;
  hasRunning: boolean;
};

const DEFAULT_WIDGETS: WidgetVisibility = {
  music: false,
  health: false,
  reading: false,
};

let widgets: WidgetVisibility = { ...DEFAULT_WIDGETS };
let settingsLoaded = false;
let settingsPromise: Promise<void> | null = null;
let healthAvailability: HealthAvailability | null = null;
let healthPromise: Promise<HealthAvailability> | null = null;
let healthUpdatedAt = 0;
const saving = new Set<WidgetKey>();
let syncing = false;
let syncQueued = false;
let toggleLayer: HTMLDivElement | null = null;
const toggleTargets: Partial<Record<WidgetKey, HTMLElement>> = {};

async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({})) as T & { message?: string };
  if (!response.ok) throw new Error(payload.message || `Request failed (${response.status})`);
  return payload;
}

async function loadSettings(): Promise<void> {
  if (settingsLoaded) return;
  if (settingsPromise) return settingsPromise;
  settingsPromise = fetchJson<{ widgets?: Partial<WidgetVisibility> }>("/api/showcase/widget-visibility", {
    credentials: "omit",
  }).then((data) => {
    widgets = { ...DEFAULT_WIDGETS, ...(data.widgets || {}) };
  }).catch(() => {
    // Fail closed: a settings outage must not accidentally publish every widget.
    widgets = { ...DEFAULT_WIDGETS };
  }).finally(() => {
    settingsLoaded = true;
    settingsPromise = null;
  });
  return settingsPromise;
}

async function loadHealthAvailability(force = false): Promise<HealthAvailability> {
  if (!force && healthAvailability && Date.now() - healthUpdatedAt < 30_000) return healthAvailability;
  if (healthPromise) return healthPromise;

  healthPromise = (async () => {
    const [summaryResult, exerciseResult, sleepResult] = await Promise.allSettled([
      fetchJson<Record<string, any>>("/api/health/public-summary", { credentials: "omit" }),
      fetchJson<Record<string, any>>("/api/health/exercises/public", { credentials: "omit" }),
      fetchJson<{ sleep?: Record<string, any> | null }>("/api/health/sleep-summary", { credentials: "omit" }),
    ]);
    const summary = summaryResult.status === "fulfilled" ? summaryResult.value : null;
    const exercise = exerciseResult.status === "fulfilled" ? exerciseResult.value : null;
    const sleep = sleepResult.status === "fulfilled" ? sleepResult.value.sleep : null;
    const steps = summary?.steps;
    const hasStepRecords = Boolean(
      steps?.today != null ||
      Number(steps?.observedDays7d || 0) > 0 ||
      (Array.isArray(steps?.recentDays) && steps.recentDays.length > 0)
    );
    const hasRunRecords = Boolean(
      summary?.latestRun ||
      (Array.isArray(summary?.recentRuns) && summary.recentRuns.length > 0)
    );
    const exerciseSessions = Array.isArray(exercise?.sessions) && exercise.sessions.length
      ? exercise.sessions
      : Array.isArray(exercise?.recentSessions) ? exercise.recentSessions : [];
    const selectedExerciseMetrics = Array.isArray(exercise?.selectedMetrics) ? exercise.selectedMetrics : [];
    const hasSelectedExerciseMetrics = selectedExerciseMetrics.some((id: unknown) => typeof id === "string" && id !== "heart_rate");
    const hasSelectedExerciseHeartRate = selectedExerciseMetrics.includes("heart_rate") && exerciseSessions.some((session: Record<string, any>) => {
      const raw = session?.values?.heartRate;
      const direct = [session?.avgHeartRate, session?.minHeartRate, session?.maxHeartRate].some((value) => typeof value === "number" && Number.isFinite(value));
      const selected = raw && typeof raw === "object" && [raw.average, raw.minimum, raw.maximum].some((value) => typeof value === "number" && Number.isFinite(value));
      return direct || selected;
    });
    const hasHeartRecords = Boolean(
      summary?.latestHeartRate ||
      (Array.isArray(summary?.recentHeartRates) && summary.recentHeartRates.length > 0) ||
      hasSelectedExerciseHeartRate
    );
    const hasExercise = Boolean(
      hasSelectedExerciseMetrics && (
        exercise?.latestSession || exerciseSessions.length > 0
      )
    );
    // Daily Activity owns step and running-session information; the other
    // profile panel owns heart-rate measurements and exercise-specific records.
    const hasSleepRecords = Boolean(
      sleep && Number(sleep.observedNights7d || 0) > 0 && Array.isArray(sleep.recentDays) && sleep.recentDays.length > 0
    );
    const hasSteps = hasStepRecords || hasRunRecords || hasSleepRecords;
    const hasRunning = hasHeartRecords || hasExercise;
    const value = { hasAny: hasSteps || hasRunning, hasSteps, hasRunning };
    healthAvailability = value;
    healthUpdatedAt = Date.now();
    return value;
  })().catch(() => {
    const empty = { hasAny: false, hasSteps: false, hasRunning: false };
    healthAvailability = empty;
    healthUpdatedAt = Date.now();
    return empty;
  }).finally(() => {
    healthPromise = null;
  });

  return healthPromise;
}

function isAccountPath(): boolean {
  return (window.location.pathname.replace(/\/+$/, "") || "/") === "/account";
}

function isForcedPublicView(): boolean {
  return new URLSearchParams(window.location.search).get("view") === "public";
}

function isPublicProfile(): boolean {
  if (isForcedPublicView()) return true;
  return Boolean(document.querySelector(".account-page.account-share-public-view"));
}

function canManageWidgets(): boolean {
  return isAccountPath() && !isForcedPublicView() && Boolean(document.querySelector(".account-activity-select"));
}

function ensureToggleStyles(): void {
  if (document.getElementById("showcase-widget-dot-toggle-styles")) return;
  const style = document.createElement("style");
  style.id = "showcase-widget-dot-toggle-styles";
  style.textContent = `
    #showcase-widget-toggle-layer {
      position: fixed;
      inset: 0;
      z-index: 10000;
      pointer-events: none;
      overflow: visible;
    }
    .showcase-widget-dot-toggle-wrap {
      position: absolute;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      margin: 0;
      padding: 0;
      transform: translate(-50%, -50%);
      pointer-events: auto;
      font: 12px/1.4 Arial, sans-serif;
    }
    .showcase-widget-dot-toggle {
      display: grid;
      place-items: center;
      box-sizing: border-box;
      width: 14px;
      height: 14px;
      margin: 0;
      padding: 0;
      border: 1.25px solid #9aa4b2;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 1px 5px rgb(15 23 42 / 18%);
      cursor: pointer;
      transition: border-color .15s ease, background .15s ease, transform .15s ease;
    }
    .showcase-widget-dot-toggle::after {
      content: "";
      display: block;
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: #9aa4b2;
      transition: width .15s ease, height .15s ease, background .15s ease;
    }
    .showcase-widget-dot-toggle[aria-checked="true"] {
      border-color: #14845b;
      background: #e9f8f0;
    }
    .showcase-widget-dot-toggle[aria-checked="true"]::after {
      width: 6px;
      height: 6px;
      background: #14845b;
    }
    .showcase-widget-dot-toggle:hover:not(:disabled) { transform: scale(1.06); }
    .showcase-widget-dot-toggle:focus-visible {
      outline: 2px solid #8fd4b5;
      outline-offset: 2px;
    }
    .showcase-widget-dot-toggle:disabled { opacity: .55; cursor: wait; }
    .showcase-widget-dot-status {
      position: absolute;
      top: 25px;
      right: 0;
      max-width: min(280px, 75vw);
      box-sizing: border-box;
      padding: 4px 7px;
      border-radius: 5px;
      color: #9b2c2c;
      background: #fff7f7;
      box-shadow: 0 2px 8px rgb(15 23 42 / 13%);
      overflow-wrap: anywhere;
      font: 11px/1.4 Arial, sans-serif;
    }
    .showcase-widget-dot-status:empty { display: none; }

    /* Responsive dashboard flow. The legacy column wrappers become transparent
       to the grid so Health cards can share a full-width, predictable flow. */
    @media (max-width: 1120px) {
      .account-page-main.account-page-main-stack .account-dashboard-grid {
        display: grid !important;
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        align-items: start;
        gap: 14px !important;
      }
      .account-dashboard-grid > .account-dashboard-left-column,
      .account-dashboard-grid > .account-dashboard-youtube-column,
      .account-dashboard-grid > .account-dashboard-media-column,
      .account-dashboard-left-base,
      .health-admin-bootstrap-root {
        display: contents !important;
      }
      .account-dashboard-status {
        order: 0;
        grid-column: 1 / -1;
        min-width: 0;
      }
      .account-dashboard-youtube {
        order: 1;
        grid-column: auto;
        min-width: 0;
        height: auto;
      }
      /* Keep the music cards as a single responsive unit beside YouTube. */
      .account-dashboard-media-stack {
        order: 2;
        grid-column: auto;
        display: flex !important;
        flex-direction: column !important;
        align-items: stretch;
        align-self: start;
        gap: 12px !important;
        min-width: 0;
      }
      .account-dashboard-media-stack > .account-showcase-section {
        width: 100%;
        max-width: none;
        min-width: 0;
        box-sizing: border-box;
      }
      /* All Health cards form one consecutive group after the primary widgets. */
      .health-admin-overview {
        order: 10;
        grid-column: 1 / -1;
        min-width: 0;
      }
      .health-admin-steps {
        order: 11;
        grid-column: 1 / -1;
        min-width: 0;
      }
      .health-admin-running {
        order: 12;
        grid-column: 1;
        min-width: 0;
      }
      .health-admin-exercise {
        order: 13;
        grid-column: 2;
        min-width: 0;
      }
      /* Feature cards and future standard showcase cards use the same auto-flow. */
      .account-dashboard-grid .account-dashboard-featured-card-list,
      .account-dashboard-grid .account-showcase-featured-section,
      .account-dashboard-grid .account-showcase-section:not(.account-dashboard-youtube):not(.account-showcase-mini-section):not(.account-showcase-ytmusic-section):not(.account-health-card) {
        order: 40;
        grid-column: 1 / -1;
        min-width: 0;
      }
    }
    @media (max-width: 720px) {
      .account-page-main.account-page-main-stack .account-dashboard-grid {
        grid-template-columns: minmax(0, 1fr) !important;
        gap: 12px !important;
      }
      .account-dashboard-status,
      .account-dashboard-youtube,
      .account-dashboard-media-stack,
      .health-admin-overview,
      .health-admin-steps,
      .health-admin-running,
      .health-admin-exercise,
      .account-dashboard-grid .account-dashboard-featured-card-list,
      .account-dashboard-grid .account-showcase-featured-section,
      .account-dashboard-grid .account-showcase-section:not(.account-dashboard-youtube):not(.account-showcase-mini-section):not(.account-showcase-ytmusic-section):not(.account-health-card) {
        grid-column: 1 / -1;
      }
      .account-dashboard-status { order: 0; }
      .account-dashboard-youtube { order: 1; }
      .account-dashboard-media-stack { order: 2; }
      .health-admin-overview { order: 10; }
      .health-admin-steps { order: 11; }
      .health-admin-running { order: 12; }
      .health-admin-exercise { order: 13; }
      .account-dashboard-grid .account-dashboard-featured-card-list,
      .account-dashboard-grid .account-showcase-featured-section,
      .account-dashboard-grid .account-showcase-section:not(.account-dashboard-youtube):not(.account-showcase-mini-section):not(.account-showcase-ytmusic-section):not(.account-health-card) {
        order: 40;
      }
    }
  `;
  document.head.append(style);
}

function getToggleLayer(): HTMLDivElement {
  ensureToggleStyles();
  let layer = document.getElementById("showcase-widget-toggle-layer") as HTMLDivElement | null;
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "showcase-widget-toggle-layer";
    layer.setAttribute("aria-label", "Administrator widget visibility controls");
    document.body.append(layer);
  }
  toggleLayer = layer;
  return layer;
}

function setToggleLayerVisible(visible: boolean): void {
  const layer = toggleLayer || document.getElementById("showcase-widget-toggle-layer") as HTMLDivElement | null;
  if (layer) layer.style.display = visible ? "block" : "none";
}

function positionToggle(key: WidgetKey, target: HTMLElement | null): void {
  const layer = toggleLayer || document.getElementById("showcase-widget-toggle-layer") as HTMLDivElement | null;
  const wrapper = layer?.querySelector<HTMLDivElement>(`[data-showcase-widget-toggle="${key}"]`);
  if (!wrapper || !target || !target.isConnected) {
    if (wrapper) wrapper.style.display = "none";
    return;
  }

  const rect = target.getBoundingClientRect();
  const isVisible = rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight && rect.right >= 0 && rect.left <= window.innerWidth;
  if (!isVisible) {
    wrapper.style.display = "none";
    return;
  }

  const left = Math.max(14, Math.min(window.innerWidth - 14, rect.right));
  const top = Math.max(14, Math.min(window.innerHeight - 14, rect.top));
  wrapper.style.left = `${left}px`;
  wrapper.style.top = `${top}px`;
  wrapper.style.display = "flex";
}

function positionAllToggles(): void {
  (Object.keys(DEFAULT_WIDGETS) as WidgetKey[]).forEach((key) => {
    positionToggle(key, toggleTargets[key] || null);
  });
}

function createToggle(key: WidgetKey, labelText: string): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.className = "showcase-widget-dot-toggle-wrap";
  wrapper.dataset.showcaseWidgetToggle = key;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "showcase-widget-dot-toggle";
  button.dataset.showcaseWidgetToggleInput = key;
  button.setAttribute("role", "switch");
  button.setAttribute("aria-checked", "false");
  button.setAttribute("aria-label", labelText);
  button.title = `${labelText}: disabled`;

  const status = document.createElement("span");
  status.className = "showcase-widget-dot-status";
  status.dataset.showcaseWidgetToggleStatus = key;
  status.setAttribute("role", "status");

  wrapper.append(button, status);
  button.addEventListener("click", () => {
    void updateVisibility(key, !widgets[key]);
  });
  return wrapper;
}

function ensureToggle(target: HTMLElement | null, key: WidgetKey, labelText: string): void {
  const layer = getToggleLayer();
  let wrapper = layer.querySelector<HTMLDivElement>(`[data-showcase-widget-toggle="${key}"]`);

  // Never append controls inside a React-owned card. A separate overlay avoids
  // corrupting React's child tree when Health, music, or reading state updates.
  if (!wrapper) {
    wrapper = createToggle(key, labelText);
    layer.append(wrapper);
  }

  if (!target) {
    delete toggleTargets[key];
    positionToggle(key, null);
    return;
  }

  toggleTargets[key] = target;
  const button = wrapper.querySelector<HTMLButtonElement>("button");
  if (button) {
    button.setAttribute("aria-label", labelText);
    button.setAttribute("aria-checked", String(widgets[key]));
    button.title = `${labelText}: ${widgets[key] ? "enabled" : "disabled"}`;
    button.disabled = !settingsLoaded || saving.size > 0;
  }
  positionToggle(key, target);
}

function ensureAdminControls(): void {
  if (!canManageWidgets()) return;

  const spotifyPanel = Array.from(document.querySelectorAll<HTMLElement>(".account-showcase-mini-section"))
    .find((panel) => headingTitle(panel) === "spotify") || null;
  const musicPanel = document.querySelector<HTMLElement>(".account-showcase-ytmusic-section") || spotifyPanel;
  ensureToggle(musicPanel, "music", "Show Spotify / YouTube Music on public profile and feed");

  // This is the visible Personal Metrics card, not the admin-only heading selector.
  const healthCard = document.querySelector<HTMLElement>(".health-admin-overview.account-health-card, .health-admin-overview");
  ensureToggle(healthCard, "health", "Show Health / Personal Metrics on public profile and feed");

  const readingCard = document.querySelector<HTMLElement>(".current-reading-panel");
  ensureToggle(readingCard, "reading", "Show Current Reading on public profile and feed");
}

async function updateVisibility(key: WidgetKey, enabled: boolean): Promise<void> {
  if (saving.has(key)) return;
  saving.add(key);
  updateToggleControls();
  setToggleMessage(key, "");

  try {
    const result = await fetchJson<{ widgets: WidgetVisibility }>("/api/admin/showcase/widget-visibility", {
      method: "PATCH",
      credentials: "include",
      body: JSON.stringify({ widget: key, enabled }),
    });
    widgets = { ...DEFAULT_WIDGETS, ...result.widgets };
    settingsLoaded = true;
    if (key === "health") {
      healthAvailability = null;
      healthUpdatedAt = 0;
    }
  } catch (error) {
    setToggleMessage(key, error instanceof Error ? error.message : "Could not save widget visibility.");
  } finally {
    saving.delete(key);
    updateToggleControls();
    sync();
  }
}

function setToggleMessage(key: WidgetKey, message: string): void {
  document.querySelectorAll<HTMLElement>(`[data-showcase-widget-toggle-status="${key}"]`)
    .forEach((element) => { element.textContent = message; });
}

function updateToggleControls(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-showcase-widget-toggle-input]")
    .forEach((button) => {
      const key = button.dataset.showcaseWidgetToggleInput as WidgetKey | undefined;
      if (!key) return;
      button.setAttribute("aria-checked", String(widgets[key]));
      const label = button.getAttribute("aria-label") || "Widget visibility";
      button.title = `${label}: ${widgets[key] ? "enabled" : "disabled"}`;
      button.disabled = !settingsLoaded || saving.size > 0;
    });
}

function setManagedVisibility(element: HTMLElement | null, visible: boolean): void {
  if (!element) return;
  if (element.dataset.showcaseVisibilityManaged !== "true") {
    element.dataset.showcaseVisibilityManaged = "true";
    element.dataset.showcaseVisibilityOriginalDisplay = element.style.getPropertyValue("display");
    element.dataset.showcaseVisibilityOriginalPriority = element.style.getPropertyPriority("display");
  }
  if (!visible) {
    element.style.setProperty("display", "none", "important");
    return;
  }
  const original = element.dataset.showcaseVisibilityOriginalDisplay || "";
  const priority = element.dataset.showcaseVisibilityOriginalPriority || "";
  if (original) element.style.setProperty("display", original, priority);
  else element.style.removeProperty("display");
}

function restoreVisibility(element: HTMLElement | null): void {
  if (!element || element.dataset.showcaseVisibilityManaged !== "true") return;
  const original = element.dataset.showcaseVisibilityOriginalDisplay || "";
  const priority = element.dataset.showcaseVisibilityOriginalPriority || "";
  if (original) element.style.setProperty("display", original, priority);
  else element.style.removeProperty("display");
  delete element.dataset.showcaseVisibilityManaged;
  delete element.dataset.showcaseVisibilityOriginalDisplay;
  delete element.dataset.showcaseVisibilityOriginalPriority;
}

function headingTitle(panel: HTMLElement | null): string {
  return panel?.querySelector("h2")?.textContent?.trim().toLowerCase() || "";
}

function hasYtMusicContent(panel: HTMLElement | null): boolean {
  if (!panel) return false;
  const title = panel.querySelector(".showcase-mini-music-copy strong")?.textContent?.trim() || "";
  return Boolean((title && !/no track selected/i.test(title)) || panel.querySelector(".showcase-ytmusic-public-block .showcase-track"));
}

function hasSpotifyContent(panel: HTMLElement | null): boolean {
  if (!panel) return false;
  const title = panel.querySelector(".showcase-mini-music-copy strong")?.textContent?.trim() || "";
  return Boolean(title && !/^not connected$/i.test(title));
}

function hasFeedNowPlayingContent(panel: HTMLElement | null): boolean {
  const text = panel?.querySelector(".blog-feed-now-playing-sr-only")?.textContent || "";
  return Boolean(text.trim() && !/nothing playing right now/i.test(text));
}

function hasAccountReadingContent(host: HTMLElement | null): boolean {
  return Boolean(host?.querySelector(".current-reading-panel .current-reading-book"));
}

function hasFeedReadingContent(host: HTMLElement | null): boolean {
  return Boolean(host?.querySelector(".blog-feed-current-reading-teaser a.blog-feed-now-playing-artwork-frame"));
}

function applyPublicAccountVisibility(health: HealthAvailability): void {
  const spotifyPanel = Array.from(document.querySelectorAll<HTMLElement>(".account-showcase-mini-section"))
    .find((panel) => headingTitle(panel) === "spotify") || null;
  const musicPanel = document.querySelector<HTMLElement>(".account-showcase-ytmusic-section");
  const readingHost = document.querySelector<HTMLElement>(".current-reading-bootstrap-host");
  const healthOverviewHost = document.querySelector<HTMLElement>("[data-health-admin-host='true'][data-health-section='overview']");
  const healthStepsHost = document.querySelector<HTMLElement>("[data-health-admin-host='true'][data-health-section='steps']");
  const healthRunningHost = document.querySelector<HTMLElement>("[data-health-admin-host='true'][data-health-section='running']");

  const hasMusicContent = hasYtMusicContent(musicPanel);
  const showYtMusic = widgets.music && hasMusicContent;
  const showSpotify = widgets.music && !hasMusicContent && hasSpotifyContent(spotifyPanel);

  // The Spotify and YouTube Music presentations share one administrator setting.
  setManagedVisibility(musicPanel, showYtMusic);
  setManagedVisibility(spotifyPanel, showSpotify);
  setManagedVisibility(readingHost, widgets.reading && hasAccountReadingContent(readingHost));

  // The overview panel is the admin import/configuration form, not a public-facing widget.
  setManagedVisibility(healthOverviewHost, false);
  setManagedVisibility(healthStepsHost, widgets.health && health.hasSteps);
  setManagedVisibility(healthRunningHost, widgets.health && health.hasRunning);

  // A Health panel with no available public records must not leave an empty wrapper.
  const healthHosts = Array.from(document.querySelectorAll<HTMLElement>("[data-health-admin-host='true']"));
  healthHosts.forEach((host) => {
    const section = host.dataset.healthSection;
    if (section === "overview") setManagedVisibility(host, false);
    else if (section === "steps") setManagedVisibility(host, widgets.health && health.hasSteps);
    else if (section === "running") setManagedVisibility(host, widgets.health && health.hasRunning);
  });
}

function applyFeedVisibility(health: HealthAvailability): void {
  const nowPlaying = document.querySelector<HTMLElement>(".blog-feed-now-playing-teaser:not(.blog-feed-current-reading-teaser)");
  setManagedVisibility(nowPlaying, widgets.music && hasFeedNowPlayingContent(nowPlaying));

  const healthWidget = document.querySelector<HTMLElement>(".blog-feed-health-widget");
  const healthLooksEmpty = Boolean(healthWidget?.textContent?.includes("No health data imported yet."));
  setManagedVisibility(healthWidget, widgets.health && health.hasAny && !healthLooksEmpty);

  const readingHost = document.querySelector<HTMLElement>(".current-reading-feed-bootstrap-host");
  setManagedVisibility(readingHost, widgets.reading && hasFeedReadingContent(readingHost));
}

function restorePublicManagedVisibility(): void {
  const selector = [
    ".account-showcase-mini-section",
    ".account-showcase-ytmusic-section",
    ".current-reading-bootstrap-host",
    ".current-reading-feed-bootstrap-host",
    "[data-health-admin-host='true']",
    ".blog-feed-now-playing-teaser",
    ".blog-feed-health-widget",
  ].join(",");
  document.querySelectorAll<HTMLElement>(selector).forEach(restoreVisibility);
}

async function runSync(): Promise<void> {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/account" && path !== "/feed") {
    setToggleLayerVisible(false);
    restorePublicManagedVisibility();
    return;
  }

  await loadSettings();

  if (isAccountPath()) {
    if (canManageWidgets()) {
      restorePublicManagedVisibility();
      ensureAdminControls();
      setToggleLayerVisible(true);
      updateToggleControls();
      positionAllToggles();
      return;
    }
    setToggleLayerVisible(false);
    if (!isPublicProfile()) {
      // Wait for the existing bootstrap to determine whether this /account view
      // belongs to the administrator before making a public visibility decision.
      restorePublicManagedVisibility();
      return;
    }
    if (widgets.health) {
      const health = await loadHealthAvailability();
      applyPublicAccountVisibility(health);
    } else {
      applyPublicAccountVisibility({ hasAny: false, hasSteps: false, hasRunning: false });
    }
    return;
  }

  if (path === "/feed") {
    setToggleLayerVisible(false);
    const health = widgets.health
      ? await loadHealthAvailability()
      : { hasAny: false, hasSteps: false, hasRunning: false };
    applyFeedVisibility(health);
  }
}

function sync(): void {
  if (syncing) {
    syncQueued = true;
    return;
  }
  syncing = true;
  void runSync().catch(() => undefined).finally(() => {
    syncing = false;
    if (syncQueued) {
      syncQueued = false;
      sync();
    }
  });
}

if (typeof document !== "undefined" && document.body) {
  const observer = new MutationObserver(() => sync());
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });
  window.addEventListener("popstate", sync);
  window.addEventListener("resize", positionAllToggles);
  window.addEventListener("scroll", positionAllToggles, true);
  window.addEventListener("health-data-updated", () => {
    healthAvailability = null;
    healthUpdatedAt = 0;
    sync();
  });
  sync();
}
