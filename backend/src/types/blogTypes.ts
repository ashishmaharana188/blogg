import { ObjectId } from "mongodb";

type BlogDocumentType = "note" | "external_article";

export type BlogInput = {
  stack_id: string;
  group_id: string;
  blogg_id?: string;
  document_type: BlogDocumentType;

  author?: string;
  title?: string;
  subtitle?: string;
  tags?: string[];

  content?: unknown[];

  source_url?: string;
  external_article?: {
    html: string;
    css?: string;
    cover_image?: string;
    source_title?: string;
    source_author?: string;
  };
};

export type BlogDocument = BlogInput & {
  _id: ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
