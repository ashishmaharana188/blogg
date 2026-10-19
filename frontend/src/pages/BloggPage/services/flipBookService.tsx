import { API_BASE_URL } from "../../../services/apiBase";

export async function fetchAllBloggsRequest() {
  const response = await fetch(`${API_BASE_URL}/bloggs`);
  if (!response.ok) throw new Error("Could not fetch notes");
  const result = await response.json();
  return result.bloggs ?? [];
}
