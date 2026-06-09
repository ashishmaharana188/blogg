import { useState } from "react";
import UserForm from "./bloggUserForm";

const BloggPage = () => {
  const [value, setValue] = useState("");

  const handleSave = (newValue: string) => {
    console.log("incoming:", newValue);

    setValue(newValue);

    console.log("current state:", value);
  };

  return <UserForm onContentChange={handleSave} />;
};

export default BloggPage;
