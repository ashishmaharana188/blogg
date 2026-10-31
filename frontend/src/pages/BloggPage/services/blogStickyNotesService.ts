import { API_BASE_URL } from "../../../services/apiBase";

export type StickyNoteVariant = "pink" | "yellow" | "sky" | "emerald";

export type BlogStickyNote = {
  id: string;
  text: string;
  variant: StickyNoteVariant;
  x: number;
  y: number;
  zIndex: number;
};

const endpoint = `${API_BASE_URL}/api/admin/blog-sticky-notes`;

async function readResponse(response: Response): Promise<any> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.message === "string"
      ? payload.message
      : `Sticky notes request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload;
}

export async function loadBlogStickyNotes(
  bloggId: string | null,
  draftKey: string,
): Promise<BlogStickyNote[]> {
  const params = new URLSearchParams();
  if (bloggId) params.set("blogg_id", bloggId);
  params.set("draft_key", draftKey);
  const response = await fetch(`${endpoint}?${params.toString()}`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const payload = await readResponse(response);
  return Array.isArray(payload?.notes) ? payload.notes : [];
}

export async function saveBlogStickyNotes(
  bloggId: string | null,
  draftKey: string,
  notes: BlogStickyNote[],
): Promise<void> {
  const response = await fetch(endpoint, {
    method: "PUT",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ blogg_id: bloggId, draft_key: draftKey, notes }),
  });
  await readResponse(response);
}
