import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import type { BloggItem } from "../../types/pageTypes";
import { API_BASE_URL } from "../../services/apiBase";
import AssetStateBox from "../../components/AssetStateBox";
import { publicStateAssets } from "virtual:public-state-assets";
import { fetchBloggFeedPageRequest } from "../BloggPage/services/flipBookService";
import { fetchStackAndGroup } from "../BloggPage/services/canvasViewService";
import BloggHeader from "../BloggPage/components/bloggHeader/BloggHeader";
import ShareBloggButton from "../BloggPage/components/ShareBloggButton";
import { bloggEditorSchema } from "../BloggPage/components/bloggForm/bloggEditorSchema";
import FeedNoteWindow from "./FeedNoteWindow";
import CopyrightNotice from "../../components/CopyrightNotice";
import "@blocknote/mantine/style.css";
import "./blogFeed.css";
import "./blogFeedBackground.css";

type CanvasStack = { stack_id: string; stack_name: string };
type CanvasGroup = { group_id: string; group_name: string; stack_id: string };
const EMPTY_BLOCKS: any[] = [{ type: "paragraph", content: "" }];
const FEED_PAGE_SIZE = 12;
const FEED_BACKGROUND_PREFERENCE_KEY = "blogg-feed-background-enabled";

type MusicTrack = {
  title?: string;
  artists?: string[];
  thumbnail?: string;
  url?: string;
  album?: string;
};
type IntegrationPlaybackResponse = { spotify?: { playing?: boolean; track?: MusicTrack | null } };
type YtMusicPublicResponse = {
  connected?: boolean;
  nowPlaying?: MusicTrack | null;
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
  label: "NOW PLAYING" | "LIKED TRACK";
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

function chooseRandomPublicStateAsset(previous?: string | null): string | undefined {
  if (publicStateAssets.length === 0) return undefined;
  const alternatives = publicStateAssets.filter((asset) => asset !== previous);
  const choices = alternatives.length > 0 ? alternatives : publicStateAssets;
  return choices[Math.floor(Math.random() * choices.length)];
}

function NowPlayingTeaser({ track }: { track: FeedNowPlayingTrack | null }) {
  const [fallbackArtwork, setFallbackArtwork] = useState<string | undefined>(() => chooseRandomPublicStateAsset(null));
  const [failedTrackThumbnail, setFailedTrackThumbnail] = useState<string | null>(null);

  useEffect(() => {
    setFailedTrackThumbnail(null);
    if (!track?.thumbnail) setFallbackArtwork((current) => chooseRandomPublicStateAsset(current));
  }, [track?.thumbnail]);

  const songName = track?.title || "Nothing playing right now";
  const artistName = track?.artists.join(", ") || (track?.provider === "ytmusic" ? "YouTube Music" : "Waiting for playback");
  const scrollingText = track ? `${track.label} · ${songName} · ${artistName} ·` : "NOW PLAYING · NOTHING PLAYING RIGHT NOW ·";
  const activeArtwork = track?.thumbnail && failedTrackThumbnail !== track.thumbnail ? track.thumbnail : fallbackArtwork;
  const handleArtworkError = () => {
    if (track?.thumbnail && activeArtwork === track.thumbnail) setFailedTrackThumbnail(track.thumbnail);
    else setFallbackArtwork((current) => chooseRandomPublicStateAsset(current));
  };
  const artwork = activeArtwork ? (
    <img key={activeArtwork} className="blog-feed-now-playing-artwork" src={activeArtwork} alt="" loading="lazy" onError={handleArtworkError} />
  ) : <span className="blog-feed-now-playing-placeholder" aria-hidden="true">♫</span>;

  return (
    <aside className="blog-feed-now-playing-teaser" aria-label={track ? `${track.label}: ${songName}, ${artistName}` : "Now playing: no active track"}>
      {track?.url && track.thumbnail && activeArtwork === track.thumbnail ? (
        <a className="blog-feed-now-playing-artwork-frame" href={track.url} target="_blank" rel="noreferrer" aria-label={`Open ${songName} on ${track.provider === "spotify" ? "Spotify" : "YouTube Music"}`}>
          {artwork}
        </a>
      ) : <div className="blog-feed-now-playing-artwork-frame">{artwork}</div>}
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

function formatDate(value?: string | Date) {
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
    schema: bloggEditorSchema,
    initialContent: Array.isArray(content) && content.length > 0 ? (content as any[]) : EMPTY_BLOCKS,
  });
  const hasContent = Array.isArray(content) && content.length > 0;
  return (
    <div className="blog-feed-note-body">
      {hasContent ? <BlockNoteView editor={editor} editable={false} theme="light" /> : <p className="blog-feed-empty-body">No body content yet.</p>}
    </div>
  );
}

function FeedPost({ blogg, stackName, groupName, onOpenWindow }: {
  blogg: BloggItem;
  stackName: string;
  groupName: string;
  onOpenWindow: (blogg: BloggItem) => void;
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
            <span>{stackName}</span><span className="blog-feed-breadcrumb-separator">›</span><span>{groupName}</span>
          </span>
        </div>
        <time className="blog-feed-time" dateTime={blogg.createdAt || blogg.updatedAt || undefined}>{formatDate(blogg.createdAt || blogg.updatedAt)}</time>
      </header>
      {blogg.title?.trim() && <h2 className="blog-feed-post-title"><Link to={noteUrl}>{blogg.title}</Link></h2>}
      {blogg.subtitle?.trim() && <p className="blog-feed-post-description">{blogg.subtitle}</p>}
      <div className="blog-feed-note-preview" aria-label="Note content preview"><NoteBody content={blogg.content} /></div>
      {!!blogg.tags?.length && <div className="blog-feed-tags" aria-label="Tags">{blogg.tags.map((tag) => <span className="blog-feed-tag" key={tag}>{tag}</span>)}</div>}
      <footer className="blog-feed-post-actions">
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <button
            type="button"
            className="blog-feed-open-link"
            style={{ padding: 0, border: 0, background: "transparent", fontFamily: "inherit", cursor: "pointer" }}
            onClick={() => onOpenWindow(blogg)}
            aria-label={`Open ${blogg.title?.trim() || "note"} in mini window`}
          >Open window</button>
          <Link className="blog-feed-open-link" to={noteUrl}>Open note</Link>
        </div>
        <ShareBloggButton blogg={blogg} stackName={stackName} groupName={groupName} />
      </footer>
      <CopyrightNotice enabled={blogg.showCopyright} holder={blogg.copyrightHolder} author={blogg.author} createdAt={blogg.createdAt} />
    </article>
  );
}

const buttonStyle: CSSProperties = {
  border: "1px solid #9ca3af",
  borderRadius: 6,
  padding: "8px 14px",
  background: "#fff",
  color: "#111827",
  fontFamily: "inherit",
  cursor: "pointer",
};

const HomePage = () => {
  const navigate = useNavigate();
  const [bloggs, setBloggs] = useState<BloggItem[]>([]);
  const [stacks, setStacks] = useState<CanvasStack[]>([]);
  const [groups, setGroups] = useState<CanvasGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([null]);
  const [nowPlayingTrack, setNowPlayingTrack] = useState<FeedNowPlayingTrack | null>(null);
  const [feedBackgroundUrl, setFeedBackgroundUrl] = useState("/feed-background.jpg");
  const [feedBackgroundEnabled] = useState<boolean>(() => {
    try {
      const storedPreference = window.localStorage.getItem(FEED_BACKGROUND_PREFERENCE_KEY);
      return storedPreference === null ? true : storedPreference === "true";
    } catch {
      return true;
    }
  });
  const [windowBlog, setWindowBlog] = useState<BloggItem | null>(null);
  const [windowInstance, setWindowInstance] = useState(0);

  const openFeedWindow = useCallback((blogg: BloggItem) => {
    setWindowBlog(blogg);
    setWindowInstance((value) => value + 1);
  }, []);

  const closeFeedWindow = useCallback(() => setWindowBlog(null), []);


  const refreshNowPlaying = useCallback(async () => {
    const [integrationsResult, ytmusicResult] = await Promise.allSettled([
      fetchPublicJson<IntegrationPlaybackResponse>("/api/showcase/integrations"),
      fetchPublicJson<YtMusicPublicResponse>("/api/showcase/ytmusic/public"),
    ]);
    const integrations = integrationsResult.status === "fulfilled" ? integrationsResult.value : null;
    const ytmusic = ytmusicResult.status === "fulfilled" ? ytmusicResult.value : null;
    const selectedTrack = validMusicTrack(ytmusic?.nowPlaying, "ytmusic", "NOW PLAYING");
    const spotifyTrack = integrations?.spotify?.playing ? validMusicTrack(integrations.spotify.track, "spotify", "NOW PLAYING") : null;
    const likedMusicFallback = validMusicTrack(ytmusic?.fallbackTrack, "ytmusic", "LIKED TRACK");
    setNowPlayingTrack(selectedTrack || spotifyTrack || likedMusicFallback);
  }, []);

  const loadFeed = useCallback(async (cursor: string | null = null): Promise<boolean> => {
    setIsLoading(true);
    setLoadError("");
    try {
      const page = await fetchBloggFeedPageRequest(cursor, FEED_PAGE_SIZE);
      setBloggs(page.bloggs);
      setNextCursor(page.nextCursor);
      return true;
    } catch (error) {
      console.error("Could not load a page of public notes from GET /bloggs/feed:", error);
      setLoadError("unavailable");
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void loadFeed(null); }, [loadFeed]);

  useEffect(() => {
    let cancelled = false;
    fetchPublicJson<{ url?: string | null }>("/api/showcase/feed-background")
      .then((setting) => { if (!cancelled && typeof setting?.url === "string" && setting.url.trim()) setFeedBackgroundUrl(setting.url); })
      .catch(() => { /* Keep the bundled starter background when no upload has been saved yet. */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchStackAndGroup({ publicReadOnly: true })
      .then((data) => {
        if (cancelled) return;
        setStacks(Array.isArray(data?.stacks) ? data.stacks : []);
        setGroups(Array.isArray(data?.groups) ? data.groups : []);
      })
      .catch((error) => {
        console.warn("Could not load public folder metadata:", error);
        if (!cancelled) { setStacks([]); setGroups([]); }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    void refreshNowPlaying();
    const interval = window.setInterval(() => { void refreshNowPlaying(); }, 300_000);
    return () => window.clearInterval(interval);
  }, [refreshNowPlaying]);

  const stackById = useMemo(() => new Map(stacks.map((stack) => [stack.stack_id, stack])), [stacks]);
  const groupById = useMemo(() => new Map(groups.map((group) => [group.group_id, group])), [groups]);
  const getLocation = (blogg: BloggItem) => {
    const group = groupById.get(blogg.group_id);
    const stack = stackById.get(blogg.stack_id) || (group ? stackById.get(group.stack_id) : undefined);
    return { stackName: stack?.stack_name || "Unsorted stack", groupName: group?.group_name || "Others" };
  };

  const goToNextPage = useCallback(async () => {
    if (isLoading || !nextCursor) return;
    const cursor = nextCursor;
    if (await loadFeed(cursor)) setCursorHistory((previous) => [...previous, cursor]);
  }, [isLoading, loadFeed, nextCursor]);

  const goToPreviousPage = useCallback(async () => {
    if (isLoading || cursorHistory.length < 2) return;
    const previousHistory = cursorHistory.slice(0, -1);
    const previousCursor = previousHistory[previousHistory.length - 1] ?? null;
    if (await loadFeed(previousCursor)) setCursorHistory(previousHistory);
  }, [cursorHistory, isLoading, loadFeed]);

  const currentCursor = cursorHistory[cursorHistory.length - 1] ?? null;

  return (
    <div
      className={`blog-feed-page typewriter-font${feedBackgroundEnabled ? " has-feed-background" : ""}`}
      style={{ "--blog-feed-background-image": `url(${JSON.stringify(feedBackgroundUrl)})` } as CSSProperties}
    >
      <BloggHeader page="feed" onNewNote={() => navigate("/blog?newNote=1")} />
      <main className="blog-feed-content">
        <div className="blog-feed-widget-rail" aria-label="Music and status widgets">
          <NowPlayingTeaser track={nowPlayingTrack} />
        </div>
        {isLoading ? <AssetStateBox status="loading" /> : loadError ? <AssetStateBox status="error" onRetry={() => void loadFeed(currentCursor)} /> : bloggs.length === 0 ? (
          <div className="blog-feed-state"><h2>No blogs yet</h2><p>Notes published to the site will appear here.</p><Link to="/blog">Open Blog Profile</Link></div>
        ) : (
          <>
            <section className="blog-feed-post-list" aria-label="Recent notes">
              {bloggs.map((blogg) => {
                const location = getLocation(blogg);
                return <FeedPost key={blogg.blogg_id || blogg._id} blogg={blogg} stackName={location.stackName} groupName={location.groupName} onOpenWindow={openFeedWindow} />;
              })}
            </section>
            <nav aria-label="Feed pagination" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "24px 12px" }}>
              <button type="button" style={{ ...buttonStyle, opacity: cursorHistory.length > 1 ? 1 : 0.45 }} disabled={isLoading || cursorHistory.length < 2} onClick={() => void goToPreviousPage()}>Newer notes</button>
              <span aria-live="polite" style={{ fontSize: 12, color: "#6b7280" }}>Page {cursorHistory.length} · {FEED_PAGE_SIZE} notes per page</span>
              <button type="button" style={{ ...buttonStyle, opacity: nextCursor ? 1 : 0.45 }} disabled={isLoading || !nextCursor} onClick={() => void goToNextPage()}>Older notes</button>
            </nav>
          </>
        )}
      </main>
      {windowBlog && <FeedNoteWindow key={windowInstance} blogg={windowBlog} onClose={closeFeedWindow} />}
    </div>
  );
};

export default HomePage;
