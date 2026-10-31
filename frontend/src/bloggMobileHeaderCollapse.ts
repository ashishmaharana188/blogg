/**
 * Supplies the mobile header minimiser when an existing blog is opened in
 * read-only mode. The normal React control is rendered in edit mode; the
 * read-only form previously omitted it because it was gated by isEditable.
 * This small progressive enhancement only changes presentation classes.
 */
const ROOT = document.getElementById("root") || document.body;
const ROW_CLASS = "blogg-mobile-header-toggle-row";
const BUTTON_CLASS = "blogg-mobile-header-toggle";
const INJECTED_CLASS = "blogg-mobile-header-toggle--injected";

function setCollapsed(heading: HTMLElement, button: HTMLButtonElement, collapsed: boolean) {
  heading.classList.toggle("is-mobile-collapsed", collapsed);

  const title = heading.querySelector<HTMLElement>(".blogg-editor-title");
  title?.classList.toggle("is-mobile-header-compact", collapsed);

  const form = heading.closest<HTMLElement>(".blogg-editor-form");
  const tags = form?.querySelector<HTMLElement>(".blogg-editor-tags-list");
  tags?.classList.toggle("is-mobile-header-collapsed", collapsed);

  button.setAttribute("aria-expanded", String(!collapsed));
  const label = button.querySelector("span");
  if (label) label.textContent = collapsed ? "Show header" : "Minimise header";
  const path = button.querySelector("svg path");
  if (path) path.setAttribute("d", collapsed ? "m7 14 5-5 5 5" : "m7 10 5 5 5-5");
}

function createToggleRow(heading: HTMLElement): HTMLDivElement {
  const row = document.createElement("div");
  row.className = ROW_CLASS;

  const button = document.createElement("button");
  button.type = "button";
  button.className = `${BUTTON_CLASS} ${INJECTED_CLASS}`;
  button.setAttribute("aria-expanded", "true");
  button.setAttribute("aria-controls", "blogg-editor-heading-fields");

  const initiallyCollapsed = heading.classList.contains("is-mobile-collapsed");
  button.setAttribute("aria-expanded", String(!initiallyCollapsed));

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
    setCollapsed(heading, button, collapsed);
  });

  row.appendChild(button);
  const fields = heading.querySelector(".blogg-editor-heading-fields");
  heading.insertBefore(row, fields || heading.firstChild);
  return row;
}

function ensureReadOnlyMobileToggle(): void {
  const headings = ROOT.querySelectorAll<HTMLElement>(".blogg-editor-heading-area");
  headings.forEach((heading) => {
    const rows = Array.from(heading.querySelectorAll<HTMLElement>(`.${ROW_CLASS}`));
    const reactOwnedRow = rows.find((row) => !row.querySelector(`.${INJECTED_CLASS}`));

    // Edit mode already has the React-owned toggle. Remove any stale injected
    // copy after switching from read-only mode to edit mode.
    if (reactOwnedRow) {
      rows.filter((row) => row !== reactOwnedRow).forEach((row) => row.remove());
      return;
    }

    if (!rows.length) createToggleRow(heading);
  });
}

ensureReadOnlyMobileToggle();
const observer = new MutationObserver(() => ensureReadOnlyMobileToggle());
observer.observe(ROOT, { childList: true, subtree: true });
