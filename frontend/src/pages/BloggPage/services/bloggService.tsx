import { BlogSavetypes } from "../../../types/pageTypes";

export async function saveBlog(
  blog: BlogSavetypes,
  stack_id?: string | null,
  group_id?: string | null,
  blogg_id?: string | null,
) {
  const response = await fetch("http://localhost:3000/blogSaveRequest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...blog,
      blogg_id,
      stack_id,
      group_id,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed: ${response.status}`);
  }

  return response.json();
}
export async function uploadFile(file: File) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("http://localhost:3000/blogMediaUpload", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Media upload failed");
  }

  const data = await response.json();
  return data.media.url;
}
