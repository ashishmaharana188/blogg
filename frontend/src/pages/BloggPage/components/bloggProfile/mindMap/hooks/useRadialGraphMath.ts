import { useMemo } from "react";

export const CENTER_X = 650;
export const CENTER_Y = 520;
// The centre is an empty geometric anchor. All domain data lives on these three rings.
export const ORBITS = { stacks: 155, groups: 295, blogs: 435 };

type GraphNode = Record<string, any>;

function point(angle: number, radius: number) {
  return {
    x: CENTER_X + Math.cos(angle) * radius,
    y: CENTER_Y + Math.sin(angle) * radius,
  };
}

function spreadOffset(index: number, count: number, spread: number) {
  if (count <= 1) return 0;
  return -spread / 2 + (spread * index) / (count - 1);
}

export default function useRadialGraphMath({
  graphData,
  rotationOffsets,
  hoveredNode,
}: {
  graphData: any;
  rotationOffsets: Record<string, number>;
  hoveredNode: any;
}) {
  const processedGraph = useMemo(() => {
    const rawNodes: GraphNode[] = Array.isArray(graphData?.nodes) ? graphData.nodes : [];
    const rawLinks: GraphNode[] = Array.isArray(graphData?.links) ? graphData.links : [];
    const stacks = rawNodes.filter((node) => node.nodeType === "stack" || node.group === "stacks");
    const folders = rawNodes.filter(
      (node) => node.nodeType === "group" || (node.group === "notes" && !node.groupId && !node.isSubnode),
    );
    const blogs = rawNodes.filter(
      (node) => node.nodeType === "blog" || (node.group === "notes" && Boolean(node.groupId)),
    );

    const stackMap = new Map<string, GraphNode>(stacks.map((node) => [String(node.id), node] as [string, GraphNode]));
    const folderMap = new Map<string, GraphNode>(folders.map((node) => [String(node.id), node] as [string, GraphNode]));
    const nodes: GraphNode[] = [];
    const links: GraphNode[] = [];
    const positionedNodes = new Map<string, GraphNode>();
    const register = (node: GraphNode) => {
      nodes.push(node);
      positionedNodes.set(String(node.id), node);
      return node;
    };

    // Layer 1: every Stack sits on the first ring. No Stack is promoted to the centre.
    const stackAngles = new Map<string, number>();
    const stackRotation = rotationOffsets.stacks || 0;
    stacks.forEach((stack, index) => {
      const angle = (index * Math.PI * 2) / Math.max(1, stacks.length) - Math.PI / 2 + stackRotation;
      stackAngles.set(String(stack.id), angle);
      const pos = point(angle, ORBITS.stacks);
      register({
        ...stack,
        id: String(stack.id),
        uniqueId: String(stack.id),
        label: stack.label || stack.title || "Untitled stack",
        x: pos.x,
        y: pos.y,
        radius: ORBITS.stacks,
        angle,
        rotation: 0,
        layer: "stacks",
        group: "stacks",
        nodeType: "stack",
        isSubnode: false,
      });
    });

    // Layer 2: folders are grouped angularly around their owning Stack.
    const foldersByStack = new Map<string, GraphNode[]>();
    folders.forEach((folder) => {
      const stackId = String(folder.stackId || "");
      const entries = foldersByStack.get(stackId);
      if (entries) entries.push(folder);
      else foldersByStack.set(stackId, [folder]);
    });
    const folderAngles = new Map<string, number>();
    const groupRotation = rotationOffsets.groups || 0;
    let unparentedFolderIndex = 0;
    for (const folder of folders) {
      const stackId = String(folder.stackId || "");
      const siblings = foldersByStack.get(stackId) || [folder];
      const siblingIndex = siblings.findIndex((item) => String(item.id) === String(folder.id));
      const parentAngle = stackAngles.get(stackId);
      const fallbackAngle = (unparentedFolderIndex++ * Math.PI * 2) / Math.max(1, folders.length) - Math.PI / 2;
      const spread = Math.min(Math.PI * 1.35, Math.max(0.32, 0.30 + (siblings.length - 1) * 0.2));
      const angle = (parentAngle ?? fallbackAngle) + spreadOffset(siblingIndex, siblings.length, spread) + groupRotation;
      folderAngles.set(String(folder.id), angle);
      const pos = point(angle, ORBITS.groups);
      const positioned = register({
        ...folder,
        id: String(folder.id),
        uniqueId: String(folder.id),
        label: folder.label || folder.title || "Untitled folder",
        stackId,
        stackTitle: stackMap.get(stackId)?.label || stackMap.get(stackId)?.title || "",
        x: pos.x,
        y: pos.y,
        radius: ORBITS.groups,
        angle,
        rotation: 0,
        layer: "groups",
        group: "notes",
        nodeType: "group",
        isSubnode: false,
        isGroupNode: true,
      });
      const parentStack = positionedNodes.get(stackId);
      if (parentStack) {
        links.push({
          id: `owns-stack-${folder.id}`,
          source: parentStack.id,
          target: positioned.id,
          type: "implicit",
          sourceNode: parentStack,
          targetNode: positioned,
          isSynthetic: true,
          weight: 1,
        });
      }
    }

    // Layer 3: every Blog sits on the outer ring, clustered around its owning folder.
    const blogsByFolder = new Map<string, GraphNode[]>();
    blogs.forEach((blog) => {
      const folderId = String(blog.groupId || "");
      const entries = blogsByFolder.get(folderId);
      if (entries) entries.push(blog);
      else blogsByFolder.set(folderId, [blog]);
    });
    const blogRotation = rotationOffsets.blogs || 0;
    let unparentedBlogIndex = 0;
    for (const blog of blogs) {
      const folderId = String(blog.groupId || "");
      const siblings = blogsByFolder.get(folderId) || [blog];
      const siblingIndex = siblings.findIndex((item) => String(item.id) === String(blog.id));
      const parentAngle = folderAngles.get(folderId);
      const fallbackAngle = (unparentedBlogIndex++ * Math.PI * 2) / Math.max(1, blogs.length) - Math.PI / 2;
      const spread = Math.min(1.3, Math.max(0.24, 0.22 + (siblings.length - 1) * 0.075));
      const angle = (parentAngle ?? fallbackAngle) + spreadOffset(siblingIndex, siblings.length, spread) + blogRotation;
      const pos = point(angle, ORBITS.blogs);
      const parentFolder = folderMap.get(folderId);
      const stackId = String(parentFolder?.stackId || blog.stackId || "");
      const positioned = register({
        ...blog,
        id: String(blog.id),
        uniqueId: String(blog.id),
        label: blog.label || blog.title || "Untitled blog",
        stackId,
        stackTitle: stackMap.get(stackId)?.label || stackMap.get(stackId)?.title || "",
        groupTitle: parentFolder?.label || parentFolder?.title || "",
        x: pos.x,
        y: pos.y,
        radius: ORBITS.blogs,
        angle,
        rotation: 0,
        layer: "blogs",
        group: "notes",
        nodeType: "blog",
        isSubnode: true,
        isExternalReferenceTarget: false,
        groupId: folderId,
      });
      const parent = positionedNodes.get(folderId);
      if (parent) {
        links.push({
          id: `owns-folder-${blog.id}`,
          source: parent.id,
          target: positioned.id,
          type: "implicit",
          sourceNode: parent,
          targetNode: positioned,
          isSynthetic: true,
          weight: 1,
        });
      }
    }

    // Manual reference edges connect Blog nodes directly, including across any Stack/Folder.
    for (const raw of rawLinks) {
      const sourceId = String(raw.source || raw.source_id || "");
      const targetId = String(raw.target || raw.target_id || "");
      const sourceNode = positionedNodes.get(sourceId);
      const targetNode = positionedNodes.get(targetId);
      if (!sourceNode || !targetNode || sourceId === targetId) continue;
      links.push({
        ...raw,
        id: raw.id || `reference-${sourceId}-${targetId}`,
        source: sourceId,
        target: targetId,
        sourceNode,
        targetNode,
        isSynthetic: false,
      });
    }

    return { nodes, links };
  }, [graphData, rotationOffsets]);

  const { connectedNodes, connectedLinks } = useMemo(() => {
    if (!hoveredNode || !processedGraph.links) {
      return { connectedNodes: new Set<string>(), connectedLinks: new Set<GraphNode>() };
    }
    const startId = String(hoveredNode.uniqueId || hoveredNode.id);
    const nodeIds = new Set<string>([startId]);
    const connected = new Set<GraphNode>();
    processedGraph.links.forEach((link: GraphNode) => {
      const source = String(link.sourceNode?.uniqueId || link.sourceNode?.id || link.source);
      const target = String(link.targetNode?.uniqueId || link.targetNode?.id || link.target);
      if (source === startId || target === startId) {
        connected.add(link);
        nodeIds.add(source);
        nodeIds.add(target);
      }
    });
    return { connectedNodes: nodeIds, connectedLinks: connected };
  }, [hoveredNode, processedGraph.links]);

  return { processedGraph, connectedNodes, connectedLinks, CENTER_X, CENTER_Y, ORBITS };
}
