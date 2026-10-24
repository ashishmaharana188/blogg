import UserForm from "./bloggUserForm";
import { saveBlog } from "../../services/bloggService";
import type { BlogSavetypes, BloggItem } from "../../../../types/pageTypes";

const BloggPageContainer = ({
  stackId,
  groupId,
  selectedBlogg,
  initialEditMode,
  canEdit = false,
  onSaved,
}: {
  stackId?: string | null;
  groupId?: string | null;
  selectedBlogg?: BloggItem | null;
  initialEditMode?: boolean;
  /** True only for the authenticated administrator. */
  canEdit?: boolean;
  onSaved?: () => void;
}) => {
  const handleSave = async (blog: BlogSavetypes) => {
    if (!canEdit) {
      throw new Error("Administrator access is required to edit notes.");
    }
    try {
      await saveBlog(blog, stackId, groupId, selectedBlogg?.blogg_id);
      onSaved?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save this note.";
      window.alert(message);
    }
  };

  return (
    <UserForm
      onContentChange={handleSave}
      selectedBlogg={selectedBlogg}
      initialEditMode={initialEditMode}
      canEdit={canEdit}
    />
  );
};

export default BloggPageContainer;
