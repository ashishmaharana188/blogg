// groupService.ts

export async function createStack(payload: {
  stack_name: string;
  stack_id: string;
}) {
  const response = await fetch("/stack/stackCreate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return response.json();
}

export async function createGroup(payload: {
  group_name: string;
  stack_id: string;
}) {
  const response = await fetch("/group/groupCreate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return response.json();
}
