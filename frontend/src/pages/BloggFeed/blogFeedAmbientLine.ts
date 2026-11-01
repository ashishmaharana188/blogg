import "./blogFeedAmbientLine.css";

const ROOT = document.getElementById("root") || document.body;
const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_WIDTH_UNITS = 1000;
const SVG_HEIGHT_UNITS = 1500;
const AMBIENT_LINE_PREFERENCE_KEY = "blogg-feed-ambient-line-enabled";
const AMBIENT_LINE_CHANGE_EVENT = "blogg-feed-ambient-line-preference-change";

type Point = { x: number; y: number };
type Segment = {
  controlOne: Point;
  controlTwo: Point;
  end: Point;
};
type ResizeBinding = { observer: ResizeObserver; svg: SVGSVGElement };

const resizeBindings = new WeakMap<HTMLElement, ResizeBinding>();

// Preserve the original continuous winding route. Larger, smoothed anchor offsets
// make each newly mounted Feed visibly different without changing its silhouette.
const START: Point = { x: 105, y: 8 };
const BASE_SEGMENTS: Segment[] = [
  { controlOne: { x: 42, y: 60 }, controlTwo: { x: 24, y: 120 }, end: { x: 50, y: 170 } },
  { controlOne: { x: 84, y: 238 }, controlTwo: { x: 170, y: 225 }, end: { x: 132, y: 290 } },
  { controlOne: { x: 99, y: 346 }, controlTwo: { x: 18, y: 350 }, end: { x: 54, y: 415 } },
  { controlOne: { x: 96, y: 482 }, controlTwo: { x: 208, y: 470 }, end: { x: 160, y: 532 } },
  { controlOne: { x: 112, y: 592 }, controlTwo: { x: 24, y: 604 }, end: { x: 70, y: 668 } },
  { controlOne: { x: 122, y: 730 }, controlTwo: { x: 258, y: 707 }, end: { x: 332, y: 770 } },
  { controlOne: { x: 432, y: 855 }, controlTwo: { x: 690, y: 780 }, end: { x: 860, y: 685 } },
  { controlOne: { x: 1000, y: 610 }, controlTwo: { x: 1015, y: 660 }, end: { x: 950, y: 724 } },
  { controlOne: { x: 883, y: 790 }, controlTwo: { x: 848, y: 825 }, end: { x: 899, y: 884 } },
  { controlOne: { x: 956, y: 950 }, controlTwo: { x: 1007, y: 1005 }, end: { x: 922, y: 1072 } },
  { controlOne: { x: 841, y: 1138 }, controlTwo: { x: 703, y: 1100 }, end: { x: 620, y: 1160 } },
  { controlOne: { x: 510, y: 1238 }, controlTwo: { x: 380, y: 1310 }, end: { x: 276, y: 1260 } },
  { controlOne: { x: 166, y: 1208 }, controlTwo: { x: 70, y: 1304 }, end: { x: 120, y: 1378 } },
  { controlOne: { x: 173, y: 1452 }, controlTwo: { x: 355, y: 1410 }, end: { x: 490, y: 1490 } },
];

function isAmbientLineEnabled(): boolean {
  try {
    const stored = window.localStorage.getItem(AMBIENT_LINE_PREFERENCE_KEY);
    return stored === null ? true : stored === "true";
  } catch {
    return true;
  }
}

function makeRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
}

function randomBetween(random: () => number, min: number, max: number): number {
  return min + random() * (max - min);
}

function createRandomRoute(): string {
  const seed = (Math.random() * 0xffffffff) >>> 0;
  const random = makeRandom(seed);
  const baseAnchors = [START, ...BASE_SEGMENTS.map((segment) => segment.end)];

  // Adjacent offsets are blended to preserve smooth transitions. The new range
  // is deliberately larger than the previous ±18/±8 values, which were hard to see.
  const rawOffsets: Point[] = baseAnchors.map(() => ({
    x: randomBetween(random, -58, 58),
    y: randomBetween(random, -28, 28),
  }));
  const offsets = rawOffsets.map((offset, index) => {
    const previous = rawOffsets[Math.max(0, index - 1)];
    const next = rawOffsets[Math.min(rawOffsets.length - 1, index + 1)];
    return {
      x: previous.x * 0.2 + offset.x * 0.6 + next.x * 0.2,
      y: previous.y * 0.2 + offset.y * 0.6 + next.y * 0.2,
    };
  });

  const first = { x: START.x + offsets[0].x, y: START.y + offsets[0].y };
  let path = `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`;

  BASE_SEGMENTS.forEach((segment, index) => {
    const fromOffset = offsets[index];
    const toOffset = offsets[index + 1];
    const c1 = {
      x: segment.controlOne.x
        + fromOffset.x * 0.72
        + toOffset.x * 0.28
        + randomBetween(random, -11, 11),
      y: segment.controlOne.y
        + fromOffset.y * 0.72
        + toOffset.y * 0.28
        + randomBetween(random, -7, 7),
    };
    const c2 = {
      x: segment.controlTwo.x
        + fromOffset.x * 0.28
        + toOffset.x * 0.72
        + randomBetween(random, -11, 11),
      y: segment.controlTwo.y
        + fromOffset.y * 0.28
        + toOffset.y * 0.72
        + randomBetween(random, -7, 7),
    };
    const end = {
      x: segment.end.x + toOffset.x,
      y: segment.end.y + toOffset.y,
    };

    path += ` C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}`
      + ` ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}`
      + ` ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
  });

  return path;
}

function makePath(className: string, route: string): SVGPathElement {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("class", className);
  path.setAttribute("d", route);
  path.setAttribute("pathLength", "1000");
  return path;
}

function createAmbientSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  const route = createRandomRoute();
  svg.setAttribute("class", "blog-feed-ambient-line");
  svg.setAttribute("viewBox", `0 0 ${SVG_WIDTH_UNITS} ${SVG_HEIGHT_UNITS}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.appendChild(makePath("blog-feed-ambient-line__track", route));
  svg.appendChild(makePath("blog-feed-ambient-line__traveller", route));
  return svg;
}

function updateSvgHeight(page: HTMLElement, svg: SVGSVGElement): void {
  const content = page.querySelector<HTMLElement>(":scope > .blog-feed-content");
  const contentTop = content?.offsetTop ?? page.clientHeight;
  const contentHeight = content
    ? Math.max(content.offsetHeight, content.scrollHeight)
    : page.clientHeight;
  const height = Math.max(page.clientHeight, contentTop + contentHeight + 24);
  svg.setAttribute("height", String(Math.ceil(height)));
  svg.style.height = `${Math.ceil(height)}px`;
}

function observePageSize(page: HTMLElement, svg: SVGSVGElement): void {
  if (typeof ResizeObserver === "undefined") return;
  const existing = resizeBindings.get(page);
  if (existing?.svg === svg) return;
  existing?.observer.disconnect();

  const observer = new ResizeObserver(() => updateSvgHeight(page, svg));
  observer.observe(page);
  const content = page.querySelector<HTMLElement>(":scope > .blog-feed-content");
  const header = page.querySelector<HTMLElement>(":scope > .blogg-shared-header");
  if (content) observer.observe(content);
  if (header) observer.observe(header);
  resizeBindings.set(page, { observer, svg });
}

function removeAmbientSvg(page: HTMLElement): void {
  page.querySelector<SVGSVGElement>(":scope > .blog-feed-ambient-line")?.remove();
  resizeBindings.get(page)?.observer.disconnect();
  resizeBindings.delete(page);
}

function ensureAmbientLines(): void {
  const enabled = isAmbientLineEnabled();
  const pages = Array.from(ROOT.querySelectorAll<HTMLElement>(".blog-feed-page"));

  pages.forEach((page) => {
    if (!enabled) {
      removeAmbientSvg(page);
      return;
    }

    let svg = page.querySelector<SVGSVGElement>(":scope > .blog-feed-ambient-line");
    if (!svg) {
      // The route is generated once for each newly mounted Feed page. It is not
      // regenerated during every DOM mutation, so the line never jumps mid-scroll.
      svg = createAmbientSvg();
      page.insertBefore(svg, page.firstChild);
    }
    updateSvgHeight(page, svg);
    observePageSize(page, svg);
  });
}

ensureAmbientLines();
const observer = new MutationObserver(() => ensureAmbientLines());
observer.observe(ROOT, { childList: true, subtree: true });
window.addEventListener("resize", ensureAmbientLines, { passive: true });
window.addEventListener(AMBIENT_LINE_CHANGE_EVENT, ensureAmbientLines);
window.addEventListener("storage", (event: StorageEvent) => {
  if (event.key === AMBIENT_LINE_PREFERENCE_KEY) ensureAmbientLines();
});
