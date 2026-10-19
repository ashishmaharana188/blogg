import { API_BASE_URL } from "./apiBase";

export type AdminActivity = "Writing" | "Reading" | "Editing";
export type AdminPresence = { online: boolean; activity: string; lastSeen: string | null };

export async function fetchAdminPresence(): Promise<AdminPresence> {
  const response = await fetch(`${API_BASE_URL}/api/admin/status`, { credentials: "include" });
  if (!response.ok) throw new Error(`Could not fetch admin status (${response.status})`);
  const result = await response.json();
  return result.status as AdminPresence;
}

export async function updateAdminPresence(payload: { activity?: AdminActivity; online?: boolean } = {}) {
  const response = await fetch(`${API_BASE_URL}/api/admin/status`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Could not update admin status (${response.status})`);
  return response.json();
}

export const sendAdminHeartbeat = () => updateAdminPresence();
