import { useCallback, useEffect, useMemo, useState } from "react";
import type { BloggSummary } from "../canvasView/bloggCanvasType";
import {
  createGroup,
  createStack,
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
  onNewNote: () => void;
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

function ToolbarIcon({ kind }: { kind: "note" | "folder" | "sort" | "collapse" }) {
  if (kind === "note") return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11.8 3.2H4.2c-.7 0-1.2.5-1.2 1.2v11.4c0 .7.5 1.2 1.2 1.2h11.4c.7 0 1.2-.5 1.2-1.2V9.4M7.1 13l.5-3.1 7.8-7.8a1.6 1.6 0 0 1 2.3 2.3l-7.8 7.8z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  if (kind === "folder") return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 5.2c0-.7.5-1.2 1.2-1.2h4l1.6 1.7h7c.7 0 1.2.5 1.2 1.2v8c0 .7-.5 1.2-1.2 1.2H3.7c-.7 0-1.2-.5-1.2-1.2zM10 8v5M7.5 10.5h5" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  if (kind === "sort") return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.2 4.2h7.5M4.2 7.4h5.6M4.2 10.6h3.8M13.8 4v11M10.8 12l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5.2h14M3 9.8h14M3 14.4h14M5.5 3v4.4M14.5 12.2v4.4" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
}

export default function BloggFileExplorer({
  canEdit,
  onNewNote,
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
    if (newNoteRequestKey <= 0) return;
    setSelectedBlogg(null);
    setSelectedEditMode(canEdit);
    setIsBlankNoteOpen(true);
    setSelectedNoteLoading(false);
    setSelectedNoteError("");
  }, [newNoteRequestKey, canEdit]);

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

  const handleCreateFolder = async () => {
    if (!canEdit) return;
    try {
      if (selectedStackId) {
        const groupName = window.prompt("New folder name");
        if (!groupName?.trim()) return;
        const draft: Group = {
          group_id: crypto.randomUUID(),
          stack_id: selectedStackId,
          group_name: groupName.trim(),
        };
        const saved = await createGroup(draft);
        setGroups((current) => [...current, (saved || draft) as Group]);
        setExpandedStacks((current) => ({ ...current, [selectedStackId]: true }));
      } else {
        const stackName = window.prompt("New top-level folder name");
        if (!stackName?.trim()) return;
        const draft: Stack = { stack_id: crypto.randomUUID(), stack_name: stackName.trim() };
        const saved = await createStack(draft);
        const created = (saved || draft) as Stack;
        setStacks((current) => [...current, created]);
        setSelectedStackId(created.stack_id);
        setExpandedStacks((current) => ({ ...current, [created.stack_id]: true }));
      }
    } catch (error) {
      console.error("Could not create file explorer folder:", error);
      window.alert(error instanceof Error ? error.message : "Could not create folder.");
    }
  };

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
    <div className="blogg-filesystem-view">
      <aside className="bfe-sidebar" aria-label="File explorer">
        <div className="bfe-toolbar" role="toolbar" aria-label="File explorer actions">
          {canEdit && (
            <button type="button" className="bfe-toolbar-button" title="New note" aria-label="New note" onClick={onNewNote}>
              <ToolbarIcon kind="note" />
            </button>
          )}
          {canEdit && (
            <button type="button" className="bfe-toolbar-button" title={selectedStackId ? "New folder in selected stack" : "New top-level folder"} aria-label="New folder" onClick={() => void handleCreateFolder()}>
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
                                      <button
                                        key={noteId}
                                        type="button"
                                        role="treeitem"
                                        className={`bfe-row bfe-note-row${selectedNoteId === noteId ? " is-selected" : ""}`}
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
