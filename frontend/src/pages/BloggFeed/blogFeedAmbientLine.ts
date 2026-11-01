import "./blogFeedAmbientLine.css";

const ROOT = document.getElementById("root") || document.body;
const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_WIDTH_UNITS = 1000;
const ROUTE_GAP_MIN_PX = 180;
const ROUTE_GAP_MAX_PX = 290;
const ROUTE_LOOKAHEAD_PX = 1900;
const AMBIENT_LINE_PREFERENCE_KEY = "blogg-feed-ambient-line-enabled";
const AMBIENT_LINE_CHANGE_EVENT = "blogg-feed-ambient-line-preference-change";

type Point = { x: number; y: number };
type ResizeBinding = { observer: ResizeObserver; svg: SVGSVGElement };

const resizeBindings = new WeakMap<HTMLElement, ResizeBinding>();
const routeSeeds = new WeakMap<SVGSVGElement, number>();

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

/**
 * Build the same route from the same seed at every height. New page content only
 * reveals additional points farther down the route; it does not redistribute
 * existing turns across the taller SVG.
 */
function createRandomRoute(seed: number, viewBoxHeight: number, unitsPerPixel: number): string {
  const random = makeRandom(seed);
  const startsLeft = random() < 0.5;
  const startY = randomBetween(random, -32, 32) * unitsPerPixel;
  const lookAhead = ROUTE_LOOKAHEAD_PX * unitsPerPixel;
  const minX = -85;
  const maxX = 1085;

  // Reflect a wandering route at the canvas edges rather than forcing it to
  // alternate left/right. This allows several consecutive turns in either
  // horizontal direction while keeping the line inside the page silhouette.
  const reflectX = (value: number): number => {
    let next = value;
    while (next < minX || next > maxX) {
      if (next < minX) next = minX + (minX - next);
      if (next > maxX) next = maxX - (next - maxX);
    }
    return next;
  };

  let currentX = startsLeft
    ? randomBetween(random, -45, 35)
    : randomBetween(random, 965, 1045);
  let currentY = startY;
  let previousHorizontalStep = randomBetween(random, -260, 260);
  const points: Point[] = [{ x: currentX, y: currentY }];
  const finalY = viewBoxHeight + lookAhead;
  let pointIndex = 0;

  // Each anchor gets a different vertical interval and horizontal movement.
  // Horizontal momentum is deliberately weak: the path may continue in the
  // same direction for a while, reverse, drift diagonally, or sweep across.
  while (currentY < finalY && pointIndex < 1600) {
    currentY += randomBetween(random, ROUTE_GAP_MIN_PX, ROUTE_GAP_MAX_PX) * unitsPerPixel;
    const momentum = previousHorizontalStep * randomBetween(random, 0.08, 0.22);
    const horizontalStep = randomBetween(random, -470, 470) + momentum;
    const nextX = reflectX(currentX + horizontalStep);
    previousHorizontalStep = nextX - currentX;
    currentX = nextX;
    points.push({ x: currentX, y: currentY });
    pointIndex += 1;
  }

  // Smooth cubic spline with a shared tangent at every anchor. Longer, gently
  // randomized handles round the turns instead of creating pointed reversals.
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

  // Seed each handle independently by anchor index. Because points are generated
  // in order from the same page seed, loading more content does not alter the
  // already visible section of the route.
  const handleLengths = points.map((point, index) => {
    const previousGap = index > 0
      ? distance(points[index - 1], point)
      : distance(point, points[index + 1]);
    const nextGap = index < points.length - 1
      ? distance(point, points[index + 1])
      : previousGap;
    const handleRandom = makeRandom((seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
    return Math.min(previousGap, nextGap) * randomBetween(handleRandom, 0.25, 0.34);
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

function makePath(className: string): SVGPathElement {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("class", className);
  path.setAttribute("pathLength", "1000");
  return path;
}

function createAmbientSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  const seed = (Math.random() * 0xffffffff) >>> 0;
  routeSeeds.set(svg, seed);
  svg.setAttribute("class", "blog-feed-ambient-line");
  svg.setAttribute("viewBox", `0 0 ${SVG_WIDTH_UNITS} 1`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.appendChild(makePath("blog-feed-ambient-line__track"));
  svg.appendChild(makePath("blog-feed-ambient-line__traveller"));
  return svg;
}

function updateSvgHeight(page: HTMLElement, svg: SVGSVGElement): void {
  const content = page.querySelector<HTMLElement>(":scope > .blog-feed-content");
  const contentTop = content?.offsetTop ?? page.clientHeight;
  const contentHeight = content
    ? Math.max(content.offsetHeight, content.scrollHeight)
    : page.clientHeight;
  const height = Math.max(
    page.clientHeight,
    page.scrollHeight,
    contentTop + contentHeight + 24,
  );
  const width = Math.max(page.clientWidth, page.getBoundingClientRect().width, 1);
  const viewBoxHeight = height * SVG_WIDTH_UNITS / width;
  const unitsPerPixel = SVG_WIDTH_UNITS / width;

  // Match SVG coordinate scale on both axes. The viewBox grows with the page,
  // rather than stretching a fixed 1500-unit route over the newly loaded content.
  svg.setAttribute(
    "viewBox",
    `0 0 ${SVG_WIDTH_UNITS} ${viewBoxHeight.toFixed(2)}`,
  );
  svg.setAttribute("height", String(Math.ceil(height)));
  svg.style.height = `${Math.ceil(height)}px`;

  const seed = routeSeeds.get(svg);
  if (seed !== undefined) {
    const route = createRandomRoute(seed, viewBoxHeight, unitsPerPixel);
    svg.querySelectorAll<SVGPathElement>("path").forEach((path) => {
      path.setAttribute("d", route);
    });
  }
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
      // Generate one seed per page mount. The route extends deterministically as
      // content loads, so completed curves do not get rearranged after rendering.
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
