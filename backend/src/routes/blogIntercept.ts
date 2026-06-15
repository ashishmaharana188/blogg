import express from "express";
import { getDB } from "../db/mongoDBConnect.ts";
import { trace } from "../middleware/trace.ts";
import { upload, saveBlogMedia, saveBlog } from "./bloggDocument.ts";
import cloudinary from "../cloudinary/cloudinary.ts";

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
  trace("MEDIA UPOAD SUCCESS", async (req) => {
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

export default blogInterceptRouter;
