export async function createStack(payload: {
  stack_name: string;
  stack_id: string;
}) {
  const response = await fetch("http://localhost:3000/stack/stackCreate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  console.log(response.status);

  const text = await response.text();
  console.log("response body:", text);

  const result = JSON.parse(text);
  return result.stack;
}

export async function createGroup(payload: {
  group_name: string;
  stack_id: string;
}) {
  const response = await fetch("http://localhost:3000/group/groupCreate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  console.log(response.status);

  const text = await response.text();
  console.log("response body:", text);

  const result = JSON.parse(text);
  return result.stack;
}

export async function fetchStackAndGroup() {
  const response = await fetch("http://localhost:3000/stackAndGroup");

  return response.json();
}

export async function renameStackRequest(payload: {
  stack_id: string;
  stack_name: string;
}) {
  const response = await fetch("http://localhost:3000/stack/stackRename", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Could not rename stack");
  }

  return response.json();
}

export async function renameGroupRequest(payload: {
  group_id: string;
  group_name: string;
}) {
  const response = await fetch(
    `http://localhost:3000/canvas/groups/groupRename`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new Error("Could not rename group");
  }

  return response.json();
}

export async function deleteStackRequest(payload: { stack_id: string }) {
  const response = await fetch(
    `http://localhost:3000/canvas/stacks/deleteStack`,
    {
      method: "DELETE",
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new Error("Could not delete stack");
  }
}

export async function deleteGroupRequest(payload: { stack_id: string }) {
  const response = await fetch(
    `http://localhost:3000/canvas/groups/deleteGroup`,
    {
      method: "DELETE",
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new Error("Could not delete group");
  }
}
