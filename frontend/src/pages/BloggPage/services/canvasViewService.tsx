export async function createStack(payload: {
  stack_name: string;
  stack_id: string;
}) {
  const response = await fetch("http://localhost:3000/stack/stackCreate", {
    method: "POST",
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
  const response = await fetch("http://localhost:3000/group/groupCreate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Could not create folder (${response.status})`);
  const result = await response.json();
  return result.group ?? result.stack;
}

export async function fetchStackAndGroup() {
  // Repair legacy notes first; otherwise notes without group_id are invisible
  // to the group-based Folder view query.
  const repairResponse = await fetch(
    "http://localhost:3000/canvas/folderView/repairUngroupedNotes",
  );
  if (!repairResponse.ok) {
    throw new Error(`Could not repair ungrouped notes (${repairResponse.status})`);
  }

  const response = await fetch("http://localhost:3000/stackAndGroup");
  if (!response.ok) throw new Error(`Could not load Folder view (${response.status})`);
  return response.json();
}

export async function renameStackRequest(payload: {
  stack_id: string;
  stack_name: string;
}) {
  const response = await fetch("http://localhost:3000/canvas/stack/stackRename", {
    method: "POST",
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
  const response = await fetch("http://localhost:3000/canvas/group/groupRename", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Could not rename group");
  return response.json();
}

export async function deleteStackRequest(payload: { stack_id: string }) {
  const response = await fetch("http://localhost:3000/canvas/stack/stackDelete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Could not delete stack");
}

export async function deleteGroupRequest(payload: { group_id: string }) {
  const response = await fetch("http://localhost:3000/canvas/group/groupDelete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Could not delete folder");
}

export async function fetchBloggByGroupRequest(payload: { group_id: string }) {
  const response = await fetch("http://localhost:3000/canvas/blogg/fetchBloggByGroup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Could not get notes");
  const result = await response.json();
  return result.bloggs ?? [];
}

export async function fetchBloggByIdRequest(payload: { blogg_id: string }) {
  const response = await fetch("http://localhost:3000/canvas/blogg/fetchBloggById", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Could not fetch note");
  const result = await response.json();
  return result.bloggs;
}
