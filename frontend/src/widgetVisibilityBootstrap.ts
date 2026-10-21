import { API_BASE_URL } from "./services/apiBase";

type WidgetKey = "youtubeLibrary" | "music" | "health";
type WidgetVisibility = Record<WidgetKey, boolean>;
type HealthAvailability = {
  hasAny: boolean;
  hasSteps: boolean;
  hasRunning: boolean;
};

const DEFAULT_WIDGETS: WidgetVisibility = {
  youtubeLibrary: false,
  music: false,
  health: false,
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
    const [summaryResult, exerciseResult] = await Promise.allSettled([
      fetchJson<Record<string, any>>("/api/health/public-summary", { credentials: "omit" }),
      fetchJson<Record<string, any>>("/api/health/exercises/public", { credentials: "omit" }),
    ]);
    const summary = summaryResult.status === "fulfilled" ? summaryResult.value : null;
    const exercise = exerciseResult.status === "fulfilled" ? exerciseResult.value : null;
    const steps = summary?.steps;
    const hasSteps = Boolean(
      steps?.today != null ||
      Number(steps?.observedDays7d || 0) > 0 ||
      (Array.isArray(steps?.recentDays) && steps.recentDays.length > 0) ||
      summary?.latestHeartRate ||
      summary?.latestRun ||
      (Array.isArray(summary?.recentRuns) && summary.recentRuns.length > 0) ||
      (Array.isArray(summary?.recentHeartRates) && summary.recentHeartRates.length > 0)
    );
    const hasExercise = Boolean(
      exercise?.latestSession ||
      (Array.isArray(exercise?.sessions) && exercise.sessions.length > 0) ||
      (Array.isArray(exercise?.recentSessions) && exercise.recentSessions.length > 0)
    );
    const hasRunning = Boolean(
      summary?.latestRun ||
      (Array.isArray(summary?.recentRuns) && summary.recentRuns.length > 0) ||
      summary?.latestHeartRate ||
      (Array.isArray(summary?.recentHeartRates) && summary.recentHeartRates.length > 0) ||
      hasExercise
    );
    const value = { hasAny: hasSteps || hasExercise, hasSteps, hasRunning };
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

function createToggle(key: WidgetKey, labelText: string): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.dataset.showcaseWidgetToggle = key;
  wrapper.style.cssText = "display:flex;flex-direction:column;align-items:flex-start;gap:3px;margin-top:8px;max-width:100%;font:12px/1.4 Arial,sans-serif;color:#536174;";
  const label = document.createElement("label");
  label.style.cssText = "display:inline-flex;align-items:center;gap:7px;cursor:pointer;font:inherit;";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.dataset.showcaseWidgetToggleInput = key;
  checkbox.style.cssText = "width:15px;height:15px;margin:0;accent-color:#111827;";
  const text = document.createElement("span");
  text.textContent = labelText;
  const status = document.createElement("span");
  status.dataset.showcaseWidgetToggleStatus = key;
  status.setAttribute("role", "status");
  status.style.cssText = "font-size:11px;color:#9b2c2c;overflow-wrap:anywhere;";
  label.append(checkbox, text);
  wrapper.append(label, status);
  checkbox.addEventListener("change", () => {
    void updateVisibility(key, checkbox.checked);
  });
  return wrapper;
}

function ensureToggle(target: HTMLElement | null, key: WidgetKey, label: string): void {
  if (!target) return;
  let wrapper = target.querySelector<HTMLDivElement>(`:scope > [data-showcase-widget-toggle="${key}"]`);
  if (!wrapper) {
    wrapper = createToggle(key, label);
    target.append(wrapper);
  }
  const checkbox = wrapper.querySelector<HTMLInputElement>("input");
  if (checkbox) {
    checkbox.checked = widgets[key];
    checkbox.disabled = !settingsLoaded || saving.size > 0;
  }
}

function ensureAdminControls(): void {
  if (!canManageWidgets()) return;
  const youtubeHeading = document.querySelector<HTMLElement>(".account-dashboard-youtube .showcase-section-heading");
  ensureToggle(youtubeHeading, "youtubeLibrary", "Show YouTube Library on public profile");

  const musicHeading = document.querySelector<HTMLElement>(".account-showcase-ytmusic-section .showcase-mini-heading");
  ensureToggle(musicHeading, "music", "Enable shared music widget on public profile");

  const healthHeading = document.querySelector<HTMLElement>(".health-admin-overview .health-panel-heading");
  ensureToggle(healthHeading, "health", "Show Health on public profile");
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
  document.querySelectorAll<HTMLInputElement>("[data-showcase-widget-toggle-input]")
    .forEach((input) => {
      const key = input.dataset.showcaseWidgetToggleInput as WidgetKey | undefined;
      if (!key) return;
      input.checked = widgets[key];
      input.disabled = !settingsLoaded || saving.size > 0;
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

function hasYoutubeLibraryContent(panel: HTMLElement | null): boolean {
  return Boolean(panel?.querySelector(".showcase-youtube-playlist-entry"));
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

function applyPublicAccountVisibility(health: HealthAvailability): void {
  const youtubePanel = document.querySelector<HTMLElement>(".account-dashboard-youtube");
  const spotifyPanel = Array.from(document.querySelectorAll<HTMLElement>(".account-showcase-mini-section"))
    .find((panel) => headingTitle(panel) === "spotify") || null;
  const musicPanel = document.querySelector<HTMLElement>(".account-showcase-ytmusic-section");
  const healthOverviewHost = document.querySelector<HTMLElement>("[data-health-admin-host='true'][data-health-section='overview']");
  const healthStepsHost = document.querySelector<HTMLElement>("[data-health-admin-host='true'][data-health-section='steps']");
  const healthRunningHost = document.querySelector<HTMLElement>("[data-health-admin-host='true'][data-health-section='running']");

  const hasMusicContent = hasYtMusicContent(musicPanel);
  const showYtMusic = widgets.music && hasMusicContent;
  const showSpotify = widgets.music && !hasMusicContent && hasSpotifyContent(spotifyPanel);

  setManagedVisibility(youtubePanel, widgets.youtubeLibrary && hasYoutubeLibraryContent(youtubePanel));
  setManagedVisibility(musicPanel, showYtMusic);
  setManagedVisibility(spotifyPanel, showSpotify);

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
  const nowPlaying = document.querySelector<HTMLElement>(".blog-feed-now-playing-teaser");
  setManagedVisibility(nowPlaying, widgets.music && hasFeedNowPlayingContent(nowPlaying));

  const healthWidget = document.querySelector<HTMLElement>(".blog-feed-health-widget");
  setManagedVisibility(healthWidget, widgets.health && health.hasAny);
}

function restorePublicManagedVisibility(): void {
  const selector = [
    ".account-dashboard-youtube",
    ".account-showcase-mini-section",
    "[data-health-admin-host='true']",
    ".blog-feed-now-playing-teaser",
    ".blog-feed-health-widget",
  ].join(",");
  document.querySelectorAll<HTMLElement>(selector).forEach(restoreVisibility);
}

async function runSync(): Promise<void> {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/account" && path !== "/feed") {
    restorePublicManagedVisibility();
    return;
  }

  await loadSettings();

  if (isAccountPath()) {
    if (canManageWidgets()) {
      restorePublicManagedVisibility();
      ensureAdminControls();
      updateToggleControls();
      return;
    }
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
  window.addEventListener("health-data-updated", () => {
    healthAvailability = null;
    healthUpdatedAt = 0;
    sync();
  });
  sync();
}
