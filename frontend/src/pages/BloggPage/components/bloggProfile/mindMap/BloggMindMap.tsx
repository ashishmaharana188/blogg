import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, PointerEvent as ReactPointerEvent } from "react";
import OrbitLayersLegend from "./components/OrbitLayersLegend";
import RadialSVGPaths from "./components/RadialSVGPaths";
import NodeDOMOverlay from "./components/NodeDOMOverlay";
import BloggMindMapInspector from "./components/BloggMindMapInspector";
import useBloggMindMapState from "./hooks/useBloggMindMapState";
import "./bloggMindMap.css";

type Props = {
  onBack: () => void;
  onOpenBlogg: (bloggId: string, edit?: boolean) => void;
  canEdit?: boolean;
};
type Camera = { scale: number; x: number; y: number };
type PointerPoint = { x: number; y: number };
type Gesture =
  | { type: "pan"; pointerId: number; startX: number; startY: number; originX: number; originY: number }
  | { type: "pinch"; pointerIds: [number, number]; startDistance: number; startScale: number; anchorX: number; anchorY: number }
  | { type: "rotate"; pointerId: number; layer: string; lastAngle: number; startX: number; startY: number; startedOnRing: boolean; hasMoved: boolean }
  | null;

const MIN_SCALE = 0.25;
const MAX_SCALE = 2.2;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const distance = (a: PointerPoint, b: PointerPoint) => Math.hypot(b.x - a.x, b.y - a.y);

export default function BloggMindMap({ onBack, onOpenBlogg, canEdit = false }: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMessage, setSearchMessage] = useState("");
  const [focusedBloggId, setFocusedBloggId] = useState<string | null>(null);
  const state = useBloggMindMapState(focusedBloggId);
  const svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointsRef = useRef<Map<number, PointerPoint>>(new Map());
  const gestureRef = useRef<Gesture>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Fit the whole graph, not merely the outer ring's radius. The previous
  // calculation used a too-small extent and caused initial clipping/over-zoom.
  const initialScale = useMemo(() => {
    if (typeof window === "undefined") return 0.5;
    const availableWidth = Math.max(320, window.innerWidth - 64);
    const availableHeight = Math.max(300, window.innerHeight - 150);
    const widthFit = availableWidth / (state.CENTER_X * 2);
    const heightFit = availableHeight / (state.CENTER_Y * 2);
    return clamp(Math.min(widthFit, heightFit), MIN_SCALE, 0.9);
  }, [state.CENTER_X, state.CENTER_Y]);
  const cameraRef = useRef<Camera>({ scale: initialScale, x: 0, y: 0 });
  const worldRef = useRef<HTMLDivElement>(null);
  const scaleReadoutRef = useRef<HTMLSpanElement>(null);
  const cameraFrameRef = useRef<number | null>(null);
  const suppressNextLayerClickRef = useRef(false);
  const clearSuppressedClickTimerRef = useRef<number | null>(null);

  const handleSearchSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) {
      setFocusedBloggId(null);
      setSearchMessage("");
      return;
    }

    const candidates = [...(state.data?.bloggs || [])].sort((a, b) =>
      String(a.title || "").localeCompare(String(b.title || "")),
    );
    const titleOf = (blogg: { title?: string }) => String(blogg.title || "").trim().toLocaleLowerCase();
    const matches = candidates.filter((blogg) => titleOf(blogg).includes(query));
    const match =
      candidates.find((blogg) => titleOf(blogg) === query) ||
      candidates.find((blogg) => titleOf(blogg).startsWith(query)) ||
      matches[0];

    if (!match) {
      setFocusedBloggId(null);
      setSearchMessage(`No blog title matches “${searchQuery.trim()}”.`);
      return;
    }

    setFocusedBloggId(match.blogg_id);
    setSearchMessage(
      matches.length > 1
        ? `Showing “${match.title}” · ${matches.length} title matches`
        : `Showing “${match.title}” · related links highlighted`,
    );
  }, [searchQuery, state.data]);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSearchMessage("");
    setFocusedBloggId(null);
  }, []);

  const getRotationAngle = useCallback((clientX: number, clientY: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return 0;
    const rect = viewport.getBoundingClientRect();
    // The graph's centre follows camera translation but not camera scale.
    const centerX = rect.left + rect.width / 2 + cameraRef.current.x;
    const centerY = rect.top + rect.height / 2 + cameraRef.current.y;
    return Math.atan2(clientY - centerY, clientX - centerX);
  }, []);

  const shouldSuppressLayerClick = useCallback(() => {
    const shouldSuppress = suppressNextLayerClickRef.current;
    if (shouldSuppress) {
      suppressNextLayerClickRef.current = false;
      if (clearSuppressedClickTimerRef.current !== null) {
        window.clearTimeout(clearSuppressedClickTimerRef.current);
        clearSuppressedClickTimerRef.current = null;
      }
    }
    return shouldSuppress;
  }, []);

  // Camera motion writes only the transformed world layer. It deliberately
  // avoids React state updates on every pointermove/wheel event, which forced
  // every SVG edge and DOM node to render on every frame and made the canvas lag.
  const applyCamera = useCallback(() => {
    cameraFrameRef.current = null;
    const current = cameraRef.current;
    const world = worldRef.current;
    if (world) {
      world.style.transform = `translate(-50%, -50%) translate3d(${current.x}px, ${current.y}px, 0) scale(${current.scale})`;
    }
    if (scaleReadoutRef.current) {
      scaleReadoutRef.current.textContent = `${Math.round(current.scale * 100)}%`;
    }
  }, []);

  const updateCamera = useCallback((next: Camera) => {
    cameraRef.current = next;
    if (cameraFrameRef.current === null) {
      cameraFrameRef.current = window.requestAnimationFrame(applyCamera);
    }
  }, [applyCamera]);

  useEffect(() => () => {
    if (cameraFrameRef.current !== null) window.cancelAnimationFrame(cameraFrameRef.current);
    if (clearSuppressedClickTimerRef.current !== null) {
      window.clearTimeout(clearSuppressedClickTimerRef.current);
    }
  }, []);

  const resetCamera = useCallback(() => {
    updateCamera({ scale: initialScale, x: 0, y: 0 });
    state.setActiveLayer(null);
  }, [initialScale, state.setActiveLayer, updateCamera]);

  const handleWheel = useCallback((event: globalThis.WheelEvent) => {
    // Wheel input has one unambiguous owner: zoom the camera when no ring is
    // selected; rotate the selected ring when a ring is active.
    if (state.activeLayer) {
      state.handleWheel(event as unknown as Parameters<typeof state.handleWheel>[0]);
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) return;
    event.preventDefault();

    const rect = viewport.getBoundingClientRect();
    let deltaY = event.deltaY;
    if (event.deltaMode === 1) deltaY *= 16;
    else if (event.deltaMode === 2) deltaY *= rect.height;
    deltaY = clamp(deltaY, -160, 160);

    const current = cameraRef.current;
    const scale = clamp(current.scale * Math.exp(-deltaY * 0.00055), MIN_SCALE, MAX_SCALE);
    if (Math.abs(scale - current.scale) < 0.0001) return;

    // Keep the world point under the cursor stationary while zooming.
    const pointerX = event.clientX - rect.left - rect.width / 2;
    const pointerY = event.clientY - rect.top - rect.height / 2;
    const ratio = scale / current.scale;
    updateCamera({
      scale,
      x: pointerX - (pointerX - current.x) * ratio,
      y: pointerY - (pointerY - current.y) * ratio,
    });
  }, [state.activeLayer, state.handleWheel, updateCamera]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const target = event.target instanceof Element ? event.target : null;
    const layerElement = target?.closest("[data-mindmap-layer]") as SVGCircleElement | null;
    const targetLayer = layerElement?.dataset.mindmapLayer || null;
    const interactiveNodeOrControl = Boolean(target?.closest(
      "button, a, input, select, textarea, .graph-node, [data-mindmap-interactive]:not([data-mindmap-layer])",
    ));

    // A click on a different/unselected ring is a selection gesture. Let its
    // click handler select it; do not accidentally pan/rotate on that same down.
    if (targetLayer && targetLayer !== state.activeLayer) return;

    if (state.activeLayer) {
      // With a ring selected, dragging blank canvas or that ring rotates it.
      // Node/control clicks remain clicks and never start a canvas gesture.
      if (interactiveNodeOrControl && !targetLayer) return;

      const points = new Map(pointsRef.current);
      points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      pointsRef.current = points;

      // If a second finger arrives, keep the selected-ring rotation mode. The
      // active pointer continues rotating; no camera pinch/zoom is started.
      if (gestureRef.current?.type === "rotate") return;

      const startedOnRing = Boolean(targetLayer && targetLayer === state.activeLayer);
      gestureRef.current = {
        type: "rotate",
        pointerId: event.pointerId,
        layer: state.activeLayer,
        lastAngle: getRotationAngle(event.clientX, event.clientY),
        startX: event.clientX,
        startY: event.clientY,
        startedOnRing,
        hasMoved: false,
      };

      // Do not capture a selected ring until it actually moves, preserving the
      // native click so a simple click can deselect the ring.
      if (!startedOnRing) {
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* detached pointer */ }
      }
      return;
    }

    // When no ring is selected, ring clicks only select. Empty-canvas drags pan.
    if (targetLayer) return;
    const interactive = interactiveNodeOrControl || Boolean(target?.closest("[data-mindmap-interactive]"));
    if (interactive && event.pointerType !== "touch") return;

    const points = new Map(pointsRef.current);
    points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pointsRef.current = points;
    // Keep ordinary touch taps on nodes clickable. Capture interactive touch
    // pointers only once a second finger actually starts a pinch.
    if (!interactive || event.pointerType !== "touch") {
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* detached pointer */ }
    }

    if (points.size >= 2) {
      const pair = [...points.entries()].slice(0, 2);
      const [firstId, first] = pair[0];
      const [secondId, second] = pair[1];
      const viewport = viewportRef.current;
      if (!viewport) return;
      try {
        event.currentTarget.setPointerCapture(firstId);
        event.currentTarget.setPointerCapture(secondId);
      } catch { /* one pointer may have left the viewport */ }
      const rect = viewport.getBoundingClientRect();
      const midpointX = (first.x + second.x) / 2 - rect.left - rect.width / 2;
      const midpointY = (first.y + second.y) / 2 - rect.top - rect.height / 2;
      const current = cameraRef.current;
      gestureRef.current = {
        type: "pinch",
        pointerIds: [firstId, secondId],
        startDistance: Math.max(1, distance(first, second)),
        startScale: current.scale,
        anchorX: (midpointX - current.x) / current.scale,
        anchorY: (midpointY - current.y) / current.scale,
      };
      setIsDragging(true);
      return;
    }

    if (!interactive) {
      const current = cameraRef.current;
      gestureRef.current = {
        type: "pan",
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: current.x,
        originY: current.y,
      };
      setIsDragging(true);
    } else {
      gestureRef.current = null;
    }
  }, [getRotationAngle, state.activeLayer]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const currentGesture = gestureRef.current;
    if (!currentGesture) return;
    const points = new Map(pointsRef.current);
    if (!points.has(event.pointerId)) return;
    points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pointsRef.current = points;

    if (currentGesture.type === "rotate" && currentGesture.pointerId === event.pointerId) {
      event.preventDefault();
      const angle = getRotationAngle(event.clientX, event.clientY);
      const moved = currentGesture.hasMoved || Math.hypot(
        event.clientX - currentGesture.startX,
        event.clientY - currentGesture.startY,
      ) >= 3;

      if (moved) {
        const delta = Math.atan2(
          Math.sin(angle - currentGesture.lastAngle),
          Math.cos(angle - currentGesture.lastAngle),
        );
        if (Math.abs(delta) > 0.0001) state.rotateLayerBy(currentGesture.layer, delta);

        if (currentGesture.startedOnRing && !currentGesture.hasMoved) {
          // Capture only after the drag threshold so a stationary click still
          // reaches the ring and can toggle selection off.
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* detached pointer */ }
          suppressNextLayerClickRef.current = true;
        }
        setIsDragging(true);
      }

      gestureRef.current = { ...currentGesture, lastAngle: angle, hasMoved: moved };
      return;
    }

    if (currentGesture.type === "pan" && currentGesture.pointerId === event.pointerId) {
      event.preventDefault();
      updateCamera({
        ...cameraRef.current,
        x: currentGesture.originX + event.clientX - currentGesture.startX,
        y: currentGesture.originY + event.clientY - currentGesture.startY,
      });
      return;
    }

    if (currentGesture.type === "pinch") {
      const first = points.get(currentGesture.pointerIds[0]);
      const second = points.get(currentGesture.pointerIds[1]);
      const viewport = viewportRef.current;
      if (!first || !second || !viewport) return;
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const nextScale = clamp(
        currentGesture.startScale * (distance(first, second) / currentGesture.startDistance),
        MIN_SCALE,
        MAX_SCALE,
      );
      const midpointX = (first.x + second.x) / 2 - rect.left - rect.width / 2;
      const midpointY = (first.y + second.y) / 2 - rect.top - rect.height / 2;
      updateCamera({
        scale: nextScale,
        x: midpointX - currentGesture.anchorX * nextScale,
        y: midpointY - currentGesture.anchorY * nextScale,
      });
    }
  }, [getRotationAngle, state.rotateLayerBy, updateCamera]);

  const finishPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const previousGesture = gestureRef.current;
    const points = new Map(pointsRef.current);
    points.delete(event.pointerId);
    pointsRef.current = points;

    if (previousGesture?.type === "rotate" && previousGesture.startedOnRing && previousGesture.hasMoved) {
      // A drag on a ring often generates a click afterward. Suppress that click
      // for this event cycle so the drag rotates instead of deselecting the ring.
      if (clearSuppressedClickTimerRef.current !== null) {
        window.clearTimeout(clearSuppressedClickTimerRef.current);
      }
      clearSuppressedClickTimerRef.current = window.setTimeout(() => {
        suppressNextLayerClickRef.current = false;
        clearSuppressedClickTimerRef.current = null;
      }, 0);
    }

    if (points.size === 0) {
      gestureRef.current = null;
      setIsDragging(false);
      return;
    }

    // When a finger is lifted from a pinch, continue panning with the remaining
    // finger if no ring is selected. In rotation mode, continue rotating the
    // selected ring with the remaining pointer instead of zooming the camera.
    if ((previousGesture?.type === "pinch" || previousGesture?.type === "rotate") && points.size === 1) {
      const [pointerId, point] = [...points.entries()][0];
      if (previousGesture.type === "rotate" && state.activeLayer) {
        gestureRef.current = {
          type: "rotate",
          pointerId,
          layer: state.activeLayer,
          lastAngle: getRotationAngle(point.x, point.y),
          startX: point.x,
          startY: point.y,
          startedOnRing: false,
          hasMoved: false,
        };
      } else {
        const current = cameraRef.current;
        gestureRef.current = {
          type: "pan",
          pointerId,
          startX: point.x,
          startY: point.y,
          originX: current.x,
          originY: current.y,
        };
      }
    }
  }, [getRotationAngle, state.activeLayer]);

  if (state.loading) {
    return (
      <div className="flex h-full min-h-[500px] flex-col items-center justify-center border border-border-subtle bg-surface">
        <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-gray-800 border-t-transparent" />
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-muted">Building blog map…</p>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="flex h-full min-h-[500px] flex-col items-center justify-center gap-3 border border-border-subtle bg-surface px-6 text-center">
        <p className="text-sm font-bold uppercase tracking-[0.15em] text-primary">Could not build the blog map</p>
        <p role="alert" className="max-w-xl text-sm text-red-700">{state.error}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => void state.refresh()} className="border border-gray-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-widest hover:bg-canvas">Retry</button>
          <button type="button" onClick={onBack} className="bg-gray-900 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white hover:bg-accent-hover">Folder View</button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[500px] w-full select-none overflow-hidden border border-border-subtle bg-[#fdfdfd] font-sans blogg-radial-map">
      <div className="pointer-events-none absolute inset-0 z-0 opacity-40" style={{ backgroundImage: "radial-gradient(#9ca3af 1px, transparent 1px)", backgroundSize: "24px 24px" }} />

      <div className="pointer-events-none absolute left-8 top-6 z-10">
        <div className="pointer-events-auto mb-3 flex items-center gap-2">
          <button type="button" onClick={onBack} className="inline-flex items-center gap-2 border border-gray-300 bg-surface/90 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-700 transition-colors hover:bg-canvas">
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12.5 4.5 7 10l5.5 5.5" /><path d="M7.5 10H17" /></svg>
            Folder View
          </button>
          <button type="button" onClick={resetCamera} className="border border-gray-300 bg-surface/90 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-700 transition-colors hover:bg-canvas" title="Reset map zoom and position">
            Reset View
          </button>
          <span ref={scaleReadoutRef} className="px-1 text-[10px] font-mono text-slate-500" aria-live="off">{Math.round(initialScale * 100)}%</span>
        </div>
        <form className="mindmap-title-search pointer-events-auto" role="search" onSubmit={handleSearchSubmit}>
          <label className="sr-only" htmlFor="mindmap-blog-title-search">Search blogs by title</label>
          <input
            id="mindmap-blog-title-search"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") clearSearch();
            }}
            placeholder="Find a blog title…"
            autoComplete="off"
            disabled={state.loading || !(state.data?.bloggs.length)}
          />
          <button type="submit" disabled={state.loading || !searchQuery.trim()} aria-label="Search blog titles">Search</button>
          {focusedBloggId && (
            <button type="button" className="mindmap-title-search-clear" onClick={clearSearch} aria-label="Clear mind map search">Clear</button>
          )}
          {searchMessage && <p className={focusedBloggId ? "is-success" : "is-error"} role="status">{searchMessage}</p>}
          <span className="mindmap-title-search-hint">Searches available blog titles. The result temporarily swaps into a highlighted outer-ring position.</span>
        </form>
        <div className={`transition-opacity duration-300 ${state.activeLayer ? "opacity-0" : "opacity-100"}`}>
          <h1 className="text-xl font-bold uppercase tracking-[0.1em] text-primary">Stack · Folder · Blog</h1>
          <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-muted">With no ring selected: scroll to zoom, drag empty canvas to pan. Select a ring to rotate it by scrolling or dragging.</p>
        </div>
      </div>

      <OrbitLayersLegend />

      <div
        ref={viewportRef}
        className={`absolute inset-0 z-0 overflow-hidden ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
        style={{ touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
      >
        <div
          ref={worldRef}
          className="absolute left-1/2 top-1/2"
          style={{
            width: state.CENTER_X * 2,
            height: state.CENTER_Y * 2,
            transform: `translate(-50%, -50%) translate3d(0, 0, 0) scale(${initialScale})`,
            transformOrigin: "center center",
            willChange: "transform",
          }}
        >
          <RadialSVGPaths
            svgRef={svgRef}
            activeLayer={state.activeLayer}
            setActiveLayer={state.setActiveLayer}
            processedGraph={state.processedGraph}
            connectedLinks={state.connectedLinks}
            hoveredNode={state.hoveredNode}
            ORBITS={state.ORBITS}
            CENTER_X={state.CENTER_X}
            CENTER_Y={state.CENTER_Y}
            shouldSuppressLayerClick={shouldSuppressLayerClick}
            focusedBloggId={focusedBloggId}
          />
          <NodeDOMOverlay
            activeLayer={state.activeLayer}
            processedGraph={state.processedGraph}
            connectedNodes={state.connectedNodes}
            hoveredNode={state.hoveredNode}
            setSelectedNode={state.setSelectedNode}
            setHoveredNode={state.setHoveredNode}
            focusedBloggId={focusedBloggId}
            CENTER_X={state.CENTER_X}
            CENTER_Y={state.CENTER_Y}
          />
        </div>
      </div>

      <BloggMindMapInspector
        selectedNode={state.selectedNode}
        bloggs={state.data?.bloggs || []}
        canEdit={canEdit}
        onClose={() => state.setSelectedNode(null)}
        onOpenBlogg={onOpenBlogg}
      />
    </div>
  );
}
