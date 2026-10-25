import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import type { BloggItem } from "../../types/pageTypes";
import CopyrightNotice from "../../components/CopyrightNotice";
import { bloggEditorSchema } from "../BloggPage/components/bloggForm/bloggEditorSchema";
import "../BloggPage/components/bloggForm/bloggReferenceNoteWindow.css";

type Props = {
  blogg: BloggItem;
  onClose: () => void;
};

const EMPTY_BLOCKS: any[] = [{ type: "paragraph", content: "" }];

type NoteWindowArticleProps = { blogg: BloggItem };

/**
 * Keep the BlockNote editor in a note-specific child component. Its key changes
 * when the selected note changes, forcing React to dispose of the old editor
 * and create a fresh one with the new note's initialContent.
 */
function NoteWindowArticle({ blogg }: NoteWindowArticleProps) {
  const hasContent = Array.isArray(blogg.content) && blogg.content.length > 0;
  const content = hasContent ? blogg.content as any[] : EMPTY_BLOCKS;
  const editor = useCreateBlockNote({ schema: bloggEditorSchema, initialContent: content });
  const heading = blogg.title?.trim() || "Untitled note";

  return (
    <article className="blogg-reference-note-window-article">
      {blogg.author?.trim() && <p className="blogg-reference-note-window-author">{blogg.author}</p>}
      <h3>{heading}</h3>
      {blogg.subtitle?.trim() && <p className="blogg-reference-note-window-subtitle">{blogg.subtitle}</p>}
      <div className="blogg-reference-note-window-body">
        {hasContent ? (
          <BlockNoteView editor={editor} editable={false} theme="dark" />
        ) : (
          <p className="blogg-reference-note-window-state">No body content yet.</p>
        )}
      </div>
      <CopyrightNotice enabled={blogg.showCopyright} holder={blogg.copyrightHolder} author={blogg.author} createdAt={blogg.createdAt} />
    </article>
  );
}

export default function FeedNoteWindow({ blogg, onClose }: Props) {
  const [minimized, setMinimized] = useState(false);
  const noteId = blogg.blogg_id || blogg._id || "untitled-note";
  const heading = blogg.title?.trim() || "Untitled note";

  // Also restore the window when its current note changes, even if a caller
  // reuses the same outer window component instead of giving it a new key.
  useEffect(() => {
    setMinimized(false);
  }, [noteId]);

  return createPortal(
    <section
      className={`blogg-reference-note-window${minimized ? " is-minimized" : ""}`}
      role="dialog"
      aria-label={`Note window: ${heading}`}
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
            onClick={() => setMinimized((value) => !value)}
            aria-label={minimized ? "Restore note window" : "Minimize note window"}
            title={minimized ? "Restore" : "Minimize"}
          >
            {minimized ? "□" : "−"}
          </button>
          <button type="button" onClick={onClose} aria-label="Close note window" title="Close">×</button>
        </div>
      </header>
      {!minimized && (
        <div className="blogg-reference-note-window-content">
          <NoteWindowArticle key={noteId} blogg={blogg} />
        </div>
      )}
    </section>,
    document.body,
  );
}
