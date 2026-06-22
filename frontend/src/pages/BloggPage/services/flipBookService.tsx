export async function fetchAllBloggsRequest() {
  const response = await fetch("http://localhost:3000/bloggs");

  if (!response.ok) {
    throw new Error("Could not fetch bloggs");
  }

  const result = await response.json();

  return result.bloggs ?? [];
}
