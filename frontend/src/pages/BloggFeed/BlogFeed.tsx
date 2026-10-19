import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import type { BloggItem } from "../../types/pageTypes";
import { fetchAllBloggsRequest } from "../BloggPage/services/flipBookService";
import { fetchStackAndGroup } from "../BloggPage/services/canvasViewService";
import BloggHeader from "../BloggPage/components/bloggHeader/BloggHeader";
import ShareBloggButton from "../BloggPage/components/ShareBloggButton";
import "@blocknote/mantine/style.css";
import "./blogFeed.css";

type CanvasStack = { stack_id: string; stack_name: string };
type CanvasGroup = { group_id: string; group_name: string; stack_id: string };
const EMPTY_BLOCKS: any[] = [{ type: "paragraph", content: "" }];

function formatDate(value?: string) {
  if (!value) return "Recently";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Recently";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function NoteBody({ content }: { content?: unknown[] }) {
  const editor = useCreateBlockNote({
    initialContent:
      Array.isArray(content) && content.length > 0
        ? (content as any[])
        : EMPTY_BLOCKS,
  });
  const hasContent = Array.isArray(content) && content.length > 0;

  return (
    <div className="blog-feed-note-body">
      {hasContent ? (
        <BlockNoteView editor={editor} editable={false} theme="light" formattingToolbar={false} />
      ) : (
        <p className="blog-feed-empty-body">No body content yet.</p>
      )}
    </div>
  );
}

function FeedPost({
  blogg,
  stackName,
  groupName,
}: {
  blogg: BloggItem;
  stackName: string;
  groupName: string;
}) {
  const noteId = blogg.blogg_id || blogg._id;
  const noteUrl = `/read/${encodeURIComponent(noteId)}`;

  return (
    <article className="blog-feed-post-card">
      <header className="blog-feed-post-header">
        <div className="blog-feed-author-line">
          <span className="blog-feed-author">{blogg.author?.trim() || "Unknown author"}</span>
          <span className="blog-feed-dot" aria-hidden="true">·</span>
          <span className="blog-feed-location" title={`${stackName} > ${groupName}`}>
            <span>{stackName}</span>
            <span className="blog-feed-breadcrumb-separator">›</span>
            <span>{groupName}</span>
          </span>
        </div>
        <time className="blog-feed-time" dateTime={blogg.createdAt || blogg.updatedAt || undefined}>
          {formatDate(blogg.createdAt || blogg.updatedAt)}
        </time>
      </header>

      {blogg.title?.trim() && (
        <h2 className="blog-feed-post-title">
          <Link to={noteUrl}>{blogg.title}</Link>
        </h2>
      )}
      {blogg.subtitle?.trim() && <p className="blog-feed-post-description">{blogg.subtitle}</p>}
      <div className="blog-feed-note-preview" aria-label="Note content preview">
        <NoteBody content={blogg.content} />
      </div>

      {!!blogg.tags?.length && (
        <div className="blog-feed-tags" aria-label="Tags">
          {blogg.tags.map((tag) => <span className="blog-feed-tag" key={tag}>{tag}</span>)}
        </div>
      )}

      <footer className="blog-feed-post-actions">
        <Link className="blog-feed-open-link" to={noteUrl}>Open note</Link>
        <ShareBloggButton blogg={blogg} stackName={stackName} groupName={groupName} />
      </footer>
    </article>
  );
}

const HomePage = () => {
  const navigate = useNavigate();
  const [bloggs, setBloggs] = useState<BloggItem[]>([]);
  const [stacks, setStacks] = useState<CanvasStack[]>([]);
  const [groups, setGroups] = useState<CanvasGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const loadFeed = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      // Notes are the primary public content. Folder metadata is supplemental,
      // so a failure in /stackAndGroup must not hide notes that /bloggs loaded.
      const [notesResult, canvasResult] = await Promise.allSettled([
        fetchAllBloggsRequest(),
        fetchStackAndGroup(),
      ]);

      if (notesResult.status === "rejected") throw notesResult.reason;

      const notes = (notesResult.value as BloggItem[]).slice().sort((a, b) => {
        const aTime = new Date(a.createdAt || a.updatedAt || 0).getTime() || 0;
        const bTime = new Date(b.createdAt || b.updatedAt || 0).getTime() || 0;
        return bTime - aTime;
      });
      setBloggs(notes);

      if (canvasResult.status === "fulfilled") {
        setStacks(Array.isArray(canvasResult.value?.stacks) ? canvasResult.value.stacks : []);
        setGroups(Array.isArray(canvasResult.value?.groups) ? canvasResult.value.groups : []);
      } else {
        // Folder labels can fall back to "Unsorted stack > Others". Keep the
        // public feed readable even if the folder metadata endpoint is failing.
        console.warn("Could not load public folder metadata:", canvasResult.reason);
        setStacks([]);
        setGroups([]);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error("Could not load public notes from GET /bloggs:", error);
      setLoadError(`We couldn't load public notes from the backend. ${reason}. Check GET /bloggs, the backend URL, and MongoDB connection.`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void loadFeed(); }, [loadFeed]);

  const stackById = useMemo(() => new Map(stacks.map((stack) => [stack.stack_id, stack])), [stacks]);
  const groupById = useMemo(() => new Map(groups.map((group) => [group.group_id, group])), [groups]);

  const getLocation = (blogg: BloggItem) => {
    const group = groupById.get(blogg.group_id);
    const stack = stackById.get(blogg.stack_id) || (group ? stackById.get(group.stack_id) : undefined);
    return {
      stackName: stack?.stack_name || "Unsorted stack",
      groupName: group?.group_name || "Others",
    };
  };

  return (
    <div className="blog-feed-page typewriter-font">
      <BloggHeader page="feed" onNewNote={() => navigate("/blog?newNote=1")} />
      <main className="blog-feed-content">
        {isLoading ? (
          <div className="blog-feed-state" role="status">Loading notes…</div>
        ) : loadError ? (
          <div className="blog-feed-state blog-feed-state-error">
            <p>{loadError}</p>
            <button type="button" onClick={() => void loadFeed()}>Try again</button>
          </div>
        ) : bloggs.length === 0 ? (
          <div className="blog-feed-state">
            <h2>No notes yet</h2>
            <p>Notes published to the site will appear here.</p>
            <Link to="/blog">Open Blog Profile</Link>
          </div>
        ) : (
          <section className="blog-feed-post-list" aria-label="Recent notes">
            {bloggs.map((blogg) => {
              const location = getLocation(blogg);
              return (
                <FeedPost
                  key={blogg.blogg_id || blogg._id}
                  blogg={blogg}
                  stackName={location.stackName}
                  groupName={location.groupName}
                />
              );
            })}
          </section>
        )}
      </main>
    </div>
  );
};

export default HomePage;
