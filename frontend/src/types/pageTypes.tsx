import { BloggItem } from "../pages/BloggPage/components/bloggProfile/canvasView/bloggCanvasType";
export interface BlogSavetypes {
  //**type for parent handleSave(blog) receive structure since blog is an object */
  author: string;
  title: string;
  subtitle: string;
  content: unknown;
}

export interface userFormtypes {
  onContentChange: (blog: BlogSavetypes) => void;
  selectedBlogg?: BloggItem | null;
}

export interface StackPosition {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
