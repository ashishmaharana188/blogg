import React from "react";

interface RadialSVGPathsProps {
  svgRef: React.RefObject<SVGSVGElement>;
  activeLayer: string | null;
  setActiveLayer: (layer: string | null) => void;
  processedGraph: { links: any[]; nodes: any[] };
  connectedLinks: Set<any>;
  hoveredNode: any;
  ORBITS: Record<string, number>;
  CENTER_X: number;
  CENTER_Y: number;
  shouldSuppressLayerClick?: () => boolean;
  focusedBloggId?: string | null;
}

const RadialSVGPaths: React.FC<RadialSVGPathsProps> = React.memo(({
  svgRef, activeLayer, setActiveLayer, processedGraph, connectedLinks,
  hoveredNode, ORBITS, CENTER_X, CENTER_Y, shouldSuppressLayerClick, focusedBloggId,
}) => (
  <svg ref={svgRef} className="pointer-events-none absolute inset-0" width="100%" height="100%">
    {Object.entries(ORBITS).map(([key, radius]) => {
      const isActive = activeLayer === key;
      const anotherActive = Boolean(activeLayer && activeLayer !== key);
      return <g key={key}>
        <circle className={`transition-all duration-700 ${isActive ? "stroke-amber-500 stroke-[3px] opacity-100" : anotherActive ? "stroke-slate-300 stroke-[1px] opacity-20" : "stroke-slate-300 stroke-[1.5px] opacity-40"}`} cx={CENTER_X} cy={CENTER_Y} r={radius} fill="none" strokeDasharray={isActive ? "0" : "6 6"} />
        <circle
          className={`pointer-events-auto cursor-pointer ${isActive ? "mindmap-ring-selected" : ""}`}
          data-mindmap-interactive="true"
          data-mindmap-layer={key}
          cx={CENTER_X}
          cy={CENTER_Y}
          r={radius}
          fill="none"
          stroke="transparent"
          strokeWidth={24}
          onClick={(event) => {
            event.stopPropagation();
            if (shouldSuppressLayerClick?.()) {
              event.preventDefault();
              return;
            }
            setActiveLayer(isActive ? null : key);
          }}
        />
      </g>;
    })}
    {processedGraph.links.map((link: any, index: number) => {
      const hoveredPath = Boolean(hoveredNode && connectedLinks.has(link));
      const sourceId = String(link.sourceNode?.uniqueId || link.sourceNode?.id || link.source || "");
      const targetId = String(link.targetNode?.uniqueId || link.targetNode?.id || link.target || "");
      const focusedPath = Boolean(focusedBloggId && (sourceId === focusedBloggId || targetId === focusedBloggId));
      const dimmed = Boolean(activeLayer && link.sourceNode.layer !== activeLayer && link.targetNode.layer !== activeLayer);
      const manual = link.type === "manual_link";
      const compound = link.type === "compound_link";
      const cross = link.type === "cross_link";
      const pollination = link.type === "cross_pollination";
      const relational = manual || compound || cross || pollination;
      const stroke = focusedPath ? "#0f9c91" : hoveredPath ? (relational ? "var(--color-accent, #8b5cf6)" : "var(--color-primary, #64748b)") : manual ? "var(--color-accent, #0f766e)" : cross ? "var(--color-accent, #a78bfa)" : compound ? "var(--color-accent, #f43f5e)" : pollination ? "var(--color-accent, #10b981)" : "var(--color-border-subtle, #cbd5e1)";
      const opacity = focusedBloggId
        ? focusedPath ? 1 : 0.035
        : dimmed ? 0.05 : activeLayer ? (relational ? 0.8 : 0.4) : relational ? 0.7 : 1;
      return <line key={link.id || `link-${index}`} x1={link.sourceNode.x} y1={link.sourceNode.y} x2={link.targetNode.x} y2={link.targetNode.y} stroke={stroke} strokeWidth={focusedPath ? 3.5 : hoveredPath ? 3 : relational ? 2 : 1.5} strokeDasharray={cross ? "4 4" : compound ? "2 2" : link.isSynthetic ? "3 3" : "0"} opacity={opacity} className="transition-all duration-300" />;
    })}
  </svg>
));

export default RadialSVGPaths;
