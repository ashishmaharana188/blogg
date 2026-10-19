import { Router } from "express";
import { getDB } from "../db/mongoDBConnect.ts";
import { authenticationMiddleware } from "../middleware/authenticationMiddleware.ts";
import { adminMiddleware } from "../middleware/adminMiddleware.ts";

const router = Router();
const STATUS_KEY = "site-admin";
const ONLINE_WINDOW_MS = 90_000;
const ALLOWED_ACTIVITIES = new Set(["Writing", "Reading", "Editing"]);

router.get("/status", async (_req, res, next) => {
  try {
    const record = await getDB().collection("adminPresence").findOne({ key: STATUS_KEY });
    const lastSeen = record?.lastSeen ? new Date(record.lastSeen as Date) : null;
    const online = record?.forceOffline !== true && !!lastSeen && Date.now() - lastSeen.getTime() < ONLINE_WINDOW_MS;
    res.json({
      success: true,
      status: {
        online,
        activity: online && typeof record?.activity === "string" ? record.activity : "Offline",
        lastSeen: lastSeen?.toISOString() ?? null,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/status", authenticationMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const collection = getDB().collection("adminPresence");
    if (req.body?.online === false) {
      await collection.updateOne(
        { key: STATUS_KEY },
        { $set: { forceOffline: true, lastSeen: new Date() }, $setOnInsert: { activity: "Reading" } },
        { upsert: true },
      );
    } else {
      const requestedActivity = req.body?.activity;
      if (requestedActivity !== undefined && !ALLOWED_ACTIVITIES.has(requestedActivity)) {
        res.status(400).json({ success: false, message: "Activity must be Writing, Reading, or Editing." });
        return;
      }
      if (requestedActivity) {
        await collection.updateOne(
          { key: STATUS_KEY },
          { $set: { lastSeen: new Date(), forceOffline: false, activity: requestedActivity } },
          { upsert: true },
        );
      } else {
        await collection.updateOne(
          { key: STATUS_KEY },
          { $set: { lastSeen: new Date(), forceOffline: false }, $setOnInsert: { activity: "Reading" } },
          { upsert: true },
        );
      }
    }
    res.json({ success: true, message: "Administrator status updated." });
  } catch (error) {
    next(error);
  }
});

export default router;
