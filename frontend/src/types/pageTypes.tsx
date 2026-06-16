export interface BlogSavetypes {
  //**type for parent handleSave(blog) receive structure since blog is an object */
  author: string;
  title: string;
  subtitle: string;
  content: unknown;
}

export interface userFormtypes {
  onContentChange: (blog: BlogSavetypes) => void;
}
