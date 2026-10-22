import { getDB } from "../../db/mongoDBConnect.ts";

/** Delete one note/document by its public application identifier. */
export async function deleteBloggById(payload: { blogg_id: string }) {
  const bloggId = payload.blogg_id.trim();
  if (!bloggId) throw new Error("A note ID is required.");

  return getDB().collection("bloggs").deleteOne({ blogg_id: bloggId });
}
