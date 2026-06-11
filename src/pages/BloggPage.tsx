import { useState } from "react";
import { Link } from "react-router-dom";
import BloggPageContainer from "../components/bloggPage/bloggPageContainer";
import BloggCanvasUI from "../components/bloggProfile/blogCanvasUI";

const BloggPage = () => {
  const [isNewNote, setNewNote] = useState(false);

  const toggleNote = () => {
    setNewNote(!isNewNote);
  };

  return (
    <div className="w-full h-screen flex flex-col overflow-hidden bg-white">
      <div className="shrink-0 pt-10 px-10 flex justify-between items-end pb-4">
        <div>
          <Link className="text-black break hover:font-bold" to="/">
            BLOG FEED
            <hr className="w-395 border-black border-2 mt-1 ml-30"></hr>
          </Link>
        </div>
        <div className="flex gap-4">
          <button className="w-30 hover:font-bold" onClick={toggleNote}>
            {isNewNote ? "Close Note" : "New Note"}
          </button>
        </div>
      </div>

      <div className="flex-1 relative w-full overflow-hidden">
        {isNewNote ? <BloggPageContainer /> : <BloggCanvasUI />}
      </div>
    </div>
  );
};

export default BloggPage;
