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
  const sweepCount = 10 + Math.floor(random() * 5);

  const edgePoint = (left: boolean, y: number, isEndpoint = false): Point => ({
    x: left
      ? randomBetween(random, isEndpoint ? -45 : -70, isEndpoint ? 95 : 330)
      : randomBetween(random, isEndpoint ? 905 : 670, isEndpoint ? 1045 : 1070),
    y,
  });

  // The line still sweeps from side to side, but the vertical distance between
  // turns is independently randomized instead of using evenly spaced anchors.
  const startY = randomBetween(random, -45, 45);
  const endY = randomBetween(random, SVG_HEIGHT_UNITS - 45, SVG_HEIGHT_UNITS + 55);
  const gapWeights = Array.from(
    { length: sweepCount + 1 },
    () => randomBetween(random, 0.52, 1.58),
  );
  const totalWeight = gapWeights.reduce((sum, weight) => sum + weight, 0);
  const totalDistance = endY - startY;

  const points: Point[] = [edgePoint(startsLeft, startY, true)];
  let currentY = startY;
  gapWeights.forEach((weight, index) => {
    currentY += totalDistance * (weight / totalWeight);
    if (index === gapWeights.length - 1) return;
    const travelsLeft = index % 2 === 0 ? !startsLeft : startsLeft;
    points.push(edgePoint(travelsLeft, currentY));
  });
  const exitsLeft = sweepCount % 2 === 0 ? startsLeft : !startsLeft;
  points.push(edgePoint(exitsLeft, endY, true));

  // Build a smooth cubic spline with a shared tangent at every anchor. Shorter
  // handles tighten each turn (a sharper curve) without creating corners or kinks.
  const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);
  const direction = (a: Point, b: Point): Point => {
    const length = distance(a, b) || 1;
    return { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  };
  const tangents: Point[] = points.map((point, index) => {
    if (index === 0) return direction(points[0], points[1]);
    if (index === points.length - 1) return direction(points[index - 1], point);

    const incoming = direction(points[index - 1], point);
    const outgoing = direction(point, points[index + 1]);
    const blended = {
      x: incoming.x + outgoing.x,
      y: incoming.y + outgoing.y,
    };
    const length = Math.hypot(blended.x, blended.y);
    return length > 0.0001
      ? { x: blended.x / length, y: blended.y / length }
      : outgoing;
  });

  // One handle length per anchor keeps the curve tangent continuous on both
  // sides of that point. Different handle lengths give each turn its own radius.
  const handleLengths = points.map((point, index) => {
    const previousGap = index > 0 ? distance(points[index - 1], point) : distance(point, points[index + 1]);
    const nextGap = index < points.length - 1 ? distance(point, points[index + 1]) : previousGap;
    return Math.min(previousGap, nextGap) * randomBetween(random, 0.105, 0.17);
  });

  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const controlOne = {
      x: start.x + tangents[index].x * handleLengths[index],
      y: start.y + tangents[index].y * handleLengths[index],
    };
    const controlTwo = {
      x: end.x - tangents[index + 1].x * handleLengths[index + 1],
      y: end.y - tangents[index + 1].y * handleLengths[index + 1],
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
