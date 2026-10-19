import UserForm from "./bloggUserForm";
import { saveBlog } from "../../services/bloggService";
import type { BlogSavetypes, BloggItem } from "../../../../types/pageTypes";

const BloggPageContainer = ({
  stackId,
  groupId,
  selectedBlogg,
  initialEditMode,
  onSaved,
}: {
  stackId?: string | null;
  groupId?: string | null;
  selectedBlogg?: BloggItem | null;
  initialEditMode?: boolean;
  onSaved?: () => void;
}) => {
  const handleSave = async (blog: BlogSavetypes) => {
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
    />
  );
};

export default BloggPageContainer;
