import "./blogFeedAmbientLine.css";

const ROOT = document.getElementById("root") || document.body;
const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_WIDTH_UNITS = 1000;
const ROUTE_GAP_MIN_PX = 180;
const ROUTE_GAP_MAX_PX = 290;
const ROUTE_LOOKAHEAD_PX = 1900;
const HOVER_RADIUS_PX = 190;
const HOVER_PUSH_PX = 15;
const AMBIENT_LINE_PREFERENCE_KEY = "blogg-feed-ambient-line-enabled";
const AMBIENT_LINE_CHANGE_EVENT = "blogg-feed-ambient-line-preference-change";
const WALLET_GRAPH_UPDATE_EVENT = "blogg-wallet-graph-update";

type Point = { x: number; y: number };
type GraphArea = { left: number; top: number; width: number; height: number; value: string };
type HoverState = {
  current: Point;
  target: Point;
  strength: number;
  targetStrength: number;
  frame: number;
};
type ResizeBinding = {
  observer: ResizeObserver | null;
  svg: SVGSVGElement;
  schedule: () => void;
};

const resizeBindings = new WeakMap<HTMLElement, ResizeBinding>();
const routeSeeds = new WeakMap<SVGSVGElement, number>();
const hoverBindings = new WeakMap<SVGSVGElement, { page: HTMLElement; move: (event: PointerEvent) => void; leave: () => void }>();
const hoverStates = new WeakMap<SVGSVGElement, HoverState>();
const pendingUpdates = new WeakMap<SVGSVGElement, number>();

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

function randomRouteAnchors(seed: number, viewBoxHeight: number, unitsPerPixel: number): Point[] {
  const random = makeRandom(seed);
  const startsLeft = random() < 0.5;
  const startY = randomBetween(random, -32, 32) * unitsPerPixel;
  const minX = -85;
  const maxX = 1085;
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
  const finalY = viewBoxHeight + ROUTE_LOOKAHEAD_PX * unitsPerPixel;
  let pointIndex = 0;

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
  return points;
}

function getWalletGraphArea(page: HTMLElement, unitsPerPixel: number): GraphArea | null {
  const surface = page.querySelector<HTMLElement>(
    ".admin-wallet-feed-widget[data-wallet-graph-mode='graph'] [data-wallet-graph-surface='true']",
  );
  if (!surface) return null;

  const rect = surface.getBoundingClientRect();
  if (rect.width < 24 || rect.height < 24) return null;
  const pageRect = page.getBoundingClientRect();
  const rawValue = surface.dataset.walletLineValue || "0.00";
  const value = /^-?\d{1,8}(?:\.\d{1,2})?$/.test(rawValue) ? rawValue : "0.00";

  return {
    left: (rect.left - pageRect.left + page.scrollLeft + 8) * unitsPerPixel,
    top: (rect.top - pageRect.top + page.scrollTop + 5) * unitsPerPixel,
    width: Math.max(1, rect.width - 16) * unitsPerPixel,
    height: Math.max(1, rect.height - 10) * unitsPerPixel,
    value,
  };
}

// Single-stroke numeral skeletons. Each digit is a connected path, and the
// digit-to-digit joins form one continuous flowing route rather than a separate
// chart or a filled text element. Coordinates are normalized to a 0..0.74 cell.
const LINE_DIGITS: Record<string, Point[]> = {
  "0": [
    { x: 0.35, y: 0.035 }, { x: 0.14, y: 0.035 }, { x: 0.035, y: 0.16 },
    { x: 0.035, y: 0.84 }, { x: 0.15, y: 0.965 }, { x: 0.56, y: 0.965 },
    { x: 0.69, y: 0.84 }, { x: 0.69, y: 0.16 }, { x: 0.56, y: 0.035 },
    { x: 0.35, y: 0.035 },
  ],
  "1": [
    { x: 0.08, y: 0.22 }, { x: 0.35, y: 0.035 }, { x: 0.35, y: 0.965 },
    { x: 0.06, y: 0.965 }, { x: 0.69, y: 0.965 },
  ],
  "2": [
    { x: 0.035, y: 0.18 }, { x: 0.16, y: 0.035 }, { x: 0.55, y: 0.035 },
    { x: 0.69, y: 0.18 }, { x: 0.69, y: 0.36 }, { x: 0.035, y: 0.84 },
    { x: 0.035, y: 0.965 }, { x: 0.70, y: 0.965 },
  ],
  "3": [
    { x: 0.045, y: 0.07 }, { x: 0.57, y: 0.07 }, { x: 0.69, y: 0.20 },
    { x: 0.69, y: 0.40 }, { x: 0.43, y: 0.50 }, { x: 0.69, y: 0.60 },
    { x: 0.69, y: 0.81 }, { x: 0.56, y: 0.94 }, { x: 0.045, y: 0.94 },
  ],
  "4": [
    { x: 0.55, y: 0.965 }, { x: 0.55, y: 0.035 }, { x: 0.035, y: 0.63 },
    { x: 0.72, y: 0.63 },
  ],
  "5": [
    { x: 0.70, y: 0.035 }, { x: 0.035, y: 0.035 }, { x: 0.035, y: 0.46 },
    { x: 0.53, y: 0.46 }, { x: 0.69, y: 0.60 }, { x: 0.69, y: 0.82 },
    { x: 0.55, y: 0.965 }, { x: 0.035, y: 0.965 },
  ],
  "6": [
    { x: 0.66, y: 0.07 }, { x: 0.27, y: 0.035 }, { x: 0.035, y: 0.24 },
    { x: 0.035, y: 0.82 }, { x: 0.18, y: 0.965 }, { x: 0.55, y: 0.965 },
    { x: 0.69, y: 0.82 }, { x: 0.69, y: 0.63 }, { x: 0.53, y: 0.50 },
    { x: 0.035, y: 0.50 },
  ],
  "7": [
    { x: 0.035, y: 0.035 }, { x: 0.72, y: 0.035 }, { x: 0.25, y: 0.965 },
  ],
  "8": [
    { x: 0.36, y: 0.50 }, { x: 0.16, y: 0.42 }, { x: 0.035, y: 0.24 },
    { x: 0.18, y: 0.035 }, { x: 0.55, y: 0.035 }, { x: 0.69, y: 0.24 },
    { x: 0.55, y: 0.42 }, { x: 0.36, y: 0.50 }, { x: 0.16, y: 0.62 },
    { x: 0.035, y: 0.82 }, { x: 0.18, y: 0.965 }, { x: 0.55, y: 0.965 },
    { x: 0.69, y: 0.82 }, { x: 0.55, y: 0.62 }, { x: 0.36, y: 0.50 },
  ],
  "9": [
    { x: 0.69, y: 0.50 }, { x: 0.55, y: 0.965 }, { x: 0.18, y: 0.965 },
    { x: 0.035, y: 0.82 }, { x: 0.035, y: 0.63 }, { x: 0.18, y: 0.50 },
    { x: 0.55, y: 0.50 }, { x: 0.69, y: 0.35 }, { x: 0.69, y: 0.18 },
    { x: 0.55, y: 0.035 }, { x: 0.18, y: 0.035 }, { x: 0.035, y: 0.18 },
    { x: 0.035, y: 0.35 },
  ],
  ".": [
    { x: 0.27, y: 0.84 }, { x: 0.27, y: 0.965 },
  ],
  "-": [
    { x: 0.035, y: 0.51 }, { x: 0.70, y: 0.51 },
  ],
};
function createLineNumeral(
  value: string,
  area: GraphArea,
): { points: Point[]; glyphs: Point[][] } {
  const characters = [...value].filter((character) => Boolean(LINE_DIGITS[character])).slice(0, 10);
  if (!characters.length) return { points: [], glyphs: [] };

  // Wide, squared-off proportions inspired by heavy monument grotesks.
  const cellAdvance = 0.84;
  const glyphWidth = 0.74;
  const totalWidth = (characters.length - 1) * cellAdvance + glyphWidth;
  const scale = Math.min(area.width * 0.88 / totalWidth, area.height * 0.76);
  const renderedWidth = totalWidth * scale;
  const left = area.left + (area.width - renderedWidth) / 2;
  const top = area.top + (area.height - scale) / 2;
  const points: Point[] = [];
  const glyphs: Point[][] = [];

  characters.forEach((character, index) => {
    const glyph = LINE_DIGITS[character];
    const offsetX = left + index * cellAdvance * scale;
    const mapped = glyph.map((point) => ({
      x: offsetX + point.x * scale,
      y: top + point.y * scale,
    }));
    glyphs.push(mapped);
    // The fine ambient stroke still connects all glyphs into one route. The
    // heavier typographic layer below keeps each character's shape independent.
    points.push(...mapped);
  });

  return { points, glyphs };
}
function pointAtY(points: Point[], y: number): { point: Point; segmentIndex: number } | null {
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (y < start.y || y > end.y) continue;
    const span = end.y - start.y;
    const amount = span > 0 ? (y - start.y) / span : 0;
    return {
      point: { x: start.x + (end.x - start.x) * amount, y },
      segmentIndex: index,
    };
  }
  return null;
}

/** Replace one route segment with connected monoline digits, then resume the ambient route. */
function mergeWalletLineNumber(
  points: Point[],
  area: GraphArea | null,
): { points: Point[]; lineStart: number; lineEnd: number; glyphs: Point[][] } {
  if (!area || points.length < 2 || area.width < 30 || area.height < 24) {
    return { points, lineStart: -1, lineEnd: -1, glyphs: [] };
  }

  const connectorDepth = Math.max(28, Math.min(56, area.height * 0.62));
  const entry = pointAtY(points, area.top - connectorDepth);
  const exit = pointAtY(points, area.top + area.height + connectorDepth);
  if (!entry || !exit || exit.segmentIndex < entry.segmentIndex) {
    return { points, lineStart: -1, lineEnd: -1, glyphs: [] };
  }

  const numeral = createLineNumeral(area.value, area);
  if (numeral.points.length < 2) {
    return { points, lineStart: -1, lineEnd: -1, glyphs: [] };
  }

  const merged = [
    ...points.slice(0, entry.segmentIndex + 1),
    entry.point,
    numeral.points[0],
    ...numeral.points.slice(1),
    exit.point,
    ...points.slice(exit.segmentIndex + 1),
  ];
  const lineStart = entry.segmentIndex + 2;
  return {
    points: merged,
    lineStart,
    lineEnd: lineStart + numeral.points.length - 1,
    glyphs: numeral.glyphs,
  };
}

function applyHoverDisplacement(points: Point[], hover: HoverState | undefined, unitsPerPixel: number): Point[] {
  if (!hover || hover.strength < 0.01) return points;
  const radius = HOVER_RADIUS_PX * unitsPerPixel;
  const displacement = HOVER_PUSH_PX * unitsPerPixel * hover.strength;
  const radiusSquared = radius * radius;

  return points.map((point) => {
    const dx = point.x - hover.current.x;
    const dy = point.y - hover.current.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared < 1 || distanceSquared > radiusSquared * 9) return point;
    const distance = Math.sqrt(distanceSquared);
    const normalized = Math.min(1, distance / radius);
    const falloff = Math.exp(-2.2 * normalized * normalized);
    const force = displacement * falloff;
    return {
      x: point.x + (dx / distance) * force,
      y: point.y + (dy / distance) * force * 0.78,
    };
  });
}

function createSmoothPath(
  points: Point[],
  seed: number,
  lineStart: number,
  lineEnd: number,
): string {
  if (points.length < 2) return "";
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
    const blended = { x: incoming.x + outgoing.x, y: incoming.y + outgoing.y };
    const length = Math.hypot(blended.x, blended.y);
    return length > 0.0001
      ? { x: blended.x / length, y: blended.y / length }
      : outgoing;
  });

  const handleLengths = points.map((point, index) => {
    const previousGap = index > 0 ? distance(points[index - 1], point) : distance(point, points[index + 1]);
    const nextGap = index < points.length - 1 ? distance(point, points[index + 1]) : previousGap;
    const handleRandom = makeRandom((seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
    const isLineNumeral = lineStart >= 0 && index >= lineStart && index <= lineEnd;
    // Shorter handles inside the glyphs retain the crisp, geometric corners.
    // The cubic joins still share tangents, so the stroke remains continuous.
    const minimum = isLineNumeral ? 0.12 : 0.25;
    const maximum = isLineNumeral ? 0.18 : 0.34;
    return Math.min(previousGap, nextGap) * randomBetween(handleRandom, minimum, maximum);
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
    const curve = ` C ${controlOne.x.toFixed(1)} ${controlOne.y.toFixed(1)}`
      + ` ${controlTwo.x.toFixed(1)} ${controlTwo.y.toFixed(1)}`
      + ` ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
    path += curve;

  }
  return path;
}

function createBrutalistNumeralRoute(
  glyphs: Point[][],
  hover: HoverState | undefined,
  unitsPerPixel: number,
  seed: number,
): string {
  return glyphs.map((glyph, index) => {
    const movedGlyph = applyHoverDisplacement(glyph, hover, unitsPerPixel);
    const glyphSeed = (seed ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0;
    // Each numeral is its own subpath so the heavy type does not acquire
    // diagonal connector strokes between characters.
    return createSmoothPath(movedGlyph, glyphSeed, 0, movedGlyph.length - 1);
  }).join(" ");
}

function makePath(className: string): SVGPathElement {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("class", className);
  path.setAttribute("pathLength", "1000");
  return path;
}

function setSharedRoute(svg: SVGSVGElement, route: string, numeralRoute: string): void {
  svg.querySelector<SVGPathElement>(".blog-feed-ambient-line__track")?.setAttribute("d", route);
  svg.querySelector<SVGPathElement>(".blog-feed-ambient-line__traveller")?.setAttribute("d", route);
  svg.querySelector<SVGPathElement>(".blog-feed-ambient-line__wallet-numeral")?.setAttribute("d", numeralRoute);
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
  svg.appendChild(makePath("blog-feed-ambient-line__wallet-numeral"));
  svg.appendChild(makePath("blog-feed-ambient-line__traveller"));

  return svg;
}

function updateSvgHeight(page: HTMLElement, svg: SVGSVGElement): void {
  const content = page.querySelector<HTMLElement>(":scope > .blog-feed-content");
  const contentTop = content?.offsetTop ?? page.clientHeight;
  const contentHeight = content ? Math.max(content.offsetHeight, content.scrollHeight) : page.clientHeight;
  const height = Math.max(page.clientHeight, page.scrollHeight, contentTop + contentHeight + 24);
  const width = Math.max(page.clientWidth, page.getBoundingClientRect().width, 1);
  const viewBoxHeight = height * SVG_WIDTH_UNITS / width;
  const unitsPerPixel = SVG_WIDTH_UNITS / width;

  svg.setAttribute("viewBox", `0 0 ${SVG_WIDTH_UNITS} ${viewBoxHeight.toFixed(2)}`);
  svg.setAttribute("height", String(Math.ceil(height)));
  svg.style.height = `${Math.ceil(height)}px`;

  const seed = routeSeeds.get(svg);
  if (seed === undefined) return;
  const anchors = randomRouteAnchors(seed, viewBoxHeight, unitsPerPixel);
  const graphArea = getWalletGraphArea(page, unitsPerPixel);
  const merged = mergeWalletLineNumber(anchors, graphArea);
  const hover = hoverStates.get(svg);
  const movedPoints = applyHoverDisplacement(merged.points, hover, unitsPerPixel);
  const route = createSmoothPath(movedPoints, seed, merged.lineStart, merged.lineEnd);
  const numeralRoute = createBrutalistNumeralRoute(
    merged.glyphs,
    hover,
    unitsPerPixel,
    seed,
  );
  setSharedRoute(svg, route, numeralRoute);
}

function scheduleUpdate(page: HTMLElement, svg: SVGSVGElement): void {
  if (pendingUpdates.has(svg)) return;
  const frame = window.requestAnimationFrame(() => {
    pendingUpdates.delete(svg);
    if (svg.isConnected) updateSvgHeight(page, svg);
  });
  pendingUpdates.set(svg, frame);
}

function attachHoverTracking(page: HTMLElement, svg: SVGSVGElement): void {
  if (hoverBindings.has(svg)) return;
  const state: HoverState = {
    current: { x: 0, y: 0 },
    target: { x: 0, y: 0 },
    strength: 0,
    targetStrength: 0,
    frame: 0,
  };
  hoverStates.set(svg, state);

  const animate = () => {
    const ease = 0.2;
    state.current.x += (state.target.x - state.current.x) * ease;
    state.current.y += (state.target.y - state.current.y) * ease;
    state.strength += (state.targetStrength - state.strength) * 0.16;
    updateSvgHeight(page, svg);

    const positionDifference = Math.hypot(state.target.x - state.current.x, state.target.y - state.current.y);
    const strengthDifference = Math.abs(state.targetStrength - state.strength);
    if (positionDifference > 0.6 || strengthDifference > 0.008) {
      state.frame = window.requestAnimationFrame(animate);
    } else {
      state.frame = 0;
      if (state.strength < 0.01) {
        state.strength = 0;
        svg.classList.remove("is-pointer-active");
      }
    }
  };

  const move = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    const pageRect = page.getBoundingClientRect();
    const width = Math.max(page.clientWidth, pageRect.width, 1);
    const unitsPerPixel = SVG_WIDTH_UNITS / width;
    state.target = {
      x: (event.clientX - pageRect.left + page.scrollLeft) * unitsPerPixel,
      y: (event.clientY - pageRect.top + page.scrollTop) * unitsPerPixel,
    };
    state.targetStrength = 1;
    svg.classList.add("is-pointer-active");
    if (!state.frame) state.frame = window.requestAnimationFrame(animate);
  };

  const leave = () => {
    state.targetStrength = 0;
    if (!state.frame) state.frame = window.requestAnimationFrame(animate);
  };

  // Listen on the scrolling page, not only on the SVG stroke itself. The SVG
  // sits behind the Feed content, so a stroke-only listener cannot see pointer
  // movement over the transparent Wallet area where the numeral is drawn.
  page.addEventListener("pointermove", move, { passive: true });
  page.addEventListener("pointerleave", leave, { passive: true });
  hoverBindings.set(svg, { page, move, leave });
}

function observePageSize(page: HTMLElement, svg: SVGSVGElement): void {
  const existing = resizeBindings.get(page);
  if (existing?.svg === svg) {
    const currentGraphSurface = page.querySelector<HTMLElement>("[data-wallet-graph-surface='true']");
    if (currentGraphSurface) existing.observer?.observe(currentGraphSurface);
    return;
  }
  existing?.observer?.disconnect();
  if (existing) page.removeEventListener("scroll", existing.schedule);

  const schedule = () => scheduleUpdate(page, svg);
  page.addEventListener("scroll", schedule, { passive: true });

  if (typeof ResizeObserver === "undefined") {
    resizeBindings.set(page, { observer: null, svg, schedule });
    return;
  }

  const observer = new ResizeObserver(schedule);
  observer.observe(page);
  const content = page.querySelector<HTMLElement>(":scope > .blog-feed-content");
  const header = page.querySelector<HTMLElement>(":scope > .blogg-shared-header");
  const graphSurface = page.querySelector<HTMLElement>("[data-wallet-graph-surface='true']");
  if (content) observer.observe(content);
  if (header) observer.observe(header);
  if (graphSurface) observer.observe(graphSurface);
  resizeBindings.set(page, { observer, svg, schedule });
}

function removeAmbientSvg(page: HTMLElement): void {
  const svg = page.querySelector<SVGSVGElement>(":scope > .blog-feed-ambient-line");
  if (svg) {
    const binding = hoverBindings.get(svg);
    if (binding) {
      binding.page.removeEventListener("pointermove", binding.move);
      binding.page.removeEventListener("pointerleave", binding.leave);
    }
    const hover = hoverStates.get(svg);
    if (hover?.frame) window.cancelAnimationFrame(hover.frame);
    const pending = pendingUpdates.get(svg);
    if (pending) window.cancelAnimationFrame(pending);
    svg.remove();
  }
  const binding = resizeBindings.get(page);
  binding?.observer?.disconnect();
  if (binding) page.removeEventListener("scroll", binding.schedule);
  resizeBindings.delete(page);
}

function updatePageLine(page: HTMLElement): void {
  let svg = page.querySelector<SVGSVGElement>(":scope > .blog-feed-ambient-line");
  if (!isAmbientLineEnabled()) {
    removeAmbientSvg(page);
    return;
  }
  if (!svg) {
    svg = createAmbientSvg();
    page.insertBefore(svg, page.firstChild);
  }
  attachHoverTracking(page, svg);
  updateSvgHeight(page, svg);
  observePageSize(page, svg);
}

function ensureAmbientLines(): void {
  const pages = Array.from(ROOT.querySelectorAll<HTMLElement>(".blog-feed-page"));
  pages.forEach(updatePageLine);
}

function scheduleAllPageLines(): void {
  ROOT.querySelectorAll<HTMLElement>(".blog-feed-page").forEach((page) => {
    const svg = page.querySelector<SVGSVGElement>(":scope > .blog-feed-ambient-line");
    if (svg) scheduleUpdate(page, svg);
  });
}

ensureAmbientLines();
const observer = new MutationObserver(() => ensureAmbientLines());
observer.observe(ROOT, { childList: true, subtree: true });
document.addEventListener("scroll", scheduleAllPageLines, { capture: true, passive: true });
window.addEventListener("resize", scheduleAllPageLines, { passive: true });
window.addEventListener("scroll", scheduleAllPageLines, { passive: true });
window.visualViewport?.addEventListener("resize", scheduleAllPageLines, { passive: true });
window.visualViewport?.addEventListener("scroll", scheduleAllPageLines, { passive: true });
window.addEventListener(AMBIENT_LINE_CHANGE_EVENT, ensureAmbientLines);
window.addEventListener(WALLET_GRAPH_UPDATE_EVENT, scheduleAllPageLines);
window.addEventListener("storage", (event: StorageEvent) => {
  if (event.key === AMBIENT_LINE_PREFERENCE_KEY) ensureAmbientLines();
});
