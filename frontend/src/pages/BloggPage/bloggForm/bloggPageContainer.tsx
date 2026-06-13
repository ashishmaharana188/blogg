import UserForm from "./bloggUserForm";
import { BlogSavetypes } from "../../../types/pageTypes";

const BloggPageContainer = ({ groupId }: { groupId?: string | null }) => {
  //save blogUserForm
  const handleSave = async (blog: BlogSavetypes) => {
    const response = await fetch("http://localhost:3000/blogSaveRequest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...blog,
        groupId,
      }),
    });

    const data = await response.json();

    console.log(data);
  };

  return <UserForm onContentChange={handleSave} />;
};

export default BloggPageContainer;
