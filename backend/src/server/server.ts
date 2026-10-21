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
import sharePreviewRouter from "../routes/sharePreview.ts";
import cookieParser from "cookie-parser";
import { errorHandler } from "../middleware/errorHandler.ts";
import adminStatusRouter from "../routes/adminStatus.ts";
import adminShowcaseRouter from "../routes/adminShowcase.ts";
import youtubeMusicApiRouter from "../routes/youtubeMusicApi.ts";
import linkPreviewRouter from "../routes/linkPreview.ts";

const app = express();
const port = Number(process.env.PORT ?? 3000);

// YouTube Music now uses the existing YouTube Data API OAuth token. Clear legacy
// companion settings so older integration-status helpers cannot call the retired
// Python service while still serving unrelated YouTube Library routes.
process.env.YTMUSIC_SERVICE_URL = "";
process.env.YTMUSIC_SERVICE_TOKEN = "";

app.use(
  cors({
    origin: process.env.FRONTEND_URL ?? "http://localhost:5173",
    credentials: true,
  }),
);
app.use(express.json());
app.use(middleware);

await mongoConnectDB();
await warmupPgPool();
await initializePostgresSchema();

app.use(cookieParser());
app.use(sharePreviewRouter);
app.use("/api/auth", authenticationRouter);
app.use("/api/admin", adminStatusRouter);
app.use("/api", linkPreviewRouter);
// Mount replacement routes before the legacy showcase router so the Python
// YouTube Music companion is no longer used by any active YT Music endpoint.
app.use("/api", youtubeMusicApiRouter);
app.use("/api", adminShowcaseRouter);
app.use(canvasViewInterceptor);
app.use(blogInterceptRouter);
app.use(flipBookInterceptor);
app.use(errorHandler);

app.listen(port, "0.0.0.0", () => {
  logger.info({ event: "SERVER_RUNNING", port });
});
