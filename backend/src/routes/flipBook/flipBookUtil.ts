import { getDB } from "../../db/mongoDBConnect.ts";

/**
 * Anonymous visitors get public notes only. Records created before visibility
 * was added have no isPublic field, so they remain public for compatibility.
 */
export async function getAllBloggs(includePrivate = false) {
  const filter = includePrivate ? {} : { isPublic: { $ne: false } };
  return getDB()
    .collection("bloggs")
    .find(filter)
    .sort({ createdAt: -1 })
    .toArray();
}
