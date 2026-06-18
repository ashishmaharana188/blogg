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
