import { API_BASE_URL } from "../../../services/apiBase";

export async function fetchAllBloggsRequest() {
  const response = await fetch(`${API_BASE_URL}/bloggs`);
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
  return result.bloggs ?? [];
}
