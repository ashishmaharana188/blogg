import { useState } from "react";
import UserForm from "./bloggUserForm";

const BloggPageContainer = ({ groupId }: { groupId?: string | null }) => {
  const [value, setValue] = useState("");

  const handleSave = (newValue: string) => {
    console.log(`Incoming Content:`, newValue);
    console.log(`Target Group ID:`, groupId || "Unassigned");

    setValue(newValue);

    console.log("current state:", value);
  };

  return <UserForm onContentChange={handleSave} />;
};

export default BloggPageContainer;
