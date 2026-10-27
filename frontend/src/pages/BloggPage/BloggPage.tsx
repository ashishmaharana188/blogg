import { useState, useCallback, useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import BloggPageContainer from "./components/bloggForm/bloggPageContainer";
import BlogFlipBookUI from "./components/bloggProfile/flipBook/bloggFlipBookUI";
import BloggCanvasUI from "./components/bloggProfile/canvasView/bloggCanvasUI";
import BloggFileExplorer from "./components/bloggProfile/fileExplorer/BloggFileExplorer";
import BloggMindMap from "./components/bloggProfile/mindMap/BloggMindMap";
import BloggHeader from "./components/bloggHeader/BloggHeader";
import type { BloggSummary } from "./components/bloggProfile/canvasView/bloggCanvasType";
import type { BloggItem } from "../../types/pageTypes";
import { fetchBloggByIdRequest, fetchStackAndGroup } from "./services/canvasViewService";
import { useAuth } from "../../context/authContext";
import "./components/bloggProfile/canvasView/canvasReadOnly.css";
import "./components/bloggProfile/flipBook/flipBookFilters.css";

type ViewMode = "canvas" | "flipbook" | "filesystem";
type FlipBookStack = { stack_id: string; stack_name: string };
type FlipBookGroup = { group_id: string; group_name: string; stack_id: string };

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
    searchParams.get("view") === "flipbook" ? "flipbook" : searchParams.get("view") === "filesystem" ? "filesystem" : "canvas",
  );
  const [canvasRefreshKey, setCanvasRefreshKey] = useState(0);
  const [isMindMapOpen, setIsMindMapOpen] = useState(
    () => searchParams.get("view") === "mindmap",
  );
  const [flipBookStacks, setFlipBookStacks] = useState<FlipBookStack[]>([]);
  const [flipBookGroups, setFlipBookGroups] = useState<FlipBookGroup[]>([]);
  const [filtersLoading, setFiltersLoading] = useState(true);
  const [filtersError, setFiltersError] = useState(false);

  const closeMindMap = useCallback(() => {
    setIsMindMapOpen(false);
    if (searchParams.get("view") !== "mindmap") return;
    const next = new URLSearchParams(searchParams);
    next.delete("view");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // Flipbook filters are URL-backed so refreshing or sharing the filtered view
  // never silently falls back to every note in every stack.
  const selectedStackId = searchParams.get("stackId") || "";
  const selectedGroupId = searchParams.get("groupId") || "";
  const availableGroups = flipBookGroups.filter(
    (group) => group.stack_id === selectedStackId,
  );
  const selectedGroup = availableGroups.find(
    (group) => group.group_id === selectedGroupId,
  );
  const hasValidFlipBookSelection = Boolean(selectedStackId && selectedGroup);

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

  const refreshCanvasAfterAutoSave = useCallback(() => {
    setCanvasRefreshKey((key) => key + 1);
  }, []);

  const toggleNote = useCallback(() => {
    if (!isAdmin) return;
    closeMindMap();
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
  }, [activeForm.isOpen, closeMindMap, isAdmin]);

  const toggleViewMode = useCallback(() => {
    closeMindMap();
    const nextMode: ViewMode = viewMode === "flipbook" ? "canvas" : "flipbook";
    setViewMode(nextMode);
    const next = new URLSearchParams(searchParams);
    if (nextMode === "flipbook") next.set("view", "flipbook");
    else next.delete("view");
    next.delete("noteId");
    setSearchParams(next, { replace: true });
  }, [closeMindMap, searchParams, setSearchParams, viewMode]);

  const toggleFileExplorer = useCallback(() => {
    closeMindMap();
    const nextMode: ViewMode = viewMode === "filesystem" ? "canvas" : "filesystem";
    setViewMode(nextMode);
    const next = new URLSearchParams(searchParams);
    if (nextMode === "filesystem") next.set("view", "filesystem");
    else next.delete("view");
    next.delete("noteId");
    setSearchParams(next, { replace: true });
  }, [closeMindMap, searchParams, setSearchParams, viewMode]);

  // Legacy flipbook note URLs should use the exact same Open note screen
  // as Blog Feed. Keep the selected stack/group so Back returns to this book.
  useEffect(() => {
    const legacyNoteId = bloggId || searchParams.get("noteId");
    if (!legacyNoteId) return;

    const next = new URLSearchParams();
    next.set("returnTo", "flipbook");
    const stackId = searchParams.get("stackId");
    const groupId = searchParams.get("groupId");
    if (stackId) next.set("stackId", stackId);
    if (groupId) next.set("groupId", groupId);
    navigate(`/read/${encodeURIComponent(legacyNoteId)}?${next.toString()}`, {
      replace: true,
    });
  }, [bloggId, navigate, searchParams]);

  useEffect(() => {
    let cancelled = false;
    setFiltersLoading(true);
    setFiltersError(false);
    fetchStackAndGroup({ publicReadOnly: true })
      .then((data) => {
        if (cancelled) return;
        setFlipBookStacks(Array.isArray(data?.stacks) ? data.stacks : []);
        setFlipBookGroups(Array.isArray(data?.groups) ? data.groups : []);
      })
      .catch((error) => {
        console.error("Could not load flipbook stack/group filters:", error);
        if (!cancelled) setFiltersError(true);
      })
      .finally(() => {
        if (!cancelled) setFiltersLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const handleFlipBookStackChange = useCallback((stackId: string) => {
    const next = new URLSearchParams();
    next.set("view", "flipbook");
    if (stackId) next.set("stackId", stackId);
    // A group belongs to one stack. Clear it every time the stack changes.
    setSearchParams(next, { replace: true });
    setViewMode("flipbook");
  }, [setSearchParams]);

  const handleFlipBookGroupChange = useCallback((groupId: string) => {
    const next = new URLSearchParams();
    next.set("view", "flipbook");
    if (selectedStackId) next.set("stackId", selectedStackId);
    if (groupId) next.set("groupId", groupId);
    setSearchParams(next, { replace: true });
    setViewMode("flipbook");
  }, [selectedStackId, setSearchParams]);

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
    // Resolve the persisted session before fetching direct read/edit links;
    // private notes are filtered by the backend for non-admin visitors.
    if ((editNoteId || readNoteId) && authLoading) return;
    const requestedNoteId = editNoteId || readNoteId;
    if (!requestedNoteId) return;

    const openInEditMode = Boolean(editNoteId) && isAdmin;
    let cancelled = false;
    const openNoteInReader = async () => {
      try {
        const note = await fetchBloggByIdRequest({ blogg_id: requestedNoteId });
        if (cancelled) return;
        if (!note) {
          window.alert("This note could not be found or is private.");
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
    if (!fullBlogg) return;
    setActiveForm({
      isOpen: true,
      stackId: fullBlogg.stack_id,
      groupId: fullBlogg.group_id,
      selectedBlogg: fullBlogg,
      initialEditMode: false,
    });
  };

  const handleOpenMindMapBlogg = useCallback(async (bloggId: string, edit = false) => {
    try {
      const fullBlogg = await fetchBloggByIdRequest({ blogg_id: bloggId });
      if (!fullBlogg) {
        window.alert("This blog could not be found or is private.");
        return;
      }
      closeMindMap();
      setActiveForm({
        isOpen: true,
        stackId: fullBlogg.stack_id ?? null,
        groupId: fullBlogg.group_id ?? null,
        selectedBlogg: fullBlogg as BloggItem,
        initialEditMode: Boolean(edit && isAdmin),
      });
    } catch (error) {
      console.error("Could not open blog from Mind Map:", error);
      window.alert("Could not open this blog. Please try again.");
    }
  }, [closeMindMap, isAdmin]);

  const handleEditFromFlipBook = useCallback((blogg: BloggItem) => {
    if (!isAdmin) return;
    setActiveForm({
      isOpen: true,
      stackId: blogg.stack_id,
      groupId: blogg.group_id,
      selectedBlogg: blogg,
      initialEditMode: true,
    });
  }, [isAdmin]);

  return (
    <div className="blogg-profile-root w-full h-full min-h-0 flex flex-col bg-white">
      <BloggHeader
        page="profile"
        viewMode={viewMode}
        isFormOpen={Boolean(activeForm.isOpen)}
        onToggleViewMode={toggleViewMode}
        onToggleFileExplorer={toggleFileExplorer}
        onNewNote={toggleNote}
      />

      <div
        className={`blogg-main-viewport flex-1 relative w-full min-h-0 ${
          activeForm.isOpen
            ? "overflow-hidden"
            : "overflow-hidden"
        }`}
      >
        {activeForm.isOpen ? (
          <div className={`blogg-form-host ${isAdmin ? "" : "public-readonly-note-form"} h-full min-h-0 w-full overflow-hidden`}>
            <BloggPageContainer
              key={activeForm.selectedBlogg?.blogg_id || activeForm.selectedBlogg?._id || "new-note"}
              groupId={activeForm.groupId}
              stackId={activeForm.stackId}
              selectedBlogg={activeForm.selectedBlogg}
              initialEditMode={activeForm.initialEditMode}
              canEdit={isAdmin}
              onSaved={closeFormAfterSave}
              onAutoSaved={refreshCanvasAfterAutoSave}
            />
          </div>
        ) : isMindMapOpen ? (
          <BloggMindMap
            onBack={closeMindMap}
            canEdit={isAdmin}
            onOpenBlogg={(bloggId, edit) => void handleOpenMindMapBlogg(bloggId, edit)}
          />
        ) : viewMode === "canvas" ? (
          <div className="absolute inset-0">
            <div className={isAdmin ? "absolute inset-0" : "absolute inset-0 canvas-readonly-scope"}>
              <BloggCanvasUI
                key={canvasRefreshKey}
                onOpenForm={handleOpenFormFromCanvas}
              />
            </div>
            <button
              type="button"
              onClick={() => setIsMindMapOpen(true)}
              aria-label="Open Mind Map"
              title="Open Mind Map"
              className="absolute right-[76px] top-9 z-[3000] bg-transparent p-0 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600 shadow-none transition-colors hover:text-slate-950 hover:underline hover:underline-offset-4 focus:outline-none focus-visible:underline"
            >
              <span>Open Mind Map</span>
            </button>
          </div>
        ) : viewMode === "filesystem" ? (
          <div className="absolute inset-0">
            <BloggFileExplorer
              key={canvasRefreshKey}
              canEdit={isAdmin}
              onNewNote={toggleNote}
              onOpenNote={(blogg) => {
                void handleOpenFormFromCanvas(blogg.stack_id, blogg.group_id, blogg);
              }}
            />
          </div>
        ) : (
          <div className="flipbook-page-shell">
            <div className="flipbook-filter-bar" aria-label="Choose flipbook content">
              <div className="flipbook-filter-field">
                <label htmlFor="flipbook-stack-select">Stack</label>
                <select
                  id="flipbook-stack-select"
                  value={selectedStackId}
                  onChange={(event) => handleFlipBookStackChange(event.target.value)}
                  disabled={filtersLoading || flipBookStacks.length === 0}
                >
                  <option value="">{filtersLoading ? "Loading stacks…" : "Select a stack"}</option>
                  {flipBookStacks.map((stack) => (
                    <option key={stack.stack_id} value={stack.stack_id}>{stack.stack_name}</option>
                  ))}
                </select>
              </div>
              <div className="flipbook-filter-field">
                <label htmlFor="flipbook-group-select">Group</label>
                <select
                  id="flipbook-group-select"
                  value={selectedGroup?.group_id || ""}
                  onChange={(event) => handleFlipBookGroupChange(event.target.value)}
                  disabled={filtersLoading || !selectedStackId || availableGroups.length === 0}
                >
                  <option value="">{!selectedStackId ? "Select a stack first" : "Select a group"}</option>
                  {availableGroups.map((group) => (
                    <option key={group.group_id} value={group.group_id}>{group.group_name}</option>
                  ))}
                </select>
              </div>
            </div>
            {filtersError ? (
              <div className="flipbook-filter-empty" role="status">
                <p>Stack and group filters could not be loaded.</p>
                <button type="button" onClick={() => window.location.reload()}>Retry</button>
              </div>
            ) : filtersLoading ? (
              <div className="flipbook-filter-empty" role="status">Loading stacks and groups…</div>
            ) : hasValidFlipBookSelection ? (
              <div className="flipbook-content-area">
                <BlogFlipBookUI
                  key={`${selectedStackId}:${selectedGroupId}`}
                  onOpenBlogg={(blogg) => {
                    const noteId = blogg.blogg_id || blogg._id;
                    const next = new URLSearchParams();
                    next.set("returnTo", "flipbook");
                    next.set("stackId", selectedStackId);
                    next.set("groupId", selectedGroupId);
                    navigate(`/read/${encodeURIComponent(noteId)}?${next.toString()}`);
                  }}
                  onBackFromBlogg={() => navigate(`/blog?view=flipbook&stackId=${encodeURIComponent(selectedStackId)}&groupId=${encodeURIComponent(selectedGroupId)}`)}
                  onOpenInReader={(blogg) => {
                    const noteId = blogg.blogg_id || blogg._id;
                    const next = new URLSearchParams();
                    next.set("returnTo", "flipbook");
                    next.set("stackId", selectedStackId);
                    next.set("groupId", selectedGroupId);
                    navigate(`/read/${encodeURIComponent(noteId)}?${next.toString()}`);
                  }}
                  onEditBlogg={isAdmin ? handleEditFromFlipBook : undefined}
                />
              </div>
            ) : (
              <div className="flipbook-filter-empty" role="status">
                {flipBookStacks.length === 0
                  ? "No stacks are available yet. Create a stack and group first."
                  : selectedStackId && availableGroups.length === 0
                    ? "This stack has no groups yet. Create a group first."
                    : "Select a stack and a group to display its blogs."}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default BloggPage;
