import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import type { BloggItem } from "../../types/pageTypes";
import { fetchAllBloggsRequest } from "../BloggPage/services/flipBookService";
import { fetchStackAndGroup } from "../BloggPage/services/canvasViewService";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "./blogFeed.css";

type CanvasStack = { stack_id: string; stack_name: string };
type CanvasGroup = {
  group_id: string;
  group_name: string;
  stack_id: string;
};

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

  return (
    <div className="blog-feed-note-body">
      <BlockNoteView editor={editor} editable={false} theme="light" />
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

      {blogg.title?.trim() && <h2 className="blog-feed-post-title">{blogg.title}</h2>}
      {blogg.subtitle?.trim() && <p className="blog-feed-post-description">{blogg.subtitle}</p>}

      <NoteBody content={blogg.content} />

      {!!blogg.tags?.length && (
        <div className="blog-feed-tags" aria-label="Tags">
          {blogg.tags.map((tag) => (
            <span className="blog-feed-tag" key={tag}>{tag}</span>
          ))}
        </div>
      )}
    </article>
  );
}

const HomePage = () => {
  const [bloggs, setBloggs] = useState<BloggItem[]>([]);
  const [stacks, setStacks] = useState<CanvasStack[]>([]);
  const [groups, setGroups] = useState<CanvasGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const loadFeed = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const [notesResult, canvasResult] = await Promise.all([
        fetchAllBloggsRequest(),
        fetchStackAndGroup(),
      ]);

      const notes = (notesResult as BloggItem[]).slice().sort((a, b) => {
        const aTime = new Date(a.createdAt || a.updatedAt || 0).getTime() || 0;
        const bTime = new Date(b.createdAt || b.updatedAt || 0).getTime() || 0;
        return bTime - aTime;
      });

      setBloggs(notes);
      setStacks(Array.isArray(canvasResult?.stacks) ? canvasResult.stacks : []);
      setGroups(Array.isArray(canvasResult?.groups) ? canvasResult.groups : []);
    } catch (error) {
      console.error("Could not load the blog feed:", error);
      setLoadError("We couldn't load your notes. Check the backend connection and try again.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  const stackById = useMemo(
    () => new Map(stacks.map((stack) => [stack.stack_id, stack])),
    [stacks],
  );
  const groupById = useMemo(
    () => new Map(groups.map((group) => [group.group_id, group])),
    [groups],
  );

  const getLocation = (blogg: BloggItem) => {
    const group = groupById.get(blogg.group_id);
    const stack = stackById.get(blogg.stack_id) || (group ? stackById.get(group.stack_id) : undefined);
    return {
      stackName: stack?.stack_name || "Unsorted stack",
      groupName: group?.group_name || "Others",
    };
  };

  return (
    <div className="blog-feed-page">
      <header className="blog-feed-header">
        <nav className="blog-feed-header-nav" aria-label="Main navigation">
          <Link className="blog-feed-header-link is-active" to="/feed" aria-current="page">
            Blog Feed
          </Link>
          <Link className="blog-feed-header-link" to="/blog">
            Blog Profile
          </Link>
        </nav>
      </header>

      <main className="blog-feed-content">
        <div className="blog-feed-heading">
          <h1>Blog Feed</h1>
          <p>Notes from your workspace, newest first.</p>
        </div>

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
            <p>Create a note in your Blog Profile to see it here.</p>
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
