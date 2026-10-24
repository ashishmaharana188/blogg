import express from "express";
import cors from "cors";
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
import {
  isConfiguredAdminRequest,
  optionalAuthenticationMiddleware,
} from "../middleware/authenticationMiddleware.ts";

const app = express();
const port = Number(process.env.PORT ?? 3000);
app.use(cors({ origin: process.env.FRONTEND_URL ?? "http://localhost:5173", credentials: true }));
app.use(express.json({ limit: "5mb" }));
app.use(middleware);
await mongoConnectDB();
await warmupPgPool();
await initializePostgresSchema();
app.use(cookieParser());
// Register fixed preview paths before dynamic note IDs; "feed" and "account"
// are share pages, not blogg IDs.
app.use(accountSharePreviewRouter);
app.use(feedSharePreviewRouter);
app.use(sharePreviewRouter);
app.use("/api/auth", authenticationRouter);
app.use("/api/admin", adminStatusRouter);

// A cached rich-link preview can outlive a note being changed from Public to
// Private. Re-check note visibility before the cache is consulted; anonymous
// visitors receive generic metadata rather than the private title/body/image.
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
      return res.json({
        preview: {
          url: url.toString(),
          title: "Private note on Blogg",
          description: "This note is private.",
          image: "",
          provider: "Blogg",
        },
      });
    }
    return next();
  } catch (error) {
    return next(error);
  }
});

app.use("/api", linkPreviewRouter);
// The diagnostics route stores technical client failures in backend logs; details never enter the UI.
app.use("/api", clientUiLogsRouter);
// OAuth-backed routes are registered before the general showcase routes.
app.use("/api", youtubeMusicApiRouter);
app.use("/api", showcaseWidgetVisibilityRouter);
app.use("/api", healthRouter);
app.use("/api", healthSleepRouter);
app.use("/api", healthExerciseAggregateRouter);
app.use("/api", newsletterRouter);
// Register paginated search before the legacy route.
app.use("/api", currentReadingSearchPaginationRouter);
app.use("/api", currentReadingRouter);
app.use("/api", adminShowcaseRouter);
app.use(canvasViewInterceptor);
app.use(blogInterceptRouter);
app.use(flipBookInterceptor);
app.use(errorHandler);
app.listen(port, "0.0.0.0", () => { logger.info({ event: "SERVER_RUNNING", port }); });
