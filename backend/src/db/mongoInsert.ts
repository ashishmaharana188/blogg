import { getDB } from "./mongoDBConnect.ts";
import type { BlogInput, BlogDocument } from "../types/blogTypes.ts";

const saveBlog = async (blog: BlogInput): Promise<BlogDocument> => {
  const blogDocument = {
    ...blog,
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

export default saveBlog;
