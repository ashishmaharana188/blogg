import express from "express";
import { randomUUID } from "crypto";
import { getDB } from "../../db/mongoDBConnect.ts";
import { authenticationMiddleware, isConfiguredAdminRequest, optionalAuthenticationMiddleware } from "../../middleware/authenticationMiddleware.ts";
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
  optionalAuthenticationMiddleware,
  trace("GROUP_BLOGS_FETCH", async (req) => {
    const bloggs = await getBlogsByGroup(req.body, isConfiguredAdminRequest(req));
    return { success: true, message: "GROUP_BLOGS_FETCH", bloggs };
  }),
);

blogInterceptRouter.post(
  "/canvas/blogg/fetchBloggById",
  optionalAuthenticationMiddleware,
  trace("GROUP_BLOGS_FETCH", async (req) => {
    const bloggs = await getBloggContent(req.body, isConfiguredAdminRequest(req));
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

// Mind Map data is public-read, but private blogs/references stay visible only to the admin.
blogInterceptRouter.get(
  "/canvas/blogg/mindMapData",
  optionalAuthenticationMiddleware,
  trace("BLOGG_MIND_MAP_FETCH", async (req) => {
    const db = getDB();
    const includePrivate = isConfiguredAdminRequest(req);
    const blogFilter = includePrivate ? {} : { isPublic: { $ne: false } };
    const [stackDocs, groupDocs, blogDocs] = await Promise.all([
      db.collection("stackGroupCanvas")
        .find({ stack_name: { $exists: true }, group_id: { $exists: false } })
        .sort({ _id: -1 })
        .toArray(),
      db.collection("stackGroupCanvas")
        .find({ group_id: { $exists: true } })
        .sort({ _id: -1 })
        .toArray(),
      db.collection("bloggs")
        .find(blogFilter, {
          projection: {
            _id: 0,
            blogg_id: 1,
            stack_id: 1,
            group_id: 1,
            title: 1,
            subtitle: 1,
            author: 1,
            isPublic: 1,
            references: 1,
            createdAt: 1,
          },
        })
        .sort({ createdAt: 1 })
        .toArray(),
    ]);

    const visibleById = new Map<string, any>();
    for (const blog of blogDocs) {
      if (typeof blog.blogg_id === "string" && blog.blogg_id) visibleById.set(blog.blogg_id, blog);
    }

    const bloggs = blogDocs.map((blog) => ({
      blogg_id: String(blog.blogg_id || ""),
      stack_id: String(blog.stack_id || ""),
      group_id: String(blog.group_id || ""),
      title: String(blog.title || "Untitled blog"),
      subtitle: String(blog.subtitle || ""),
      author: String(blog.author || ""),
      isPublic: blog.isPublic !== false,
      references: (Array.isArray(blog.references) ? blog.references : [])
        .filter((reference: any) => visibleById.has(String(reference?.target_blogg_id || "")))
        .map((reference: any) => ({
          reference_id: String(reference.reference_id || randomUUID()),
          target_blogg_id: String(reference.target_blogg_id),
          target_title: String(visibleById.get(String(reference.target_blogg_id))?.title || reference.target_title || "Untitled blog"),
          target_excerpt: String(reference.target_excerpt || ""),
          source_excerpt: String(reference.source_excerpt || ""),
        })),
    }));

    return {
      success: true,
      message: "BLOGG_MIND_MAP_FETCH",
      stacks: stackDocs.map((stack) => ({ stack_id: String(stack.stack_id || ""), stack_name: String(stack.stack_name || "Untitled stack") })),
      groups: groupDocs.map((group) => ({ group_id: String(group.group_id || ""), group_name: String(group.group_name || "Untitled group"), stack_id: String(group.stack_id || "") })),
      bloggs,
    };
  }),
);

blogInterceptRouter.get(
  "/canvas/blogg/references/:bloggId",
  optionalAuthenticationMiddleware,
  trace("BLOGG_REFERENCES_FETCH", async (req) => {
    const bloggId = typeof req.params.bloggId === "string" ? req.params.bloggId.trim() : "";
    if (!bloggId) return { success: true, references: [] };
    const includePrivate = isConfiguredAdminRequest(req);
    const db = getDB();
    const source = await db.collection("bloggs").findOne({ blogg_id: bloggId });
    if (!source || (source.isPublic === false && !includePrivate)) {
      return { success: true, references: [] };
    }

    const sourceReferences = Array.isArray(source.references) ? source.references : [];
    const targetIds = [...new Set(sourceReferences.map((reference: any) => String(reference?.target_blogg_id || "")).filter(Boolean))];
    if (!targetIds.length) return { success: true, references: [] };
    const targetFilter: any = { blogg_id: { $in: targetIds } };
    if (!includePrivate) targetFilter.isPublic = { $ne: false };
    const targets = await db.collection("bloggs")
      .find(targetFilter, { projection: { blogg_id: 1, title: 1 } })
      .toArray();
    const targetById = new Map<string, any>(targets.map((target: any) => [String(target.blogg_id), target] as [string, any]));
    const references = sourceReferences
      .filter((reference: any) => targetById.has(String(reference?.target_blogg_id || "")))
      .map((reference: any) => ({
        reference_id: String(reference.reference_id || randomUUID()),
        target_blogg_id: String(reference.target_blogg_id),
        target_title: String(targetById.get(String(reference.target_blogg_id))?.title || reference.target_title || "Untitled blog"),
        target_excerpt: String(reference.target_excerpt || ""),
        source_excerpt: String(reference.source_excerpt || ""),
      }));
    return { success: true, references };
  }),
);

blogInterceptRouter.post(
  "/canvas/blogg/references/save",
  authenticationMiddleware,
  adminMiddleware,
  trace("BLOGG_REFERENCES_SAVE", async (req) => {
    const bloggId = typeof req.body?.blogg_id === "string" ? req.body.blogg_id.trim() : "";
    if (!bloggId) throw new Error("Save this blog before adding references.");
    const rawReferences = Array.isArray(req.body?.references) ? req.body.references : [];
    if (rawReferences.length > 100) throw new Error("A blog can have at most 100 references.");

    const db = getDB();
    const blogs = db.collection("bloggs");
    const source = await blogs.findOne({ blogg_id: bloggId }, { projection: { blogg_id: 1, references: 1 } });
    if (!source) throw new Error("The source blog could not be found.");

    const normalizedInput: Array<{ reference_id: string; target_blogg_id: string; target_excerpt: string; source_excerpt: string }> = [];
    const seenReferenceIds = new Set<string>();
    for (const item of rawReferences) {
      const targetId = typeof item?.target_blogg_id === "string" ? item.target_blogg_id.trim() : "";
      const excerpt = typeof item?.target_excerpt === "string" ? item.target_excerpt.trim().slice(0, 2000) : "";
      const sourceExcerpt = typeof item?.source_excerpt === "string" ? item.source_excerpt.trim().slice(0, 500) : "";
      if (!targetId || targetId === bloggId) continue;
      if (!excerpt) throw new Error("Each reference must include the passage being referenced.");
      if (!sourceExcerpt) throw new Error("Link each reference to selected text in the source blog before saving.");
      const referenceId = typeof item?.reference_id === "string" && item.reference_id.trim()
        ? item.reference_id.trim()
        : String(randomUUID());
      if (seenReferenceIds.has(referenceId)) continue;
      seenReferenceIds.add(referenceId);
      normalizedInput.push({
        reference_id: referenceId,
        target_blogg_id: targetId,
        target_excerpt: excerpt,
        source_excerpt: sourceExcerpt,
      });
    }

    const targetIds = [...new Set(normalizedInput.map((reference) => reference.target_blogg_id))];
    const targets = targetIds.length
      ? await blogs.find({ blogg_id: { $in: targetIds } }, { projection: { blogg_id: 1, title: 1 } }).toArray()
      : [];
    const targetsById = new Map<string, any>(targets.map((target: any) => [String(target.blogg_id), target] as [string, any]));
    if (targetsById.size !== targetIds.length) throw new Error("One or more referenced blogs could not be found.");

    const references = normalizedInput.map((reference) => ({
      ...reference,
      target_title: String(targetsById.get(reference.target_blogg_id)?.title || "Untitled blog"),
    }));
    await blogs.updateOne({ blogg_id: bloggId }, { $set: { references, updatedAt: new Date() } });
    return { success: true, message: "BLOGG_REFERENCES_SAVED", references };
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
