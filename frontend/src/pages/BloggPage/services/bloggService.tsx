import type { BlogSavetypes } from "../../../types/pageTypes";
import { API_BASE_URL } from "../../../services/apiBase";

export async function saveBlog(
  blog: BlogSavetypes,
  stack_id?: string | null,
  group_id?: string | null,
  blogg_id?: string | null,
) {
  const response = await fetch(`${API_BASE_URL}/blogSaveRequest`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...blog, isPublic: blog.isPublic !== false, blogg_id, stack_id, group_id }),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Sign in as the administrator before creating or editing notes.");
    }
    throw new Error(`Failed to save note (${response.status})`);
  }
  return response.json();
}

export async function uploadFile(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${API_BASE_URL}/blogMediaUpload`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Sign in as the administrator before uploading media.");
    }
    throw new Error("Media upload failed");
  }
  const data = await response.json();
  return data.media.url;
}
