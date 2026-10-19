import { API_BASE_URL } from "../../../services/apiBase";

export async function createStack(payload: {
  stack_name: string;
  stack_id: string;
}) {
  const response = await fetch(`${API_BASE_URL}/stack/stackCreate`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Could not create stack (${response.status})`);
  const result = await response.json();
  return result.stack;
}

export async function createGroup(payload: {
  group_name: string;
  stack_id: string;
  group_id?: string;
}) {
  const response = await fetch(`${API_BASE_URL}/group/groupCreate`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Could not create folder (${response.status})`);
  const result = await response.json();
  return result.group ?? result.stack;
}

export async function fetchStackAndGroup() {
  // Automatic legacy-note repair is a data mutation, so only run it in the
  // administrator's browser session. Public Folder view remains read-only.
  try {
    const sessionResponse = await fetch(`${API_BASE_URL}/api/auth/me`, { credentials: "include" });
    if (sessionResponse.ok) {
      const session = await sessionResponse.json();
      if (session.isAdmin === true || session.user?.isAdmin === true) {
        const repairResponse = await fetch(
          `${API_BASE_URL}/canvas/folderView/repairUngroupedNotes`,
          { credentials: "include" },
        );
        if (!repairResponse.ok) {
          throw new Error(`Could not repair ungrouped notes (${repairResponse.status})`);
        }
      }
    }
  } catch (error) {
    // If session lookup fails, still allow public data viewing; do not attempt
    // the mutating repair without a confirmed administrator session.
    if (error instanceof Error && error.message.startsWith("Could not repair")) throw error;
  }

  const response = await fetch(`${API_BASE_URL}/stackAndGroup`);
  if (!response.ok) throw new Error(`Could not load Folder view (${response.status})`);
  return response.json();
}

export async function renameStackRequest(payload: {
  stack_id: string;
  stack_name: string;
}) {
  const response = await fetch(`${API_BASE_URL}/canvas/stack/stackRename`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Could not rename stack");
  return response.json();
}

export async function renameGroupRequest(payload: {
  group_id: string;
  group_name: string;
}) {
  const response = await fetch(`${API_BASE_URL}/canvas/group/groupRename`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Could not rename group");
  return response.json();
}

export async function deleteStackRequest(payload: { stack_id: string }) {
  const response = await fetch(`${API_BASE_URL}/canvas/stack/stackDelete`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Could not delete stack");
}

export async function deleteGroupRequest(payload: { group_id: string }) {
  const response = await fetch(`${API_BASE_URL}/canvas/group/groupDelete`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Could not delete folder");
}

export async function fetchBloggByGroupRequest(payload: { group_id: string }) {
  const response = await fetch(`${API_BASE_URL}/canvas/blogg/fetchBloggByGroup`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Could not get notes");
  const result = await response.json();
  return result.bloggs ?? [];
}

export async function fetchBloggByIdRequest(payload: { blogg_id: string }) {
  const response = await fetch(`${API_BASE_URL}/canvas/blogg/fetchBloggById`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Could not fetch note");
  const result = await response.json();
  return result.bloggs;
}
