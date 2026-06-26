import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import BloggPageContainer from "../BloggPage/components/bloggForm/bloggPageContainer";
import BlogFlipBookUI from "./components/bloggProfile/flipBook/bloggFlipBookUI";
import BloggCanvasUI from "./components/bloggProfile/canvasView/bloggCanvasUI";
type ViewMode = "canvas" | "flipbook";
import { BloggSummary } from "./components/bloggProfile/canvasView/bloggCanvasType";
import { BloggItem } from "../../types/pageTypes";
import { fetchBloggByIdRequest } from "./services/canvasViewService";

const BloggPage = () => {
  const [activeForm, setActiveForm] = useState<{
    isOpen?: boolean;
    stackId?: string | null;
    groupId?: string | null;
    selectedBlogg: BloggItem | null;
  }>({
    isOpen: false,
    stackId: null,
    groupId: null,
    selectedBlogg: null,
  });
  const [viewMode, setViewMode] = useState<ViewMode>("canvas");

  const toggleNote = () => {
    setActiveForm((prev) => ({
      isOpen: !prev.isOpen,
      stackId: null,
      groupId: null,
      selectedBlogg: null,
    }));
  };

  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => (prev === "canvas" ? "flipbook" : "canvas"));
  }, []);

  const handleOpenFormFromCanvas = async (
    stackId: string,
    groupId: string,
    blogg?: BloggSummary,
  ) => {
    // New Note button path: no summary was passed.
    if (!blogg) {
      setActiveForm({
        isOpen: true,
        stackId,
        groupId,
        selectedBlogg: null,
      });
      return;
    }

    const fullBlogg = await fetchBloggByIdRequest({
      blogg_id: blogg.blogg_id,
    });

    setActiveForm({
      isOpen: true,
      stackId: fullBlogg.stack_id,
      groupId: fullBlogg.group_id,
      selectedBlogg: fullBlogg,
    });
  };

  return (
    <div className="w-full h-full flex flex-col bg-white">
      <div className="shrink-0 pt-6 px-6 sm:pt-10 sm:px-10 flex justify-between items-end pb-4 border-b border-slate-100 z-50 bg-white">
        <div className="flex flex-row justify-between items-center w-full mb-2">
          <div className="flex gap-4 shrink-0 self-start items-center">
            <Link className="text-black hover:font-bold" to="/">
              BLOG FEED
            </Link>
            {!activeForm.isOpen && (
              <button
                className="text-sm text-gray-600 hover:text-black hover:font-bold ml-6"
                onClick={toggleViewMode}
              >
                Switch to {viewMode === "canvas" ? "Flipbook" : "Folder"} View
              </button>
            )}
          </div>
          <hr className="w-350 border-black border-2 ml-5 mt-2" />
          <div className="flex gap-4 shrink-0 pl-4 self-end mt-2">
            <button
              className="text-black block hover:font-bold truncate"
              onClick={toggleNote}
            >
              {activeForm.isOpen ? "Close Note" : "New Note"}
            </button>
          </div>
        </div>
      </div>

      <div
        className={`flex-1 relative w-full ${
          activeForm.isOpen
            ? "overflow-y-auto custom-scrollbar"
            : "overflow-hidden"
        }`}
      >
        {activeForm.isOpen ? (
          <BloggPageContainer
            groupId={activeForm.groupId}
            stackId={activeForm.stackId}
            selectedBlogg={activeForm.selectedBlogg}
          />
        ) : viewMode === "canvas" ? (
          <BloggCanvasUI onOpenForm={handleOpenFormFromCanvas} />
        ) : (
          <BlogFlipBookUI />
        )}
      </div>
    </div>
  );
};

export default BloggPage;
