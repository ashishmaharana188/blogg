import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/authContext";
import { API_BASE_URL } from "../../services/apiBase";
import {
  fetchAdminPresence,
  updateAdminPresence,
  type AdminActivity,
  type AdminPresence,
} from "../../services/adminStatusService";
import "./accountPage.css";

const ACTIVITIES: AdminActivity[] = ["Writing", "Reading", "Editing"];

type ShowcaseLink = {
  id: string;
  url: string;
  title: string;
  description?: string;
  image?: string;
  provider: string;
  visible: boolean;
  order: number;
};
type Song = {
  title: string;
  artists: string[];
  album?: string;
  thumbnail?: string;
  url?: string;
  videoId?: string;
};
type YoutubePlaylist = {
  id: string;
  title: string;
  description: string;
  thumbnail?: string;
  url: string;
  itemCount: number;
};
type YoutubeDisplayMode = "playlist" | "rows";
type PlaylistVideosState = { loading: boolean; items: Song[]; error?: string };
type YoutubePlaylistsResponse = {
  configured: boolean;
  connected: boolean;
  mode: YoutubeDisplayMode;
  playlists: YoutubePlaylist[];
};
type IntegrationStatus = { configured: boolean; connected: boolean; message?: string };
type IntegrationsResponse = {
  spotify: IntegrationStatus & { playing: boolean; track?: Song | null; provider?: string };
  youtube: IntegrationStatus;
  ytmusic: IntegrationStatus;
};

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || body.detail || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

function ProviderMark({ provider }: { provider: string }) {
  const labels: Record<string, string> = {
    youtube: "YT",
    spotify: "SPOTIFY",
    ytmusic: "YT MUSIC",
    blogg: "BLOGG",
    web: "LINK",
  };
  return <span className="showcase-provider-mark">{labels[provider] || provider.toUpperCase()}</span>;
}

function showcaseProviderLabel(item: ShowcaseLink): string {
  if (item.provider === "blogg") return "BLOGG NOTE";
  if (item.provider === "web") {
    try { return new URL(item.url).hostname.replace(/^www\./i, "").toUpperCase(); }
    catch { return "WEBSITE"; }
  }
  return item.provider.toUpperCase();
}

function ShowcaseCard({
  item,
  onVisibility,
  onDelete,
  editable,
}: {
  item: ShowcaseLink;
  editable: boolean;
  onVisibility?: (item: ShowcaseLink) => void;
  onDelete?: (item: ShowcaseLink) => void;
}) {
  return (
    <article className="showcase-link-card">
      {item.image ? (
        <a className="showcase-link-image" href={item.url} target="_blank" rel="noreferrer">
          <img src={item.image} alt="" loading="lazy" />
        </a>
      ) : (
        <a className="showcase-link-image showcase-link-no-image" href={item.url} target="_blank" rel="noreferrer">
          <ProviderMark provider={item.provider} />
        </a>
      )}
      <div className="showcase-link-body">
        <p className="showcase-card-provider">{showcaseProviderLabel(item)}</p>
        <a href={item.url} target="_blank" rel="noreferrer" className="showcase-link-title">{item.title}</a>
        {item.description && <p className="showcase-link-description">{item.description}</p>}
        {editable && (
          <div className="showcase-link-actions">
            <button type="button" onClick={() => onVisibility?.(item)}>
              {item.visible ? "Hide from visitors" : "Show to visitors"}
            </button>
            <button type="button" onClick={() => onDelete?.(item)} className="is-danger">Remove</button>
          </div>
        )}
      </div>
    </article>
  );
}

function MusicTrack({ song, onFeature }: { song: Song; onFeature?: (song: Song) => void }) {
  return (
    <div className="showcase-track">
      {song.thumbnail ? (
        <img src={song.thumbnail} alt="" loading="lazy" />
      ) : (
        <div className="showcase-track-empty" aria-hidden="true">♪</div>
      )}
      <div className="showcase-track-copy">
        <strong>{song.title}</strong>
        <span>{song.artists.join(", ") || "Unknown artist"}{song.album ? ` · ${song.album}` : ""}</span>
      </div>
      {song.url && <a href={song.url} target="_blank" rel="noreferrer">Open ↗</a>}
      {song.url && onFeature && <button type="button" className="showcase-track-feature" onClick={() => onFeature(song)}>Feature</button>}
    </div>
  );
}

function YoutubePlaylistCard({ playlist }: { playlist: YoutubePlaylist }) {
  return (
    <a className="showcase-youtube-playlist-card" href={playlist.url} target="_blank" rel="noreferrer">
      {playlist.thumbnail ? <img src={playlist.thumbnail} alt="" loading="lazy" /> : <div className="showcase-youtube-playlist-placeholder" aria-hidden="true">▶</div>}
      <div className="showcase-youtube-playlist-copy">
        <strong>{playlist.title}</strong>
        <span>{playlist.itemCount} {playlist.itemCount === 1 ? "video" : "videos"}</span>
        {playlist.description && <p>{playlist.description}</p>}
        <span className="showcase-youtube-playlist-open">Open playlist ↗</span>
      </div>
    </a>
  );
}

function YoutubePlaylistRows({
  playlist,
  videos,
  onFeature,
  onLoad,
}: {
  playlist: YoutubePlaylist;
  videos?: PlaylistVideosState;
  onFeature?: (song: Song) => void;
  onLoad: (playlistId: string) => void;
}) {
  const sectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (videos || !sectionRef.current) return;
    const section = sectionRef.current;
    if (typeof IntersectionObserver === "undefined") {
      onLoad(playlist.id);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        onLoad(playlist.id);
      }
    }, { rootMargin: "600px 0px" });
    observer.observe(section);
    return () => observer.disconnect();
  }, [onLoad, playlist.id, videos]);

  return (
    <section ref={sectionRef} className="showcase-youtube-playlist-rows" aria-label={playlist.title}>
      <div className="showcase-youtube-playlist-heading">
        <div>
          <h3>{playlist.title}</h3>
          <span>{playlist.itemCount} {playlist.itemCount === 1 ? "video" : "videos"}</span>
        </div>
        <a href={playlist.url} target="_blank" rel="noreferrer">Open playlist ↗</a>
      </div>
      {playlist.description && <p className="showcase-youtube-playlist-description">{playlist.description}</p>}
      {videos?.loading ? <p className="showcase-empty showcase-playlist-loading">Loading playlist videos…</p> : !videos ? <p className="showcase-empty showcase-playlist-loading">Videos load as this playlist comes into view.</p> : videos.error ? <p className="showcase-empty">{videos.error}</p> : videos.items.length ? (
        <div className="showcase-track-list">{videos.items.map((song, index) => <MusicTrack song={song} key={song.videoId || `${playlist.id}-${index}`} onFeature={onFeature} />)}</div>
      ) : <p className="showcase-empty">This playlist has no accessible videos.</p>}
    </section>
  );
}

export default function AccountPage() {
  const navigate = useNavigate();
  const { user, isAdmin, loading, logout, refreshUser } = useAuth();
  const [presence, setPresence] = useState<AdminPresence>({ online: false, activity: "Offline", lastSeen: null });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState<ShowcaseLink[]>([]);
  const [linksLoading, setLinksLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkMessage, setLinkMessage] = useState("");
  const [nowPlaying, setNowPlaying] = useState<IntegrationsResponse["spotify"]>({
    configured: false, connected: false, playing: false,
  });
  const [youtubePlaylists, setYoutubePlaylists] = useState<YoutubePlaylist[]>([]);
  const [youtubeMode, setYoutubeMode] = useState<YoutubeDisplayMode>("playlist");
  const [youtubeConnected, setYoutubeConnected] = useState(false);
  const [youtubeConfigured, setYoutubeConfigured] = useState(false);
  const [youtubePlaylistsLoading, setYoutubePlaylistsLoading] = useState(true);
  const [youtubePlaylistsError, setYoutubePlaylistsError] = useState("");
  const [youtubePlaylistVideos, setYoutubePlaylistVideos] = useState<Record<string, PlaylistVideosState>>({});
  const [likedMusic, setLikedMusic] = useState<Song[]>([]);
  const [integrationState, setIntegrationState] = useState<Record<string, IntegrationStatus>>({});

  const refreshPresence = useCallback(async () => {
    try {
      setPresence(await fetchAdminPresence());
    } catch {
      // Presence is informational. A status failure must not break this page.
    }
  }, []);

  const refreshShowcase = useCallback(async () => {
    try {
      const data = await api<{ items: ShowcaseLink[] }>("/api/showcase");
      setLinks(data.items || []);
    } catch {
      // The showcase can be unavailable during initial deployment.
    } finally {
      setLinksLoading(false);
    }
  }, []);

  const refreshIntegrations = useCallback(async () => {
    try {
      const data = await api<IntegrationsResponse>("/api/showcase/integrations");
      setIntegrationState({ spotify: data.spotify, youtube: data.youtube, ytmusic: data.ytmusic });
      setNowPlaying(data.spotify);
    } catch {
      // Keep the account and activity card usable if an external integration is unavailable.
    }
  }, []);

  const loadYoutubePlaylistVideos = useCallback(async (playlistId: string) => {
    setYoutubePlaylistVideos((current) => ({
      ...current,
      [playlistId]: { loading: true, items: current[playlistId]?.items || [] },
    }));
    try {
      const data = await api<{ items: Song[] }>(`/api/showcase/youtube/playlists/${encodeURIComponent(playlistId)}/videos`);
      setYoutubePlaylistVideos((current) => ({ ...current, [playlistId]: { loading: false, items: data.items || [] } }));
    } catch (error) {
      setYoutubePlaylistVideos((current) => ({
        ...current,
        [playlistId]: { loading: false, items: [], error: error instanceof Error ? error.message : "Could not load playlist videos." },
      }));
    }
  }, []);

  const refreshYoutubePlaylists = useCallback(async () => {
    setYoutubePlaylistsLoading(true);
    setYoutubePlaylistsError("");
    try {
      const data = await api<YoutubePlaylistsResponse>("/api/showcase/youtube/playlists");
      const playlists = Array.isArray(data.playlists) ? data.playlists : [];
      const mode = data.mode === "rows" ? "rows" : "playlist";
      setYoutubePlaylists(playlists);
      setYoutubeMode(mode);
      setYoutubeConnected(Boolean(data.connected));
      setYoutubeConfigured(Boolean(data.configured));
    } catch (error) {
      setYoutubePlaylists([]);
      setYoutubePlaylistsError(error instanceof Error ? error.message : "Could not load public YouTube playlists.");
    } finally {
      setYoutubePlaylistsLoading(false);
    }
  }, []);

  const refreshLikedLibraries = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const data = await api<{ items: Song[] }>("/api/showcase/ytmusic/liked");
      setLikedMusic(data.items || []);
    } catch {
      setLikedMusic([]);
    }
  }, [isAdmin]);

  const changeYoutubeMode = async (mode: YoutubeDisplayMode) => {
    const previousMode = youtubeMode;
    setYoutubeMode(mode);
    setYoutubePlaylistsError("");
    try {
      await api("/api/admin/showcase/youtube/display-mode", { method: "POST", body: JSON.stringify({ mode }) });
    } catch (error) {
      setYoutubeMode(previousMode);
      setYoutubePlaylistsError(error instanceof Error ? error.message : "Could not save the YouTube display mode.");
    }
  };

  useEffect(() => {
    if (isAdmin) {
      void updateAdminPresence().then(refreshPresence).catch(() => {
        void refreshUser();
        void refreshPresence();
      });
    } else {
      void refreshPresence();
    }
    const pollId = window.setInterval(() => { void refreshPresence(); }, 20_000);
    const heartbeatId = isAdmin
      ? window.setInterval(() => { void updateAdminPresence().catch(() => refreshUser()); }, 30_000)
      : null;
    return () => {
      window.clearInterval(pollId);
      if (heartbeatId !== null) window.clearInterval(heartbeatId);
    };
  }, [refreshPresence, refreshUser, isAdmin]);

  useEffect(() => {
    void refreshShowcase();
    void refreshIntegrations();
    void refreshYoutubePlaylists();
    const pollId = window.setInterval(() => { void refreshIntegrations(); }, 30_000);
    return () => window.clearInterval(pollId);
  }, [refreshShowcase, refreshIntegrations, refreshYoutubePlaylists]);

  useEffect(() => {
    if (isAdmin) void refreshLikedLibraries();
  }, [isAdmin, refreshLikedLibraries]);

  const changeActivity = async (activity: AdminActivity) => {
    setBusy(true);
    setMessage("");
    try {
      await updateAdminPresence({ activity });
      await refreshPresence();
      setMessage(`Activity set to ${activity}.`);
    } catch {
      setMessage("Could not update activity. Check your admin session.");
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    try {
      await updateAdminPresence({ online: false }).catch(() => undefined);
      await logout();
      navigate("/feed", { replace: true });
    } finally {
      setBusy(false);
    }
  };

  const addLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLinkBusy(true);
    setLinkMessage("");
    try {
      await api("/api/admin/showcase/links", { method: "POST", body: JSON.stringify({ url }) });
      setUrl("");
      await refreshShowcase();
      setLinkMessage("Link added. It remains hidden until you publish it.");
    } catch (error) {
      setLinkMessage(error instanceof Error ? error.message : "Could not add this link.");
    } finally {
      setLinkBusy(false);
    }
  };

  const featureSong = async (song: Song) => {
    if (!song.url) return;
    setLinkMessage("");
    try {
      await api("/api/admin/showcase/links", { method: "POST", body: JSON.stringify({ url: song.url, title: song.title }) });
      await refreshShowcase();
      setLinkMessage(`Added “${song.title}” to Featured links. Publish it from that card when ready.`);
    } catch (error) {
      setLinkMessage(error instanceof Error ? error.message : "Could not feature this item.");
    }
  };

  const toggleLink = async (item: ShowcaseLink) => {
    try {
      await api(`/api/admin/showcase/links/${encodeURIComponent(item.id)}`, {
        method: "PATCH", body: JSON.stringify({ visible: !item.visible }),
      });
      await refreshShowcase();
    } catch (error) {
      setLinkMessage(error instanceof Error ? error.message : "Could not update visibility.");
    }
  };

  const removeLink = async (item: ShowcaseLink) => {
    try {
      await api(`/api/admin/showcase/links/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      await refreshShowcase();
    } catch (error) {
      setLinkMessage(error instanceof Error ? error.message : "Could not remove this link.");
    }
  };

  const connect = async (provider: "spotify" | "youtube" | "ytmusic") => {
    // Start OAuth with fetch while the Vercel page is still the top-level site.
    // Firefox may partition cross-site cookies, so navigating directly to Render
    // can omit the admin cookie even when authenticated API fetches work.
    setLinkMessage("");
    try {
      const result = await api<{ authorizationUrl?: string; message?: string }>(
        `/api/admin/integrations/${provider}/connect`,
        { headers: { Accept: "application/json" } },
      );
      if (result.authorizationUrl) {
        window.location.assign(result.authorizationUrl);
        return;
      }
      if (result.message) setLinkMessage(result.message);
      else setLinkMessage(`Could not start the ${provider} connection.`);
    } catch (error) {
      setLinkMessage(error instanceof Error ? error.message : `Could not connect ${provider}.`);
    }
  };
  const integration = (provider: string): IntegrationStatus => integrationState[provider] || { configured: false, connected: false };
  const visibleLinks = links.filter((item) => isAdmin || item.visible);

  return (
    <div className="account-page typewriter-font">
      <div className="account-page-shell">
        <header className="account-page-header">
          <Link to="/feed" className="account-page-nav-link">BLOG FEED</Link>
          <span className="account-page-rule" aria-hidden="true" />
          <Link to="/blog" className="account-page-nav-link">BLOG PROFILE</Link>
        </header>

        <main className="account-page-main account-page-main-stack">
          {/* Existing status panel intentionally retains its behavior and choices. */}
          <section className="account-status-card" aria-labelledby="account-status-heading">
            <p className="account-eyebrow">SITE ACCOUNT</p>
            <h1 id="account-status-heading" className="account-status-title">Administrator status</h1>
            <div className="account-presence-row" aria-live="polite">
              <span className={`account-presence-pill ${presence.online ? "is-online" : "is-offline"}`}>
                <span className="account-presence-dot" />{presence.online ? "Online" : "Offline"}
              </span>
              {presence.online && <span className="account-activity-pill">{presence.activity}</span>}
            </div>
            {isAdmin ? <>
              <p className="account-description">
                Signed in as the site administrator{user?.email ? ` (${user.email})` : ""}. Public visitors can read the site; only this account can change its content.
              </p>
              <label className="account-field-label" htmlFor="admin-activity">Your current activity</label>
              <select
                id="admin-activity"
                value={ACTIVITIES.includes(presence.activity as AdminActivity) ? presence.activity : "Reading"}
                disabled={busy}
                onChange={(event) => void changeActivity(event.target.value as AdminActivity)}
                className="account-activity-select"
              >
                {ACTIVITIES.map((activity) => <option key={activity} value={activity}>{activity}</option>)}
              </select>
              {message && <p className="account-message" role="status">{message}</p>}
              <div className="account-card-footer">
                <button type="button" disabled={busy} onClick={() => void handleLogout()} className="account-secondary-button">
                  {busy ? "Please wait…" : "Log out"}
                </button>
              </div>
            </> : <>
              <p className="account-description">
                The site is public and read-only for visitors. The administrator account is the only account that can create or edit notes, folders, and stacks.
              </p>
              <div className="account-card-footer"><Link to="/login" className="account-primary-link">Administrator login</Link></div>
              {!loading && <p className="account-footnote">No public registration is available.</p>}
            </>}
          </section>

          <section className="account-showcase-section">
            <div className="showcase-section-heading">
              <div><p className="account-eyebrow">A LITTLE CURRENTLY</p><h2>Now playing</h2><p>What’s playing on Spotify right now, when the connection is enabled.</p></div>
              {isAdmin && <button type="button" className="showcase-outline-button" onClick={() => connect("spotify")}>{integration("spotify").connected ? "Reconnect Spotify" : "Connect Spotify"}</button>}
            </div>
            {nowPlaying.playing && nowPlaying.track ? (
              <div className="showcase-now-playing">
                {nowPlaying.track.thumbnail ? <img className="showcase-now-cover" src={nowPlaying.track.thumbnail} alt="Album artwork" /> : <div className="showcase-now-cover showcase-track-empty">♪</div>}
                <div className="showcase-now-copy">
                  <span className="showcase-live-dot">● LIVE</span><h3>{nowPlaying.track.title}</h3><p>{nowPlaying.track.artists.join(", ")}</p>
                  {nowPlaying.track.album && <span>{nowPlaying.track.album}</span>}
                  {nowPlaying.track.url && <a href={nowPlaying.track.url} target="_blank" rel="noreferrer">Listen on Spotify ↗</a>}
                </div>
              </div>
            ) : <p className="showcase-empty">{nowPlaying.message || (nowPlaying.connected ? "Nothing is playing on Spotify right now." : "Spotify is not connected yet.")}</p>}
            {isAdmin && integration("spotify").configured && <p className="showcase-admin-hint">{integration("spotify").connected ? "Spotify connected. Playback refreshes approximately every 30 seconds." : "App credentials are configured. Connect your Spotify account to finish setup."}</p>}
          </section>

          <section className="account-showcase-section">
            <div className="showcase-section-heading">
              <div><p className="account-eyebrow">YOUTUBE LIBRARY</p><h2>Public playlists</h2><p>Public playlists owned by the connected YouTube account. Visitors only receive playlist metadata and videos from public playlists.</p></div>
              {isAdmin && <button type="button" className="showcase-outline-button" onClick={() => connect("youtube")}>{integration("youtube").connected ? "Reconnect YouTube" : "Connect YouTube"}</button>}
            </div>
            {isAdmin && <div className="showcase-youtube-mode-row" role="group" aria-label="YouTube playlist display mode">
              <span>Display mode</span>
              <button type="button" className={youtubeMode === "playlist" ? "is-active" : ""} aria-pressed={youtubeMode === "playlist"} onClick={() => void changeYoutubeMode("playlist")}>Playlist</button>
              <button type="button" className={youtubeMode === "rows" ? "is-active" : ""} aria-pressed={youtubeMode === "rows"} onClick={() => void changeYoutubeMode("rows")}>Rows</button>
            </div>}
            {youtubePlaylistsLoading ? <p className="showcase-empty">Loading public YouTube playlists…</p> : youtubePlaylistsError ? <p className="showcase-empty" role="status">{youtubePlaylistsError}</p> : !youtubeConnected ? (
              <p className="showcase-empty">{isAdmin ? youtubeConfigured ? "Connect YouTube to load public playlists from that account." : "Configure the Google OAuth credentials and YouTube Data API key, then connect YouTube." : "No public YouTube playlists are available right now."}</p>
            ) : youtubePlaylists.length === 0 ? (
              <p className="showcase-empty">No public playlists were found on the connected account. Set a playlist to Public on YouTube, then refresh this page.</p>
            ) : youtubeMode === "playlist" ? (
              <div className="showcase-youtube-playlist-grid">{youtubePlaylists.map((playlist) => <YoutubePlaylistCard playlist={playlist} key={playlist.id} />)}</div>
            ) : (
              <div className="showcase-youtube-playlist-rows-list">{youtubePlaylists.map((playlist) => <YoutubePlaylistRows playlist={playlist} videos={youtubePlaylistVideos[playlist.id]} onFeature={isAdmin ? featureSong : undefined} onLoad={loadYoutubePlaylistVideos} key={playlist.id} />)}</div>
            )}
            {isAdmin && <p className="showcase-admin-hint">Playlist mode links directly to each public playlist. Rows mode expands its videos here. The selected mode is saved for visitors too.</p>}
          </section>

          <section className="account-showcase-section">
            <div className="showcase-section-heading">
              <div><p className="account-eyebrow">YOUTUBE MUSIC</p><h2>Liked songs</h2><p>Your YouTube Music liked songs through the separate ytmusicapi companion service.</p></div>
              {isAdmin && <button type="button" className="showcase-outline-button" onClick={() => connect("ytmusic")}>{integration("ytmusic").connected ? "Refresh Music" : "Music setup"}</button>}
            </div>
            {isAdmin ? likedMusic.length ? <div className="showcase-track-list">{likedMusic.slice(0, 8).map((song, index) => <MusicTrack song={song} key={song.videoId || index} onFeature={featureSong} />)}</div> : <p className="showcase-empty">{integration("ytmusic").configured ? "No songs returned. Check the companion service and credentials." : "YouTube Music is not connected yet."}</p> : <p className="showcase-empty">Sign in as the administrator to manage this library.</p>}
            {isAdmin && <p className="showcase-admin-hint">ytmusicapi uses YouTube Music’s unofficial web interface and may require re-authentication.</p>}
          </section>

          <section className="account-showcase-section">
            <div className="showcase-section-heading"><div><p className="account-eyebrow">HAND-PICKED</p><h2>Featured links</h2><p>Share videos, songs, notes, articles, and links from any public website with rich preview cards.</p></div></div>
            {isAdmin && <form className="showcase-add-link-form" onSubmit={addLink}>
              <label htmlFor="showcase-url">Paste a link</label>
              <div className="showcase-add-link-row"><input id="showcase-url" type="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" /><button type="submit" disabled={linkBusy}>{linkBusy ? "Adding…" : "Add link"}</button></div>
              <p className="showcase-admin-hint">Paste any public HTTP or HTTPS link. Links start hidden; publish each card when you want visitors to see it. Some sites block metadata previews, so a title and domain fallback may be used.</p>
              {linkMessage && <p className="account-message" role="status">{linkMessage}</p>}
            </form>}
            {linksLoading ? <p className="showcase-empty">Loading featured links…</p> : visibleLinks.length ? (
              <div className="showcase-links-grid">{visibleLinks.map((item) => <ShowcaseCard key={item.id} item={item} editable={isAdmin} onVisibility={toggleLink} onDelete={removeLink} />)}</div>
            ) : <p className="showcase-empty">No featured links have been published yet.</p>}
          </section>
        </main>
      </div>
    </div>
  );
}
