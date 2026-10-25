import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchBloggMindMapData,
  fetchBloggReferences,
  saveBloggReferences,
  type BloggReference,
  type MindMapBlogg,
  type MindMapStack,
  type MindMapGroup,
} from "../../services/bloggReferencesService";
import { fetchBloggByIdRequest } from "../../services/canvasViewService";
import { useCreateBlockNote } from "@blocknote/react";
import { createPortal } from "react-dom";
import { BlockNoteView } from "@blocknote/mantine";
import { bloggEditorSchema } from "./bloggEditorSchema";
import "./bloggReferenceNoteWindow.css";

type LinkSelectionResult = { sourceText: string; error?: string };
type Props = {
  bloggId: string | null;
  canEdit: boolean;
  linkSelectedSourceText: (href: string) => LinkSelectionResult;
  saveBlogBody: () => Promise<boolean>;
  focusReferenceId?: string | null;
  /** Close button shown for the read-only/public footnotes panel. */
  onClose?: () => void;
};
type TargetBlogContent = MindMapBlogg & { content?: unknown };

function textFromInlineContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) {
    if (!value || typeof value !== "object") return "";
    const item = value as Record<string, unknown>;
    if (typeof item.text === "string") return item.text;
    if (Array.isArray(item.content)) return textFromInlineContent(item.content);
    return "";
  }
  return value.map((part) => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    const item = part as Record<string, unknown>;
    if (item.type === "text" && typeof item.text === "string") return item.text;
    if (Array.isArray(item.content)) return textFromInlineContent(item.content);
    if (typeof item.text === "string") return item.text;
    return "";
  }).join("");
}

function blockText(block: unknown): string {
  if (!block || typeof block !== "object") return "";
  const value = block as Record<string, unknown>;
  const text = textFromInlineContent(value.content).trim();
  if (text) return text;
  if (value.type === "linkPreview" && value.props && typeof value.props === "object") {
    const props = value.props as Record<string, unknown>;
    return [props.title, props.description].filter((part) => typeof part === "string" && part.trim()).join("\n");
  }
  return "";
}

function readableBlocks(content: unknown): string[] {
  if (!Array.isArray(content)) return (typeof content === "string" ? content : "").split(/\n+/).map((part) => part.trim()).filter(Boolean);
  return content.flatMap((block) => {
    const ownText = blockText(block);
    const children = block && typeof block === "object" && Array.isArray((block as Record<string, unknown>).children)
      ? readableBlocks((block as Record<string, unknown>).children)
      : [];
    return [...(ownText ? [ownText] : []), ...children];
  });
}

const quietButton = "inline-flex items-center justify-center border-0 border-b border-slate-400 bg-transparent px-0 py-1 text-xs font-medium text-slate-700 hover:border-slate-900 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40";

type ReferenceNoteWindowProps = {
  note: TargetBlogContent | null;
  title: string;
  loading: boolean;
  error: string;
  minimized: boolean;
  onMinimize: () => void;
  onRestore: () => void;
  onClose: () => void;
};

function ReferenceNoteWindow({
  note,
  title,
  loading,
  error,
  minimized,
  onMinimize,
  onRestore,
  onClose,
}: ReferenceNoteWindowProps) {
  const initialContent = Array.isArray(note?.content) && note.content.length
    ? note.content as any[]
    : [{ type: "paragraph", content: "" }];
  const editor = useCreateBlockNote({
    schema: bloggEditorSchema,
    initialContent,
  });
  const heading = note?.title?.trim() || title || "Referenced note";

  return (
    <section
      className={`blogg-reference-note-window${minimized ? " is-minimized" : ""}`}
      role="dialog"
      aria-label={`Referenced note: ${heading}`}
      aria-modal={false}
    >
      <header className="blogg-reference-note-window-header">
        <div className="blogg-reference-note-window-heading">
          <span className="blogg-reference-note-window-eyebrow">OPEN NOTE</span>
          <h2 title={heading}>{heading}</h2>
        </div>
        <div className="blogg-reference-note-window-controls">
          <button
            type="button"
            onClick={minimized ? onRestore : onMinimize}
            aria-label={minimized ? "Restore note window" : "Minimize note window"}
            title={minimized ? "Restore" : "Minimize"}
          >
            {minimized ? "□" : "−"}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close note window"
            title="Close"
          >
            ×
          </button>
        </div>
      </header>
      {!minimized && (
        <div className="blogg-reference-note-window-content">
          {loading ? (
            <p className="blogg-reference-note-window-state" role="status">Loading note…</p>
          ) : error ? (
            <p className="blogg-reference-note-window-state is-error" role="alert">{error}</p>
          ) : note ? (
            <article className="blogg-reference-note-window-article">
              {note.author?.trim() && <p className="blogg-reference-note-window-author">{note.author}</p>}
              <h3>{note.title || "Untitled note"}</h3>
              {note.subtitle?.trim() && <p className="blogg-reference-note-window-subtitle">{note.subtitle}</p>}
              <div className="blogg-reference-note-window-body">
                <BlockNoteView editor={editor} editable={false} theme="dark" />
              </div>
            </article>
          ) : (
            <p className="blogg-reference-note-window-state">No note content is available.</p>
          )}
        </div>
      )}
    </section>
  );
}


export default function BloggReferencesSidebar({ bloggId, canEdit, linkSelectedSourceText, saveBlogBody, focusReferenceId = null, onClose }: Props) {
  const [targets, setTargets] = useState<MindMapBlogg[]>([]);
  const [stacks, setStacks] = useState<MindMapStack[]>([]);
  const [groups, setGroups] = useState<MindMapGroup[]>([]);
  const [references, setReferences] = useState<BloggReference[]>([]);
  const [selectedStackId, setSelectedStackId] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const [selectedTargetBlog, setSelectedTargetBlog] = useState<TargetBlogContent | null>(null);
  const [selectedPassage, setSelectedPassage] = useState("");
  const [loading, setLoading] = useState(true);
  const [targetLoading, setTargetLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [editingReferenceId, setEditingReferenceId] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isAddedCollapsed, setIsAddedCollapsed] = useState(false);
  const [expandedReferenceId, setExpandedReferenceId] = useState<string | null>(null);
  const passageRef = useRef<HTMLDivElement | null>(null);
  const [isNoteWindowOpen, setIsNoteWindowOpen] = useState(false);
  const [isNoteWindowMinimized, setIsNoteWindowMinimized] = useState(false);
  const [noteWindowBlog, setNoteWindowBlog] = useState<TargetBlogContent | null>(null);
  const [noteWindowTitle, setNoteWindowTitle] = useState("Referenced note");
  const [noteWindowLoading, setNoteWindowLoading] = useState(false);
  const [noteWindowError, setNoteWindowError] = useState("");
  const noteWindowRequestRef = useRef(0);

  const folders = useMemo(() => groups.filter((group) => group.stack_id === selectedStackId), [groups, selectedStackId]);
  const blogsInFolder = useMemo(() => targets.filter((blog) =>
    Boolean(blog.blogg_id) && blog.blogg_id !== bloggId && blog.stack_id === selectedStackId && blog.group_id === selectedGroupId,
  ), [bloggId, selectedGroupId, selectedStackId, targets]);
  const selectedTarget = blogsInFolder.find((blog) => blog.blogg_id === selectedTargetId) || null;
  const passageBlocks = useMemo(() => readableBlocks(selectedTargetBlog?.content), [selectedTargetBlog?.content]);
  const unlinkedCount = references.filter((reference) => !reference.source_excerpt?.trim()).length;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setStatus("");
    try {
      const [mapData, current] = await Promise.all([
        fetchBloggMindMapData(),
        bloggId ? fetchBloggReferences(bloggId) : Promise.resolve([]),
      ]);
      setTargets(mapData.bloggs);
      setStacks(mapData.stacks);
      setGroups(mapData.groups);
      setReferences(current);
      setSelectedStackId("");
      setSelectedGroupId("");
      setSelectedTargetId("");
      setSelectedTargetBlog(null);
      setSelectedPassage("");
      setEditingReferenceId(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load references.");
    } finally {
      setLoading(false);
    }
  }, [bloggId]);

  useEffect(() => { void load(); }, [load]);


  const openReferenceNoteWindow = useCallback(async (targetBloggId: string, fallbackTitle = "Referenced note") => {
    const requestId = ++noteWindowRequestRef.current;
    setIsNoteWindowOpen(true);
    setIsNoteWindowMinimized(false);
    setNoteWindowBlog(null);
    setNoteWindowTitle(fallbackTitle);
    setNoteWindowLoading(true);
    setNoteWindowError("");
    try {
      const record: unknown = await fetchBloggByIdRequest({ blogg_id: targetBloggId });
      if (requestId !== noteWindowRequestRef.current) return;
      if (!record || typeof record !== "object") {
        setNoteWindowError("This note could not be found or is not available.");
        return;
      }
      const blog = record as TargetBlogContent;
      setNoteWindowBlog(blog);
      setNoteWindowTitle(blog.title || fallbackTitle);
    } catch (reason) {
      if (requestId === noteWindowRequestRef.current) {
        setNoteWindowError(reason instanceof Error ? reason.message : "Could not open this note.");
      }
    } finally {
      if (requestId === noteWindowRequestRef.current) setNoteWindowLoading(false);
    }
  }, []);

  const openSelectedTargetWindow = useCallback(() => {
    if (selectedTargetBlog) {
      noteWindowRequestRef.current += 1;
      setIsNoteWindowOpen(true);
      setIsNoteWindowMinimized(false);
      setNoteWindowBlog(selectedTargetBlog);
      setNoteWindowTitle(selectedTargetBlog.title || selectedTarget?.title || "Source note");
      setNoteWindowLoading(false);
      setNoteWindowError("");
      return;
    }
    if (selectedTargetId) {
      void openReferenceNoteWindow(selectedTargetId, selectedTarget?.title || "Source note");
    }
  }, [openReferenceNoteWindow, selectedTarget, selectedTargetBlog, selectedTargetId]);

  const closeNoteWindow = useCallback(() => {
    noteWindowRequestRef.current += 1;
    setIsNoteWindowOpen(false);
    setIsNoteWindowMinimized(false);
    setNoteWindowBlog(null);
    setNoteWindowLoading(false);
    setNoteWindowError("");
  }, []);

  useEffect(() => {
    if (!focusReferenceId) return;
    setIsCollapsed(false);
    setIsAddedCollapsed(false);
    setExpandedReferenceId(focusReferenceId);
  }, [focusReferenceId]);

  useEffect(() => {
    if (!selectedTargetId) {
      setSelectedTargetBlog(null);
      setTargetLoading(false);
      return;
    }
    let cancelled = false;
    setTargetLoading(true);
    setSelectedTargetBlog(null);
    setError("");
    fetchBloggByIdRequest({ blogg_id: selectedTargetId })
      .then((record: unknown) => {
        if (cancelled) return;
        if (!record || typeof record !== "object") {
          setError("Could not load the selected blog.");
          return;
        }
        setSelectedTargetBlog(record as TargetBlogContent);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load blog content.");
      })
      .finally(() => { if (!cancelled) setTargetLoading(false); });
    return () => { cancelled = true; };
  }, [selectedTargetId]);

  const captureTargetPassage = useCallback(() => {
    const container = passageRef.current;
    const selection = window.getSelection();
    if (!container || !selection || selection.rangeCount === 0) return;
    if (!selection.anchorNode || !selection.focusNode || !container.contains(selection.anchorNode) || !container.contains(selection.focusNode)) return;
    const paragraphFor = (node: Node) => {
      const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
      return element?.closest("[data-reference-paragraph]") || null;
    };
    const startParagraph = paragraphFor(selection.anchorNode);
    const endParagraph = paragraphFor(selection.focusNode);
    if (!startParagraph || startParagraph !== endParagraph) {
      setSelectedPassage("");
      setError("Select a passage within one paragraph.");
      return;
    }
    const value = selection.toString().replace(/\s+/g, " ").trim().slice(0, 2000);
    if (value) {
      setSelectedPassage(value);
      setError("");
      setStatus("");
    }
  }, []);

  const addPassage = () => {
    const target = selectedTarget || targets.find((blog) => blog.blogg_id === selectedTargetId);
    const excerpt = selectedPassage.trim();
    if (!target) { setError("Choose a Stack, Folder, and Blog first."); return; }
    if (!excerpt) { setError("Highlight a passage in the selected blog first."); return; }

    const existing = editingReferenceId ? references.find((ref) => ref.reference_id === editingReferenceId) : undefined;
    const reference: BloggReference = {
      reference_id: editingReferenceId || crypto.randomUUID(),
      target_blogg_id: target.blogg_id,
      target_title: target.title || "Untitled blog",
      target_excerpt: excerpt,
      // Updating the target passage requires re-linking the phrase in this blog.
      source_excerpt: editingReferenceId ? "" : undefined,
    };
    setReferences((current) => existing
      ? current.map((item) => item.reference_id === existing.reference_id ? reference : item)
      : [...current, reference]);
    setEditingReferenceId(null);
    setSelectedPassage("");
    setStatus("Passage added. Select the referring words in the blog and link them.");
    setError("");
  };

  const editReference = (reference: BloggReference) => {
    const target = targets.find((item) => item.blogg_id === reference.target_blogg_id);
    if (!target) { setError("That referenced blog is no longer available."); return; }
    setSelectedStackId(target.stack_id);
    setSelectedGroupId(target.group_id);
    setSelectedTargetId(target.blogg_id);
    setSelectedPassage(reference.target_excerpt);
    setEditingReferenceId(reference.reference_id);
    setStatus("Select a replacement passage, then update it.");
    setError("");
  };

  const linkSourceText = (reference: BloggReference) => {
    const href = `/read/${encodeURIComponent(reference.target_blogg_id)}?excerpt=${encodeURIComponent(reference.target_excerpt)}&referenceId=${encodeURIComponent(reference.reference_id)}`;
    const result = linkSelectedSourceText(href);
    if (result.error || !result.sourceText) {
      setError(result.error || "Select words in this blog's BlockNote content first.");
      setStatus("");
      return;
    }
    setReferences((current) => current.map((item) => item.reference_id === reference.reference_id
      ? { ...item, source_excerpt: result.sourceText }
      : item));
    setStatus(`Linked “${result.sourceText.slice(0, 60)}${result.sourceText.length > 60 ? "…" : ""}” in this blog.`);
    setError("");
  };

  const removeReference = (referenceId: string) => {
    setReferences((current) => current.filter((reference) => reference.reference_id !== referenceId));
    setStatus("Reference removed.");
    setError("");
  };

  const save = async () => {
    if (!bloggId) { setError("Save this blog before adding references."); return; }
    if (unlinkedCount) {
      setError(`Link the selected text in this blog for each reference before saving (${unlinkedCount} still unlinked).`);
      return;
    }
    setSaving(true);
    setError("");
    setStatus("");
    try {
      // The inline BlockNote links are part of the blog content. Persist those
      // first, then persist the matching reference metadata and mind-map edge.
      const bodySaved = await saveBlogBody();
      if (!bodySaved) {
        setError("The blog body could not be saved. Fix the save error before saving references.");
        return;
      }
      const saved = await saveBloggReferences(bloggId, references);
      setReferences(saved);
      setStatus("References saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save references.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <aside className="blogg-references-sidebar flex min-h-0 flex-col overflow-hidden bg-white text-slate-900" aria-label="Footnotes and references">
      <header className="blogg-ref-header">
        <button
          type="button"
          onClick={() => setIsCollapsed((value) => !value)}
          aria-expanded={!isCollapsed}
          className="blogg-ref-header-toggle"
          style={onClose ? { width: "auto", flex: "1 1 auto" } : undefined}
        >
          <span aria-hidden="true" className="blogg-ref-header-glyph">{isCollapsed ? "+" : "−"}</span>
          <span>Footnotes &amp; References</span>
          <span className="blogg-ref-count">{references.length}</span>
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close footnotes"
            title="Close footnotes"
            className="ml-2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-lg leading-none text-slate-500 shadow-sm transition-colors hover:border-slate-400 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
          >
            ×
          </button>
        )}
      </header>

      {!isCollapsed && (
        <>
          <div className="blogg-ref-scroll blogg-references-sidebar-content min-h-0 flex-1 space-y-4 overflow-y-auto py-3">
            {!bloggId ? (
              <p className="text-sm text-slate-600">Save this blog first to add references.</p>
            ) : !canEdit ? (
              <section aria-label="References for this blog">
                {!references.length ? (
                  <p className="text-sm text-slate-600">No references for this blog.</p>
                ) : (
                  <div className="divide-y divide-slate-200">
                    {references.map((reference, index) => (
                      <article key={reference.reference_id} className="py-3 first:pt-1">
                        <button type="button" onClick={() => { setExpandedReferenceId((current) => current === reference.reference_id ? null : reference.reference_id); void openReferenceNoteWindow(reference.target_blogg_id, reference.target_title || "Referenced blog"); }} aria-expanded={expandedReferenceId === reference.reference_id} className="flex w-full items-start gap-2 bg-transparent p-0 text-left">
                          <span className="text-xs text-slate-500">{index + 1}.</span>
                          <span className="flex-1 text-sm font-medium text-slate-800 underline decoration-dotted underline-offset-2">{reference.target_title || "Referenced blog"}</span>
                          <span className="text-xs text-slate-500">{expandedReferenceId === reference.reference_id ? "−" : "+"}</span>
                        </button>
                        {expandedReferenceId === reference.reference_id && (
                          <div className="pl-5 pt-2">
                            <p className="whitespace-pre-wrap text-xs leading-5 text-slate-600">{reference.target_excerpt}</p>
                            <button type="button" onClick={() => void openReferenceNoteWindow(reference.target_blogg_id, reference.target_title || "Referenced blog")} className="mt-2 inline-block text-xs font-semibold text-slate-700 underline underline-offset-2 hover:text-black">Open referenced note ↗</button>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </section>
            ) : (
              <>
                <section aria-label="Choose a source passage">
                  <p className="blogg-ref-eyebrow">Source blog</p>
                  <div className="blogg-ref-filter-list">
                    <label className="blogg-ref-filter-row">
                      <span className="blogg-ref-filter-label">Stack</span>
                      <select id="blogg-reference-stack" value={selectedStackId} onChange={(event) => {
                        setSelectedStackId(event.target.value); setSelectedGroupId(""); setSelectedTargetId(""); setSelectedPassage(""); setEditingReferenceId(null); setStatus("");
                      }} disabled={loading || !stacks.length} className="blogg-ref-select">
                        <option value="">Choose stack</option>
                        {stacks.map((stack) => <option key={stack.stack_id} value={stack.stack_id}>{stack.stack_name}</option>)}
                      </select>
                    </label>
                    <label className="blogg-ref-filter-row">
                      <span className="blogg-ref-filter-label">Folder</span>
                      <select id="blogg-reference-group" value={selectedGroupId} onChange={(event) => {
                        setSelectedGroupId(event.target.value); setSelectedTargetId(""); setSelectedPassage(""); setEditingReferenceId(null); setStatus("");
                      }} disabled={!selectedStackId || !folders.length} className="blogg-ref-select">
                        <option value="">Choose folder</option>
                        {folders.map((folder) => <option key={folder.group_id} value={folder.group_id}>{folder.group_name}</option>)}
                      </select>
                    </label>
                    <label className="blogg-ref-filter-row">
                      <span className="blogg-ref-filter-label">Blog</span>
                      <select id="blogg-reference-target" value={selectedTargetId} onChange={(event) => {
                        setSelectedTargetId(event.target.value); setSelectedPassage(""); setEditingReferenceId(null); setStatus("");
                      }} disabled={!selectedGroupId || !blogsInFolder.length} className="blogg-ref-select">
                        <option value="">Choose blog</option>
                        {blogsInFolder.map((blog) => <option key={blog.blogg_id} value={blog.blogg_id}>{blog.title || "Untitled blog"}</option>)}
                      </select>
                    </label>
                  </div>

                  {selectedTargetId && (
                    <div className="blogg-ref-passage-section mt-3 border-t border-[#edf0f4] pt-3">
                      <div className="blogg-ref-source-title-row">
                        <div className="mb-2 text-sm font-medium text-slate-800">{selectedTarget?.title || selectedTargetBlog?.title || "Source text"}</div>
                        <button type="button" onClick={openSelectedTargetWindow} disabled={targetLoading || !selectedTargetId} className="blogg-ref-open-note-button">Open note window ↗</button>
                      </div>
                      <div ref={passageRef} onMouseUp={captureTargetPassage} onKeyUp={captureTargetPassage} tabIndex={0} aria-label="Select a passage from the target blog" className="blogg-ref-passage max-h-44 select-text space-y-2 overflow-y-auto py-1 text-sm leading-5 text-slate-700 selection:bg-slate-200 selection:text-slate-950">
                        {targetLoading ? <p className="text-xs text-slate-500">Loading…</p> : passageBlocks.length ? passageBlocks.map((text, index) => <p data-reference-paragraph={index} key={`${index}:${text.slice(0, 16)}`} className="whitespace-pre-wrap">{text}</p>) : <p className="text-xs text-slate-500">No selectable text in this blog.</p>}
                      </div>
                      {selectedPassage && <p className="blogg-ref-selected-passage my-2 text-xs leading-5 text-slate-600">Selected passage: “{selectedPassage}”</p>}
                      <div className="blogg-ref-actions flex items-center gap-3 pt-2">
                        <button type="button" onClick={addPassage} disabled={!selectedPassage || targetLoading} className={quietButton}>{editingReferenceId ? "Update passage" : "Add reference"}</button>
                        {selectedPassage && <button type="button" onClick={() => setSelectedPassage("")} className="text-xs text-slate-500 underline underline-offset-2 hover:text-slate-900">Clear</button>}
                      </div>
                    </div>
                  )}
                </section>

                <section className="blogg-ref-added border-t border-slate-200 pt-3">
                  <button
                    type="button"
                    onClick={() => setIsAddedCollapsed((value) => !value)}
                    aria-expanded={!isAddedCollapsed}
                    className="blogg-ref-added-toggle flex w-full items-center justify-between bg-transparent p-0 text-left text-sm font-semibold text-slate-800"
                  >
                    <span>Added references <span className="font-normal text-slate-500">({references.length})</span></span>
                    <span className="text-xs font-normal text-slate-500">{isAddedCollapsed ? "Show" : "Hide"}</span>
                  </button>
                  {!isAddedCollapsed && (!references.length ? (
                    <p className="pt-2 text-xs leading-5 text-slate-500">No references added.</p>
                  ) : (
                    <div className="blogg-ref-list mt-2 divide-y divide-slate-200">
                      {references.map((reference) => (
                        <article key={reference.reference_id} className="blogg-ref-item py-3 first:pt-1 last:pb-0">
                          <button type="button" onClick={() => void openReferenceNoteWindow(reference.target_blogg_id, reference.target_title || "Referenced blog")} className="blogg-ref-item-title text-sm font-medium text-slate-800 underline decoration-dotted underline-offset-2 hover:text-black">{reference.target_title || "Referenced blog"}</button>
                          {reference.source_excerpt ? <p className="blogg-ref-linked-text mt-1 text-xs leading-5 text-slate-500">Linked text: {reference.source_excerpt}</p> : <p className="blogg-ref-linked-text mt-1 text-xs text-slate-500">Not linked to body text</p>}
                          <button
                            type="button"
                            onClick={() => setExpandedReferenceId((current) => current === reference.reference_id ? null : reference.reference_id)}
                            aria-expanded={expandedReferenceId === reference.reference_id}
                            className="mt-1 bg-transparent p-0 text-xs text-slate-600 underline underline-offset-2 hover:text-slate-950"
                          >
                            {expandedReferenceId === reference.reference_id ? "Hide passage" : "View passage"}
                          </button>
                          {expandedReferenceId === reference.reference_id && <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-600">{reference.target_excerpt}</p>}
                          <div className="mt-2 flex items-center gap-3">
                            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => linkSourceText(reference)} disabled={!canEdit} className={quietButton}>{reference.source_excerpt ? "Relink words" : "Link selected words"}</button>
                            <button type="button" onClick={() => editReference(reference)} className="text-xs text-slate-600 underline underline-offset-2 hover:text-slate-950">Change passage</button>
                            <button type="button" onClick={() => removeReference(reference.reference_id)} className="text-xs text-slate-500 underline underline-offset-2 hover:text-red-700">Remove</button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ))}
                </section>
              </>
            )}

            {error && <p role="alert" className="blogg-ref-message is-error border-t border-[#edf0f4] pt-2 text-xs leading-5 text-red-700">{error}</p>}
            {status && <p role="status" className="blogg-ref-message is-status border-t border-[#edf0f4] pt-2 text-xs leading-5 text-slate-600">{status}</p>}
          </div>

          {canEdit && bloggId && (
            <footer className="blogg-ref-footer flex items-center justify-between gap-2 border-t border-[#edf0f4] py-3">
              <span className="text-xs text-slate-500">{unlinkedCount ? `${unlinkedCount} unlinked` : "Ready to save"}</span>
              <button type="button" onClick={() => void save()} disabled={saving || loading || unlinkedCount > 0} className="blogg-ref-save-button" >
                {saving ? "Saving…" : "Save references"}
              </button>
            </footer>
          )}
        </>
      )}
    </aside>
    {isNoteWindowOpen && typeof document !== "undefined" && createPortal(
      <ReferenceNoteWindow
        key={noteWindowBlog?.blogg_id || `loading:${noteWindowTitle}`}
        note={noteWindowBlog}
        title={noteWindowTitle}
        loading={noteWindowLoading}
        error={noteWindowError}
        minimized={isNoteWindowMinimized}
        onMinimize={() => setIsNoteWindowMinimized(true)}
        onRestore={() => setIsNoteWindowMinimized(false)}
        onClose={closeNoteWindow}
      />,
      document.body,
    )}
    </>
  );
}
