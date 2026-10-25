import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WheelEvent } from "react";
import {
  fetchBloggMindMapData,
  type BloggMindMapData,
} from "../../../../services/bloggReferencesService";
import useRadialGraphMath from "./useRadialGraphMath";

type GraphNode = Record<string, any>;
type GraphLink = Record<string, any>;

function toGraphData(data: BloggMindMapData | null) {
  if (!data) return { nodes: [] as GraphNode[], links: [] as GraphLink[] };

  const stackNodes: GraphNode[] = data.stacks.map((stack) => ({
    id: String(stack.stack_id),
    label: stack.stack_name || "Untitled stack",
    title: stack.stack_name || "Untitled stack",
    group: "stacks",
    nodeType: "stack",
    hasFile: false,
  }));

  const groupNodes: GraphNode[] = data.groups.map((group) => ({
    id: String(group.group_id),
    label: group.group_name || "Untitled folder",
    title: group.group_name || "Untitled folder",
    group: "notes",
    nodeType: "group",
    isGroupNode: true,
    stackId: String(group.stack_id || ""),
    hasFile: false,
  }));

  const blogNodes: GraphNode[] = data.bloggs.map((blogg) => ({
    id: String(blogg.blogg_id),
    label: blogg.title || "Untitled blog",
    title: blogg.title || "Untitled blog",
    description: blogg.subtitle || "",
    author: blogg.author || "",
    group: "notes",
    nodeType: "blog",
    isSubnode: true,
    stackId: String(blogg.stack_id || ""),
    groupId: String(blogg.group_id || ""),
    isPublic: blogg.isPublic !== false,
    references: Array.isArray(blogg.references) ? blogg.references : [],
  }));

  const links: GraphLink[] = [];
  for (const blogg of data.bloggs) {
    for (const reference of blogg.references || []) {
      const targetId = String(reference.target_blogg_id || "");
      const sourceId = String(blogg.blogg_id || "");
      if (!sourceId || !targetId || targetId === sourceId) continue;
      links.push({
        id: String(reference.reference_id || `${sourceId}:${targetId}`),
        source: sourceId,
        target: targetId,
        type: "manual_link",
        label: reference.target_excerpt || "",
        context_text: reference.target_excerpt || "",
        reference,
        weight: 1,
      });
    }
  }

  return { nodes: [...stackNodes, ...groupNodes, ...blogNodes], links };
}

export default function useBloggMindMapState(focusedBloggId: string | null = null) {
  const [data, setData] = useState<BloggMindMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [hoveredNode, setHoveredNode] = useState<any>(null);
  const [activeLayer, setActiveLayer] = useState<string | null>(null);
  const [rotationOffsets, setRotationOffsets] = useState<Record<string, number>>({
    stacks: 0,
    groups: 0,
    blogs: 0,
  });
  const pendingRotationRef = useRef<Record<string, number>>({});
  const rotationFrameRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (rotationFrameRef.current !== null) window.cancelAnimationFrame(rotationFrameRef.current);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const nextData = await fetchBloggMindMapData();
      setData(nextData);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load the Blogg Mind Map.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handleRefresh = () => void refresh();
    window.addEventListener("BLOGG_MINDMAP_REFRESH", handleRefresh);
    return () => window.removeEventListener("BLOGG_MINDMAP_REFRESH", handleRefresh);
  }, [refresh]);

  const graphData = useMemo(() => toGraphData(data), [data]);
  const math = useRadialGraphMath({ graphData, rotationOffsets, hoveredNode, focusedBloggId });

  // All nodes already have a stable position on one of the three data rings.
  // Selecting a footnote target only selects that Blog; it never promotes it to the centre.
  useEffect(() => {
    const selectNode = (event: Event) => {
      const custom = event as CustomEvent<{ nodeId?: string }>;
      const nodeId = String(custom.detail?.nodeId || "");
      if (!nodeId) return;
      const target = math.processedGraph.nodes.find(
        (node: any) => String(node.id || node.uniqueId) === nodeId,
      );
      if (!target) return;
      setSelectedNode(target);
      setHoveredNode(target);
      setActiveLayer(null);
    };
    window.addEventListener("MINDMAP_SELECT_NODE", selectNode as EventListener);
    return () => window.removeEventListener("MINDMAP_SELECT_NODE", selectNode as EventListener);
  }, [math.processedGraph.nodes]);

  const rotateLayerBy = useCallback((layer: string, delta: number) => {
    if ((layer !== "stacks" && layer !== "groups" && layer !== "blogs") || !Number.isFinite(delta) || delta === 0) {
      return;
    }

    pendingRotationRef.current[layer] = (pendingRotationRef.current[layer] || 0) + delta;
    if (rotationFrameRef.current !== null) return;

    rotationFrameRef.current = window.requestAnimationFrame(() => {
      rotationFrameRef.current = null;
      const pending = pendingRotationRef.current;
      pendingRotationRef.current = {};
      setRotationOffsets((previous) => {
        const next = { ...previous };
        for (const [key, amount] of Object.entries(pending)) {
          next[key] = (next[key] || 0) + amount;
        }
        return next;
      });
    });
  }, []);

  const handleWheel = useCallback((event: WheelEvent) => {
    // Interaction mode is exclusive: when a ring is selected, wheel input
    // rotates that ring; the canvas owns wheel zoom only with no ring selected.
    if (!activeLayer) return;
    event.preventDefault();
    event.stopPropagation();
    rotateLayerBy(activeLayer, event.deltaY * -0.008);
  }, [activeLayer, rotateLayerBy]);

  return {
    data,
    loading,
    error,
    refresh,
    selectedNode,
    setSelectedNode,
    hoveredNode,
    setHoveredNode,
    activeLayer,
    setActiveLayer,
    handleWheel,
    rotateLayerBy,
    ...math,
  };
}
