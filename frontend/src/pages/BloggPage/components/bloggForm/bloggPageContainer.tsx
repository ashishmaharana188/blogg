import UserForm from "./bloggUserForm";
import { saveBlog } from "../../services/bloggService";
import { BlogSavetypes } from "../../../../types/pageTypes";
import type { BloggItem } from "../../../../types/pageTypes";

const BloggPageContainer = ({
  stackId,
  groupId,
  selectedBlogg,
}: {
  stackId?: string | null;
  groupId?: string | null;
  selectedBlogg?: BloggItem | null;
}) => {
  const handleSave = async (blog: BlogSavetypes) => {
    const data = await saveBlog(
      blog,
      stackId,
      groupId,
      selectedBlogg?.blogg_id,
    );

    console.log(data);
  };

  return (
    <UserForm onContentChange={handleSave} selectedBlogg={selectedBlogg} />
  );
};

export default BloggPageContainer;
