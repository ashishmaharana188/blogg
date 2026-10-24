import { API_BASE_URL } from "../../../services/apiBase";

export async function fetchAllBloggsRequest() {
  // The server uses the administrator's session cookie to decide whether the
  // response may include private notes. Without credentials, admins would see
  // only the public subset in Feed and Flipbook.
  const response = await fetch(`${API_BASE_URL}/bloggs`, {
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
  return result.bloggs ?? [];
}
