import UserForm from "./bloggUserForm";
import { saveBlog } from "../../services/bloggService";
import { BlogSavetypes } from "../../../../types/pageTypes";

const BloggPageContainer = ({
  stackId,
  groupId,
}: {
  stackId?: string | null;
  groupId?: string | null;
}) => {
  const handleSave = async (blog: BlogSavetypes) => {
    const data = await saveBlog(blog, stackId, groupId);

    console.log(data);
  };

  return <UserForm onContentChange={handleSave} />;
};

export default BloggPageContainer;
