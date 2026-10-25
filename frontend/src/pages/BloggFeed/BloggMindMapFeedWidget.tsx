import { useEffect, useMemo, useState } from "react";
import {
  fetchBloggMindMapData,
  type BloggMindMapData,
  type MindMapBlogg,
  type MindMapGroup,
  type MindMapStack,
} from "../BloggPage/services/bloggReferencesService";
import "./bloggMindMapFeedWidget.css";

type Point = { x: number; y: number };
type MiniNode = Point & {
  id: string;
  label: string;
  layer: "stacks" | "groups" | "blogs";
};
type MiniEdge = { id: string; from: Point; to: Point; reference?: boolean };

const SVG_WIDTH = 232;
const SVG_HEIGHT = 140;
const CENTER = { x: SVG_WIDTH / 2, y: 72 };
const RADII = { stacks: 18, groups: 37, blogs: 56 };

function point(angle: number, radius: number): Point {
  return {
    x: CENTER.x + Math.cos(angle) * radius,
    y: CENTER.y + Math.sin(angle) * radius,
  };
}

function spread(index: number, count: number, maximum: number): number {
  if (count <= 1) return 0;
  const range = Math.min(maximum, 0.28 + (count - 1) * 0.09);
  return -range / 2 + (range * index) / (count - 1);
}

function buildMiniGraph(data: BloggMindMapData | null) {
  const empty = { nodes: [] as MiniNode[], edges: [] as MiniEdge[] };
  if (!data) return empty;

  // This is intentionally a lightweight preview, not a second full-size map.
  // Capping visible dots keeps dense collections legible in a narrow side rail.
  const candidateBlogs: MindMapBlogg[] = data.bloggs
    .filter((blog) => blog.isPublic !== false)
    .slice(-32);
  const candidateGroupIds = new Set(
    candidateBlogs.map((blog) => blog.group_id),
  );
  const groups: MindMapGroup[] = data.groups
    .filter((group) => candidateGroupIds.has(group.group_id))
    .slice(0, 18);
  const visibleGroupIds = new Set(groups.map((group) => group.group_id));
  const blogs: MindMapBlogg[] = candidateBlogs.filter((blog) =>
    visibleGroupIds.has(blog.group_id),
  );
  const visibleStackIds = new Set(groups.map((group) => group.stack_id));
  const stacks: MindMapStack[] = data.stacks
    .filter((stack) => visibleStackIds.has(stack.stack_id))
    .slice(0, 9);
  const nodes: MiniNode[] = [];
  const edges: MiniEdge[] = [];
  const stackAngles = new Map<string, number>();
  const groupAngles = new Map<string, number>();
  const positions = new Map<string, MiniNode>();

  stacks.forEach((stack, index) => {
    const angle =
      (index * Math.PI * 2) / Math.max(1, stacks.length) - Math.PI / 2;
    stackAngles.set(stack.stack_id, angle);
    const node: MiniNode = {
      ...point(angle, RADII.stacks),
      id: stack.stack_id,
      label: stack.stack_name || "Untitled stack",
      layer: "stacks",
    };
    nodes.push(node);
    positions.set(node.id, node);
  });

  const groupsByStack = new Map<string, MindMapGroup[]>();
  groups.forEach((group) => {
    const items = groupsByStack.get(group.stack_id) || [];
    items.push(group);
    groupsByStack.set(group.stack_id, items);
  });

  groups.forEach((group) => {
    const siblings = groupsByStack.get(group.stack_id) || [group];
    const index = siblings.findIndex(
      (item) => item.group_id === group.group_id,
    );
    const baseAngle =
      stackAngles.get(group.stack_id) ??
      (groups.indexOf(group) * Math.PI * 2) / Math.max(1, groups.length) -
        Math.PI / 2;
    const angle = baseAngle + spread(index, siblings.length, 2.35);
    groupAngles.set(group.group_id, angle);
    const node: MiniNode = {
      ...point(angle, RADII.groups),
      id: group.group_id,
      label: group.group_name || "Untitled folder",
      layer: "groups",
    };
    nodes.push(node);
    positions.set(node.id, node);
    const parent = positions.get(group.stack_id);
    if (parent)
      edges.push({ id: `stack-${group.group_id}`, from: parent, to: node });
  });

  const blogsByGroup = new Map<string, MindMapBlogg[]>();
  blogs.forEach((blog) => {
    const items = blogsByGroup.get(blog.group_id) || [];
    items.push(blog);
    blogsByGroup.set(blog.group_id, items);
  });

  blogs.forEach((blog) => {
    const siblings = blogsByGroup.get(blog.group_id) || [blog];
    const index = siblings.findIndex((item) => item.blogg_id === blog.blogg_id);
    const baseAngle =
      groupAngles.get(blog.group_id) ??
      (blogs.indexOf(blog) * Math.PI * 2) / Math.max(1, blogs.length) -
        Math.PI / 2;
    const angle = baseAngle + spread(index, siblings.length, 1.7);
    const node: MiniNode = {
      ...point(angle, RADII.blogs),
      id: blog.blogg_id,
      label: blog.title || "Untitled blog",
      layer: "blogs",
    };
    nodes.push(node);
    positions.set(node.id, node);
    const parent = positions.get(blog.group_id);
    if (parent)
      edges.push({ id: `group-${blog.blogg_id}`, from: parent, to: node });
  });

  let referenceCount = 0;
  for (const blog of blogs) {
    for (const reference of blog.references || []) {
      if (referenceCount >= 14) break;
      const from = positions.get(blog.blogg_id);
      const to = positions.get(reference.target_blogg_id);
      if (!from || !to || from.id === to.id) continue;
      edges.push({
        id: `reference-${reference.reference_id}`,
        from,
        to,
        reference: true,
      });
      referenceCount += 1;
    }
    if (referenceCount >= 14) break;
  }

  return { nodes, edges };
}

export default function BloggMindMapFeedWidget() {
  const [data, setData] = useState<BloggMindMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchBloggMindMapData()
      .then((nextData) => {
        if (!cancelled) setData(nextData);
      })
      .catch(() => {
        if (!cancelled) setHasError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The feed widget is always public-safe, even when the administrator is signed in.
  const publicData = useMemo(() => {
    if (!data) return null;
    const visibleBlogs = data.bloggs.filter((blog) => blog.isPublic !== false);
    const publicBlogIds = new Set(visibleBlogs.map((blog) => blog.blogg_id));
    const bloggs = visibleBlogs.map((blog) => ({
      ...blog,
      references: blog.references.filter((reference) =>
        publicBlogIds.has(reference.target_blogg_id),
      ),
    }));
    const publicGroupIds = new Set(
      bloggs.map((blog) => blog.group_id).filter(Boolean),
    );
    const groups = data.groups.filter((group) =>
      publicGroupIds.has(group.group_id),
    );
    const publicStackIds = new Set([
      ...bloggs.map((blog) => blog.stack_id).filter(Boolean),
      ...groups.map((group) => group.stack_id).filter(Boolean),
    ]);
    const stacks = data.stacks.filter((stack) =>
      publicStackIds.has(stack.stack_id),
    );
    return { stacks, groups, bloggs };
  }, [data]);
  const graph = useMemo(() => buildMiniGraph(publicData), [publicData]);
  const stackCount = publicData?.stacks.length ?? 0;
  const groupCount = publicData?.groups.length ?? 0;
  const blogCount = publicData?.bloggs.length ?? 0;
  const referenceCount =
    publicData?.bloggs.reduce(
      (total, blog) => total + blog.references.length,
      0,
    ) ?? 0;

  return (
    <section
      className="blog-feed-mindmap-card"
      aria-label="Blog Mind Map preview"
    >
      <header className="blog-feed-mindmap-heading">
        <div>
          <p className="blog-feed-mindmap-kicker">EXPLORE CONNECTIONS</p>
        </div>
      </header>

      <div className="blog-feed-mindmap-preview">
        {loading ? (
          <div className="blog-feed-mindmap-status" role="status">
            Building map…
          </div>
        ) : hasError ? (
          <div className="blog-feed-mindmap-status" role="status">
            Map preview unavailable
          </div>
        ) : blogCount === 0 && stackCount === 0 && groupCount === 0 ? (
          <div className="blog-feed-mindmap-status">
            Your map will appear here as the Blogg library grows.
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
            role="img"
            aria-label={`A compact map of ${stackCount} stacks, ${groupCount} folders, ${blogCount} blogs and ${referenceCount} references`}
          >
            <g className="blog-feed-mindmap-rings">
              <circle cx={CENTER.x} cy={CENTER.y} r={RADII.stacks} />
              <circle cx={CENTER.x} cy={CENTER.y} r={RADII.groups} />
              <circle cx={CENTER.x} cy={CENTER.y} r={RADII.blogs} />
            </g>
            {graph.edges.map((edge) => (
              <line
                key={edge.id}
                x1={edge.from.x}
                y1={edge.from.y}
                x2={edge.to.x}
                y2={edge.to.y}
                className={edge.reference ? "is-reference" : ""}
              />
            ))}
            <circle
              className="blog-feed-mindmap-center"
              cx={CENTER.x}
              cy={CENTER.y}
              r="3"
            />
            {graph.nodes.map((node) => (
              <circle
                key={`${node.layer}-${node.id}`}
                cx={node.x}
                cy={node.y}
                r={
                  node.layer === "stacks"
                    ? 3.2
                    : node.layer === "groups"
                      ? 2.7
                      : 2.2
                }
                className={`blog-feed-mindmap-node is-${node.layer}`}
              >
                <title>{node.label}</title>
              </circle>
            ))}
          </svg>
        )}
      </div>

      <div className="blog-feed-mindmap-stats" aria-label="Map totals">
        <span>
          <i className="is-stacks" />
          {loading || hasError ? "—" : stackCount} stacks
        </span>
        <span>
          <i className="is-groups" />
          {loading || hasError ? "—" : groupCount} folders
        </span>
        <span>
          <i className="is-blogs" />
          {loading || hasError ? "—" : blogCount} blogs
        </span>
      </div>

      <a className="blog-feed-mindmap-open" href="/blog?view=mindmap">
        Open full Mind Map <span aria-hidden="true">↗</span>
      </a>
    </section>
  );
}
