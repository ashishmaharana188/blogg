import React from "react";

interface NodeDOMOverlayProps {
  activeLayer: string | null;
  processedGraph: { nodes: any[]; links: any[] };
  connectedNodes: Set<any>;
  hoveredNode: any;
  setSelectedNode: (node: any) => void;
  setHoveredNode: (node: any) => void;
  CENTER_X: number;
  CENTER_Y: number;
}

const NodeDOMOverlay: React.FC<NodeDOMOverlayProps> = React.memo(({
  activeLayer, processedGraph, connectedNodes, hoveredNode,
  setSelectedNode, setHoveredNode,
}) => {
  return <div className="absolute inset-0 pointer-events-none">
    {processedGraph.nodes.map((node: any) => {
      const isCenter = node.radius === 0;
      const isNotActiveLayer = activeLayer && node.layer !== activeLayer;
      const nodeKey = node.uniqueId || node.id;
      const isHoveredFocus = !!hoveredNode && connectedNodes.size > 0 && connectedNodes.has(nodeKey);
      const shouldDimForHover = !!hoveredNode && connectedNodes.size > 0 && !isHoveredFocus;
      let dotColor = "bg-rose-500";
      if (node.group === "library") dotColor = "bg-emerald-500";
      else if (node.group === "brain") dotColor = "bg-black";
      else if (node.group === "echo") dotColor = "bg-rose-700";
      else if (node.group === "notes" && node.isGroupNode) dotColor = "bg-violet-500";
      else if (node.group === "notes") dotColor = "bg-blue-500";
      else if (node.group === "stacks") dotColor = "bg-amber-500";

      if (isCenter) return <div key={nodeKey} className={`graph-node absolute z-30 flex h-24 w-24 cursor-pointer items-center justify-center rounded-full border-4 border-gray-100 bg-gray-900 shadow-[0_0_20px_rgba(0,0,0,0.2)] transition-all duration-500 pointer-events-auto ${activeLayer ? "scale-90 opacity-80" : "scale-100 opacity-100"}`} style={{ left: node.x - 48, top: node.y - 48 }} onClick={(event) => { event.stopPropagation(); setSelectedNode(node); }}>
        <span className="max-w-[76px] px-1 text-center text-[8px] font-bold uppercase leading-tight tracking-[0.12em] text-white">{node.label || node.title || "STACK"}</span>
      </div>;

      return <div key={nodeKey} className={`group graph-node absolute z-20 transition-opacity duration-300 hover:z-[100] ${isNotActiveLayer ? "pointer-events-none opacity-20 grayscale" : shouldDimForHover ? "pointer-events-auto opacity-25" : "pointer-events-auto opacity-100"}`} style={{ left: node.x, top: node.y, transform: `rotate(${node.rotation || 0}deg)` }} onMouseEnter={() => setHoveredNode(node)} onMouseLeave={() => setHoveredNode(null)} onClick={(event) => { event.stopPropagation(); setSelectedNode(node); }}>
        <div className={`absolute left-0 top-0 flex -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center border border-gray-300 bg-surface shadow-sm transition-all duration-300 group-hover:scale-125 ${node.isSubnode ? "h-3 w-3 rounded-sm" : node.isExternalStack ? "h-5 w-5 rounded-full" : "h-5 w-5"} ${isHoveredFocus ? "ring-2 ring-amber-400 ring-offset-2 ring-offset-white" : ""}`}>
          <div className={`${node.isSubnode ? "h-1.5 w-1.5" : "h-2.5 w-2.5"} rounded-full ${dotColor}`} />
        </div>
        <span className={`pointer-events-none absolute top-0 -translate-y-1/2 whitespace-nowrap font-bold uppercase tracking-[0.12em] opacity-0 transition-all duration-300 group-hover:rounded group-hover:bg-surface/95 group-hover:px-2 group-hover:py-0.5 group-hover:opacity-100 group-hover:shadow-lg ${node.isSubnode ? "left-4 max-w-48 text-[8px] text-muted" : "left-6 max-w-56 text-[10px] text-gray-800"}`}>
          {node.label || node.title}{node.isExternalReferenceTarget ? <span className="ml-1 normal-case text-slate-500">· {node.stackTitle || "external"}</span> : null}
        </span>
      </div>;
    })}
  </div>;
});

export default NodeDOMOverlay;
