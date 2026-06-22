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
  const response = await fetch(
    "http://localhost:3000/canvas/stack/stackRename",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

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
    `http://localhost:3000/canvas/group/groupRename`,
    {
      method: "POST",
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
    `http://localhost:3000/canvas/stack/stackDelete`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new Error("Could not delete stack");
  }
}

export async function deleteGroupRequest(payload: { group_id: string }) {
  const response = await fetch(
    "http://localhost:3000/canvas/group/groupDelete",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new Error("Could not delete group");
  }
}

export async function fetchBloggByGroupRequest(payload: { group_id: string }) {
  const response = await fetch(
    "http://localhost:3000/canvas/blogg/fetchBloggByGroup",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new Error("Could get bloggs");
  }

  const result = await response.json();

  console.log("SERVICE RESULT:", result);
  console.log("SERVICE BLOGGS:", result.bloggs);

  return result.bloggs ?? [];
}
