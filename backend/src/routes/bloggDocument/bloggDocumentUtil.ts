import multer from "multer";
import { getDB } from "../../db/mongoDBConnect.ts";
import type { BlogInput, BlogDocument } from "../../types/blogTypes.ts";
import { Readable } from "stream";
import cloudinary from "../../cloudinary/cloudinary.ts";
import logger from "../../logs/logger.ts";
import { randomUUID } from "crypto";

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    const allowedMimeTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "video/mp4",
      "video/webm",
      "video/quicktime",
    ];
    if (allowedMimeTypes.includes(file.mimetype)) callback(null, true);
    else callback(new Error("Unsupported file type"));
  },
});

export const saveBlogMedia = async (file: Express.Multer.File) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: "blogg", resource_type: "auto" },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        logger.info({
          event: "MEDIA_UPLOAD_SUCCESS",
          mediaId: result?.public_id,
          resourceType: result?.resource_type,
        });
        resolve({
          id: result?.public_id,
          url: result?.secure_url,
          resourceType: result?.resource_type,
        });
      },
    );
    Readable.from(file.buffer).pipe(uploadStream);
  });
};

/**
 * Header-created notes have no canvas destination. Put those notes in a
 * stable "Others" folder so the canvas and flipbook use the same document.
 * The folder is reused on subsequent saves; when the canvas is empty, a
 * matching stack is created as well.
 */
async function resolveDefaultFolder(): Promise<{ stack_id: string; group_id: string }> {
  const canvas = getDB().collection("stackGroupCanvas");

  let group = await canvas.findOne<{ group_id: string; stack_id: string }>({
    group_id: { $exists: true },
    group_name: { $regex: /^others$/i },
  });

  if (group?.group_id && group.stack_id) {
    // A group can exist after its stack was deleted. Recreate that stack so
    // the folder remains visible in Folder view.
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

/**
 * Repair older notes saved without a stack/folder destination. This operation
 * is idempotent: once every note has IDs, later calls do no database writes.
 */
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
    blogg_id: randomUUID(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const result = await db.collection("bloggs").insertOne(blogDocument);
  const savedBlog = await db
    .collection<BlogDocument>("bloggs")
    .findOne({ _id: result.insertedId });

  if (!savedBlog) throw new Error("Failed to retrieve saved blog");
  return savedBlog;
};

export async function getBlogsByGroup(payload: { group_id: string }) {
  const bloggs = await getDB()
    .collection("bloggs")
    .find(
      { group_id: payload.group_id },
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

export async function getBloggContent(payload: { blogg_id: string }) {
  return getDB().collection("bloggs").findOne({ blogg_id: payload.blogg_id });
}
