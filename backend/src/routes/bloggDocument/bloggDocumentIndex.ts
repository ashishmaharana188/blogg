import express from "express";
import { trace } from "../../middleware/trace.ts";
import {
  upload,
  saveBlogMedia,
  saveBlog,
  getBlogsByGroup,
  getBloggContent,
} from "./bloggDocumentUtil.ts";

const blogInterceptRouter = express.Router();

blogInterceptRouter.post(
  "/blogSaveRequest",

  trace("BLOG_SAVE", async (req) => {
    const savedBlog = await saveBlog(req.body);

    return {
      success: true,
      message: "BLOG_SAVED",
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
      message: "MEDIA_SAVED",
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
  "/canvas/blogg/fetchBloggById",
  trace("GROUP_BLOGS_FETCH", async (req) => {
    const bloggs = await getBloggContent(req.body);

    return {
      success: true,
      message: "BLOG_ID_CONTENT_FETCH",
      bloggs,
    };
  }),
);

export default blogInterceptRouter;
