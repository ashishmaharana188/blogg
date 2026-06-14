import { getDB } from "./mongodbConnect.ts";
import type { BlogInput, BlogDocument } from "../types/blogTypes.ts";

const saveBlog = async (blog: BlogInput): Promise<BlogDocument> => {
  const blogDocument = {
    ...blog,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  console.log("BLOG", blog);

  console.log("BLOG DOCUMENT", blogDocument);

  console.log("BLOG DOCUMENT _ID", (blogDocument as any)._id);

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
