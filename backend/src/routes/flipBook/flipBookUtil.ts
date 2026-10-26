import { ObjectId } from "mongodb";
import { getDB } from "../../db/mongoDBConnect.ts";

/** Anonymous visitors get public notes only. Legacy records without isPublic remain public. */
export async function getAllBloggs(includePrivate = false, scope: { stackId?: string; groupId?: string } = {}) {
  const filter: Record<string, any> = includePrivate ? {} : { isPublic: { $ne: false } };
  if (scope.stackId) filter.stack_id = scope.stackId;
  if (scope.groupId) filter.group_id = scope.groupId;
  return getDB().collection("bloggs").find(filter).sort({ createdAt: -1, _id: -1 }).toArray();
}

type FeedCursor = { id: string; createdAtKind: "date" | "string" | "number" | "missing"; createdAtValue?: string | number };
function encodeFeedCursor(document: { _id: ObjectId; createdAt?: unknown }) {
  const createdAt = document.createdAt;
  const cursor: FeedCursor = { id: String(document._id), createdAtKind: createdAt instanceof Date ? "date" : typeof createdAt === "string" ? "string" : typeof createdAt === "number" ? "number" : "missing" };
  if (createdAt instanceof Date) cursor.createdAtValue = createdAt.toISOString();
  else if (typeof createdAt === "string" || typeof createdAt === "number") cursor.createdAtValue = createdAt;
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}
function decodeFeedCursor(value?: string): FeedCursor | null {
  if (!value) return null;
  if (value.length > 1024) throw new Error("Invalid feed cursor.");
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<FeedCursor>;
    if (typeof parsed.id !== "string" || !ObjectId.isValid(parsed.id) || !["date", "string", "number", "missing"].includes(String(parsed.createdAtKind))) throw new Error("Invalid cursor payload.");
    if ((parsed.createdAtKind === "date" || parsed.createdAtKind === "string") && typeof parsed.createdAtValue !== "string") throw new Error("Invalid cursor date.");
    if (parsed.createdAtKind === "number" && typeof parsed.createdAtValue !== "number") throw new Error("Invalid cursor number.");
    return parsed as FeedCursor;
  } catch { throw new Error("Invalid feed cursor."); }
}
function cursorCreatedAt(cursor: FeedCursor): Date | string | number | null {
  switch (cursor.createdAtKind) {
    case "date": return new Date(String(cursor.createdAtValue));
    case "string": return String(cursor.createdAtValue);
    case "number": return Number(cursor.createdAtValue);
    default: return null;
  }
}
/** Bounded, cursor-paginated feed returns only the fields used by Feed. */
export async function getBloggFeedPage(includePrivate = false, requestedLimit = 12, rawCursor?: string) {
  const limit = Math.max(1, Math.min(24, Math.floor(requestedLimit) || 12));
  const filter: Record<string, any> = includePrivate ? {} : { isPublic: { $ne: false } };
  // A bibliography tag hides a note from the feed for everyone, including admins.
  // It deliberately remains in getAllBloggs and the folder/reference endpoints.
  filter.tags = { $nin: [/^bibilography$/i, /^bibliography$/i] };
  const cursor = decodeFeedCursor(rawCursor);
  if (cursor) {
    const id = new ObjectId(cursor.id);
    if (cursor.createdAtKind === "missing") filter.$or = [ { createdAt: { $exists: false }, _id: { $lt: id } }, { createdAt: null, _id: { $lt: id } } ];
    else {
      const createdAt = cursorCreatedAt(cursor);
      filter.$or = [ { createdAt: { $lt: createdAt } }, { createdAt, _id: { $lt: id } } ];
    }
  }
  const records = await getDB().collection("bloggs").find(filter, { projection: {
    _id: 1, blogg_id: 1, stack_id: 1, group_id: 1, document_type: 1, author: 1, title: 1, subtitle: 1, tags: 1,
    content: 1, isPublic: 1, showCopyright: 1, copyrightHolder: 1, createdAt: 1, updatedAt: 1,
  } }).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).toArray();
  const hasMore = records.length > limit;
  const bloggs = hasMore ? records.slice(0, limit) : records;
  const last = bloggs[bloggs.length - 1] as { _id: ObjectId; createdAt?: unknown } | undefined;
  return { bloggs, hasMore, nextCursor: hasMore && last ? encodeFeedCursor(last) : null };
}
