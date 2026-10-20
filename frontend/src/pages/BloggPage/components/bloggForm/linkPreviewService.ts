import { API_BASE_URL } from "../../../../services/apiBase";

export type LinkPreviewMetadata = {
  url: string;
  title: string;
  description: string;
  image: string;
  provider: string;
};

export async function fetchLinkPreview(url: string): Promise<LinkPreviewMetadata> {
  const response = await fetch(`${API_BASE_URL}/api/link-preview`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  const payload = await response.json().catch(() => ({})) as {
    message?: string;
    preview?: LinkPreviewMetadata;
  };
  if (!response.ok || !payload.preview) {
    throw new Error(payload.message || `Could not create link preview (${response.status}).`);
  }
  return payload.preview;
}
