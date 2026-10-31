/**
 * Reliable mobile header minimiser and Footnotes contrast enforcement.
 *
 * The React editor renders its own toggle in edit mode. Read-only mode used to
 * omit it, so this module adds the same control when needed. It also applies
 * important inline foreground colours to the Footnotes label and entry points;
 * this avoids relying on the order of global/theme stylesheets.
 */
const ROOT: HTMLElement = document.documentElement;
const ROW_CLASS = "blogg-mobile-header-toggle-row";
const BUTTON_CLASS = "blogg-mobile-header-toggle";
const INJECTED_CLASS = "blogg-mobile-header-toggle--injected";
const MOBILE_QUERY = "(max-width: 760px)";

function isDarkMode(): boolean {
  return document.documentElement.classList.contains("blogg-dark-mode");
}

function setImportantColor(element: HTMLElement, color: string): void {
  element.style.setProperty("color", color, "important");
  element.style.setProperty("-webkit-text-fill-color", color, "important");
  element.style.setProperty("opacity", "1", "important");
}

function syncFootnotesContrast(): void {
  const dark = isDarkMode();
  const foreground = dark ? "#f5f5f5" : "#263247";
  const muted = dark ? "#bdbdbd" : "#647084";

  const selectors = [
    ".blogg-editor-references-toggle-label",
    ".blogg-editor-references-toggle-row > span",
    ".blogg-editor-form button[aria-label='Show Footnotes and References']",
    ".blogg-editor-form button.text-slate-600",
    ".blogg-reference-panel-slot .blogg-ref-header-toggle",
    ".blogg-reference-panel-slot .blogg-ref-header-toggle :where(*)",
  ];

  for (const selector of selectors) {
    ROOT.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      setImportantColor(element, foreground);
    });
  }

  ROOT.querySelectorAll<HTMLElement>(".blogg-reference-panel-slot .blogg-ref-count").forEach((element) => {
    setImportantColor(element, muted);
  });
}

function applyCollapsedState(heading: HTMLElement, button: HTMLButtonElement, collapsed: boolean): void {
  heading.classList.toggle("is-mobile-collapsed", collapsed);

  const title = heading.querySelector<HTMLElement>(".blogg-editor-title");
  title?.classList.toggle("is-mobile-header-compact", collapsed);

  const form = heading.closest<HTMLElement>(".blogg-editor-form");
  const tags = form?.querySelector<HTMLElement>(".blogg-editor-tags-list");
  tags?.classList.toggle("is-mobile-header-collapsed", collapsed);

  button.setAttribute("aria-expanded", String(!collapsed));
  const label = button.querySelector<HTMLElement>("span");
  if (label) label.textContent = collapsed ? "Show header" : "Minimise header";
  const path = button.querySelector<SVGPathElement>("svg path");
  if (path) path.setAttribute("d", collapsed ? "m7 14 5-5 5 5" : "m7 10 5 5 5-5");
}

function styleMobileToggle(row: HTMLElement, button: HTMLButtonElement): void {
  const visible = window.matchMedia(MOBILE_QUERY).matches;
  row.style.setProperty("display", visible ? "flex" : "none", "important");
  row.style.setProperty("align-items", "center", "important");
  row.style.setProperty("justify-content", "flex-end", "important");
  row.style.setProperty("width", "100%", "important");
  row.style.setProperty("margin", "-2px 0 -7px", "important");

  button.style.setProperty("display", visible ? "inline-flex" : "none", "important");
  button.style.setProperty("align-items", "center", "important");
  button.style.setProperty("justify-content", "center", "important");
  button.style.setProperty("gap", "6px", "important");
  button.style.setProperty("min-height", "30px", "important");
  button.style.setProperty("padding", "5px 9px", "important");
  button.style.setProperty("border", "1px solid #666", "important");
  button.style.setProperty("border-radius", "5px", "important");
  button.style.setProperty("background", isDarkMode() ? "#383838" : "#f8fafc", "important");
  setImportantColor(button, isDarkMode() ? "#f4f4f4" : "#273246");
  button.style.setProperty("font", "600 10px/1.2 system-ui, sans-serif", "important");
  button.style.setProperty("cursor", "pointer", "important");

  const svg = button.querySelector<SVGSVGElement>("svg");
  if (svg) {
    svg.style.setProperty("width", "13px", "important");
    svg.style.setProperty("height", "13px", "important");
    svg.style.setProperty("fill", "none", "important");
    svg.style.setProperty("stroke", "currentColor", "important");
    svg.style.setProperty("stroke-width", "1.8", "important");
    svg.style.setProperty("stroke-linecap", "round", "important");
    svg.style.setProperty("stroke-linejoin", "round", "important");
  }
}

function createToggleRow(heading: HTMLElement): HTMLDivElement {
  const row = document.createElement("div");
  row.className = ROW_CLASS;

  const button = document.createElement("button");
  button.type = "button";
  button.className = `${BUTTON_CLASS} ${INJECTED_CLASS}`;
  button.setAttribute("aria-controls", "blogg-editor-heading-fields");

  const initiallyCollapsed = heading.classList.contains("is-mobile-collapsed");
  const label = document.createElement("span");
  label.textContent = initiallyCollapsed ? "Show header" : "Minimise header";
  button.appendChild(label);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", initiallyCollapsed ? "m7 14 5-5 5 5" : "m7 10 5 5 5-5");
  svg.appendChild(path);
  button.appendChild(svg);

  button.addEventListener("click", () => {
    const collapsed = !heading.classList.contains("is-mobile-collapsed");
    applyCollapsedState(heading, button, collapsed);
  });

  row.appendChild(button);
  const fields = heading.querySelector(".blogg-editor-heading-fields");
  heading.insertBefore(row, fields || heading.firstChild);
  return row;
}

function ensureMobileHeaderToggles(): void {
  ROOT.querySelectorAll<HTMLElement>(".blogg-editor-heading-area").forEach((heading) => {
    const rows = Array.from(heading.querySelectorAll<HTMLElement>(`.${ROW_CLASS}`));
    const reactOwnedRow = rows.find((row) => !row.querySelector(`.${INJECTED_CLASS}`));

    // Keep the React-owned control in edit mode and remove any injected duplicate.
    if (reactOwnedRow) {
      rows.filter((row) => row !== reactOwnedRow).forEach((row) => row.remove());
      const button = reactOwnedRow.querySelector<HTMLButtonElement>(`.${BUTTON_CLASS}`);
      if (button) styleMobileToggle(reactOwnedRow, button);
      return;
    }

    let row = rows.find((candidate) => candidate.querySelector(`.${INJECTED_CLASS}`));
    if (!row) row = createToggleRow(heading);
    const button = row.querySelector<HTMLButtonElement>(`.${BUTTON_CLASS}`);
    if (button) styleMobileToggle(row, button);
  });
}

function refresh(): void {
  ensureMobileHeaderToggles();
  syncFootnotesContrast();
}

// Run once and again after React mounts/replaces a form, the theme changes, or
// the viewport crosses the mobile breakpoint.
refresh();
const observer = new MutationObserver(refresh);
observer.observe(ROOT, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["class"],
});
window.addEventListener("resize", refresh, { passive: true });
