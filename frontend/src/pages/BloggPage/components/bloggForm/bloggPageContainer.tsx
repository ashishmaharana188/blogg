import UserForm from "./bloggUserForm";
import { saveBlog } from "../../services/bloggService";
import type { BlogSavetypes, BloggItem } from "../../../../types/pageTypes";

type BloggPageContainerProps = {
  stackId?: string | null;
  groupId?: string | null;
  selectedBlogg?: BloggItem | null;
  initialEditMode?: boolean;
  /** True only for the authenticated administrator. */
  canEdit?: boolean;
  /** Explicit Save & Close action. */
  onSaved?: () => void;
  /** Refresh the canvas after an autosave without closing the editor. */
  onAutoSaved?: () => void;
};

const BloggPageContainer = ({
  stackId,
  groupId,
  selectedBlogg,
  initialEditMode,
  canEdit = false,
  onSaved,
  onAutoSaved,
}: BloggPageContainerProps) => {
  const handleSave = async (
    blog: BlogSavetypes,
    currentBloggId?: string | null,
    closeAfterSave = false,
  ) => {
    if (!canEdit) {
      throw new Error("Administrator access is required to edit notes.");
    }

    const response = await saveBlog(
      blog,
      stackId,
      groupId,
      currentBloggId || selectedBlogg?.blogg_id || null,
    );
    const savedBlog = response?.blog ?? response;

    if (closeAfterSave) onSaved?.();
    return savedBlog;
  };

  return (
    <UserForm
      onContentChange={handleSave}
      onAutoSaved={onAutoSaved}
      selectedBlogg={selectedBlogg}
      initialEditMode={initialEditMode}
      canEdit={canEdit}
    />
  );
};

export default BloggPageContainer;
