import { API_BASE_URL } from "../../../services/apiBase";
import type { BloggItem } from "../../../types/pageTypes";

export type BloggFeedPage = {
  bloggs: BloggItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

export async function fetchBloggFeedPageRequest(
  cursor: string | null = null,
  limit = 12,
): Promise<BloggFeedPage> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`${API_BASE_URL}/bloggs/feed?${params.toString()}`, {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof result?.message === "string" ? `: ${result.message}` : "";
    throw new Error(`GET /bloggs/feed failed with HTTP ${response.status}${detail}`);
  }
  return {
    bloggs: Array.isArray(result?.bloggs) ? result.bloggs : [],
    nextCursor: typeof result?.nextCursor === "string" ? result.nextCursor : null,
    hasMore: result?.hasMore === true,
  };
}

export async function fetchAllBloggsRequest() {
  // Keep the flipbook API scoped to its selected folder. The server now applies
  // these filters before returning bodies instead of downloading every note.
  const pathname = window.location.pathname.replace(/\/$/, "");
  const params = new URLSearchParams();
  if (pathname === "/blog") {
    const search = new URLSearchParams(window.location.search);
    const stackId = search.get("stackId");
    const groupId = search.get("groupId");
    if (!stackId || !groupId) return [];
    params.set("stackId", stackId);
    params.set("groupId", groupId);
  }
  const suffix = params.size ? `?${params.toString()}` : "";
  const response = await fetch(`${API_BASE_URL}/bloggs${suffix}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = typeof body?.message === "string" ? body.message : "";
    } catch {
      // The backend may return an empty or non-JSON error response.
    }
    throw new Error(`GET /bloggs failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  const result = await response.json();
  return Array.isArray(result?.bloggs) ? result.bloggs : [];
}
