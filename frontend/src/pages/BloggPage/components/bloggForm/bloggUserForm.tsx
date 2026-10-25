import { userFormtypes } from "../../../../types/pageTypes";
import { useCreateBlockNote, FormattingToolbarController } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { uploadFile } from "../../services/bloggService";
import { BloggFormattingToolbar } from "./bloggFormattingToolbar";
import { bloggEditorSchema } from "./bloggEditorSchema";
import CopyrightNotice from "../../../../components/CopyrightNotice";
import { fetchLinkPreview } from "./linkPreviewService";
import BloggReferencesSidebar from "./bloggReferencesSidebar";
import "../../../bloggReferenceHighlight.css";
import "./bloggReferencesLayout.css";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

const TAG_COLORS = [
  "bg-blue-100 text-blue-800 border-blue-200",
  "bg-emerald-100 text-emerald-800 border-emerald-200",
  "bg-purple-100 text-purple-800 border-purple-200",
  "bg-amber-100 text-amber-800 border-amber-200",
  "bg-rose-100 text-rose-800 border-rose-200",
  "bg-cyan-100 text-cyan-800 border-cyan-200",
];

type PastedLink = { url: string; label: string };

function normaliseHttpUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Handles both address-bar URLs (plain text) and a single copied hyperlink (HTML clipboard). */
function readPastedLink(event: ClipboardEvent): PastedLink | null {
  const clipboard = event.clipboardData;
  if (!clipboard) return null;

  const plain = clipboard.getData("text/plain").trim();
  const plainUrl = normaliseHttpUrl(plain);
  if (plainUrl && !/\s/.test(plain)) return { url: plainUrl, label: plain };

  const html = clipboard.getData("text/html");
  if (!html) return null;
  try {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const anchors = Array.from(parsed.querySelectorAll("a[href]"));
    if (anchors.length !== 1) return null;
    const anchor = anchors[0];
    const url = normaliseHttpUrl(anchor.getAttribute("href") || "");
    const label = (anchor.textContent || plain || "").replace(/\s+/g, " ").trim();
    const wholeClipboardText = (parsed.body.textContent || "").replace(/\s+/g, " ").trim();
    if (!url || (wholeClipboardText && label && wholeClipboardText !== label)) return null;
    return { url, label: label || plain || url };
  } catch {
    return null;
  }
}

function textOfBlock(block: { content?: unknown }): string {
  if (typeof block.content === "string") return block.content;
  if (!Array.isArray(block.content)) return "";
  return block.content.map((part) => {
    if (typeof part === "string") return part;
    if (part && typeof part === "object") {
      const inline = part as { type?: string; text?: string; content?: unknown };
      if (inline.type === "text") return inline.text || "";
      if (inline.type === "link" && Array.isArray(inline.content)) {
        return inline.content.map((nested) => typeof nested === "object" && nested && "text" in nested ? String((nested as { text?: unknown }).text || "") : "").join("");
      }
    }
    return "";
  }).join("");
}

function providerLabel(urlValue: string): string {
  try {
    const url = new URL(urlValue);
    if (url.hostname === "open.spotify.com") return "Spotify";
    if (url.hostname === "music.youtube.com") return "YouTube Music";
    if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(url.hostname)) return "YouTube";
    if (url.hostname === "noteonstuff.vercel.app" && url.pathname.startsWith("/share/")) return "Blogg";
    return url.hostname.replace(/^www\./i, "");
  } catch {
    return "Website";
  }
}

const UserForm = ({
  onContentChange,
  onAutoSaved,
  selectedBlogg,
  initialEditMode = false,
  canEdit = false,
}: userFormtypes) => {
  // A saved note starts in read-only mode. Non-admins can never turn editing on,
  // even if they manipulate component state or open a direct reader URL.
  const [isReadOnly, setIsReadOnly] = useState(
    !canEdit || (selectedBlogg !== null && selectedBlogg !== undefined && !initialEditMode),
  );
  const [formData, setFormData] = useState({
    author: selectedBlogg?.author ?? "",
    title: selectedBlogg?.title ?? "",
    description: selectedBlogg?.subtitle ?? "",
    content: selectedBlogg?.content ?? [],
  });
  const [isPublic, setIsPublic] = useState(selectedBlogg?.isPublic !== false);
  const [showCopyright, setShowCopyright] = useState(selectedBlogg?.showCopyright === true);
  const [copyrightHolder, setCopyrightHolder] = useState(selectedBlogg?.copyrightHolder ?? "");
  const [tags, setTags] = useState<{ text: string; colorClass: string }[]>(
    (selectedBlogg?.tags ?? []).map((text, index) => ({
      text,
      colorClass: TAG_COLORS[index % TAG_COLORS.length],
    })),
  );
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "pending" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const [contentRevision, setContentRevision] = useState(0);
  const pendingPreviewsRef = useRef<Set<Promise<void>>>(new Set());
  const savedBloggIdRef = useRef<string | null>(selectedBlogg?.blogg_id || null);
  const [currentBloggId, setCurrentBloggId] = useState<string | null>(selectedBlogg?.blogg_id || null);
  const [isReferencesOpen, setIsReferencesOpen] = useState(true);
  const [isReadOnlyReferencesOpen, setIsReadOnlyReferencesOpen] = useState(false);
  const [focusedReferenceId, setFocusedReferenceId] = useState<string | null>(null);
  const editRevisionRef = useRef(0);
  const hasUnsavedChangesRef = useRef(false);
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const isEditable = canEdit && !isReadOnly;
  const isReferencePanelVisible =
    (isEditable && isReferencesOpen) ||
    (!isEditable && isReadOnlyReferencesOpen && Boolean(currentBloggId));

  const markDirty = useCallback(() => {
    editRevisionRef.current += 1;
    hasUnsavedChangesRef.current = true;
    setSaveStatus("pending");
    setSaveError("");
  }, []);

  const editor = useCreateBlockNote({
    schema: bloggEditorSchema,
    initialContent: selectedBlogg?.content as any,
    uploadFile,
    pasteHandler: ({ event, editor: pasteEditor, defaultPasteHandler }) => {
      const pasted = readPastedLink(event);
      if (!pasted) return defaultPasteHandler();

      let cursor: ReturnType<typeof pasteEditor.getTextCursorPosition>;
      try {
        cursor = pasteEditor.getTextCursorPosition();
      } catch {
        return defaultPasteHandler();
      }

      const currentBlock = cursor.block;
      const isBlankParagraph = currentBlock.type === "paragraph" && textOfBlock(currentBlock).trim() === "";

      // A standalone HTTPS URL on a blank paragraph becomes a saved, clickable preview block.
      // URLs pasted into an existing sentence (or HTTP URLs) remain inline hyperlinks instead.
      if (isBlankParagraph && pasted.url.startsWith("https://")) {
        const blockId = currentBlock.id;
        const initialProps = {
          url: pasted.url,
          title: pasted.url,
          description: "Loading link preview…",
          image: "",
          provider: providerLabel(pasted.url),
        };
        pasteEditor.updateBlock(blockId, { type: "linkPreview", props: initialProps });
        // A preview is a non-editable block. Keep a normal paragraph after it so
        // the caret has a safe place to land and the user can continue writing.
        const trailingParagraph = pasteEditor.insertBlocks(
          [{ type: "paragraph" }],
          blockId,
          "after",
        )[0];
        if (trailingParagraph) {
          pasteEditor.setTextCursorPosition(trailingParagraph.id, "start");
        }

        let pending: Promise<void>;
        pending = fetchLinkPreview(pasted.url).then((metadata) => {
          const latestBlock = pasteEditor.getBlock(blockId);
          if (!latestBlock || latestBlock.type !== "linkPreview") return;
          pasteEditor.updateBlock(blockId, {
            props: {
              url: metadata.url || pasted.url,
              title: metadata.title || pasted.url,
              description: metadata.description || "",
              image: metadata.image || "",
              provider: metadata.provider || initialProps.provider,
            },
          });
        }).catch(() => {
          const latestBlock = pasteEditor.getBlock(blockId);
          if (!latestBlock || latestBlock.type !== "linkPreview") return;
          pasteEditor.updateBlock(blockId, {
            props: {
              ...initialProps,
              description: "Preview details could not be loaded. Open the original link.",
            },
          });
        }).finally(() => {
          pendingPreviewsRef.current.delete(pending);
        });
        pendingPreviewsRef.current.add(pending);
        return true;
      }

      // Using BlockNote's inline-link schema ensures the URL is clickable when pasted into text.
      pasteEditor.insertInlineContent([
        {
          type: "link",
          content: pasted.label || pasted.url,
          href: pasted.url,
        },
      ]);
      return true;
    },
  });

  const authorRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  const handleTitleChange = (field: "author" | "title" | "description", value: string) => {
    markDirty();
    setFormData((current) => ({ ...current, [field]: value }));
  };

  const autoResize = (ref: React.RefObject<HTMLTextAreaElement | null>) => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = ref.current.scrollHeight + "px";
    }
  };

  const confirmTag = () => {
    if (tagInput.trim()) {
      markDirty();
      const randomColor = TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
      setTags((current) => [...current, { text: tagInput.trim(), colorClass: randomColor }]);
    }
    setTagInput("");
    setIsAddingTag(false);
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmTag();
    }
    if (e.key === "Escape") {
      setTagInput("");
      setIsAddingTag(false);
    }
  };

  const removeTag = (indexToRemove: number) => {
    markDirty();
    setTags((current) => current.filter((_, index) => index !== indexToRemove));
  };

  const handleReferenceLinkClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target?.closest<HTMLAnchorElement>("a[href]");
    if (!anchor) return;
    let destination: URL;
    try { destination = new URL(anchor.href, window.location.href); }
    catch { return; }
    if (!destination.pathname.startsWith("/read/") || !destination.searchParams.has("referenceId")) return;

    // Reference words open their footnote entry in the side panel instead of
    // immediately navigating away from the source blog.
    event.preventDefault();
    event.stopPropagation();
    setFocusedReferenceId(destination.searchParams.get("referenceId"));
    if (isEditable) setIsReferencesOpen(true);
    else setIsReadOnlyReferencesOpen(true);
  }, [isEditable]);

  const linkSelectedSourceText = useCallback((href: string) => {
    const sourceText = editor.getSelectedText().replace(/\s+/g, " ").trim();
    if (!sourceText) {
      return { sourceText: "", error: "Select the words in this blog's BlockNote content first." };
    }
    if (sourceText.length > 500) {
      return { sourceText: "", error: "Select a shorter phrase (500 characters or fewer)." };
    }
    const selectedBlocks = editor.getSelection()?.blocks || [];
    if (selectedBlocks.length > 1) {
      return { sourceText: "", error: "Select text within one paragraph or heading at a time." };
    }
    editor.createLink(href);
    markDirty();
    setContentRevision((revision) => revision + 1);
    return { sourceText };
  }, [editor, markDirty]);

  const saveForm = useCallback(async (closeAfterSave = false): Promise<boolean> => {
    if (!canEdit || isReadOnly) return false;

    // Capture the revision when this save was requested. If the user keeps typing
    // while a request is in flight, the later queued save must keep the form dirty.
    const requestedRevision = editRevisionRef.current;
    const runSave = async () => {
      // Do not persist a temporary "Loading link preview…" placeholder if the user saves quickly.
      if (pendingPreviewsRef.current.size > 0) {
        await Promise.all(Array.from(pendingPreviewsRef.current));
      }
      const blog = {
        author: formData.author,
        title: formData.title,
        subtitle: formData.description,
        tags: tags.map((tag) => tag.text),
        content: editor.document,
        isPublic,
        showCopyright,
        copyrightHolder: copyrightHolder.trim().slice(0, 180),
      };
      const result = await onContentChange(blog, savedBloggIdRef.current, closeAfterSave);
      const savedRecord = result && typeof result === "object" && "blog" in result
        ? (result as { blog?: unknown }).blog
        : result;
      if (savedRecord && typeof savedRecord === "object") {
        const savedId = (savedRecord as { blogg_id?: unknown }).blogg_id;
        if (typeof savedId === "string" && savedId.trim()) {
          // Critical for a brand-new note: the next autosave updates this record
          // instead of creating a duplicate note on every edit.
          savedBloggIdRef.current = savedId;
          setCurrentBloggId(savedId);
        }
      }
      return result;
    };

    // Serialize writes so a slower previous request cannot overwrite newer edits.
    const queuedSave = saveQueueRef.current.catch(() => undefined).then(runSave);
    saveQueueRef.current = queuedSave;
    setSaveStatus("saving");
    setSaveError("");

    try {
      await queuedSave;
      const savedLatestRevision = editRevisionRef.current === requestedRevision;
      if (savedLatestRevision) {
        hasUnsavedChangesRef.current = false;
        setSaveStatus("saved");
      } else {
        setSaveStatus("pending");
      }
      if (!closeAfterSave) onAutoSaved?.();
      return savedLatestRevision;
    } catch (error) {
      setSaveStatus("error");
      setSaveError(error instanceof Error ? error.message : "Could not save changes.");
      return false;
    }
  }, [canEdit, isReadOnly, formData, tags, editor, isPublic, showCopyright, copyrightHolder, onContentChange, onAutoSaved]);

  useEffect(() => {
    if (!isEditable || !autoSaveEnabled || !hasUnsavedChangesRef.current) return;
    const timer = window.setTimeout(() => {
      void saveForm(false);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [isEditable, autoSaveEnabled, formData, tags, isPublic, contentRevision, saveForm]);

  const saveStatusMessage = !autoSaveEnabled
    ? (hasUnsavedChangesRef.current ? "Auto-save off · unsaved changes" : "Auto-save off")
    : saveStatus === "saving"
      ? "Saving changes…"
      : saveStatus === "pending"
        ? "Unsaved changes · saving automatically"
        : saveStatus === "saved"
          ? "All changes saved"
          : saveStatus === "error"
            ? saveError || "Save failed"
            : "Auto-save is on";

  return (
    <div className="blogg-editor-form w-full min-w-0 relative">
      <div className={`blogg-editor-layout ${isReferencePanelVisible ? "is-references-open" : ""}`}>
        <main className="blogg-editor-form-main min-w-0">
          <div className="blogg-editor-form-inner relative mx-auto block w-full max-w-[1600px] p-3 sm:p-4">
        <div className="mx-auto flex w-full max-w-[1200px] min-w-0 flex-col gap-4">
        <div className="blogg-editor-field blogg-editor-author-field self-center -mt-4 w-full max-w-[500px]">
          <textarea
            ref={authorRef}
            value={formData.author}
            readOnly={!canEdit || isReadOnly}
            onChange={(event) => {
              handleTitleChange("author", event.target.value);
              autoResize(authorRef);
            }}
            placeholder="Author"
            className="blogg-editor-author w-full max-w-full resize-none overflow-hidden whitespace-pre-wrap break-words text-lg sm:text-xl outline-none text-center"
          />
        </div>
        <textarea
          ref={titleRef}
          value={formData.title}
          readOnly={!canEdit || isReadOnly}
          onChange={(event) => {
            handleTitleChange("title", event.target.value);
            autoResize(titleRef);
          }}
          placeholder="Document Title"
          className="blogg-editor-title w-full max-w-[1100px] resize-none overflow-hidden whitespace-pre-wrap break-words text-3xl sm:text-4xl font-bold outline-none self-center text-center"
        />
        <div className="blogg-editor-field blogg-editor-description-field self-center -mt-4 w-full max-w-[800px]">
          <textarea
            ref={descriptionRef}
            value={formData.description}
            readOnly={!canEdit || isReadOnly}
            onChange={(event) => {
              handleTitleChange("description", event.target.value);
              autoResize(descriptionRef);
            }}
            placeholder="Description"
            className="blogg-editor-description w-full max-w-full mt-5 resize-none overflow-hidden whitespace-pre-wrap break-words text-lg sm:text-xl outline-none text-center italic"
          />
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 mt-4 min-h-[32px]">
          {tags.map((tag, index) => (
            <div key={index} className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border transition-all ${tag.colorClass}`}>
              <span>{tag.text}</span>
              {isEditable && <button onClick={() => removeTag(index)} className="hover:text-black opacity-50 hover:opacity-100 transition-opacity focus:outline-none" title="Remove tag">×</button>}
            </div>
          ))}
          {isEditable && (isAddingTag ? (
            <input
              autoFocus
              type="text"
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={handleTagKeyDown}
              onBlur={confirmTag}
              placeholder="Type & Enter..."
              className="w-32 px-3 py-1 text-xs font-bold border border-gray-300 rounded-full focus:outline-none focus:border-slate-800 text-center bg-white shadow-sm"
            />
          ) : (
            <button onClick={() => setIsAddingTag(true)} className="px-4 py-1 text-xs border border-gray-300 rounded-full font-bold text-gray-600 hover:bg-gray-100 transition-colors shadow-sm">+ Add Tag</button>
          ))}
        </div>

        <div className="mt-10 [&_.bn-editor]:pt-6 [&_.bn-editor]:pb-12" onClickCapture={handleReferenceLinkClickCapture}>
          <BlockNoteView
            editor={editor}
            theme="dark"
            filePanel={isEditable}
            editable={isEditable}
            formattingToolbar={false}
            onChange={() => {
              markDirty();
              setContentRevision((revision) => revision + 1);
            }}
          >
            {isEditable && <FormattingToolbarController formattingToolbar={BloggFormattingToolbar} />}
          </BlockNoteView>
        </div>

        <CopyrightNotice enabled={showCopyright} holder={copyrightHolder} author={formData.author} createdAt={selectedBlogg?.createdAt} />

        {canEdit && (
          <div className="blogg-note-visibility-row">
            <label className="blogg-note-visibility-label">
              <input
                type="checkbox"
                checked={isPublic}
                disabled={isReadOnly}
                onChange={(event) => {
                  markDirty();
                  setIsPublic(event.target.checked);
                }}
                className="blogg-note-visibility-checkbox"
              />
              <span>Public</span>
            </label>
            <p className="blogg-note-visibility-help">
              {isPublic
                ? "Visible in Blog Feed, Folder view and Flipbook."
                : "Only visible to the administrator while signed in."}
            </p>
          </div>
        )}

        {!isEditable && selectedBlogg && (
          <div className="flex justify-end">
            <button type="button" onClick={() => setIsReadOnlyReferencesOpen(true)} className="text-xs text-slate-600 underline underline-offset-4 hover:text-slate-950">
              Footnotes &amp; References
            </button>
          </div>
        )}
        {isReadOnly && canEdit && selectedBlogg && <div className="flex justify-end mt-4"><button className="px-5 py-1 text-l bg-white border border-gray-300 text-black rounded font-bold hover:bg-black hover:text-white transition-colors" onClick={() => setIsReadOnly(false)}>EDIT</button></div>}
        {isEditable && (
          <div className="blogg-editor-bottom-area">
            <section className="blogg-copyright-editor-control" aria-label="Copyright attribution settings">
              <label className="blogg-copyright-editor-toggle">
                <input type="checkbox" checked={showCopyright} onChange={(event) => { markDirty(); setShowCopyright(event.target.checked); }} />
                <span>Display copyright footer</span>
              </label>
              {showCopyright && (
                <div className="blogg-copyright-editor-details">
                  <input type="text" maxLength={180} value={copyrightHolder} onChange={(event) => { markDirty(); setCopyrightHolder(event.target.value); }} placeholder="Optional rights holder (blank shows legal declaration)" aria-label="Copyright owner or rights holder" />
                  <p>Enter a rights-holder name only when you want explicit © attribution. Leave this blank to display the general legal declaration instead of assuming the author owns the copyright. <a href="https://copyright.gov.in/Copyright_Act_1957/chapter_iv.html" target="_blank" rel="noreferrer">Section 17</a> · <a href="https://copyright.gov.in/Copyright_Act_1957/chapter_xii.html" target="_blank" rel="noreferrer">Section 57</a>.</p>
                </div>
              )}
            </section>
            <div className="blogg-editor-references-toggle-row">
              <span className="blogg-editor-references-toggle-label">Footnotes</span>
              <button
                type="button"
                role="switch"
                aria-checked={isReferencesOpen}
                aria-label="Show Footnotes and References"
                onClick={() => setIsReferencesOpen((open) => !open)}
                className={`blogg-editor-switch ${isReferencesOpen ? "is-on" : ""}`}
              >
                <span className="blogg-editor-switch-thumb" />
              </button>
              <span className="blogg-editor-references-toggle-state">{isReferencesOpen ? "Shown" : "Hidden"}</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
            <div className="min-w-0">
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-800">
                <input
                  type="checkbox"
                  checked={autoSaveEnabled}
                  onChange={(event) => {
                    setAutoSaveEnabled(event.target.checked);
                    setSaveStatus(hasUnsavedChangesRef.current ? "pending" : "idle");
                  }}
                  className="h-4 w-4 accent-black"
                />
                Auto-save changes
              </label>
              <p className={`mt-1 text-xs ${saveStatus === "error" ? "text-red-700" : "text-slate-500"}`} role="status" aria-live="polite">
                {saveStatusMessage}
              </p>
            </div>
            <button
              className="px-5 py-2 text-sm bg-white border border-gray-300 text-black rounded font-bold hover:bg-black hover:text-white transition-colors"
              onClick={() => void saveForm(true)}
            >
              SAVE &amp; CLOSE
            </button>
            </div>
          </div>
        )}
          </div>
          </div>
        </main>
        <div
          className={`blogg-reference-panel-slot ${isReferencePanelVisible ? "is-visible" : ""}`}
          aria-hidden={!isReferencePanelVisible}
        >
          {isReferencePanelVisible && (
            <BloggReferencesSidebar
              bloggId={currentBloggId}
              canEdit={isEditable}
              focusReferenceId={focusedReferenceId}
              linkSelectedSourceText={linkSelectedSourceText}
              saveBlogBody={() => saveForm(false)}
              onClose={!isEditable ? () => setIsReadOnlyReferencesOpen(false) : undefined}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default UserForm;
