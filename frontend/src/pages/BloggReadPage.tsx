import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import type { BloggItem } from "../types/pageTypes";
import { fetchBloggByIdRequest, fetchStackAndGroup } from "./BloggPage/services/canvasViewService";
import BloggHeader from "./BloggPage/components/bloggHeader/BloggHeader";
import ShareBloggButton from "./BloggPage/components/ShareBloggButton";
import { useAuth } from "../context/authContext";
import { bloggEditorSchema } from "./BloggPage/components/bloggForm/bloggEditorSchema";
import "@blocknote/mantine/style.css";
import "./bloggReadPage.css";

type CanvasStack = { stack_id: string; stack_name: string };
type CanvasGroup = { group_id: string; group_name: string; stack_id: string };
const EMPTY_BLOCKS: any[] = [{ type: "paragraph", content: "" }];

function NoteBody({ content }: { content?: unknown[] }) {
  const editor = useCreateBlockNote({
    schema: bloggEditorSchema,
    initialContent: Array.isArray(content) && content.length > 0 ? (content as any[]) : EMPTY_BLOCKS,
  });

  return (
    <div className="blogg-reader-body">
      {Array.isArray(content) && content.length > 0 ? (
        <BlockNoteView editor={editor} editable={false} theme="light" formattingToolbar={false} />
      ) : (
        <p className="blogg-reader-empty">This note has no body content yet.</p>
      )}
    </div>
  );
}

export default function BloggReadPage() {
  const { bloggId = "" } = useParams<{ bloggId: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [blogg, setBlogg] = useState<BloggItem | null>(null);
  const [stacks, setStacks] = useState<CanvasStack[]>([]);
  const [groups, setGroups] = useState<CanvasGroup[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setStatus("loading");
      try {
        const [note, canvas] = await Promise.all([
          fetchBloggByIdRequest({ blogg_id: bloggId }),
          fetchStackAndGroup(),
        ]);
        if (cancelled) return;
        if (!note) {
          setBlogg(null);
          setStatus("missing");
          return;
        }
        setBlogg(note as BloggItem);
        setStacks(Array.isArray(canvas?.stacks) ? canvas.stacks : []);
        setGroups(Array.isArray(canvas?.groups) ? canvas.groups : []);
        setStatus("ready");
      } catch (error) {
        console.error("Could not load note:", error);
        if (!cancelled) setStatus("error");
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [bloggId]);

  const group = useMemo(() => groups.find((item) => item.group_id === blogg?.group_id), [groups, blogg?.group_id]);
  const stack = useMemo(
    () => stacks.find((item) => item.stack_id === blogg?.stack_id) ?? stacks.find((item) => item.stack_id === group?.stack_id),
    [stacks, blogg?.stack_id, group?.stack_id],
  );

  return (
    <div className="blogg-reader-page typewriter-font">
      <BloggHeader page="feed" onNewNote={() => navigate("/blog?newNote=1")} />
      <main className="blogg-reader-scroll">
        {status === "loading" ? (
          <div className="blogg-reader-state" role="status">Loading note…</div>
        ) : status === "error" ? (
          <div className="blogg-reader-state" role="alert"><p>The note could not be loaded. Check the connection and try again.</p><button type="button" onClick={() => window.location.reload()}>Retry</button></div>
        ) : status === "missing" || !blogg ? (
          <div className="blogg-reader-state" role="status"><h1>Note not found</h1><p>This link may be invalid or the note may have been removed.</p><Link to="/feed">Back to Blog Feed</Link></div>
        ) : (
          <article className="blogg-reader-card">
            <header className="blogg-reader-meta">
              <div><p className="blogg-reader-author">{blogg.author?.trim() || "Unknown author"}</p><p className="blogg-reader-breadcrumb"><Link to="/blog">{stack?.stack_name || "Unsorted stack"}</Link><span aria-hidden="true">›</span><span>{group?.group_name || "Others"}</span></p></div>
              <time dateTime={blogg.createdAt || blogg.updatedAt || undefined}>{(() => { const date = new Date(blogg.createdAt || blogg.updatedAt || ""); return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : ""; })()}</time>
            </header>
            <h1 className="blogg-reader-title">{blogg.title?.trim() || "Untitled note"}</h1>
            {blogg.subtitle?.trim() && <p className="blogg-reader-subtitle">{blogg.subtitle}</p>}
            {!!blogg.tags?.length && <div className="blogg-reader-tags" aria-label="Tags">{blogg.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
            <div className="blogg-reader-content"><NoteBody key={blogg.blogg_id || blogg._id} content={blogg.content} /></div>
            <footer className="blogg-reader-actions">
              <Link to="/feed">Back to feed</Link>
              <Link to={`/blog?readNote=${encodeURIComponent(blogg.blogg_id || blogg._id)}`}>Open in Note View</Link>
              {isAdmin && <Link to={`/blog?editNote=${encodeURIComponent(blogg.blogg_id || blogg._id)}`}>Edit in BlockNote</Link>}
              <ShareBloggButton blogg={blogg} stackName={stack?.stack_name || "Unsorted stack"} groupName={group?.group_name || "Others"} />
            </footer>
          </article>
        )}
      </main>
    </div>
  );
}
