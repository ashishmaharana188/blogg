import React from "react";

interface NodeDOMOverlayProps {
  activeLayer: string | null;
  processedGraph: { nodes: any[]; links: any[] };
  connectedNodes: Set<any>;
  hoveredNode: any;
  setSelectedNode: (node: any) => void;
  setHoveredNode: (node: any) => void;
  focusedBloggId?: string | null;
  CENTER_X: number;
  CENTER_Y: number;
}

const NodeDOMOverlay: React.FC<NodeDOMOverlayProps> = React.memo(({
  activeLayer, processedGraph, connectedNodes, hoveredNode,
  setSelectedNode, setHoveredNode, focusedBloggId,
}) => {
  const focusedConnectionIds = new Set<string>();
  if (focusedBloggId) {
    focusedConnectionIds.add(String(focusedBloggId));
    processedGraph.links.forEach((link: any) => {
      const sourceId = String(link.sourceNode?.uniqueId || link.sourceNode?.id || link.source || "");
      const targetId = String(link.targetNode?.uniqueId || link.targetNode?.id || link.target || "");
      if (sourceId === focusedBloggId || targetId === focusedBloggId) {
        if (sourceId) focusedConnectionIds.add(sourceId);
        if (targetId) focusedConnectionIds.add(targetId);
      }
    });
  }

  return <div className="absolute inset-0 pointer-events-none">
    {processedGraph.nodes.map((node: any) => {
      const isCenter = node.radius === 0;
      const isNotActiveLayer = activeLayer && node.layer !== activeLayer;
      const nodeKey = node.uniqueId || node.id;
      const isSpotlightNode = Boolean(focusedBloggId && String(nodeKey) === focusedBloggId);
      const isSearchConnection = Boolean(focusedBloggId && focusedConnectionIds.has(String(nodeKey)));
      const isHoveredFocus = isSpotlightNode || isSearchConnection || (!!hoveredNode && connectedNodes.size > 0 && connectedNodes.has(nodeKey));
      const shouldDimForHover = !!hoveredNode && connectedNodes.size > 0 && !connectedNodes.has(nodeKey);
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

      const searchDimmed = Boolean(focusedBloggId && !isSearchConnection);
      const nodeVisibility = isSpotlightNode
        ? "pointer-events-auto opacity-100"
        : searchDimmed
          ? "pointer-events-none opacity-[0.12] grayscale"
          : isNotActiveLayer
            ? "pointer-events-none opacity-20 grayscale"
            : shouldDimForHover
              ? "pointer-events-auto opacity-25"
              : "pointer-events-auto opacity-100";
      const labelVisible = isSpotlightNode || isSearchConnection || (isHoveredFocus && !focusedBloggId);
      return <div key={nodeKey} className={`group graph-node absolute z-20 transition-opacity duration-300 hover:z-[100] ${nodeVisibility}`} style={{ left: node.x, top: node.y, zIndex: isSpotlightNode ? 200 : isSearchConnection ? 80 : undefined, transform: `rotate(${node.rotation || 0}deg)` }} onMouseEnter={() => setHoveredNode(node)} onMouseLeave={() => setHoveredNode(null)} onClick={(event) => { event.stopPropagation(); setSelectedNode(node); }}>
        <div className={`absolute left-0 top-0 flex -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center bg-surface shadow-sm transition-all duration-300 group-hover:scale-125 ${isSpotlightNode ? "h-6 w-6 rounded-full border-2 border-amber-500 ring-4 ring-amber-300/50" : node.isSubnode ? "h-3 w-3 rounded-sm border border-gray-300" : node.isExternalStack ? "h-5 w-5 rounded-full border border-gray-300" : "h-5 w-5 border border-gray-300"} ${isHoveredFocus ? "ring-2 ring-amber-400 ring-offset-2 ring-offset-white" : ""}`}>
          <div className={`${isSpotlightNode ? "h-3 w-3" : node.isSubnode ? "h-1.5 w-1.5" : "h-2.5 w-2.5"} rounded-full ${dotColor}`} />
        </div>
        <span className={`pointer-events-none absolute top-0 -translate-y-1/2 whitespace-nowrap font-bold uppercase tracking-[0.12em] transition-all duration-300 ${labelVisible ? "rounded border border-slate-200 bg-white/95 px-2 py-1 opacity-100 shadow-md" : "opacity-0 group-hover:rounded group-hover:bg-surface/95 group-hover:px-2 group-hover:py-0.5 group-hover:opacity-100 group-hover:shadow-lg"} ${isSpotlightNode ? "left-5 z-[210] max-w-[260px] truncate text-[10px] text-amber-900" : node.isSubnode ? "left-4 max-w-48 text-[8px] text-muted" : "left-6 max-w-56 text-[10px] text-gray-800"}`}>
          {node.label || node.title}{node.isExternalReferenceTarget ? <span className="ml-1 normal-case text-slate-500">· {node.stackTitle || "external"}</span> : null}
        </span>
      </div>;
    })}
  </div>;
});

export default NodeDOMOverlay;
