import multer from "multer";
import { randomUUID } from "crypto";
import { getDB } from "../../db/mongoDBConnect.ts";
import type { BlogInput, BlogDocument } from "../../types/blogTypes.ts";
import cloudinary from "../../cloudinary/cloudinary.ts";
import logger from "../../logs/logger.ts";

const ALLOWED_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const isAllowedMediaType = (mimeType: string) =>
  (mimeType.startsWith("image/") && mimeType !== "image/svg+xml") || ALLOWED_VIDEO_MIME_TYPES.has(mimeType);

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => isAllowedMediaType(file.mimetype)
    ? callback(null, true)
    : callback(new Error(`Unsupported file type: ${file.mimetype || "unknown"}`)),
});

export const saveBlogMedia = async (file: Express.Multer.File) => {
  if (!Buffer.isBuffer(file?.buffer) || file.buffer.length === 0) throw new Error("MEDIA_UPLOAD_EMPTY_BUFFER");
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder: "blogg", resource_type: "auto" }, (error, result) => {
      if (error) {
        logger.error({ event: "MEDIA_UPLOAD_CLOUDINARY_FAILED", errorMessage: (error as Error).message });
        reject(error);
        return;
      }
      if (!result?.secure_url) { reject(new Error("Cloudinary upload returned no secure media URL")); return; }
      resolve({ id: result.public_id, url: result.secure_url, resourceType: result.resource_type });
    });
    stream.end(file.buffer);
  });
};

async function resolveDefaultFolder(): Promise<{ stack_id: string; group_id: string }> {
  const canvas = getDB().collection("stackGroupCanvas");
  let group = await canvas.findOne<{ group_id: string; stack_id: string }>({ group_id: { $exists: true }, group_name: { $regex: /^others$/i } });
  if (group?.group_id && group.stack_id) {
    const stack = await canvas.findOne({ stack_id: group.stack_id, group_id: { $exists: false }, stack_name: { $exists: true } });
    if (stack) return { stack_id: group.stack_id, group_id: group.group_id };
  }
  let stack = await canvas.findOne<{ stack_id: string }>({ stack_name: { $exists: true }, group_id: { $exists: false } });
  if (!stack) {
    const stack_id = randomUUID();
    await canvas.insertOne({ stack_id, stack_name: "Others" });
    stack = { stack_id };
  }
  const group_id = randomUUID();
  await canvas.insertOne({ group_id, stack_id: stack.stack_id, group_name: "Others", created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  return { stack_id: stack.stack_id, group_id };
}

export async function assignUngroupedBlogsToDefaultFolder() {
  const db = getDB();
  const filter = { $or: [
    { group_id: { $exists: false } }, { group_id: null }, { group_id: "" },
    { stack_id: { $exists: false } }, { stack_id: null }, { stack_id: "" },
  ] };
  if (!(await db.collection("bloggs").countDocuments(filter))) return;
  const folder = await resolveDefaultFolder();
  await db.collection("bloggs").updateMany(filter, { $set: { stack_id: folder.stack_id, group_id: folder.group_id, updatedAt: new Date() } });
}

const copyrightFields = (blog: BlogInput) => ({
  showCopyright: blog.showCopyright === true,
  copyrightHolder: typeof blog.copyrightHolder === "string" ? blog.copyrightHolder.replace(/\s+/g, " ").trim().slice(0, 180) : "",
});

export const saveBlog = async (blog: BlogInput): Promise<BlogDocument> => {
  const db = getDB();
  const isPublic = blog.isPublic !== false;
  const attribution = copyrightFields(blog);
  if (blog.blogg_id) {
    const result = await db.collection<BlogDocument>("bloggs").findOneAndUpdate(
      { blogg_id: blog.blogg_id },
      { $set: { author: blog.author, title: blog.title, subtitle: blog.subtitle, tags: blog.tags, content: blog.content, isPublic, ...attribution, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!result) throw new Error("Blog not found");
    return result;
  }
  const destination = blog.stack_id && blog.group_id ? { stack_id: blog.stack_id, group_id: blog.group_id } : await resolveDefaultFolder();
  const document = { ...blog, ...destination, isPublic, ...attribution, blogg_id: randomUUID(), createdAt: new Date(), updatedAt: new Date() };
  const result = await db.collection("bloggs").insertOne(document);
  const saved = await db.collection("bloggs").findOne({ _id: result.insertedId });
  if (!saved) throw new Error("Failed to retrieve saved blog");
  return saved as BlogDocument;
};

export async function getBlogsByGroup(payload: { group_id: string }, includePrivate = false) {
  const filter = includePrivate ? { group_id: payload.group_id } : { group_id: payload.group_id, isPublic: { $ne: false } };
  return getDB().collection("bloggs").find(filter, { projection: {
    _id: 1, blogg_id: 1, stack_id: 1, group_id: 1, document_type: 1, author: 1, title: 1, subtitle: 1, tags: 1,
    isPublic: 1, showCopyright: 1, copyrightHolder: 1, createdAt: 1, updatedAt: 1,
  } }).sort({ createdAt: -1 }).limit(9).toArray();
}

export async function getBloggContent(payload: { blogg_id: string }, includePrivate = false) {
  const bloggId = typeof payload?.blogg_id === "string" ? payload.blogg_id.trim() : "";
  if (!bloggId) return null;
  const filter = includePrivate ? { blogg_id: bloggId } : { blogg_id: bloggId, isPublic: { $ne: false } };
  return getDB().collection("bloggs").findOne(filter);
}
