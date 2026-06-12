import UserForm from "./bloggUserForm";
import { BlogSavetypes } from "../../../types/pageTypes";

const BloggPageContainer = ({ groupId }: { groupId?: string | null }) => {
  //save blogUserForm
  const handleSave = async (blog: BlogSavetypes) => {
    const response = await fetch("http://localhost:3000/blogSaveRequest", {
      method: "POST",
      headers: {
        "Conten-Type": "application/json",
      },
      body: JSON.stringify({
        ...blog,
        groupId,
      }),
    });
    const text = await response.text();

    console.log(text);
  };

  return <UserForm onContentChange={handleSave} />;
};

export default BloggPageContainer;
