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
  const bloggs = Array.isArray(result?.bloggs) ? result.bloggs : [];

  // Blog Profile's flipbook must never default to the full site-wide note list.
  // Its parent mounts this request only after a stack and group have both been
  // selected. Filtering here keeps the fetched book scoped to that selection.
  const pathname = window.location.pathname.replace(/\/$/, "");
  if (pathname === "/blog") {
    const params = new URLSearchParams(window.location.search);
    const stackId = params.get("stackId");
    const groupId = params.get("groupId");
    if (!stackId || !groupId) return [];

    return bloggs.filter((blogg: any) =>
      blogg?.group_id === groupId &&
      (blogg?.stack_id === stackId || !blogg?.stack_id),
    );
  }

  return bloggs;
}
