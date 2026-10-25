import express from "express";
import cors from "cors";
import multer from "multer";
import { ObjectId } from "mongodb";
import logger from "../logs/logger.ts";
import { middleware } from "../middleware/middleWare.ts";
import { mongoConnectDB, getDB } from "../db/mongoDBConnect.ts";
import { warmupPgPool } from "../db/postgres.ts";
import { initializePostgresSchema } from "../db/postgresSchema.ts";
import blogInterceptRouter from "../routes/bloggDocument/bloggDocumentIndex.ts";
import canvasViewInterceptor from "../routes/canvasView/canvasViewIndex.ts";
import flipBookInterceptor from "../routes/flipBook/flipBookIndex.ts";
import authenticationRouter from "../routes/authentication/authenticationIndex.ts";
import accountSharePreviewRouter from "../routes/accountSharePreview.ts";
import feedSharePreviewRouter from "../routes/feedSharePreview.ts";
import sharePreviewRouter from "../routes/sharePreview.ts";
import bloggShareSnapshotRouter from "../routes/bloggShareSnapshot.ts";
import cookieParser from "cookie-parser";
import { errorHandler } from "../middleware/errorHandler.ts";
import adminStatusRouter from "../routes/adminStatus.ts";
import adminShowcaseRouter from "../routes/adminShowcase.ts";
import youtubeMusicApiRouter from "../routes/youtubeMusicApi.ts";
import showcaseWidgetVisibilityRouter from "../routes/showcaseWidgetVisibility.ts";
import linkPreviewRouter from "../routes/linkPreview.ts";
import healthRouter from "../routes/health.ts";
import healthSleepRouter from "../routes/healthSleep.ts";
import healthExerciseAggregateRouter from "../routes/healthExerciseAggregate.ts";
import currentReadingSearchPaginationRouter from "../routes/currentReadingSearchPagination.ts";
import currentReadingRouter from "../routes/currentReading.ts";
import clientUiLogsRouter from "../routes/clientUiLogs.ts";
import newsletterRouter from "../routes/newsletter.ts";
import cloudinary from "../cloudinary/cloudinary.ts";
import { authenticationMiddleware, isConfiguredAdminRequest, optionalAuthenticationMiddleware } from "../middleware/authenticationMiddleware.ts";
import { adminMiddleware } from "../middleware/adminMiddleware.ts";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const allowedBackgroundMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);
const feedBackgroundUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => allowedBackgroundMimeTypes.has(file.mimetype)
    ? callback(null, true)
    : callback(new Error("Unsupported image. Use PNG, JPEG, WebP, AVIF, or GIF.")),
});

app.use(cors({ origin: process.env.FRONTEND_URL ?? "http://localhost:5173", credentials: true }));
app.use(express.json({ limit: "5mb" }));
app.use(middleware);
await mongoConnectDB();
await warmupPgPool();
await initializePostgresSchema();
app.use(cookieParser());
// Register fixed preview paths before dynamic note IDs; "feed" and "account" are share pages, not blogg IDs.
app.use(accountSharePreviewRouter);
app.use(feedSharePreviewRouter);
app.use(sharePreviewRouter);
app.use(bloggShareSnapshotRouter);
app.use("/api/auth", authenticationRouter);
app.use("/api/admin", adminStatusRouter);

// A cached rich-link preview can outlive a note being changed from Public to Private.
// Re-check visibility before the cache is consulted.
app.post("/api/link-preview", optionalAuthenticationMiddleware, async (req, res, next) => {
  try {
    const rawUrl = typeof req.body?.url === "string" ? req.body.url : "";
    let url: URL;
    try { url = new URL(rawUrl); } catch { return next(); }
    const configuredHost = (() => {
      try { return new URL(process.env.FRONTEND_URL || "https://noteonstuff.vercel.app").hostname.toLowerCase(); }
      catch { return "noteonstuff.vercel.app"; }
    })();
    if (!["noteonstuff.vercel.app", configuredHost].includes(url.hostname.toLowerCase()) || !url.pathname.startsWith("/share/")) return next();
    const noteId = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) || "");
    if (!noteId) return next();
    const objectId = /^[a-f\d]{24}$/i.test(noteId) ? new ObjectId(noteId) : null;
    const filter = objectId ? { $or: [{ blogg_id: noteId }, { _id: objectId }] } : { blogg_id: noteId };
    const note = await getDB().collection("bloggs").findOne(filter);
    if (note?.isPublic === false && !isConfiguredAdminRequest(req)) {
      res.setHeader("Cache-Control", "private, no-store");
      return res.json({ preview: { url: url.toString(), title: "Private note on Blogg", description: "This note is private.", image: "", provider: "Blogg" } });
    }
    return next();
  } catch (error) { return next(error); }
});

app.use("/api", linkPreviewRouter);
app.use("/api", clientUiLogsRouter);
app.use("/api", youtubeMusicApiRouter);
app.use("/api", showcaseWidgetVisibilityRouter);
app.use("/api", healthRouter);
app.use("/api", healthSleepRouter);
app.use("/api", healthExerciseAggregateRouter);
app.use("/api", newsletterRouter);
app.use("/api", currentReadingSearchPaginationRouter);
app.use("/api", currentReadingRouter);
app.use("/api", adminShowcaseRouter);

// Publicly readable current Feed wallpaper. Only one URL is stored, so visitors
// never receive a list or gallery of old backgrounds.
app.get("/api/showcase/feed-background", async (_req, res, next) => {
  try {
    const setting = await getDB().collection("adminIntegrationSettings").findOne({ key: "feed-background" }, { projection: { url: 1, updatedAt: 1 } });
    res.setHeader("Cache-Control", "no-store");
    res.json({ url: typeof setting?.url === "string" ? setting.url : null, updatedAt: setting?.updatedAt ?? null });
  } catch (error) { next(error); }
});

// Admin uploads overwrite a single stable Cloudinary public ID. This replaces
// the existing background instead of accumulating each uploaded file.
app.post("/api/admin/showcase/feed-background", authenticationMiddleware, adminMiddleware, feedBackgroundUpload.single("file"), async (req, res, next) => {
  try {
    const file = req.file;
    if (!file?.buffer?.length) return res.status(400).json({ message: "Choose an image file first." });
    const uploaded = await new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({
        folder: "blogg",
        public_id: "feed-background",
        resource_type: "image",
        overwrite: true,
        invalidate: true,
      }, (error, result) => {
        if (error) { reject(error); return; }
        if (!result?.secure_url || !result.public_id) { reject(new Error("Image service returned no URL.")); return; }
        resolve({ secure_url: result.secure_url, public_id: result.public_id });
      });
      stream.end(file.buffer);
    });
    const updatedAt = new Date();
    await getDB().collection("adminIntegrationSettings").updateOne(
      { key: "feed-background" },
      { $set: { key: "feed-background", url: uploaded.secure_url, publicId: uploaded.public_id, updatedAt } },
      { upsert: true },
    );
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, url: uploaded.secure_url, updatedAt });
  } catch (error) { next(error); }
});

app.use(canvasViewInterceptor);
app.use(blogInterceptRouter);
app.use(flipBookInterceptor);
app.use(errorHandler);
app.listen(port, "0.0.0.0", () => { logger.info({ event: "SERVER_RUNNING", port }); });
