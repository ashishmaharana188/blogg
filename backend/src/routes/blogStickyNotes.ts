import { Router } from "express";
import { randomUUID } from "crypto";
import { getDB } from "../db/mongoDBConnect.ts";
import { authenticationMiddleware } from "../middleware/authenticationMiddleware.ts";
import { adminMiddleware } from "../middleware/adminMiddleware.ts";

const router = Router();
const COLLECTION = "blogStickyNotes";
const MAX_NOTES = 30;
const MAX_TEXT_LENGTH = 2000;
const RETENTION_DAYS = 30;
const ALLOWED_VARIANTS = new Set(["pink", "yellow", "sky", "emerald"]);

let ttlIndexPromise: Promise<string> | null = null;
async function ensureTtlIndex() {
  if (!ttlIndexPromise) {
    ttlIndexPromise = getDB().collection(COLLECTION).createIndex(
      { expires_at: 1 },
      { expireAfterSeconds: 0, name: "blog_sticky_notes_expiry" },
    );
  }
  await ttlIndexPromise;
}

function getOwnerId(req: any): string {
  return typeof req.user?.user_id === "string" ? req.user.user_id : "";
}

function getIdentityFilter(ownerId: string, bloggId: string, draftKey: string): any {
  const identity: Record<string, unknown>[] = [];
  if (bloggId) identity.push({ blogg_id: bloggId });
  if (draftKey) identity.push({ draft_key: draftKey });
  return identity.length === 1
    ? { owner_id: ownerId, ...identity[0] }
    : { owner_id: ownerId, $or: identity };
}

function cleanNotes(input: unknown) {
  if (!Array.isArray(input)) throw new Error("Sticky notes must be an array.");
  if (input.length > MAX_NOTES) throw new Error(`A blog can have at most ${MAX_NOTES} sticky notes.`);
  return input.map((raw: any, index: number) => {
    const text = typeof raw?.text === "string" ? raw.text.slice(0, MAX_TEXT_LENGTH) : "";
    const variant = ALLOWED_VARIANTS.has(raw?.variant) ? raw.variant : ["pink", "yellow", "sky", "emerald"][index % 4];
    const x = Number.isFinite(Number(raw?.x)) ? Math.min(0.98, Math.max(0.02, Number(raw.x))) : 0.75;
    const y = Number.isFinite(Number(raw?.y)) ? Math.min(0.98, Math.max(0.02, Number(raw.y))) : 0.2;
    const zIndex = Number.isFinite(Number(raw?.zIndex)) ? Math.min(1000, Math.max(1, Math.floor(Number(raw.zIndex)))) : index + 1;
    const id = typeof raw?.id === "string" && raw.id.trim() ? raw.id.trim().slice(0, 100) : randomUUID();
    return { id, text, variant, x, y, zIndex };
  });
}

router.get(
  "/admin/blog-sticky-notes",
  authenticationMiddleware,
  adminMiddleware,
  async (req, res, next) => {
    try {
      await ensureTtlIndex();
      const ownerId = getOwnerId(req);
      const bloggId = typeof req.query.blogg_id === "string" ? req.query.blogg_id.trim() : "";
      const draftKey = typeof req.query.draft_key === "string" ? req.query.draft_key.trim() : "";
      if (!bloggId && !draftKey) return res.status(400).json({ message: "A blog ID or draft key is required." });
      const collection = getDB().collection(COLLECTION);
      const filter = getIdentityFilter(ownerId, bloggId, draftKey);
      const record = await collection.findOne(filter, { projection: { notes: 1, blogg_id: 1, draft_key: 1 } });
      if (record && bloggId && record.blogg_id !== bloggId) {
        await collection.updateOne({ _id: record._id, owner_id: ownerId }, {
          $set: { blogg_id: bloggId, expires_at: new Date(Date.now() + RETENTION_DAYS * 86400000) },
        });
      }
      return res.setHeader("Cache-Control", "private, no-store").json({ success: true, notes: Array.isArray(record?.notes) ? record.notes : [] });
    } catch (error) { return next(error); }
  },
);

router.put(
  "/admin/blog-sticky-notes",
  authenticationMiddleware,
  adminMiddleware,
  async (req, res, next) => {
    try {
      await ensureTtlIndex();
      const ownerId = getOwnerId(req);
      const bloggId = typeof req.body?.blogg_id === "string" ? req.body.blogg_id.trim() : "";
      const draftKey = typeof req.body?.draft_key === "string" ? req.body.draft_key.trim() : "";
      if (!bloggId && !draftKey) return res.status(400).json({ message: "A blog ID or draft key is required." });
      const notes = cleanNotes(req.body?.notes);
      const now = new Date();
      const collection = getDB().collection(COLLECTION);
      const filter = getIdentityFilter(ownerId, bloggId, draftKey);
      await collection.updateOne(filter, {
        $set: {
          owner_id: ownerId,
          ...(bloggId ? { blogg_id: bloggId } : {}),
          ...(draftKey ? { draft_key: draftKey } : {}),
          notes,
          updated_at: now,
          expires_at: new Date(now.getTime() + RETENTION_DAYS * 86400000),
        },
        $setOnInsert: { created_at: now },
      }, { upsert: true });
      return res.setHeader("Cache-Control", "private, no-store").json({ success: true, message: "BLOG_STICKY_NOTES_SAVED", count: notes.length });
    } catch (error) { return next(error); }
  },
);

export default router;
