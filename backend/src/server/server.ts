import express from "express";
import cors from "cors";
import logger from "../logs/logger.ts";
import { trace } from "../middleware/trace.ts";
import { middleware } from "../middleware/middleWare.ts";
import { mongoConnectDB } from "../db/mongoDBConnect.ts";
import blogInterceptRouter from "../routes/bloggDocument/bloggDocumentUtil.ts";

const app = express();

app.use(cors());

app.use(express.json());

app.use(middleware);

await mongoConnectDB();

app.use(blogInterceptRouter);

app.listen(3000, () => {
  logger.info("Server running on port 3000");
});
