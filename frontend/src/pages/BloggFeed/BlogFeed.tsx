import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import type { BloggItem } from "../../types/pageTypes";
import { API_BASE_URL } from "../../services/apiBase";
import AssetStateBox from "../../components/AssetStateBox";
import { fetchAllBloggsRequest } from "../BloggPage/services/flipBookService";
import { fetchStackAndGroup } from "../BloggPage/services/canvasViewService";
import BloggHeader from "../BloggPage/components/bloggHeader/BloggHeader";
import ShareBloggButton from "../BloggPage/components/ShareBloggButton";
import { bloggEditorSchema } from "../BloggPage/components/bloggForm/bloggEditorSchema";
import "@blocknote/mantine/style.css";
import "./blogFeed.css";

type CanvasStack = { stack_id: string; stack_name: string };
type CanvasGroup = { group_id: string; group_name: string; stack_id: string };
const EMPTY_BLOCKS: any[] = [{ type: "paragraph", content: "" }];


type MusicTrack = {
  title?: string;
  artists?: string[];
  thumbnail?: string;
  url?: string;
  album?: string;
};

type IntegrationPlaybackResponse = {
  spotify?: { playing?: boolean; track?: MusicTrack | null };
};

type YtMusicPublicResponse = {
  connected?: boolean;
  lastPlayed?: MusicTrack | null;
  tracks?: MusicTrack[];
  fallbackTrack?: MusicTrack | null;
};

type FeedNowPlayingTrack = {
  title: string;
  artists: string[];
  thumbnail?: string;
  url?: string;
  provider: "spotify" | "ytmusic";
  label: "NOW PLAYING" | "LAST PLAYED" | "PUBLIC PICK" | "LIKED TRACK";
};

async function fetchPublicJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

function validMusicTrack(
  track: MusicTrack | null | undefined,
  provider: FeedNowPlayingTrack["provider"],
  label: FeedNowPlayingTrack["label"],
): FeedNowPlayingTrack | null {
  if (!track || typeof track.title !== "string" || !track.title.trim()) return null;
  return {
    title: track.title.trim(),
    artists: Array.isArray(track.artists)
      ? track.artists.filter((artist): artist is string => typeof artist === "string" && artist.trim().length > 0)
      : [],
    thumbnail: typeof track.thumbnail === "string" ? track.thumbnail : undefined,
    url: typeof track.url === "string" ? track.url : undefined,
    provider,
    label,
  };
}

function NowPlayingTeaser({ track }: { track: FeedNowPlayingTrack | null }) {
  const songName = track?.title || "Nothing playing right now";
  const artistName = track?.artists.join(", ") || (track?.provider === "ytmusic" ? "YouTube Music" : "Waiting for playback");
  const scrollingText = track
    ? `${track.label} · ${songName} · ${artistName} ·`
    : "NOW PLAYING · NOTHING PLAYING RIGHT NOW ·";
  const artwork = track?.thumbnail
    ? <img className="blog-feed-now-playing-artwork" src={track.thumbnail} alt="" loading="lazy" />
    : <span className="blog-feed-now-playing-placeholder" aria-hidden="true">♫</span>;

  return (
    <aside
      className="blog-feed-now-playing-teaser"
      aria-label={track ? `${track.label}: ${songName}, ${artistName}` : "Now playing: no active track"}
    >
      {track?.url ? (
        <a
          className="blog-feed-now-playing-artwork-frame"
          href={track.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${songName} on ${track.provider === "spotify" ? "Spotify" : "YouTube Music"}`}
        >
          {artwork}
        </a>
      ) : (
        <div className="blog-feed-now-playing-artwork-frame">{artwork}</div>
      )}
      <div className="blog-feed-now-playing-marquee" aria-hidden="true">
        <div className="blog-feed-now-playing-marquee-track">
          <span className="blog-feed-now-playing-marquee-run">{scrollingText}</span>
          <span className="blog-feed-now-playing-marquee-run">{scrollingText}</span>
        </div>
      </div>
      <span className="blog-feed-now-playing-sr-only">{scrollingText}</span>
    </aside>
  );
}

function formatDate(value?: string) {
  if (!value) return "Recently";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Recently";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric", hour: "numeric", minute: "2-digit" });
}

function NoteBody({ content }: { content?: unknown[] }) {
  const editor = useCreateBlockNote({
    schema: bloggEditorSchema,
    initialContent: Array.isArray(content) && content.length > 0 ? (content as any[]) : EMPTY_BLOCKS,
  });
  const hasContent = Array.isArray(content) && content.length > 0;
  return <div className="blog-feed-note-body">{hasContent ? <BlockNoteView editor={editor} editable={false} theme="light" /> : <p className="blog-feed-empty-body">No body content yet.</p>}</div>;
}

function FeedPost({ blogg, stackName, groupName }: { blogg: BloggItem; stackName: string; groupName: string }) {
  const noteId = blogg.blogg_id || blogg._id;
  const noteUrl = `/read/${encodeURIComponent(noteId)}`;
  return (
    <article className="blog-feed-post-card">
      <header className="blog-feed-post-header">
        <div className="blog-feed-author-line"><span className="blog-feed-author">{blogg.author?.trim() || "Unknown author"}</span><span className="blog-feed-dot" aria-hidden="true">·</span><span className="blog-feed-location" title={`${stackName} > ${groupName}`}><span>{stackName}</span><span className="blog-feed-breadcrumb-separator">›</span><span>{groupName}</span></span></div>
        <time className="blog-feed-time" dateTime={blogg.createdAt || blogg.updatedAt || undefined}>{formatDate(blogg.createdAt || blogg.updatedAt)}</time>
      </header>
      {blogg.title?.trim() && <h2 className="blog-feed-post-title"><Link to={noteUrl}>{blogg.title}</Link></h2>}
      {blogg.subtitle?.trim() && <p className="blog-feed-post-description">{blogg.subtitle}</p>}
      <div className="blog-feed-note-preview" aria-label="Note content preview"><NoteBody content={blogg.content} /></div>
      {!!blogg.tags?.length && <div className="blog-feed-tags" aria-label="Tags">{blogg.tags.map((tag) => <span className="blog-feed-tag" key={tag}>{tag}</span>)}</div>}
      <footer className="blog-feed-post-actions"><Link className="blog-feed-open-link" to={noteUrl}>Open note</Link><ShareBloggButton blogg={blogg} stackName={stackName} groupName={groupName} /></footer>
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
  const [nowPlayingTrack, setNowPlayingTrack] = useState<FeedNowPlayingTrack | null>(null);

  const refreshNowPlaying = useCallback(async () => {
    const [integrationsResult, ytmusicResult] = await Promise.allSettled([
      fetchPublicJson<IntegrationPlaybackResponse>("/api/showcase/integrations"),
      fetchPublicJson<YtMusicPublicResponse>("/api/showcase/ytmusic/public"),
    ]);
    const integrations = integrationsResult.status === "fulfilled" ? integrationsResult.value : null;
    const ytmusic = ytmusicResult.status === "fulfilled" ? ytmusicResult.value : null;
    const spotifyTrack = integrations?.spotify?.playing
      ? validMusicTrack(integrations.spotify.track, "spotify", "NOW PLAYING")
      : null;
    const lastPlayedTrack = validMusicTrack(ytmusic?.lastPlayed, "ytmusic", "LAST PLAYED");
    const publicPick = validMusicTrack(ytmusic?.tracks?.[0], "ytmusic", "PUBLIC PICK");
    const likedMusicFallback = validMusicTrack(ytmusic?.fallbackTrack, "ytmusic", "LIKED TRACK");
    setNowPlayingTrack(spotifyTrack || lastPlayedTrack || publicPick || likedMusicFallback);
  }, []);

  const loadFeed = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const [notesResult, canvasResult] = await Promise.allSettled([fetchAllBloggsRequest(), fetchStackAndGroup()]);
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
        console.warn("Could not load public folder metadata:", canvasResult.reason);
        setStacks([]);
        setGroups([]);
      }
    } catch (error) {
      console.error("Could not load public notes from GET /bloggs:", error);
      setLoadError("unavailable");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void loadFeed(); }, [loadFeed]);
  useEffect(() => {
    void refreshNowPlaying();
    const interval = window.setInterval(() => { void refreshNowPlaying(); }, 60_000);
    return () => window.clearInterval(interval);
  }, [refreshNowPlaying]);
  const stackById = useMemo(() => new Map(stacks.map((stack) => [stack.stack_id, stack])), [stacks]);
  const groupById = useMemo(() => new Map(groups.map((group) => [group.group_id, group])), [groups]);
  const getLocation = (blogg: BloggItem) => {
    const group = groupById.get(blogg.group_id);
    const stack = stackById.get(blogg.stack_id) || (group ? stackById.get(group.stack_id) : undefined);
    return { stackName: stack?.stack_name || "Unsorted stack", groupName: group?.group_name || "Others" };
  };

  return (
    <div className="blog-feed-page typewriter-font">
      <BloggHeader page="feed" onNewNote={() => navigate("/blog?newNote=1")} />
      <main className="blog-feed-content">
        <div className="blog-feed-widget-rail" aria-label="Music and status widgets">
          <NowPlayingTeaser track={nowPlayingTrack} />
        </div>
        {isLoading ? <AssetStateBox status="loading" /> : loadError ? (
          <AssetStateBox status="error" onRetry={() => void loadFeed()} />
        ) : bloggs.length === 0 ? (
          <div className="blog-feed-state"><h2>No notes yet</h2><p>Notes published to the site will appear here.</p><Link to="/blog">Open Blog Profile</Link></div>
        ) : (
          <section className="blog-feed-post-list" aria-label="Recent notes">
            {bloggs.map((blogg) => {
              const location = getLocation(blogg);
              return <FeedPost key={blogg.blogg_id || blogg._id} blogg={blogg} stackName={location.stackName} groupName={location.groupName} />;
            })}
          </section>
        )}
      </main>
    </div>
  );
};

export default HomePage;
