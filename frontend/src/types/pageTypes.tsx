export interface BlogSavetypes {
  //**type for parent handleSave(blog) receive structure since blog is an object */
  author: string;
  title: string;
  subtitle: string;
  content: unknown;
}

export interface userFormtypes {
  onContentChange: (blog: BlogSavetypes) => void;
  bloggId?: string | null;
}

export interface StackPosition {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
