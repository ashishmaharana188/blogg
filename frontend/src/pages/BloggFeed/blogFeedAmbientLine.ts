import "./blogFeedAmbientLine.css";

const ROOT = document.getElementById("root") || document.body;
const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_WIDTH_UNITS = 1000;
const SVG_HEIGHT_UNITS = 1500;
const AMBIENT_LINE_PREFERENCE_KEY = "blogg-feed-ambient-line-enabled";
const AMBIENT_LINE_CHANGE_EVENT = "blogg-feed-ambient-line-preference-change";

type Point = { x: number; y: number };
type ResizeBinding = { observer: ResizeObserver; svg: SVGSVGElement };

const resizeBindings = new WeakMap<HTMLElement, ResizeBinding>();

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
  const startsLeft = random() < 0.5;
  const sweepCount = random() < 0.5 ? 4 : 6;

  const edgePoint = (left: boolean, y: number, isEndpoint = false): Point => ({
    x: left
      ? randomBetween(random, isEndpoint ? -45 : -95, isEndpoint ? 95 : 340)
      : randomBetween(random, isEndpoint ? 905 : 660, isEndpoint ? 1045 : 1095),
    y,
  });

  // Randomise the route itself: enter near one edge, sweep to the opposite side,
  // then alternate sides down the page before exiting at the opposite edge.
  // These are the path's anchor points, not randomised Bézier handles.
  const points: Point[] = [
    edgePoint(startsLeft, randomBetween(random, -45, 45), true),
  ];

  const verticalStep = SVG_HEIGHT_UNITS / (sweepCount + 1);
  const maxVerticalJitter = Math.min(88, verticalStep * 0.28);
  for (let index = 0; index < sweepCount; index += 1) {
    const travelsLeft = index % 2 === 1 ? startsLeft : !startsLeft;
    const expectedY = verticalStep * (index + 1);
    const y = expectedY + randomBetween(random, -maxVerticalJitter, maxVerticalJitter);
    points.push(edgePoint(travelsLeft, y));
  }

  points.push(edgePoint(!startsLeft, randomBetween(random, SVG_HEIGHT_UNITS - 45, SVG_HEIGHT_UNITS + 55), true));

  // Convert the randomized anchors into a Catmull-Rom-derived cubic Bézier path.
  // Tangents are calculated from neighbouring anchors, keeping every transition
  // smooth while leaving the overall side-to-side journey free to change per load.
  const first = points[0];
  const second = points[1];
  const last = points[points.length - 1];
  const penultimate = points[points.length - 2];
  const beforeFirst = {
    x: first.x - (second.x - first.x),
    y: first.y - (second.y - first.y),
  };
  const afterLast = {
    x: last.x + (last.x - penultimate.x),
    y: last.y + (last.y - penultimate.y),
  };
  const paddedPoints = [beforeFirst, ...points, afterLast];

  let path = `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = paddedPoints[index];
    const start = paddedPoints[index + 1];
    const end = paddedPoints[index + 2];
    const next = paddedPoints[index + 3];
    const controlOne = {
      x: start.x + (end.x - previous.x) / 6,
      y: start.y + (end.y - previous.y) / 6,
    };
    const controlTwo = {
      x: end.x - (next.x - start.x) / 6,
      y: end.y - (next.y - start.y) / 6,
    };

    path += ` C ${controlOne.x.toFixed(1)} ${controlOne.y.toFixed(1)}`
      + ` ${controlTwo.x.toFixed(1)} ${controlTwo.y.toFixed(1)}`
      + ` ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
  }

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
      // Generate once per page mount. Content mutations and scrolling do not
      // regenerate the path, so the line stays fixed while its highlight travels.
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
