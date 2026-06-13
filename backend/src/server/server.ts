import express from "express";
import cors from "cors";
import logger from "../logs/logger.ts";
import { trace } from "../middleware/trace.ts";
import { middleware } from "../middleware/middleWare.ts";
import { connectDB } from "../routes/blogs.ts";

const app = express();

app.use(cors());

app.use(express.json());

app.use(middleware);

app.post(
  "/blogSaveRequest",

  trace("BLOG_SAVE", async (req) => {
    const savedBlog = req.body;

    return {
      success: true,
      message: "Blog saved",
      blog: savedBlog,
    };
  }),
);

await connectDB();

app.listen(3000, () => {
  logger.info("Server running on port 3000");
});
