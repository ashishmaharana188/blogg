import { ObjectId } from "mongodb";

export type BlogInput = {
  blogg_id?: string | null;
  author: string;
  title: string;
  subtitle: string;
  tags: string[];
  content: unknown[];
  stack_id?: string | null;
  group_id?: string | null;
};

export type BlogDocument = BlogInput & {
  _id: ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
