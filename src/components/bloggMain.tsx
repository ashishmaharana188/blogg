import React from "react";
import UserForm from "./bloggUserForm";

const BloggPage = () => {
  const handleSave = () => {
    console.log("Form Saved");
  };

  return (
    <div>
      <UserForm textSaved={handleSave} />
    </div>
  );
};

export default BloggPage;
