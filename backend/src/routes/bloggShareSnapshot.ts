import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../db/mongoDBConnect.ts";
import { authenticationMiddleware, isConfiguredAdminRequest, optionalAuthenticationMiddleware } from "../middleware/authenticationMiddleware.ts";
import { adminMiddleware } from "../middleware/adminMiddleware.ts";

const router = Router();
const SNAPSHOT_COLLECTION = "bloggShareSnapshots";
const MAX_PNG_BYTES = 3 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function noteLookupFilter(bloggId: string) {
  const objectId = /^[a-f\d]{24}$/i.test(bloggId) ? new ObjectId(bloggId) : null;
  return objectId ? { $or: [{ blogg_id: bloggId }, { _id: objectId }] } : { blogg_id: bloggId };
}

/**
 * Serve the previously captured PNG for one note. A private note's image is
 * never made available to anonymous visitors, even if a snapshot already exists.
 */
router.get("/share/blog/:bloggId/og-image.png", optionalAuthenticationMiddleware, async (req, res, next) => {
  try {
    const bloggId = String(req.params.bloggId || "").trim();
    if (!bloggId) return res.status(404).type("text").send("Snapshot not found.");

    const note = await getDB().collection("bloggs").findOne(noteLookupFilter(bloggId));
    if (!note || (note.isPublic === false && !isConfiguredAdminRequest(req))) {
      res.setHeader("Cache-Control", "private, no-store");
      return res.status(404).type("text").send("Snapshot not found.");
    }

    const canonicalId = String(note.blogg_id || note._id);
    const snapshot = await getDB().collection(SNAPSHOT_COLLECTION).findOne({ blogg_id: canonicalId });
    if (typeof snapshot?.pngBase64 !== "string" || !snapshot.pngBase64) {
      res.setHeader("Cache-Control", note.isPublic === false ? "private, no-store" : "public, max-age=0, s-maxage=60, must-revalidate");
      return res.status(404).type("text").send("Blog preview snapshot has not been captured yet.");
    }

    const image = Buffer.from(snapshot.pngBase64, "base64");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", String(image.length));
    res.setHeader("Cache-Control", note.isPublic === false ? "private, no-store" : "public, max-age=0, s-maxage=60, must-revalidate");
    if (snapshot.updatedAt) res.setHeader("Last-Modified", new Date(snapshot.updatedAt).toUTCString());
    return res.status(200).send(image);
  } catch (error) {
    return next(error);
  }
});

/** Admin-only upload. Each note gets one stable record; a new capture replaces it. */
router.put(
  "/api/admin/share/blog-snapshot/:bloggId",
  authenticationMiddleware,
  adminMiddleware,
  async (req, res, next) => {
    try {
      const bloggId = String(req.params.bloggId || "").trim();
      if (!bloggId) return res.status(400).json({ message: "A note ID is required." });

      const note = await getDB().collection("bloggs").findOne(noteLookupFilter(bloggId));
      if (!note) return res.status(404).json({ message: "Note not found." });
      const canonicalId = String(note.blogg_id || note._id);
      const pngBase64 = req.body?.pngBase64;
      if (typeof pngBase64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(pngBase64)) {
        return res.status(400).json({ message: "A valid base64 PNG snapshot is required." });
      }
      if (pngBase64.length > Math.ceil((MAX_PNG_BYTES * 4) / 3) + 8) {
        return res.status(413).json({ message: "The blog snapshot is too large. The maximum PNG size is 3 MB." });
      }

      const image = Buffer.from(pngBase64, "base64");
      if (image.length < 24 || image.length > MAX_PNG_BYTES || !image.subarray(0, 8).equals(PNG_SIGNATURE)) {
        return res.status(400).json({ message: "The snapshot must be a valid PNG smaller than 3 MB." });
      }
      const width = image.readUInt32BE(16);
      const height = image.readUInt32BE(20);
      if (width !== 1200 || height !== 630) {
        return res.status(400).json({ message: "The blog snapshot must be exactly 1200 × 630 pixels." });
      }

      const updatedAt = new Date();
      await getDB().collection(SNAPSHOT_COLLECTION).updateOne(
        { blogg_id: canonicalId },
        {
          $set: {
            blogg_id: canonicalId,
            pngBase64,
            contentType: "image/png",
            width,
            height,
            updatedAt,
          },
        },
        { upsert: true },
      );
      return res.status(200).json({ ok: true, blogg_id: canonicalId, updatedAt: updatedAt.getTime(), width, height });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
