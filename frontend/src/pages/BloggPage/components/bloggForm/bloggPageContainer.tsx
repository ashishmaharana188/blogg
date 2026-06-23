import UserForm from "./bloggUserForm";
import { saveBlog } from "../../services/bloggService";
import { BlogSavetypes } from "../../../../types/pageTypes";

const BloggPageContainer = ({
  stackId,
  groupId,
  bloggId,
}: {
  stackId?: string | null;
  groupId?: string | null;
  bloggId?: string | null;
}) => {
  const handleSave = async (blog: BlogSavetypes) => {
    const data = await saveBlog(blog, stackId, groupId, bloggId);

    console.log(data);
  };

  return <UserForm onContentChange={handleSave} bloggId={bloggId} />;
};

export default BloggPageContainer;
