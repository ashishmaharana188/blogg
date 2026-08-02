import express from "express";
import cors from "cors";
import logger from "../logs/logger.ts";
import { trace } from "../middleware/trace.ts";
import { middleware } from "../middleware/middleWare.ts";
import { mongoConnectDB } from "../db/mongoDBConnect.ts";
import { warmupPgPool } from "../db/postgres.ts";
import { initializePostgresSchema } from "../db/postgresSchema.ts";
import blogInterceptRouter from "../routes/bloggDocument/bloggDocumentIndex.ts";
import canvasViewInterceptor from "../routes/canvasView/canvasViewIndex.ts";
import flipBookInterceptor from "../routes/flipBook/flipBookIndex.ts";
import authenticationRouter from "../routes/authentication/authenticationIndex.ts";
import cookieParser from "cookie-parser";

import { errorHandler } from "../middleware/errorHandler.ts";

const app = express();

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

app.use("/api/auth", authenticationRouter);

app.use(canvasViewInterceptor);
app.use(blogInterceptRouter);
app.use(flipBookInterceptor);
app.use(errorHandler);

app.listen(3000, () => {
  logger.info("Server running on port 3000");
});
