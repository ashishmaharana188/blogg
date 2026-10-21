import express from "express";
import cors from "cors";
import logger from "../logs/logger.ts";
import { middleware } from "../middleware/middleWare.ts";
import { mongoConnectDB } from "../db/mongoDBConnect.ts";
import { warmupPgPool } from "../db/postgres.ts";
import { initializePostgresSchema } from "../db/postgresSchema.ts";
import blogInterceptRouter from "../routes/bloggDocument/bloggDocumentIndex.ts";
import canvasViewInterceptor from "../routes/canvasView/canvasViewIndex.ts";
import flipBookInterceptor from "../routes/flipBook/flipBookIndex.ts";
import authenticationRouter from "../routes/authentication/authenticationIndex.ts";
import accountSharePreviewRouter from "../routes/accountSharePreview.ts";
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
import currentReadingSearchPaginationRouter from "../routes/currentReadingSearchPagination.ts";
import currentReadingRouter from "../routes/currentReading.ts";
import clientUiLogsRouter from "../routes/clientUiLogs.ts";

const app = express();
const port = Number(process.env.PORT ?? 3000);
app.use(cors({ origin: process.env.FRONTEND_URL ?? "http://localhost:5173", credentials: true }));
app.use(express.json({ limit: "5mb" }));
app.use(middleware);
await mongoConnectDB();
await warmupPgPool();
await initializePostgresSchema();
app.use(cookieParser());
// Register the fixed route before /share/:bloggId so "account" is not treated as a note ID.
app.use(accountSharePreviewRouter);
app.use(sharePreviewRouter);
app.use("/api/auth", authenticationRouter);
app.use("/api/admin", adminStatusRouter);
app.use("/api", linkPreviewRouter);
// The diagnostics route stores technical client failures in backend logs; details never enter the UI.
app.use("/api", clientUiLogsRouter);
// Mount OAuth-backed routes before the general showcase routes.
app.use("/api", youtubeMusicApiRouter);
// Individual public-profile widget visibility controls.
app.use("/api", showcaseWidgetVisibilityRouter);
app.use("/api", healthRouter);
app.use("/api", healthSleepRouter);
// Register the paginated search first; it handles the matching GET before the legacy search route.
app.use("/api", currentReadingSearchPaginationRouter);
app.use("/api", currentReadingRouter);
app.use("/api", adminShowcaseRouter);
app.use(canvasViewInterceptor);
app.use(blogInterceptRouter);
app.use(flipBookInterceptor);
app.use(errorHandler);
app.listen(port, "0.0.0.0", () => { logger.info({ event: "SERVER_RUNNING", port }); });
