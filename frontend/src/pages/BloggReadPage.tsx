import { useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import type { BloggItem } from "../types/pageTypes";
import { fetchBloggReferences, type BloggReference } from "./BloggPage/services/bloggReferencesService";
import { fetchBloggByIdRequest, fetchStackAndGroup } from "./BloggPage/services/canvasViewService";
import BloggHeader from "./BloggPage/components/bloggHeader/BloggHeader";
import ShareBloggButton from "./BloggPage/components/ShareBloggButton";
import CopyrightNotice from "../components/CopyrightNotice";
import { useAuth } from "../context/authContext";
import AssetStateBox from "../components/AssetStateBox";
import { bloggEditorSchema } from "./BloggPage/components/bloggForm/bloggEditorSchema";
import "@blocknote/mantine/style.css";
import "./bloggReadPage.css";
import "./bloggReferenceHighlight.css";

type CanvasStack = { stack_id: string; stack_name: string };
type CanvasGroup = { group_id: string; group_name: string; stack_id: string };
const EMPTY_BLOCKS: any[] = [{ type: "paragraph", content: "" }];

function NoteBody({
  content,
  onReferenceClick,
}: {
  content?: unknown[];
  onReferenceClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  const editor = useCreateBlockNote({
    schema: bloggEditorSchema,
    initialContent: Array.isArray(content) && content.length > 0 ? (content as any[]) : EMPTY_BLOCKS,
  });

  return (
    <div className="blogg-reader-body" onClick={onReferenceClick}>
      {Array.isArray(content) && content.length > 0 ? (
        <BlockNoteView editor={editor} editable={false} theme="light" formattingToolbar={false} />
      ) : (
        <p className="blogg-reader-empty">This note has no body content yet.</p>
      )}
    </div>
  );
}

function normalizeExcerpt(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export default function BloggReadPage() {
  const { bloggId = "" } = useParams<{ bloggId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAdmin } = useAuth();
  const [blogg, setBlogg] = useState<BloggItem | null>(null);
  const [stacks, setStacks] = useState<CanvasStack[]>([]);
  const [groups, setGroups] = useState<CanvasGroup[]>([]);
  const [references, setReferences] = useState<BloggReference[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [footnotesOpen, setFootnotesOpen] = useState(false);
  const [activeReferenceId, setActiveReferenceId] = useState<string | null>(null);

  const returnToFlipbook = searchParams.get("returnTo") === "flipbook";
  const requestedExcerpt = searchParams.get("excerpt")?.trim() || "";
  const returnHref = useMemo(() => {
    if (!returnToFlipbook) return "/feed";
    const params = new URLSearchParams({ view: "flipbook" });
    const stackId = searchParams.get("stackId");
    const groupId = searchParams.get("groupId");
    if (stackId) params.set("stackId", stackId);
    if (groupId) params.set("groupId", groupId);
    return `/blog?${params.toString()}`;
  }, [returnToFlipbook, searchParams]);

  const buildBlockNoteUrl = (action: "readNote" | "editNote") => {
    const params = new URLSearchParams({ [action]: bloggId });
    if (returnToFlipbook) {
      params.set("returnTo", "flipbook");
      const stackId = searchParams.get("stackId");
      const groupId = searchParams.get("groupId");
      if (stackId) params.set("stackId", stackId);
      if (groupId) params.set("groupId", groupId);
    }
    return `/blog?${params.toString()}`;
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setStatus("loading");
      setReferences([]);
      setFootnotesOpen(false);
      setActiveReferenceId(null);
      try {
        const [note, canvas, noteReferences] = await Promise.all([
          fetchBloggByIdRequest({ blogg_id: bloggId }, { retryTransientErrors: true }),
          fetchStackAndGroup({ publicReadOnly: true, retryTransientErrors: true }),
          fetchBloggReferences(bloggId).catch(() => []),
        ]);
        if (cancelled) return;
        if (!note) {
          setBlogg(null);
          setReferences([]);
          setStatus("missing");
          return;
        }
        setBlogg(note as BloggItem);
        setReferences(Array.isArray(noteReferences) ? noteReferences : []);
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

  // Inline links inside the body are footnote triggers, not direct navigation.
  // Navigation is offered separately inside the footnote drawer.
  const handleReaderContentClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const eventTarget = event.target instanceof Element ? event.target : null;
    const anchor = eventTarget?.closest<HTMLAnchorElement>("a[href]");
    if (!anchor) return;

    let destination: URL;
    try { destination = new URL(anchor.href, window.location.href); }
    catch { return; }
    if (!destination.pathname.startsWith("/read/") || !destination.searchParams.has("referenceId")) return;

    event.preventDefault();
    event.stopPropagation();
    const referenceId = destination.searchParams.get("referenceId") || "";
    const pathSegments = destination.pathname.split("/").filter(Boolean);
    const targetId = pathSegments[pathSegments.length - 1] || "";
    const excerpt = destination.searchParams.get("excerpt") || "";
    const reference = references.find((item) => item.reference_id === referenceId)
      || references.find((item) => item.target_blogg_id === targetId && normalizeExcerpt(item.target_excerpt) === normalizeExcerpt(excerpt));
    setActiveReferenceId(reference?.reference_id || referenceId || null);
    setFootnotesOpen(true);
  }, [references]);

  useEffect(() => {
    if (!footnotesOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFootnotesOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [footnotesOpen]);

  useEffect(() => {
    if (!requestedExcerpt || status !== "ready" || !blogg?.blogg_id) return;
    let highlighted: HTMLElement | null = null;
    const frame = window.requestAnimationFrame(() => {
      const body = document.querySelector<HTMLElement>(".blogg-reader-body");
      if (!body) return;
      const excerpt = normalizeExcerpt(requestedExcerpt);
      const blocks = Array.from(body.querySelectorAll<HTMLElement>(".bn-block-content"));
      highlighted = blocks.find((block) => normalizeExcerpt(block.innerText || block.textContent || "").includes(excerpt)) || null;
      if (highlighted) {
        highlighted.classList.add("blogg-reference-target-highlight");
        highlighted.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
      highlighted?.classList.remove("blogg-reference-target-highlight");
    };
  }, [requestedExcerpt, status, blogg?.blogg_id]);

  const group = useMemo(() => groups.find((item) => item.group_id === blogg?.group_id), [groups, blogg?.group_id]);
  const stack = useMemo(
    () => stacks.find((item) => item.stack_id === blogg?.stack_id) ?? stacks.find((item) => item.stack_id === group?.stack_id),
    [stacks, blogg?.stack_id, group?.stack_id],
  );

  const openAllFootnotes = () => {
    setActiveReferenceId(null);
    setFootnotesOpen(true);
  };

  return (
    <div className="blogg-reader-page">
      <BloggHeader page="feed" onNewNote={() => navigate("/blog?newNote=1")} />
      <main className="blogg-reader-scroll">
        {status === "loading" ? (
          <AssetStateBox status="loading" />
        ) : status === "error" ? (
          <AssetStateBox status="error" onRetry={() => window.location.reload()} />
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
            <div className="blogg-reader-content">
              <NoteBody key={blogg.blogg_id || blogg._id} content={blogg.content} onReferenceClick={handleReaderContentClick} />
            </div>
            {references.length > 0 && (
              <div className="blogg-reader-footnotes-trigger-wrap">
                <button type="button" className="blogg-reader-footnotes-trigger" onClick={openAllFootnotes} aria-haspopup="dialog">
                  <span>Footnotes &amp; References</span>
                  <span className="blogg-reader-footnotes-count">{references.length}</span>
                  <span className="blogg-reader-footnotes-action">View</span>
                </button>
              </div>
            )}
            <footer className="blogg-reader-actions">
              <Link to={returnHref}>{returnToFlipbook ? "Back to Flipbook" : "Back to feed"}</Link>
              <Link to={buildBlockNoteUrl("readNote")}>Open in Note View</Link>
              {isAdmin && <Link to={buildBlockNoteUrl("editNote")}>Edit in BlockNote</Link>}
              <ShareBloggButton blogg={blogg} stackName={stack?.stack_name || "Unsorted stack"} groupName={group?.group_name || "Others"} />
            </footer>
            <CopyrightNotice enabled={blogg.showCopyright} holder={blogg.copyrightHolder} author={blogg.author} createdAt={blogg.createdAt} />
          </article>
        )}
      </main>

      {footnotesOpen && references.length > 0 && (
        <div className="blogg-footnotes-backdrop" role="presentation" onMouseDown={() => setFootnotesOpen(false)}>
          <aside
            className="blogg-footnotes-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Footnotes and references"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="blogg-footnotes-drawer-header">
              <div>
                <h2>Footnotes &amp; References</h2>
                <p>{references.length} {references.length === 1 ? "reference" : "references"}</p>
              </div>
              <button type="button" onClick={() => setFootnotesOpen(false)} aria-label="Close footnotes" title="Close">×</button>
            </header>
            <div className="blogg-footnotes-drawer-body">
              {references.map((reference, index) => {
                const expanded = reference.reference_id === activeReferenceId;
                const preview = reference.target_excerpt.length > 180
                  ? `${reference.target_excerpt.slice(0, 180).trimEnd()}…`
                  : reference.target_excerpt;
                return (
                  <section key={reference.reference_id} className={`blogg-footnote-entry${expanded ? " is-active" : ""}`}>
                    <button
                      type="button"
                      className="blogg-footnote-entry-toggle"
                      aria-expanded={expanded}
                      onClick={() => setActiveReferenceId(expanded ? null : reference.reference_id)}
                    >
                      <span className="blogg-footnote-number">{index + 1}.</span>
                      <span className="blogg-footnote-title">{reference.target_title || "Referenced blog"}</span>
                      <span className="blogg-footnote-chevron" aria-hidden="true">{expanded ? "−" : "+"}</span>
                    </button>
                    {!expanded && <p className="blogg-footnote-preview">{preview}</p>}
                    {expanded && (
                      <div className="blogg-footnote-expanded">
                        {reference.source_excerpt && <p className="blogg-footnote-source">Linked words: “{reference.source_excerpt}”</p>}
                        <blockquote>{reference.target_excerpt}</blockquote>
                        <Link
                          to={`/read/${encodeURIComponent(reference.target_blogg_id)}?excerpt=${encodeURIComponent(reference.target_excerpt)}`}
                          onClick={() => setFootnotesOpen(false)}
                          className="blogg-footnote-open-target"
                        >
                          Open referenced blog <span aria-hidden="true">↗</span>
                        </Link>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
