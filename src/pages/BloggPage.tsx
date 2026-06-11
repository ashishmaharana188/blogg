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
    <div className="w-full h-full flex flex-col overflow-hidden bg-white">
      <div className="shrink-0 pt-6 px-6 sm:pt-10 sm:px-10 flex justify-between items-end pb-4 border-b border-slate-100 z-50 bg-white">
        <div className="flex justify-between items-center w-full mb-2">
          <div className="flex gap-4 shrink-0">
            <Link className="text-black hover:font-bold" to="/">
              BLOG FEED
            </Link>
          </div>
          <hr className="w-280 border-black border-2 mt-10 ml-5 " />
          <div className="flex gap-4 shrink-0 pl-4">
            <button
              className="text-black block hover:font-bold truncate"
              onClick={toggleNote}
            >
              {isNewNote ? "Close Note" : "New Note"}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 relative w-full overflow-hidden">
        {isNewNote ? <BloggPageContainer /> : <BloggCanvasUI />}
      </div>
    </div>
  );
};

export default BloggPage;
