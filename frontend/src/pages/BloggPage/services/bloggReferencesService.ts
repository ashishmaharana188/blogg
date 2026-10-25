import { API_BASE_URL } from "../../../services/apiBase";

export type BloggReference = {
  reference_id: string;
  target_blogg_id: string;
  target_title: string;
  target_excerpt: string;
  /** Exact text selected in the current Blogg body and converted into an inline link. */
  source_excerpt?: string;
};

export type MindMapStack = { stack_id: string; stack_name: string };
export type MindMapGroup = {
  group_id: string;
  group_name: string;
  stack_id: string;
};
export type MindMapBlogg = {
  blogg_id: string;
  title: string;
  subtitle?: string;
  author?: string;
  stack_id: string;
  group_id: string;
  isPublic?: boolean;
  references: BloggReference[];
};
export type BloggMindMapData = {
  stacks: MindMapStack[];
  groups: MindMapGroup[];
  bloggs: MindMapBlogg[];
};

async function readJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof payload?.message === "string"
        ? payload.message
        : `${fallbackMessage} (${response.status})`,
    );
  }
  return payload as T;
}

export async function fetchBloggMindMapData(): Promise<BloggMindMapData> {
  const response = await fetch(`${API_BASE_URL}/canvas/blogg/mindMapData`, {
    credentials: "include",
  });
  const payload = await readJson<Partial<BloggMindMapData>>(
    response,
    "Could not load the Mind Map",
  );
  return {
    stacks: Array.isArray(payload.stacks) ? payload.stacks : [],
    groups: Array.isArray(payload.groups) ? payload.groups : [],
    bloggs: Array.isArray(payload.bloggs)
      ? payload.bloggs.map((blogg) => ({
          ...blogg,
          references: Array.isArray(blogg.references) ? blogg.references : [],
        }))
      : [],
  };
}

export async function fetchBloggReferences(bloggId: string): Promise<BloggReference[]> {
  const response = await fetch(
    `${API_BASE_URL}/canvas/blogg/references/${encodeURIComponent(bloggId)}`,
    { credentials: "include" },
  );
  const payload = await readJson<{ references?: BloggReference[] }>(
    response,
    "Could not load blog references",
  );
  return Array.isArray(payload.references) ? payload.references : [];
}

export async function saveBloggReferences(
  bloggId: string,
  references: BloggReference[],
): Promise<BloggReference[]> {
  const response = await fetch(`${API_BASE_URL}/canvas/blogg/references/save`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blogg_id: bloggId, references }),
  });
  const payload = await readJson<{ references?: BloggReference[] }>(
    response,
    "Could not save blog references",
  );
  return Array.isArray(payload.references) ? payload.references : [];
}
