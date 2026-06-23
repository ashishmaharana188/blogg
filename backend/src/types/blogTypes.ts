import { ObjectId } from "mongodb";

export type BlogInput = {
  author: string;
  title: string;
  subtitle: string;
  content: unknown[]; // refine later using BlockNote types
  groupId: string | null;
  stackId: string | null;
  blogId: string | null;
};

export type BlogDocument = BlogInput & {
  _id: ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
