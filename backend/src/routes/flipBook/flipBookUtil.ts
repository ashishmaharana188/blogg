import { getDB } from "../../db/mongoDBConnect.ts";

export async function getAllBloggs() {
  return getDB()
    .collection("bloggs")
    .find({})
    .sort({ createdAt: -1 })
    .toArray();
}
