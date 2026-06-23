import express from "express";
import { trace } from "../../middleware/trace.ts";
import {
  upload,
  saveBlogMedia,
  saveBlog,
  getBlogsByGroup,
  getBlogsByBloggId,
} from "./bloggDocumentUtil.ts";

const blogInterceptRouter = express.Router();

blogInterceptRouter.post(
  "/blogSaveRequest",

  trace("BLOG_SAVE", async (req) => {
    const savedBlog = await saveBlog(req.body);

    return {
      success: true,
      message: "Blog saved",
      blog: savedBlog,
    };
  }),
);

blogInterceptRouter.post(
  "/blogMediaUpload",
  upload.single("file"),
  trace("MEDIA UPOAD", async (req) => {
    if (!req.file) {
      throw new Error("No file uploaded");
    }

    const mediaUploaded = await saveBlogMedia(req.file);

    return {
      success: true,
      message: "Media saved",
      media: mediaUploaded,
    };
  }),
);

blogInterceptRouter.post(
  "/canvas/blogg/fetchBloggByGroup",
  trace("GROUP_BLOGS_FETCH", async (req) => {
    const bloggs = await getBlogsByGroup(req.body);

    return {
      success: true,
      message: "GROUP_BLOGS_FETCH",
      bloggs,
    };
  }),
);

blogInterceptRouter.post(
  "/canvas/blogg/fetchBloggByBloggId",
  trace("GROUP_BLOGS_FETCH", async (req) => {
    const bloggs = await getBlogsByBloggId(req.body);

    return {
      success: true,
      message: "GROUP_BLOGS_FETCH",
      bloggs,
    };
  }),
);

export default blogInterceptRouter;
