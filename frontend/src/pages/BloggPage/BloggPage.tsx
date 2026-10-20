import { useState, useCallback, useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import BloggPageContainer from "./components/bloggForm/bloggPageContainer";
import BlogFlipBookUI from "./components/bloggProfile/flipBook/bloggFlipBookUI";
import BloggCanvasUI from "./components/bloggProfile/canvasView/bloggCanvasUI";
import BloggHeader from "./components/bloggHeader/BloggHeader";
import type { BloggSummary } from "./components/bloggProfile/canvasView/bloggCanvasType";
import type { BloggItem } from "../../types/pageTypes";
import { fetchBloggByIdRequest } from "./services/canvasViewService";
import { useAuth } from "../../context/authContext";
import "./components/bloggProfile/canvasView/canvasReadOnly.css";

type ViewMode = "canvas" | "flipbook";

const BloggPage = () => {
  const navigate = useNavigate();
  const { isAdmin, loading: authLoading } = useAuth();
  const { bloggId } = useParams<{ bloggId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeForm, setActiveForm] = useState<{
    isOpen?: boolean;
    stackId?: string | null;
    groupId?: string | null;
    selectedBlogg: BloggItem | null;
    initialEditMode?: boolean;
  }>({
    isOpen: false,
    stackId: null,
    groupId: null,
    selectedBlogg: null,
    initialEditMode: false,
  });
  const [viewMode, setViewMode] = useState<ViewMode>(
    bloggId || searchParams.get("view") === "flipbook" ? "flipbook" : "canvas",
  );
  const [canvasRefreshKey, setCanvasRefreshKey] = useState(0);

  // Keep an opened Flipbook note in the /blog route using a query parameter.
  // This preserves the current React tree and book instance instead of
  // switching between the sibling /blog and /blog/:bloggId routes.
  const openedNoteId = bloggId || searchParams.get("noteId") || undefined;

  const closeFormAfterSave = useCallback(() => {
    setActiveForm({
      isOpen: false,
      stackId: null,
      groupId: null,
      selectedBlogg: null,
      initialEditMode: false,
    });
    setCanvasRefreshKey((key) => key + 1);
  }, []);

  const toggleNote = useCallback(() => {
    if (!isAdmin) return;
    if (activeForm.isOpen) {
      setActiveForm((prev) => ({ ...prev, isOpen: false }));
      return;
    }
    setActiveForm({
      isOpen: true,
      // The backend resolves a missing destination to the default Others folder.
      stackId: null,
      groupId: null,
      selectedBlogg: null,
      initialEditMode: false,
    });
  }, [activeForm.isOpen, isAdmin]);

  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => (prev === "canvas" ? "flipbook" : "canvas"));
  }, []);

  useEffect(() => {
    if (bloggId) {
      setViewMode("flipbook");
      setActiveForm((prev) => prev.isOpen ? {
        isOpen: false,
        stackId: null,
        groupId: null,
        selectedBlogg: null,
        initialEditMode: false,
      } : prev);
    }
  }, [bloggId]);

  // The shared header's New Note button carries this flag from Blog Feed.
  useEffect(() => {
    if (searchParams.get("newNote") !== "1") return;
    if (!isAdmin) {
      const next = new URLSearchParams(searchParams);
      next.delete("newNote");
      setSearchParams(next, { replace: true });
      return;
    }
    setActiveForm({
      isOpen: true,
      stackId: null,
      groupId: null,
      selectedBlogg: null,
      initialEditMode: false,
    });
    const next = new URLSearchParams(searchParams);
    next.delete("newNote");
    setSearchParams(next, { replace: true });
  }, [isAdmin, searchParams, setSearchParams]);

  // Reuse the Folder/Canvas BlockNote form for both readable view and direct
  // editing. Edit mode is enabled only for an authenticated administrator.
  useEffect(() => {
    const editNoteId = searchParams.get("editNote");
    const readNoteId = searchParams.get("readNote");
    // Wait until the persisted session has been resolved before deciding
    // whether a direct edit link should open in editable mode.
    if (editNoteId && authLoading) return;
    const requestedNoteId = editNoteId || readNoteId;
    if (!requestedNoteId) return;

    const openInEditMode = Boolean(editNoteId) && isAdmin;
    let cancelled = false;
    const openNoteInReader = async () => {
      try {
        const note = await fetchBloggByIdRequest({ blogg_id: requestedNoteId });
        if (cancelled) return;
        if (!note) {
          window.alert("This note could not be found.");
          return;
        }

        setViewMode("canvas");
        setActiveForm({
          isOpen: true,
          stackId: note.stack_id ?? null,
          groupId: note.group_id ?? null,
          selectedBlogg: note as BloggItem,
          initialEditMode: openInEditMode,
        });

        const next = new URLSearchParams(searchParams);
        next.delete("readNote");
        next.delete("editNote");
        setSearchParams(next, { replace: true });
      } catch (error) {
        console.error("Could not open note in BlockNote view:", error);
        if (!cancelled) window.alert("Could not open this note. Please try again.");
      }
    };

    void openNoteInReader();
    return () => { cancelled = true; };
  }, [authLoading, isAdmin, searchParams, setSearchParams]);

  const handleOpenFormFromCanvas = async (
    stackId: string,
    groupId: string,
    blogg?: BloggSummary,
  ) => {
    if (!blogg) {
      if (!isAdmin) return;
      setActiveForm({
        isOpen: true,
        stackId,
        groupId,
        selectedBlogg: null,
        initialEditMode: false,
      });
      return;
    }

    const fullBlogg = await fetchBloggByIdRequest({ blogg_id: blogg.blogg_id });
    setActiveForm({
      isOpen: true,
      stackId: fullBlogg.stack_id,
      groupId: fullBlogg.group_id,
      selectedBlogg: fullBlogg,
      initialEditMode: false,
    });
  };

  const handleEditFromFlipBook = useCallback((blogg: BloggItem) => {
    setActiveForm({
      isOpen: true,
      stackId: blogg.stack_id,
      groupId: blogg.group_id,
      selectedBlogg: blogg,
      initialEditMode: true,
    });
  }, []);

  return (
    <div className="w-full h-full flex flex-col bg-white">
      <BloggHeader
        page="profile"
        viewMode={viewMode}
        isFormOpen={Boolean(activeForm.isOpen)}
        onToggleViewMode={toggleViewMode}
        onNewNote={toggleNote}
      />

      <div
        className={`flex-1 relative w-full ${
          activeForm.isOpen
            ? "overflow-y-auto custom-scrollbar"
            : "overflow-hidden"
        }`}
      >
        {activeForm.isOpen ? (
          <div className={isAdmin ? "h-full" : "h-full public-readonly-note-form"}>
            <BloggPageContainer
              groupId={activeForm.groupId}
              stackId={activeForm.stackId}
              selectedBlogg={activeForm.selectedBlogg}
              initialEditMode={activeForm.initialEditMode}
              onSaved={closeFormAfterSave}
            />
          </div>
        ) : viewMode === "canvas" && !bloggId ? (
          <div className={isAdmin ? "absolute inset-0" : "absolute inset-0 canvas-readonly-scope"}>
            <BloggCanvasUI
              key={canvasRefreshKey}
              onOpenForm={handleOpenFormFromCanvas}
            />
          </div>
        ) : (
          <BlogFlipBookUI
            initialBloggId={openedNoteId}
            onOpenBlogg={(blogg) => {
              const noteId = blogg.blogg_id || blogg._id;
              navigate(`/blog?view=flipbook&noteId=${encodeURIComponent(noteId)}`);
            }}
            onBackFromBlogg={() => navigate("/blog?view=flipbook")}
            onOpenInReader={(blogg) => navigate(`/blog?readNote=${encodeURIComponent(blogg.blogg_id || blogg._id)}`)}
            onEditBlogg={isAdmin ? handleEditFromFlipBook : undefined}
          />
        )}
      </div>
    </div>
  );
};

export default BloggPage;
