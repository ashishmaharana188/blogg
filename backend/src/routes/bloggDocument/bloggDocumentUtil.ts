import multer from "multer";
import { getDB } from "../../db/mongoDBConnect.ts";
import type { BlogInput, BlogDocument } from "../../types/blogTypes.ts";
import { Readable } from "stream";
import cloudinary from "../../cloudinary/cloudinary.ts";
import logger from "../../logs/logger.ts";
import { randomUUID } from "crypto";

export const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 50 * 1024 * 1024,
  },

  fileFilter: (req, file, callback) => {
    const allowedMimeTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "video/mp4",
      "video/webm",
      "video/quicktime",
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      callback(null, true);
    } else {
      callback(new Error("Unsupported file type"));
    }
  },
});

export const saveBlogMedia = async (file: Express.Multer.File) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: "blogg",
        resource_type: "auto",
      },

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

export const saveBlog = async (blog: BlogInput): Promise<BlogDocument> => {
  const blogDocument = {
    ...blog,
    blogg_id: randomUUID(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const result = await getDB().collection("bloggs").insertOne(blogDocument);

  const savedBlog = await getDB().collection<BlogDocument>("bloggs").findOne({
    _id: result.insertedId,
  });

  if (!savedBlog) {
    throw new Error("Failed to retrieve saved blog");
  }

  return savedBlog;
};

export async function getBlogsByGroup(payload: { group_id: string }) {
  const bloggs = await getDB()
    .collection("bloggs")
    .find({
      group_id: payload.group_id,
    })
    .sort({
      created_at: -1,
    })
    .toArray();

  return bloggs;
}
