export interface BlogSavetypes {
  // Structure passed from the editor to the save handler.
  author: string;
  title: string;
  subtitle: string;
  tags?: string[];
  content: unknown;
  /** Missing visibility values on old records are treated as public by the API. */
  isPublic?: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  displayName?: string;
  avatar?: string;
}

export interface userFormtypes {
  onContentChange: (blog: BlogSavetypes, bloggId?: string | null, closeAfterSave?: boolean) => Promise<unknown>;
  onAutoSaved?: () => void;
  selectedBlogg?: BloggItem | null;
  initialEditMode?: boolean;
  /** True only when the authenticated user is the configured administrator. */
  canEdit?: boolean;
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

  /** False means administrator-only. Missing values remain public for legacy records. */
  isPublic?: boolean;

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
