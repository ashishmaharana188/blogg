import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent as ReactChangeEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  loadBlogStickyNotes,
  saveBlogStickyNotes,
  type BlogStickyNote,
  type StickyNoteVariant,
} from "../../services/blogStickyNotesService";
import "./bloggStickyNotes.css";

type BloggStickyNotesProps = {
  bloggId: string | null;
};

const VARIANTS: StickyNoteVariant[] = ["pink", "yellow", "sky", "emerald"];
const SAVE_DELAY_MS = 650;

function makeId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `sticky-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export default function BloggStickyNotes({ bloggId }: BloggStickyNotesProps) {
  const [enabled, setEnabled] = useState(false);
  const [notes, setNotes] = useState<BlogStickyNote[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const draftKeyRef = useRef<string>(makeId());
  const dirtyRef = useRef(false);
  const revisionRef = useRef(0);
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    revisionRef.current += 1;
    setSaveMessage("Unsaved");
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setLoadError("");
    void loadBlogStickyNotes(bloggId, draftKeyRef.current)
      .then((savedNotes) => {
        if (!cancelled) {
          setNotes(savedNotes);
          dirtyRef.current = false;
          setSaveMessage("");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : "Could not load sticky notes.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [bloggId]);

  useEffect(() => {
    if (!loaded || !dirtyRef.current) return;
    const revision = revisionRef.current;
    const timer = window.setTimeout(() => {
      setSaveMessage("Saving…");
      void saveBlogStickyNotes(bloggId, draftKeyRef.current, notes)
        .then(() => {
          if (revisionRef.current === revision) {
            dirtyRef.current = false;
            setSaveMessage("Saved");
          }
        })
        .catch((error: unknown) => {
          setSaveMessage(
            error instanceof Error ? error.message : "Save failed",
          );
        });
    }, SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [bloggId, loaded, notes]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const width = Math.max(window.innerWidth, 1);
      const height = Math.max(window.innerHeight, 1);
      const nextX = clamp(drag.originX + (event.clientX - drag.startX) / width, 56 / width, 1 - 56 / width);
      const nextY = clamp(drag.originY + (event.clientY - drag.startY) / height, 56 / height, 1 - 56 / height);
      setNotes((current) =>
        current.map((note) =>
          note.id === drag.id ? { ...note, x: nextX, y: nextY } : note,
        ),
      );
    };
    const handlePointerUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, []);

  const addNote = () => {
    const index = notes.length;
    const column = Math.floor(index / 4);
    const row = index % 4;
    const nextNote: BlogStickyNote = {
      id: makeId(),
      text: "",
      variant: VARIANTS[index % VARIANTS.length],
      x: clamp(0.76 - column * 0.15, 0.12, 0.88),
      y: clamp(0.2 + row * 0.17, 0.08, 0.92),
      zIndex: Math.max(0, ...notes.map((note) => note.zIndex)) + 1,
    };
    markDirty();
    setNotes((current) => [...current, nextNote]);
  };

  const updateNoteText = (id: string, text: string) => {
    markDirty();
    setNotes((current) =>
      current.map((note) => (note.id === id ? { ...note, text } : note)),
    );
  };

  const removeNote = (id: string) => {
    markDirty();
    setNotes((current) => current.filter((note) => note.id !== id));
  };

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>, note: BlogStickyNote) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    markDirty();
    const topZ = Math.max(0, ...notes.map((item) => item.zIndex)) + 1;
    setNotes((current) =>
      current.map((item) => item.id === note.id ? { ...item, zIndex: topZ } : item),
    );
    dragRef.current = {
      id: note.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: note.x,
      originY: note.y,
    };
  };

  return (
    <>
      <div className="blogg-sticky-controls">
        <button
          type="button"
          className={`blogg-sticky-toggle ${enabled ? "is-enabled" : ""}`}
          aria-pressed={enabled}
          onClick={() => setEnabled((current) => !current)}
          title={enabled ? "Hide sticky notes" : "Show sticky notes"}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 3.75h10a2 2 0 0 1 2 2v12.5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5.75a2 2 0 0 1 2-2Z" />
            <path d="M8.5 8h7M8.5 11.5h7M8.5 15h4" />
          </svg>
          <span>Sticky notes</span>
          <span className="blogg-sticky-count">{notes.length}</span>
          <span className={`blogg-sticky-switch ${enabled ? "is-on" : ""}`} aria-hidden="true">
            <span />
          </span>
        </button>
        {saveMessage && <span className="blogg-sticky-save-status" role="status">{saveMessage}</span>}
        {loadError && <span className="blogg-sticky-save-error" role="status">{loadError}</span>}
      </div>

      {enabled && loaded && (
        <div className="blogg-sticky-layer" aria-label="Sticky notes layer">
          {notes.map((note) => (
            <article
              key={note.id}
              className={`blogg-sticky-card blogg-sticky-${note.variant}`}
              style={{
                left: `${note.x * 100}%`,
                top: `${note.y * 100}%`,
                zIndex: 20 + note.zIndex,
              }}
            >
              <div
                className="blogg-sticky-drag-handle"
                onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => startDrag(event, note)}
                title="Drag to move sticky note"
                aria-label="Drag to move sticky note"
              >
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
              <button
                type="button"
                className="blogg-sticky-remove"
                onClick={() => removeNote(note.id)}
                aria-label="Delete sticky note"
                title="Delete sticky note"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m7 7 10 10M17 7 7 17" />
                </svg>
              </button>
              <textarea
                className="blogg-sticky-text"
                value={note.text}
                onChange={(event: ReactChangeEvent<HTMLTextAreaElement>) => updateNoteText(note.id, event.target.value)}
                placeholder="Jot a note..."
                aria-label="Sticky note text"
                maxLength={2000}
                spellCheck
              />
            </article>
          ))}
          <button
            type="button"
            className="blogg-sticky-add"
            onClick={addNote}
            title="Add sticky note"
            aria-label="Add sticky note"
            disabled={!loaded}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      )}
    </>
  );
}
