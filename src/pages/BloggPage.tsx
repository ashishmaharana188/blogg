import { useState } from "react";
import { Link } from "react-router-dom";
import BloggPageContainer from "../components/bloggPage/bloggPageContainer";
import BloggCanvasUI from "../components/bloggProfile/blogCanvasUI";

const BloggPage = () => {
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
          <Link className="text-black break hover:font-bold" to="/">
            BLOG FEED
            <hr className="w-355 ml-30 border-black border-2"></hr>
          </Link>
        </div>
        <div className="flex justify-end gap-4 mr-15">
          <button className={"w-30 hover:font-bold self-end"} onClick={newNote}>
            New Note
          </button>
          <button className={"w-30 hover:font-bold self-end"} onClick={newNote}>
            Close Note
          </button>
        </div>
        <div className="">
          {isNewNote ? <BloggPageContainer /> : <BloggCanvasUI />}
        </div>
      </div>
    </div>
  );
};

export default BloggPage;
