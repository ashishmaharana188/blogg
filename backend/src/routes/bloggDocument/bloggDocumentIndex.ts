import express from "express";
import { authenticationMiddleware } from "../../middleware/authenticationMiddleware.ts";
import { adminMiddleware } from "../../middleware/adminMiddleware.ts";
import { trace } from "../../middleware/trace.ts";
import {
  upload,
  saveBlogMedia,
  saveBlog,
  getBlogsByGroup,
  getBloggContent,
  assignUngroupedBlogsToDefaultFolder,
} from "./bloggDocumentUtil.ts";
import { deleteBloggById } from "./deleteBloggUtil.ts";

const blogInterceptRouter = express.Router();

blogInterceptRouter.post(
  "/blogSaveRequest",
  authenticationMiddleware,
  adminMiddleware,
  trace("BLOG_SAVE", async (req) => {
    const savedBlog = await saveBlog(req.body);
    return { success: true, message: "BLOG_SAVED", blog: savedBlog };
  }),
);

blogInterceptRouter.post(
  "/blogMediaUpload",
  authenticationMiddleware,
  adminMiddleware,
  upload.single("file"),
  trace("MEDIA_UPLOAD", async (req) => {
    if (!req.file) throw new Error("No file uploaded");
    const mediaUploaded = await saveBlogMedia(req.file);
    return { success: true, message: "MEDIA_SAVED", media: mediaUploaded };
  }),
);

blogInterceptRouter.post(
  "/canvas/blogg/fetchBloggByGroup",
  trace("GROUP_BLOGS_FETCH", async (req) => {
    const bloggs = await getBlogsByGroup(req.body);
    return { success: true, message: "GROUP_BLOGS_FETCH", bloggs };
  }),
);

blogInterceptRouter.post(
  "/canvas/blogg/fetchBloggById",
  trace("GROUP_BLOGS_FETCH", async (req) => {
    const bloggs = await getBloggContent(req.body);
    return { success: true, message: "BLOG_ID_CONTENT_FETCH", bloggs };
  }),
);

blogInterceptRouter.post(
  "/canvas/blogg/deleteBlogg",
  authenticationMiddleware,
  adminMiddleware,
  trace("BLOG_DELETE", async (req) => {
    const bloggId = typeof req.body?.blogg_id === "string" ? req.body.blogg_id.trim() : "";
    if (!bloggId) throw new Error("A note ID is required.");

    const result = await deleteBloggById({ blogg_id: bloggId });
    if (result.deletedCount !== 1) throw new Error("Note not found or already deleted.");

    return { success: true, message: "BLOG_DELETED", blogg_id: bloggId };
  }),
);

// Repair legacy notes before Folder view queries by group_id.
blogInterceptRouter.get(
  "/canvas/folderView/repairUngroupedNotes",
  authenticationMiddleware,
  adminMiddleware,
  trace("FOLDER_VIEW_REPAIR_UNGROUPED_NOTES", async () => {
    await assignUngroupedBlogsToDefaultFolder();
    return { success: true, message: "FOLDER_VIEW_REPAIR_COMPLETE" };
  }),
);

export default blogInterceptRouter;
