import { useState } from "react";
import { Link } from "react-router-dom";
import BloggPageContainer from "../../pages/BloggPage/bloggForm/bloggPageContainer";
import BloggCanvasUI from "../../pages/BloggPage/bloggProfile/bloggCanvasUI";

const BloggPage = () => {
  const [activeForm, setActiveForm] = useState<{
    isOpen: boolean;
    groupId: string | null;
  }>({
    isOpen: false,
    groupId: null,
  });

  const toggleNote = () => {
    setActiveForm((prev) => ({ isOpen: !prev.isOpen, groupId: null }));
  };

  const handleOpenFormFromCanvas = (groupId: string) => {
    setActiveForm({ isOpen: true, groupId });
  };

  return (
    <div className="w-full h-full flex flex-col bg-white">
      <div className="shrink-0 pt-6 px-6 sm:pt-10 sm:px-10 flex justify-between items-end pb-4 border-b border-slate-100 z-50 bg-white">
        <div className="flex flex-col justify-between items-center w-full mb-2">
          <div className="flex gap-4 shrink-0 self-start">
            <Link className="text-black hover:font-bold" to="/">
              BLOG FEED
            </Link>
          </div>
          <hr className="w-280 border-black border-2 ml-5 " />
          <div className="flex gap-4 shrink-0 pl-4 self-end">
            <button
              className="text-black block hover:font-bold truncate"
              onClick={toggleNote}
            >
              {activeForm.isOpen ? "Close Note" : "New Note"}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 relative w-full">
        {activeForm.isOpen ? (
          <BloggPageContainer groupId={activeForm.groupId} />
        ) : (
          <BloggCanvasUI onOpenForm={handleOpenFormFromCanvas} />
        )}
      </div>
    </div>
  );
};

export default BloggPage;
