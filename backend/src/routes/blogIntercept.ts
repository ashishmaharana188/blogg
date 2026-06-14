import express from "express";
import { getDB } from "../db/mongodbConnect.ts";
import { trace } from "../middleware/trace.ts";
import saveBlog from "../db/mongoInsert.ts";

const blogInterceptRouter = express.Router();

blogInterceptRouter.post(
  "/blogSaveRequest",

  trace("BLOG_SAVE", async (req) => {
    const savedBlog = await saveBlog(req.body);
    const result = await getDB().collection("bloggs").insertOne(savedBlog);

    return {
      success: true,
      message: "Blog saved",
      blog: result,
    };
  }),
);
export default blogInterceptRouter;
