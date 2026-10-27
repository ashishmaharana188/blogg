import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BloggSummary } from "../canvasView/bloggCanvasType";
import {
  createGroup,
  createStack,
  deleteBloggRequest,
  fetchBloggByGroupRequest,
  fetchBloggByIdRequest,
  fetchStackAndGroup,
} from "../../../services/canvasViewService";
import BloggPageContainer from "../../bloggForm/bloggPageContainer";
import type { BloggItem } from "../../../../../types/pageTypes";
import "./bloggFileExplorer.css";

type Stack = { stack_id: string; stack_name: string };
type Group = { group_id: string; group_name: string; stack_id: string };
type NoteRow = Partial<BloggSummary> & {
  blogg_id?: string;
  _id?: string;
  title?: string;
  stack_id?: string;
  group_id?: string;
};

type Props = {
  canEdit: boolean;
  newNoteRequestKey?: number;
  initialBlogg?: BloggItem | null;
  initialEditMode?: boolean;
  onExternalNoteHandled?: () => void;
};

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`bfe-chevron${open ? " is-open" : ""}`} viewBox="0 0 12 12" aria-hidden="true">
      <path d="m4 2.5 3.5 3.5L4 9.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg className="bfe-node-icon" viewBox="0 0 20 20" aria-hidden="true">
      {open ? (
        <path d="M2.1 5.6c0-.8.6-1.4 1.4-1.4h4.2l1.8 1.9h7c.8 0 1.4.6 1.4 1.4v7c0 .8-.6 1.4-1.4 1.4H3.5c-.8 0-1.4-.6-1.4-1.4V5.6Z" fill="currentColor" opacity=".92" />
      ) : (
        <path d="M2.1 5.4c0-.7.6-1.3 1.3-1.3h4.1l1.8 1.8h7.2c.7 0 1.3.6 1.3 1.3v7.1c0 .7-.6 1.3-1.3 1.3H3.4c-.7 0-1.3-.6-1.3-1.3V5.4Z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg className="bfe-node-icon bfe-file-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 2.8h6.4L15.5 7v10.1H5z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M11.2 2.9V7h4.1M7.4 10h5.7M7.4 12.8h5.7" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function ToolbarIcon({ kind }: { kind: "note" | "stack" | "folder" | "sort" | "collapse" | "minimize" | "expand" }) {
  if (kind === "note") return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11.8 3.2H4.2c-.7 0-1.2.5-1.2 1.2v11.4c0 .7.5 1.2 1.2 1.2h11.4c.7 0 1.2-.5 1.2-1.2V9.4M7.1 13l.5-3.1 7.8-7.8a1.6 1.6 0 0 1 2.3 2.3l-7.8 7.8z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  if (kind === "stack") return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2.7 7 3.6-7 3.6-7-3.6zM3 10l7 3.6 7-3.6M3 13.7l7 3.6 7-3.6" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  if (kind === "folder") return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 5.2c0-.7.5-1.2 1.2-1.2h4l1.6 1.7h7c.7 0 1.2.5 1.2 1.2v8c0 .7-.5 1.2-1.2 1.2H3.7c-.7 0-1.2-.5-1.2-1.2zM10 8v5M7.5 10.5h5" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  if (kind === "sort") return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.2 4.2h7.5M4.2 7.4h5.6M4.2 10.6h3.8M13.8 4v11M10.8 12l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  if (kind === "minimize") return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4h14M3 8h14M3 12h9M3 16h9M15 11v6M12 14h6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  if (kind === "expand") return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4h14M3 8h6M3 12h6M3 16h6M13 11v6M10 14h6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5.2h14M3 9.8h14M3 14.4h14M5.5 3v4.4M14.5 12.2v4.4" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
}

export default function BloggFileExplorer({
  canEdit,
  newNoteRequestKey = 0,
  initialBlogg = null,
  initialEditMode = false,
  onExternalNoteHandled,
}: Props) {
  const [stacks, setStacks] = useState<Stack[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [expandedStacks, setExpandedStacks] = useState<Record<string, boolean>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [notesByGroup, setNotesByGroup] = useState<Record<string, NoteRow[]>>({});
  const [loadingGroups, setLoadingGroups] = useState<Record<string, boolean>>({});
  const [failedGroups, setFailedGroups] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [sortAscending, setSortAscending] = useState(true);
  const [selectedStackId, setSelectedStackId] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedNoteId, setSelectedNoteId] = useState("");
  const [selectedBlogg, setSelectedBlogg] = useState<BloggItem | null>(null);
  const [selectedEditMode, setSelectedEditMode] = useState(false);
  const [isBlankNoteOpen, setIsBlankNoteOpen] = useState(false);
  const [selectedNoteLoading, setSelectedNoteLoading] = useState(false);
  const [selectedNoteError, setSelectedNoteError] = useState("");
  const [deletingNoteIds, setDeletingNoteIds] = useState<Record<string, boolean>>({});
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const viewportWidth = typeof window === "undefined" ? 1200 : window.innerWidth;
    const maxWidth = Math.max(190, Math.min(700, viewportWidth * 0.72));
    const defaultWidth = viewportWidth <= 540 ? Math.min(260, maxWidth) : 320;
    try {
      const savedWidth = Number(window.localStorage.getItem("blogg-file-explorer-sidebar-width"));
      return Number.isFinite(savedWidth) && savedWidth > 0
        ? Math.min(Math.max(savedWidth, 190), maxWidth)
        : defaultWidth;
    } catch {
      return defaultWidth;
    }
  });
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const handledNewNoteRequestKey = useRef(0);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "blogg-file-explorer-sidebar-width",
        String(Math.round(sidebarWidth)),
      );
    } catch {
      // Keep resizing available when local storage is blocked.
    }
  }, [sidebarWidth]);

  const resizeSidebar = (event: React.PointerEvent<HTMLDivElement>) => {
    const root = event.currentTarget.parentElement;
    if (!root) return;
    const bounds = root.getBoundingClientRect();
    const maxWidth = Math.max(190, Math.min(700, window.innerWidth * 0.72));
    setSidebarWidth(Math.min(Math.max(event.clientX - bounds.left, 190), maxWidth));
  };

  const changeSidebarWidthByKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const delta = event.key === "ArrowLeft" ? -16 : 16;
      const maxWidth = Math.max(190, Math.min(700, window.innerWidth * 0.72));
      setSidebarWidth((current) => Math.min(Math.max(current + delta, 190), maxWidth));
    } else if (event.key === "Home") {
      event.preventDefault();
      setSidebarWidth(190);
    } else if (event.key === "End") {
      event.preventDefault();
      setSidebarWidth(Math.max(190, Math.min(700, window.innerWidth * 0.72)));
    }
  };

  const beginNewNote = useCallback(() => {
    if (!canEdit) return;

    const selectedGroup = groups.find(
      (group) => String(group.group_id) === String(selectedGroupId),
    );
    let destination = selectedGroup;

    if (!destination) {
      const candidates = (selectedStackId
        ? groups.filter((group) => String(group.stack_id) === String(selectedStackId))
        : [...groups]
      ).sort((a, b) => a.group_name.localeCompare(b.group_name));

      if (candidates.length === 1) {
        destination = candidates[0];
      } else if (candidates.length > 1) {
        const choices = candidates.map((group, index) => {
          const stackName = stacks.find(
            (stack) => String(stack.stack_id) === String(group.stack_id),
          )?.stack_name || "Unknown stack";
          return `${index + 1}. ${stackName} / ${group.group_name}`;
        }).join("; ");
        const answer = window.prompt(
          "Choose the folder for the new note by number: " + choices,
        );
        if (answer === null) return;
        const choice = Number(answer);
        if (!Number.isInteger(choice) || choice < 1 || choice > candidates.length) {
          window.alert("Enter one of the folder numbers shown.");
          return;
        }
        destination = candidates[choice - 1];
      }
    }

    if (!destination) {
      window.alert("Create a stack and folder first, or select an existing folder.");
      return;
    }

    const group = destination;
    setSelectedStackId(group.stack_id);
    setSelectedGroupId(group.group_id);
    setExpandedStacks((current) => ({ ...current, [group.stack_id]: true }));
    setExpandedGroups((current) => ({ ...current, [group.group_id]: true }));
    setSelectedNoteId("");
    setSelectedBlogg(null);
    setSelectedEditMode(true);
    setIsBlankNoteOpen(true);
    setSelectedNoteLoading(false);
    setSelectedNoteError("");
  }, [canEdit, groups, selectedGroupId, selectedStackId, stacks]);

  useEffect(() => {
    if (!initialBlogg) return;
    setSelectedBlogg(initialBlogg);
    setSelectedEditMode(Boolean(canEdit && initialEditMode));
    setIsBlankNoteOpen(false);
    setSelectedNoteId(String(initialBlogg.blogg_id || initialBlogg._id || ""));
    if (initialBlogg.stack_id) {
      setSelectedStackId(initialBlogg.stack_id);
      setExpandedStacks((current) => ({ ...current, [initialBlogg.stack_id]: true }));
    }
    if (initialBlogg.group_id) {
      setSelectedGroupId(initialBlogg.group_id);
      setExpandedGroups((current) => ({ ...current, [initialBlogg.group_id]: true }));
    }
    onExternalNoteHandled?.();
  }, [initialBlogg, initialEditMode, canEdit, onExternalNoteHandled]);

  useEffect(() => {
    if (
      newNoteRequestKey <= 0 ||
      loading ||
      handledNewNoteRequestKey.current === newNoteRequestKey
    ) return;
    handledNewNoteRequestKey.current = newNoteRequestKey;
    beginNewNote();
  }, [newNoteRequestKey, beginNewNote, loading]);

  const openNoteInWorkspace = useCallback(async (
    noteId: string,
    stackId: string,
    groupId: string,
    editMode = canEdit,
  ) => {
    if (!noteId) return;
    setSelectedNoteLoading(true);
    setSelectedNoteError("");
    setSelectedBlogg(null);
    setIsBlankNoteOpen(false);
    try {
      const note = await fetchBloggByIdRequest({ blogg_id: noteId });
      if (!note) {
        setSelectedNoteError("This note could not be found or is private.");
        return;
      }
      const fullNote = {
        ...note,
        blogg_id: String(note.blogg_id || note._id || noteId),
        stack_id: String(note.stack_id || stackId),
        group_id: String(note.group_id || groupId),
        title: note.title || "Untitled note",
      } as BloggItem;
      setSelectedBlogg(fullNote);
      setSelectedEditMode(Boolean(canEdit && editMode));
      setIsBlankNoteOpen(false);
      setSelectedStackId(fullNote.stack_id);
      setSelectedGroupId(fullNote.group_id);
    } catch (error) {
      console.error("Could not open note in File Explorer workspace:", error);
      setSelectedNoteError(error instanceof Error ? error.message : "Could not open this note.");
    } finally {
      setSelectedNoteLoading(false);
    }
  }, [canEdit]);

  const closeWorkspaceNote = useCallback(() => {
    setSelectedBlogg(null);
    setSelectedEditMode(false);
    setIsBlankNoteOpen(false);
    setSelectedNoteLoading(false);
    setSelectedNoteError("");
  }, []);

  const deleteNoteFromExplorer = useCallback(async (noteId: string, groupId: string) => {
    if (!canEdit || !noteId || deletingNoteIds[noteId]) return;
    const confirmed = window.confirm("Permanently delete this note? This cannot be undone.");
    if (!confirmed) return;

    setDeletingNoteIds((current) => ({ ...current, [noteId]: true }));
    try {
      await deleteBloggRequest({ blogg_id: noteId });
      setNotesByGroup((current) => ({
        ...current,
        [groupId]: (current[groupId] || []).filter(
          (note) => String(note.blogg_id || note._id || "") !== noteId,
        ),
      }));
      if (selectedNoteId === noteId) {
        closeWorkspaceNote();
        setSelectedNoteId("");
      }
    } catch (error) {
      console.error("Could not delete File Explorer note:", error);
      window.alert(error instanceof Error ? error.message : "Could not delete note.");
    } finally {
      setDeletingNoteIds((current) => {
        const next = { ...current };
        delete next[noteId];
        return next;
      });
    }
  }, [canEdit, closeWorkspaceNote, deletingNoteIds, selectedNoteId]);

  const reloadTree = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await fetchStackAndGroup({ publicReadOnly: !canEdit });
      const nextStacks = Array.isArray(data?.stacks) ? data.stacks as Stack[] : [];
      const nextGroups = Array.isArray(data?.groups) ? data.groups as Group[] : [];
      setStacks(nextStacks);
      setGroups(nextGroups);
      setExpandedStacks(Object.fromEntries(nextStacks.map((stack) => [stack.stack_id, true])));
    } catch (error) {
      console.error("Could not load file explorer:", error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [canEdit]);

  useEffect(() => {
    void reloadTree();
  }, [reloadTree]);

  const loadGroupNotes = useCallback(async (groupId: string) => {
    if (Object.prototype.hasOwnProperty.call(notesByGroup, groupId) || loadingGroups[groupId]) return;
    setLoadingGroups((current) => ({ ...current, [groupId]: true }));
    setFailedGroups((current) => ({ ...current, [groupId]: false }));
    try {
      const result = await fetchBloggByGroupRequest({ group_id: groupId });
      setNotesByGroup((current) => ({
        ...current,
        [groupId]: Array.isArray(result) ? result as NoteRow[] : [],
      }));
    } catch (error) {
      console.error("Could not load notes for file explorer folder:", error);
      setFailedGroups((current) => ({ ...current, [groupId]: true }));
    } finally {
      setLoadingGroups((current) => ({ ...current, [groupId]: false }));
    }
  }, [loadingGroups, notesByGroup]);

  const sortedStacks = useMemo(() => {
    const result = [...stacks].sort((a, b) => a.stack_name.localeCompare(b.stack_name));
    return sortAscending ? result : result.reverse();
  }, [sortAscending, stacks]);

  const groupsForStack = useCallback((stackId: string) => {
    const result = groups.filter((group) => String(group.stack_id) === String(stackId))
      .sort((a, b) => a.group_name.localeCompare(b.group_name));
    return sortAscending ? result : result.reverse();
  }, [groups, sortAscending]);

  const toggleStack = (stack: Stack) => {
    setSelectedStackId(stack.stack_id);
    setSelectedGroupId("");
    setExpandedStacks((current) => ({ ...current, [stack.stack_id]: !current[stack.stack_id] }));
  };

  const toggleGroup = (group: Group) => {
    const willOpen = !expandedGroups[group.group_id];
    setSelectedStackId(group.stack_id);
    setSelectedGroupId(group.group_id);
    setExpandedStacks((current) => ({ ...current, [group.stack_id]: true }));
    setExpandedGroups((current) => ({ ...current, [group.group_id]: willOpen }));
    if (willOpen) void loadGroupNotes(group.group_id);
  };

  const handleCreateStack = async () => {
    if (!canEdit) return;
    const stackName = window.prompt("New stack name");
    if (!stackName?.trim()) return;

    const draft: Stack = {
      stack_id: crypto.randomUUID(),
      stack_name: stackName.trim(),
    };
    try {
      const saved = await createStack(draft);
      const created = (saved || draft) as Stack;
      setStacks((current) => [...current, created]);
      setSelectedStackId(created.stack_id);
      setSelectedGroupId("");
      setExpandedStacks((current) => ({ ...current, [created.stack_id]: true }));
    } catch (error) {
      console.error("Could not create file explorer stack:", error);
      window.alert(error instanceof Error ? error.message : "Could not create stack.");
    }
  };

  const handleCreateFolder = async () => {
    if (!canEdit) return;
    if (!selectedStackId) {
      window.alert("Select a stack first, or create a new stack.");
      return;
    }

    const groupName = window.prompt("New folder name");
    if (!groupName?.trim()) return;
    const draft: Group = {
      group_id: crypto.randomUUID(),
      stack_id: selectedStackId,
      group_name: groupName.trim(),
    };
    try {
      const saved = await createGroup(draft);
      const created = (saved || draft) as Group;
      setGroups((current) => [...current, created]);
      setSelectedGroupId(created.group_id);
      setExpandedStacks((current) => ({ ...current, [selectedStackId]: true }));
      setExpandedGroups((current) => ({ ...current, [created.group_id]: true }));
      setNotesByGroup((current) => ({ ...current, [created.group_id]: [] }));
    } catch (error) {
      console.error("Could not create file explorer folder:", error);
      window.alert(error instanceof Error ? error.message : "Could not create folder.");
    }
  };

  const refreshGroupNotes = useCallback(async (groupId: string) => {
    try {
      const result = await fetchBloggByGroupRequest({ group_id: groupId });
      setNotesByGroup((current) => ({
        ...current,
        [groupId]: Array.isArray(result) ? result as NoteRow[] : [],
      }));
      setFailedGroups((current) => ({ ...current, [groupId]: false }));
    } catch (error) {
      console.error("Could not refresh notes after save:", error);
      setFailedGroups((current) => ({ ...current, [groupId]: true }));
    }
  }, []);

  const handleWorkspaceAutoSaved = useCallback(() => {
    const groupId = String(selectedBlogg?.group_id || selectedGroupId || "");
    if (groupId) void refreshGroupNotes(groupId);
  }, [refreshGroupNotes, selectedBlogg?.group_id, selectedGroupId]);

  const collapseAll = () => {
    setExpandedStacks({});
    setExpandedGroups({});
  };

  const getNotes = (groupId: string) => {
    const notes = [...(notesByGroup[groupId] || [])].sort((a, b) =>
      String(a.title || "").localeCompare(String(b.title || "")),
    );
    return sortAscending ? notes : notes.reverse();
  };

  return (
    <div className={`blogg-filesystem-view${isResizingSidebar ? " is-resizing-sidebar" : ""}${isSidebarCollapsed ? " is-sidebar-collapsed" : ""}`}>
      <aside
        className="bfe-sidebar"
        aria-label="File explorer"
        style={{
          flexBasis: isSidebarCollapsed ? "38px" : `${sidebarWidth}px`,
          width: isSidebarCollapsed ? "38px" : `${sidebarWidth}px`,
        }}
      >
        <div className="bfe-toolbar" role="toolbar" aria-label="File explorer actions">
          {isSidebarCollapsed ? (
            <button
              type="button"
              className="bfe-toolbar-button bfe-restore-sidebar-button"
              title="Restore file explorer"
              aria-label="Restore file explorer"
              aria-expanded={false}
              onClick={() => setIsSidebarCollapsed(false)}
            >
              <ToolbarIcon kind="expand" />
            </button>
          ) : (
          <>
          {canEdit && (
            <button type="button" className="bfe-toolbar-button" title="New note" aria-label="New note" onClick={beginNewNote}>
              <ToolbarIcon kind="note" />
            </button>
          )}
          {canEdit && (
            <button type="button" className="bfe-toolbar-button" title="New stack" aria-label="New stack" onClick={() => void handleCreateStack()}>
              <ToolbarIcon kind="stack" />
            </button>
          )}
          {canEdit && (
            <button type="button" className="bfe-toolbar-button" title={selectedStackId ? "New folder in selected stack" : "Select a stack to create a folder"} aria-label="New folder" onClick={() => void handleCreateFolder()}>
              <ToolbarIcon kind="folder" />
            </button>
          )}
          <button
            type="button"
            className="bfe-toolbar-button"
            title={sortAscending ? "Sort Z to A" : "Sort A to Z"}
            aria-label="Change file sorting order"
            onClick={() => setSortAscending((value) => !value)}
          >
            <ToolbarIcon kind="sort" />
          </button>
          <button type="button" className="bfe-toolbar-button" title="Collapse all folders" aria-label="Collapse all folders" onClick={collapseAll}>
            <ToolbarIcon kind="collapse" />
          </button>
          <button
            type="button"
            className="bfe-toolbar-button bfe-minimize-sidebar-button"
            title="Minimize file explorer"
            aria-label="Minimize file explorer"
            aria-expanded={true}
            onClick={() => setIsSidebarCollapsed(true)}
          >
            <ToolbarIcon kind="minimize" />
          </button>
          </>
          )}
        </div>

        <div className="bfe-tree-scroll">
          {loading ? (
            <div className="bfe-status">Loading files…</div>
          ) : loadError ? (
            <div className="bfe-status">
              <span>Files could not be loaded.</span>
              <button type="button" onClick={() => void reloadTree()}>Retry</button>
            </div>
          ) : sortedStacks.length === 0 ? (
            <div className="bfe-status">No folders yet.</div>
          ) : (
            <div className="bfe-tree" role="tree" aria-label="Folders and notes">
              {sortedStacks.map((stack) => {
                const stackOpen = Boolean(expandedStacks[stack.stack_id]);
                const stackGroups = groupsForStack(stack.stack_id);
                return (
                  <div key={stack.stack_id} className="bfe-stack-node">
                    <button
                      type="button"
                      role="treeitem"
                      aria-expanded={stackOpen}
                      className={`bfe-row bfe-stack-row${selectedStackId === stack.stack_id ? " is-selected" : ""}`}
                      onClick={() => toggleStack(stack)}
                    >
                      <Chevron open={stackOpen} />
                      <FolderIcon open={stackOpen} />
                      <span className="bfe-row-label">{stack.stack_name}</span>
                    </button>
                    {stackOpen && (
                      <div className="bfe-stack-children" role="group">
                        {stackGroups.length === 0 ? (
                          <div className="bfe-empty-folder">Empty folder</div>
                        ) : stackGroups.map((group) => {
                          const groupOpen = Boolean(expandedGroups[group.group_id]);
                          const groupLoading = Boolean(loadingGroups[group.group_id]);
                          const notes = getNotes(group.group_id);
                          return (
                            <div key={group.group_id} className="bfe-group-node">
                              <button
                                type="button"
                                role="treeitem"
                                aria-expanded={groupOpen}
                                className={`bfe-row bfe-group-row${selectedGroupId === group.group_id ? " is-selected" : ""}`}
                                onClick={() => toggleGroup(group)}
                              >
                                <Chevron open={groupOpen} />
                                <FolderIcon open={groupOpen} />
                                <span className="bfe-row-label">{group.group_name}</span>
                              </button>
                              {groupOpen && (
                                <div className="bfe-group-children" role="group">
                                  {groupLoading ? (
                                    <div className="bfe-empty-folder">Loading notes…</div>
                                  ) : failedGroups[group.group_id] ? (
                                    <button className="bfe-retry-row" type="button" onClick={() => void loadGroupNotes(group.group_id)}>Retry loading notes</button>
                                  ) : notes.length === 0 ? (
                                    <div className="bfe-empty-folder">No notes</div>
                                  ) : notes.map((note, index) => {
                                    const noteId = String(note.blogg_id || note._id || `${group.group_id}-${index}`);
                                    return (
                                      <div
                                        key={noteId}
                                        role="treeitem"
                                        aria-selected={selectedNoteId === noteId}
                                        className={`bfe-row bfe-note-row${selectedNoteId === noteId ? " is-selected" : ""}`}
                                      >
                                        <button
                                          type="button"
                                          className="bfe-note-open-button"
                                          title={note.title || "Untitled note"}
                                          onClick={() => {
                                            setSelectedNoteId(noteId);
                                            void openNoteInWorkspace(
                                              noteId,
                                              String(note.stack_id || stack.stack_id),
                                              String(note.group_id || group.group_id),
                                              canEdit,
                                            );
                                          }}
                                        >
                                          <span className="bfe-file-spacer" aria-hidden="true" />
                                          <NoteIcon />
                                          <span className="bfe-row-label">{note.title || "Untitled note"}</span>
                                        </button>
                                        {canEdit && (
                                          <button
                                            type="button"
                                            className="bfe-note-delete-button"
                                            title={deletingNoteIds[noteId] ? "Deleting note…" : "Delete note"}
                                            aria-label={`Delete note ${note.title || "Untitled note"}`}
                                            disabled={Boolean(deletingNoteIds[noteId])}
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              void deleteNoteFromExplorer(
                                                noteId,
                                                String(note.group_id || group.group_id),
                                              );
                                            }}
                                          >
                                            <svg viewBox="0 0 20 20" aria-hidden="true">
                                              <path d="M3.8 5.3h12.4M7.2 5.3V3.5h5.6v1.8m-7.6 0 .7 11.2h8.2l.7-11.2M8.1 8.1v5.7m3.8-5.7v5.7" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
                                            </svg>
                                          </button>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>
      <div
        className={`bfe-resize-handle${isResizingSidebar ? " is-active" : ""}`}
        role="separator"
        aria-label="Resize file explorer sidebar"
        aria-orientation="vertical"
        aria-valuemin={190}
        aria-valuemax={Math.max(190, Math.min(700, typeof window === "undefined" ? 700 : window.innerWidth * 0.72))}
        aria-valuenow={Math.round(sidebarWidth)}
        tabIndex={0}
        title="Drag to resize the file tree. Use ← and → to adjust; Home/End for min/max. Double-click to reset."
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          setIsResizingSidebar(true);
          resizeSidebar(event);
        }}
        onPointerMove={(event) => {
          if (isResizingSidebar && event.buttons !== 0) resizeSidebar(event);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          setIsResizingSidebar(false);
        }}
        onPointerCancel={() => setIsResizingSidebar(false)}
        onLostPointerCapture={() => setIsResizingSidebar(false)}
        onKeyDown={changeSidebarWidthByKeyboard}
        onDoubleClick={() => setSidebarWidth(typeof window !== "undefined" && window.innerWidth <= 540 ? 250 : 320)}
      />
      <main className={`bfe-workspace${selectedBlogg || isBlankNoteOpen ? " has-note" : ""}`} aria-label="File workspace">
        {selectedNoteLoading ? (
          <div className="bfe-workspace-state" role="status">Opening note…</div>
        ) : selectedNoteError ? (
          <div className="bfe-workspace-state" role="status">
            <span>{selectedNoteError}</span>
            <button type="button" onClick={closeWorkspaceNote}>Back to files</button>
          </div>
        ) : selectedBlogg || isBlankNoteOpen ? (
          <div className="bfe-note-pane">
            <div className="bfe-note-pane-toolbar">
              <span className="bfe-note-pane-title">
                {selectedBlogg?.title || "New note"}
              </span>
              <button
                type="button"
                className="bfe-note-pane-close"
                onClick={closeWorkspaceNote}
                aria-label="Close note and return to files"
                title="Back to File Explorer"
              >
                ×
              </button>
            </div>
            <div className="bfe-note-form">
              <BloggPageContainer
                key={String(selectedBlogg?.blogg_id || selectedBlogg?._id || "new-file-explorer-note")}
                stackId={selectedBlogg?.stack_id || selectedStackId || null}
                groupId={selectedBlogg?.group_id || selectedGroupId || null}
                selectedBlogg={selectedBlogg}
                initialEditMode={Boolean(canEdit && selectedEditMode)}
                canEdit={canEdit}
                onSaved={closeWorkspaceNote}
                onAutoSaved={handleWorkspaceAutoSaved}
              />
            </div>
          </div>
        ) : (
          <div className="bfe-workspace-empty">
            <span className="bfe-workspace-empty-mark" aria-hidden="true">↖</span>
            <p>Select a note to open it here</p>
            {canEdit && <span>New notes open in this workspace too.</span>}
          </div>
        )}
      </main>
    </div>
  );
}
