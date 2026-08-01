export interface BlogSavetypes {
  //**type for parent handleSave(blog) receive structure since blog is an object */
  author: string;
  title: string;
  subtitle: string;
  tags?: string[];
  content: unknown;
}

export interface userFormtypes {
  onContentChange: (blog: BlogSavetypes) => void;
  selectedBlogg?: BloggItem | null;
  initialEditMode?: boolean;
}

export interface StackPosition {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BloggDocumentType = "note" | "external_article";

export interface BloggItem {
  _id: string;
  blogg_id: string;

  stack_id: string;
  group_id: string;

  document_type: BloggDocumentType;

  author: string;
  title: string;
  subtitle: string;
  tags: string[];

  content?: unknown[]; // note only

  source_url?: string; // external_article only
  external_article?: {
    html: string;
    css?: string;
    cover_image?: string;
    source_title?: string;
    source_author?: string;
  };

  createdAt: string;
  updatedAt: string;
}
