import { useState } from "react";
import BloggPage from "../components/bloggPage";
import { Link } from "react-router-dom";

const BlogPage = () => {
  const [isNewNote, setNewNote] = useState(false);

  const newNote = () => {
    setNewNote(true);
    if (isNewNote == true) {
      setNewNote(false);
    }
  };

  return (
    <div className="w-full min-h-screen relative">
      <div className="flex flex-col">
        <div className="mt-10 ml-10">
          <Link className="text-black hover:font-bold" to="/">
            HOME PAGE
          </Link>
        </div>
        <div className="flex justify-end gap-4 mr-20">
          <button className={"w-30 hover:font-bold self-end"} onClick={newNote}>
            New Note
          </button>
          <button className={"w-30 hover:font-bold self-end"} onClick={newNote}>
            Close Note
          </button>
        </div>
        <div className="">{isNewNote && <BloggPage />}</div>
      </div>
    </div>
  );
};

export default BlogPage;
