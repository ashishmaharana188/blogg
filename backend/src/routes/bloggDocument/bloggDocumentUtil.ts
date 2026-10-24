import multer from "multer";
import { getDB } from "../../db/mongoDBConnect.ts";
import type { BlogInput, BlogDocument } from "../../types/blogTypes.ts";
import cloudinary from "../../cloudinary/cloudinary.ts";
import logger from "../../logs/logger.ts";
import { randomUUID } from "crypto";

const ALLOWED_VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

const isAllowedMediaType = (mimeType: string) => {
  // BlockNote commonly sends raster images and phone-originated image formats.
  // SVG is deliberately excluded because it can contain active content.
  const isImage = mimeType.startsWith("image/") && mimeType !== "image/svg+xml";
  return isImage || ALLOWED_VIDEO_MIME_TYPES.has(mimeType);
};

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (isAllowedMediaType(file.mimetype)) callback(null, true);
    else callback(new Error(`Unsupported file type: ${file.mimetype || "unknown"}`));
  },
});

export const saveBlogMedia = async (file: Express.Multer.File) => {
  const hasBuffer = Boolean(file && Buffer.isBuffer(file.buffer));
  const bufferBytes = hasBuffer ? file.buffer.length : 0;
  const fileSizeBytes = Number(file?.size ?? 0);

  logger.info({
    event: "MEDIA_UPLOAD_RECEIVED",
    fileSizeBytes,
    bufferBytes,
    mimeType: file?.mimetype || "unknown",
  });

  if (!hasBuffer || bufferBytes === 0) {
    throw new Error(
      `MEDIA_UPLOAD_EMPTY_BUFFER: received ${bufferBytes} bytes (declared file size ${fileSizeBytes})`,
    );
  }

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: "blogg", resource_type: "auto" },
      (error, result) => {
        if (error) {
          const cloudinaryError = error as Error & {
            http_code?: number;
            name?: string;
            message?: string;
          };
          logger.error({
            event: "MEDIA_UPLOAD_CLOUDINARY_FAILED",
            fileSizeBytes: bufferBytes,
            errorName: cloudinaryError.name,
            httpCode: cloudinaryError.http_code,
            errorMessage: cloudinaryError.message || String(error),
          });
          reject(error);
          return;
        }

        if (!result?.secure_url) {
          reject(new Error("Cloudinary upload returned no secure media URL"));
          return;
        }

        logger.info({
          event: "MEDIA_UPLOAD_SUCCESS",
          mediaId: result.public_id,
          resourceType: result.resource_type,
          fileSizeBytes: bufferBytes,
        });

        resolve({
          id: result.public_id,
          url: result.secure_url,
          resourceType: result.resource_type,
        });
      },
    );

    uploadStream.end(file.buffer);
  });
};

/**
 * Header-created notes have no canvas destination. Put those notes in a stable
 * "Others" folder so the canvas and flipbook use the same document.
 */
async function resolveDefaultFolder(): Promise<{ stack_id: string; group_id: string }> {
  const canvas = getDB().collection("stackGroupCanvas");

  let group = await canvas.findOne<{ group_id: string; stack_id: string }>({
    group_id: { $exists: true },
    group_name: { $regex: /^others$/i },
  });

  if (group?.group_id && group.stack_id) {
    const stack = await canvas.findOne({
      stack_id: group.stack_id,
      group_id: { $exists: false },
      stack_name: { $exists: true },
    });
    if (stack) return { stack_id: group.stack_id, group_id: group.group_id };
  }

  let stack = await canvas.findOne<{ stack_id: string }>({
    stack_name: { $exists: true },
    group_id: { $exists: false },
  });

  if (!stack) {
    const stack_id = randomUUID();
    await canvas.insertOne({ stack_id, stack_name: "Others" });
    stack = { stack_id };
  }

  const group_id = randomUUID();
  await canvas.insertOne({
    group_id,
    stack_id: stack.stack_id,
    group_name: "Others",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  return { stack_id: stack.stack_id, group_id };
}

/** Repair older notes saved without a stack/folder destination. */
export async function assignUngroupedBlogsToDefaultFolder() {
  const db = getDB();
  const ungroupedFilter = {
    $or: [
      { group_id: { $exists: false } },
      { group_id: null },
      { group_id: "" },
      { stack_id: { $exists: false } },
      { stack_id: null },
      { stack_id: "" },
    ],
  };

  if (!(await db.collection("bloggs").countDocuments(ungroupedFilter))) return;

  const folder = await resolveDefaultFolder();
  await db.collection("bloggs").updateMany(ungroupedFilter, {
    $set: {
      stack_id: folder.stack_id,
      group_id: folder.group_id,
      updatedAt: new Date(),
    },
  });
}

export const saveBlog = async (blog: BlogInput): Promise<BlogDocument> => {
  const db = getDB();
  const isPublic = blog.isPublic !== false;

  if (blog.blogg_id) {
    const result = await db
      .collection<BlogDocument>("bloggs")
      .findOneAndUpdate(
        { blogg_id: blog.blogg_id },
        {
          $set: {
            author: blog.author,
            title: blog.title,
            subtitle: blog.subtitle,
            tags: blog.tags,
            content: blog.content,
            isPublic,
            updatedAt: new Date(),
          },
        },
        { returnDocument: "after" },
      );

    if (!result) throw new Error("Blog not found");
    return result;
  }

  const destination = blog.stack_id && blog.group_id
    ? { stack_id: blog.stack_id, group_id: blog.group_id }
    : await resolveDefaultFolder();

  const blogDocument = {
    ...blog,
    ...destination,
    isPublic,
    blogg_id: randomUUID(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const result = await db.collection("bloggs").insertOne(blogDocument);
  const savedBlog = await db
    .collection("bloggs")
    .findOne({ _id: result.insertedId });

  if (!savedBlog) throw new Error("Failed to retrieve saved blog");
  return savedBlog as BlogDocument;
};

/**
 * Only the configured administrator may include private notes. `$ne: false`
 * intentionally treats records created before this feature (missing isPublic)
 * as public, preventing an accidental hide-all upgrade.
 */
export async function getBlogsByGroup(
  payload: { group_id: string },
  includePrivate = false,
) {
  const filter = includePrivate
    ? { group_id: payload.group_id }
    : { group_id: payload.group_id, isPublic: { $ne: false } };

  const bloggs = await getDB()
    .collection("bloggs")
    .find(
      filter,
      {
        projection: {
          _id: 1,
          blogg_id: 1,
          stack_id: 1,
          group_id: 1,
          document_type: 1,
          author: 1,
          title: 1,
          subtitle: 1,
          tags: 1,
          isPublic: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    )
    .sort({ createdAt: -1 })
    .limit(9)
    .toArray();

  return bloggs;
}

export async function getBloggContent(
  payload: { blogg_id: string },
  includePrivate = false,
) {
  const bloggId = typeof payload?.blogg_id === "string" ? payload.blogg_id.trim() : "";
  if (!bloggId) return null;
  const filter = includePrivate
    ? { blogg_id: bloggId }
    : { blogg_id: bloggId, isPublic: { $ne: false } };
  return getDB().collection("bloggs").findOne(filter);
}
