import { API_BASE_URL } from "./services/apiBase";

type VisibilityResponse = { widgets?: Record<string, unknown> };
type PatchResponse = { widgets?: Record<string, unknown>; message?: string };

// This feature has its own control so it can be added without destabilizing the
// existing Music / Health / Reading visibility bootstrap.
let newsletterVisible = true;
let settingsLoaded = false;
let settingsPromise: Promise<void> | null = null;
let saving = false;
let target: HTMLElement | null = null;
let layer: HTMLDivElement | null = null;
let wrapper: HTMLDivElement | null = null;
let button: HTMLButtonElement | null = null;
let status: HTMLSpanElement | null = null;
let observer: MutationObserver | null = null;
let frame = 0;

function currentPath(): string {
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
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
  settingsPromise = requestJson<VisibilityResponse>("/api/showcase/widget-visibility", {
    credentials: "omit",
  }).then((data) => {
    newsletterVisible = typeof data.widgets?.newsletter === "boolean" ? data.widgets.newsletter : true;
  }).catch(() => {
    // If the visibility endpoint is briefly unavailable, keep existing public behavior.
    newsletterVisible = true;
  }).finally(() => {
    settingsLoaded = true;
    settingsPromise = null;
    applyFeedVisibility();
    updateControl();
  });
  return settingsPromise;
}

function ensureStyles(): void {
  if (document.getElementById("newsletter-visibility-toggle-styles")) return;
  const style = document.createElement("style");
  style.id = "newsletter-visibility-toggle-styles";
  style.textContent = `
    #newsletter-visibility-toggle-layer {
      position: fixed; inset: 0; z-index: 10001; pointer-events: none;
      overflow: visible; isolation: isolate;
    }
    .newsletter-visibility-toggle-wrap {
      position: absolute; display: none; align-items: center; justify-content: center;
      width: 32px; height: 32px; margin: 0; padding: 0;
      transform: translate(-50%, -50%); pointer-events: auto;
      font: 12px/1.4 Arial, sans-serif;
    }
    .newsletter-visibility-toggle-button {
      display: grid; place-items: center; box-sizing: border-box;
      width: 24px; height: 24px; margin: 0; padding: 0;
      border: 1.5px solid #9aa4b2; border-radius: 50%; background: #fff;
      box-shadow: 0 1px 5px rgb(15 23 42 / 22%); cursor: pointer;
      touch-action: manipulation; transition: border-color .15s ease, background .15s ease, transform .15s ease;
    }
    .newsletter-visibility-toggle-button::after {
      content: ""; display: block; width: 7px; height: 7px;
      border-radius: 50%; background: #9aa4b2; transition: width .15s ease, height .15s ease, background .15s ease;
    }
    .newsletter-visibility-toggle-button[aria-checked="true"] { border-color: #14845b; background: #e9f8f0; }
    .newsletter-visibility-toggle-button[aria-checked="true"]::after { width: 10px; height: 10px; background: #14845b; }
    .newsletter-visibility-toggle-button:hover:not(:disabled) { transform: scale(1.06); }
    .newsletter-visibility-toggle-button:focus-visible { outline: 3px solid #8fd4b5; outline-offset: 2px; }
    .newsletter-visibility-toggle-button:disabled { opacity: .55; cursor: wait; }
    .newsletter-visibility-toggle-status {
      position: absolute; top: 28px; right: 0; max-width: min(260px, 75vw);
      box-sizing: border-box; padding: 4px 7px; border-radius: 5px;
      color: #9b2c2c; background: #fff7f7; box-shadow: 0 2px 8px rgb(15 23 42 / 13%);
      overflow-wrap: anywhere; font: 11px/1.4 Arial, sans-serif;
    }
    .newsletter-visibility-toggle-status:empty { display: none; }
    @media (max-width: 1120px) {
      .newsletter-visibility-toggle-wrap { width: 36px; height: 36px; }
      .newsletter-visibility-toggle-button { width: 28px; height: 28px; }
    }
    @media (max-width: 720px) {
      .newsletter-visibility-toggle-wrap { width: 40px; height: 40px; }
      .newsletter-visibility-toggle-button { width: 30px; height: 30px; }
    }
  `;
  document.head.append(style);
}

function ensureLayer(): void {
  ensureStyles();
  layer = document.getElementById("newsletter-visibility-toggle-layer") as HTMLDivElement | null;
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "newsletter-visibility-toggle-layer";
    layer.setAttribute("aria-label", "Newsletter visibility control");
    document.body.append(layer);
  }
  wrapper = layer.querySelector<HTMLDivElement>(".newsletter-visibility-toggle-wrap");
  if (!wrapper) {
    wrapper = document.createElement("div");
    wrapper.className = "newsletter-visibility-toggle-wrap";
    button = document.createElement("button");
    button.type = "button";
    button.className = "newsletter-visibility-toggle-button";
    button.setAttribute("role", "switch");
    button.setAttribute("aria-label", "Show Newsletter on public feed");
    button.title = "Show Newsletter on public feed";
    status = document.createElement("span");
    status.className = "newsletter-visibility-toggle-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    wrapper.append(button, status);
    layer.append(wrapper);
    button.addEventListener("click", () => { void updateVisibility(!newsletterVisible); });
  } else {
    button = wrapper.querySelector<HTMLButtonElement>(".newsletter-visibility-toggle-button");
    status = wrapper.querySelector<HTMLSpanElement>(".newsletter-visibility-toggle-status");
  }
}

function updateControl(): void {
  if (!button) return;
  button.setAttribute("aria-checked", String(newsletterVisible));
  button.title = `Newsletter on public feed: ${newsletterVisible ? "enabled" : "disabled"}`;
  button.setAttribute("aria-label", `Newsletter on public feed: ${newsletterVisible ? "enabled" : "disabled"}`);
  button.disabled = !settingsLoaded || saving;
}

function positionControl(): void {
  if (!wrapper || !layer) return;
  const panel = target;
  if (currentPath() !== "/account" || !panel || !panel.isConnected || new URLSearchParams(window.location.search).get("view") === "public") {
    wrapper.style.display = "none";
    return;
  }
  const rect = panel.getBoundingClientRect();
  const width = window.visualViewport?.width ?? window.innerWidth;
  const height = window.visualViewport?.height ?? window.innerHeight;
  const visible = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < height && rect.right > 0 && rect.left < width;
  if (!visible) {
    wrapper.style.display = "none";
    return;
  }
  wrapper.style.left = `${Math.max(20, Math.min(width - 20, rect.right - 18))}px`;
  wrapper.style.top = `${Math.max(20, Math.min(height - 20, rect.top + 18))}px`;
  wrapper.style.display = "flex";
}

function schedulePosition(): void {
  if (frame) window.cancelAnimationFrame(frame);
  frame = window.requestAnimationFrame(() => {
    frame = 0;
    positionControl();
  });
}

function applyFeedVisibility(): void {
  if (currentPath() !== "/feed") return;
  const group = document.querySelector<HTMLElement>(".blog-feed-content > .blog-feed-side-rails, .blog-feed-side-rails");
  if (!group) return;
  group.dataset.newsletterVisible = String(newsletterVisible);
  const rail = group.querySelector<HTMLElement>(":scope > .blog-feed-newsletter-rail");
  if (!rail) return;
  if (rail.dataset.newsletterVisibilityManaged !== "true") {
    rail.dataset.newsletterVisibilityManaged = "true";
    rail.dataset.newsletterOriginalDisplay = rail.style.getPropertyValue("display");
    rail.dataset.newsletterOriginalPriority = rail.style.getPropertyPriority("display");
  }
  if (!newsletterVisible) {
    rail.style.setProperty("display", "none", "important");
    return;
  }
  const original = rail.dataset.newsletterOriginalDisplay || "";
  const priority = rail.dataset.newsletterOriginalPriority || "";
  if (original) rail.style.setProperty("display", original, priority);
  else rail.style.removeProperty("display");
}

async function updateVisibility(enabled: boolean): Promise<void> {
  if (saving || !settingsLoaded) return;
  saving = true;
  updateControl();
  if (status) status.textContent = "";
  try {
    const result = await requestJson<PatchResponse>("/api/admin/showcase/widget-visibility", {
      method: "PATCH",
      credentials: "include",
      body: JSON.stringify({ widget: "newsletter", enabled }),
    });
    newsletterVisible = typeof result.widgets?.newsletter === "boolean" ? result.widgets.newsletter : enabled;
    applyFeedVisibility();
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : "Could not save newsletter visibility.";
  } finally {
    saving = false;
    updateControl();
    schedulePosition();
  }
}

function sync(): void {
  const path = currentPath();
  if (path === "/feed") {
    applyFeedVisibility();
    if (layer) layer.style.display = "none";
    return;
  }
  if (path !== "/account") {
    if (layer) layer.style.display = "none";
    return;
  }
  // NewsletterAdminPanel only mounts after the existing admin-summary request has
  // passed authentication, so this control is never added to public account views.
  const panel = document.querySelector<HTMLElement>(".newsletter-admin-panel");
  if (!panel || new URLSearchParams(window.location.search).get("view") === "public") {
    if (layer) layer.style.display = "none";
    target = null;
    return;
  }
  target = panel;
  ensureLayer();
  if (layer) layer.style.display = "block";
  updateControl();
  schedulePosition();
}

if (typeof document !== "undefined" && document.body) {
  const start = () => {
    ensureLayer();
    void loadSettings().finally(sync);
    observer = new MutationObserver(() => { applyFeedVisibility(); sync(); });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("popstate", sync);
    window.addEventListener("resize", sync, { passive: true });
    window.addEventListener("orientationchange", sync, { passive: true });
    window.addEventListener("scroll", schedulePosition, { passive: true, capture: true });
    window.visualViewport?.addEventListener("resize", sync, { passive: true });
    window.visualViewport?.addEventListener("scroll", schedulePosition, { passive: true });
    sync();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
