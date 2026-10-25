import React from "react";
import { publicStateAssets } from "virtual:public-state-assets";

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

// Select from Blogg's existing frontend/src/public assets. If a GIF exists,
// prefer it so the centre remains animated; otherwise use an existing image.
const centerGifs = publicStateAssets.filter((asset) => /\.gif(?:[?#].*)?$/i.test(asset));
const centerImages = publicStateAssets.filter((asset) => /\.(?:png|jpe?g|webp|avif|svg)(?:[?#].*)?$/i.test(asset));
const centerMediaCandidates = centerGifs.length ? centerGifs : centerImages;
const centerMediaUrl = centerMediaCandidates.length
  ? centerMediaCandidates[Math.floor(Math.random() * centerMediaCandidates.length)]
  : "";

const NodeDOMOverlay: React.FC<NodeDOMOverlayProps> = React.memo(({
  activeLayer, processedGraph, connectedNodes, hoveredNode,
  setSelectedNode, setHoveredNode, focusedBloggId, CENTER_X, CENTER_Y,
}) => {
  const [centerMediaFailed, setCenterMediaFailed] = React.useState(false);
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

    // Ownership is a two-edge path: blog -> folder -> stack.
    const focusedBlog = processedGraph.nodes.find(
      (node: any) => String(node.uniqueId || node.id) === String(focusedBloggId),
    );
    const folderId = String(focusedBlog?.groupId || "");
    const folder = folderId
      ? processedGraph.nodes.find((node: any) => String(node.uniqueId || node.id) === folderId)
      : undefined;
    const stackId = String(folder?.stackId || focusedBlog?.stackId || "");
    if (folderId) focusedConnectionIds.add(folderId);
    if (stackId) focusedConnectionIds.add(stackId);
  }

  return <div className="absolute inset-0 pointer-events-none">
    {/* The center is a geometric anchor rather than a graph data node in Blogg.
        Render it independently so it always appears, even when no media exists. */}
    <div
      className={`graph-node blogg-mindmap-center-node absolute z-30 flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-4 border-gray-100 bg-gray-900 shadow-[0_0_20px_rgba(0,0,0,0.2)] transition-all duration-500 pointer-events-none ${activeLayer ? "scale-90 opacity-80" : "scale-100 opacity-100"}`}
      style={{ left: CENTER_X - 48, top: CENTER_Y - 48 }}
      role="img"
      aria-label="Blogg Mind Map centre"
    >
      <span className={`blogg-mindmap-center-fallback ${centerMediaUrl && !centerMediaFailed ? "is-covered" : ""}`}>
        <span className="blogg-mindmap-center-mark" aria-hidden="true">B</span>
        <span className="blogg-mindmap-center-label">BLOGG</span>
      </span>
      {centerMediaUrl && !centerMediaFailed && (
        <img
          className="blogg-mindmap-center-media"
          src={centerMediaUrl}
          alt=""
          draggable={false}
          loading="eager"
          decoding="async"
          onError={() => setCenterMediaFailed(true)}
        />
      )}
    </div>

    {processedGraph.nodes.map((node: any) => {
      const isCenter = node.radius === 0;
      if (isCenter) return null;
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
