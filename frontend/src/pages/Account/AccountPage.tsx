import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/authContext";
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
  };
  return <span className="showcase-provider-mark">{labels[provider] || provider.toUpperCase()}</span>;
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
        <p className="showcase-card-provider">{item.provider === "blogg" ? "BLOGG NOTE" : item.provider.toUpperCase()}</p>
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
  const [likedYoutube, setLikedYoutube] = useState<Song[]>([]);
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

  const refreshLikedLibraries = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const data = await api<{ items: Song[] }>("/api/showcase/youtube/liked");
      setLikedYoutube(data.items || []);
    } catch {
      setLikedYoutube([]);
    }
    try {
      const data = await api<{ items: Song[] }>("/api/showcase/ytmusic/liked");
      setLikedMusic(data.items || []);
    } catch {
      setLikedMusic([]);
    }
  }, [isAdmin]);

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
    const pollId = window.setInterval(() => { void refreshIntegrations(); }, 30_000);
    return () => window.clearInterval(pollId);
  }, [refreshShowcase, refreshIntegrations]);

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
            ) : <p className="showcase-empty">{nowPlaying.connected ? "Nothing is playing on Spotify right now." : "Spotify is not connected yet."}</p>}
            {isAdmin && integration("spotify").configured && <p className="showcase-admin-hint">{integration("spotify").connected ? "Spotify connected. Playback refreshes approximately every 30 seconds." : "App credentials are configured. Connect your Spotify account to finish setup."}</p>}
          </section>

          <section className="account-showcase-section">
            <div className="showcase-section-heading">
              <div><p className="account-eyebrow">YOUR LIBRARY</p><h2>Liked on YouTube</h2><p>Recently liked videos. Your private library is visible only when you are signed in as administrator.</p></div>
              {isAdmin && <button type="button" className="showcase-outline-button" onClick={() => connect("youtube")}>{integration("youtube").connected ? "Reconnect YouTube" : "Connect YouTube"}</button>}
            </div>
            {isAdmin ? likedYoutube.length ? <div className="showcase-track-list">{likedYoutube.slice(0, 8).map((song, index) => <MusicTrack song={song} key={song.videoId || index} onFeature={featureSong} />)}</div> : <p className="showcase-empty">{integration("youtube").connected ? "No liked videos returned." : "Connect YouTube and configure the Data API to load your likes."}</p> : <p className="showcase-empty">Sign in as the administrator to manage this library.</p>}
            {isAdmin && <p className="showcase-admin-hint">Liked videos are not automatically published. Add individual links to Featured links if you want to share them publicly.</p>}
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
            <div className="showcase-section-heading"><div><p className="account-eyebrow">HAND-PICKED</p><h2>Featured links</h2><p>Share selected videos, songs, notes, and links with rich preview cards.</p></div></div>
            {isAdmin && <form className="showcase-add-link-form" onSubmit={addLink}>
              <label htmlFor="showcase-url">Paste a link</label>
              <div className="showcase-add-link-row"><input id="showcase-url" type="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" /><button type="submit" disabled={linkBusy}>{linkBusy ? "Adding…" : "Add link"}</button></div>
              <p className="showcase-admin-hint">Links start hidden. Publish each card when you want visitors to see it.</p>
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
