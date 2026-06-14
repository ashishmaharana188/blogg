import express from "express";
import cors from "cors";
import { middleware } from "../middleware/configMiddleWare.ts";
import { mongoConnectDB } from "../db/mongodbConnect.ts";
import logger from "../logs/logger.ts";
import blogInterceptRouter from "../routes/blogIntercept.ts";

const app = express();

app.use(cors());

app.use(express.json());

app.use(middleware);

app.use(blogInterceptRouter);

await mongoConnectDB();

app.listen(3000, () => {
  logger.info("Server running on port 3000");
});
