import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
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
type PlaylistVideosState = {
  loading: boolean;
  items: Song[];
  nextPageToken?: string;
  error?: string;
};
type YoutubePlaylistsResponse = {
  configured: boolean;
  connected: boolean;
  playlists: YoutubePlaylist[];
};
type YtMusicPublicState = {
  connected: boolean;
  lastPlayed: Song | null;
  tracks: Song[];
};
type IntegrationStatus = {
  configured: boolean;
  connected: boolean;
  message?: string;
};
type IntegrationsResponse = {
  spotify: IntegrationStatus & {
    playing: boolean;
    track?: Song | null;
    provider?: string;
  };
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
    throw new Error(
      body.message || body.detail || `Request failed (${response.status})`,
    );
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
  return (
    <span className="showcase-provider-mark">
      {labels[provider] || provider.toUpperCase()}
    </span>
  );
}

function showcaseProviderLabel(item: ShowcaseLink): string {
  if (item.provider === "blogg") return "BLOGG NOTE";
  if (item.provider === "web") {
    try {
      return new URL(item.url).hostname.replace(/^www\./i, "").toUpperCase();
    } catch {
      return "WEBSITE";
    }
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
        <a
          className="showcase-link-image"
          href={item.url}
          target="_blank"
          rel="noreferrer"
        >
          <img src={item.image} alt="" loading="lazy" />
        </a>
      ) : (
        <a
          className="showcase-link-image showcase-link-no-image"
          href={item.url}
          target="_blank"
          rel="noreferrer"
        >
          <ProviderMark provider={item.provider} />
        </a>
      )}
      <div className="showcase-link-body">
        <p className="showcase-card-provider">{showcaseProviderLabel(item)}</p>
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="showcase-link-title"
        >
          {item.title}
        </a>
        {item.description && (
          <p className="showcase-link-description">{item.description}</p>
        )}
        {editable && (
          <div className="showcase-link-actions">
            <button type="button" onClick={() => onVisibility?.(item)}>
              {item.visible ? "Hide from visitors" : "Show to visitors"}
            </button>
            <button
              type="button"
              onClick={() => onDelete?.(item)}
              className="is-danger"
            >
              Remove
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function MusicTrack({
  song,
  onFeature,
  publicAction,
}: {
  song: Song;
  onFeature?: (song: Song) => void;
  publicAction?: { label: string; disabled?: boolean; onClick: () => void };
}) {
  const removingPublicTrack = publicAction?.label === "Remove from public";
  const publicIcon = removingPublicTrack ? "×" : "✓";
  return (
    <div className="showcase-track">
      <div className="showcase-track-main">
        {song.thumbnail ? (
          <img src={song.thumbnail} alt="" loading="lazy" />
        ) : (
          <div className="showcase-track-empty" aria-hidden="true">
            ♪
          </div>
        )}
        <div className="showcase-track-copy">
          <strong>{song.title}</strong>
          <span>
            {song.artists.join(", ") || "Unknown artist"}
            {song.album ? ` · ${song.album}` : ""}
          </span>
        </div>
      </div>
      {(song.url || (publicAction && !onFeature)) && (
        <div className="showcase-track-actions">
          {song.url && (
            <a href={song.url} target="_blank" rel="noreferrer">
              Open ↗
            </a>
          )}
          {song.url && onFeature && (
            <button
              type="button"
              className="showcase-track-feature"
              onClick={() => onFeature(song)}
            >
              Feature
            </button>
          )}
          {publicAction && (
            <button
              type="button"
              className={`showcase-track-feature showcase-public-toggle ${removingPublicTrack ? "is-remove" : "is-add"}`}
              disabled={publicAction.disabled}
              onClick={publicAction.onClick}
              aria-label={publicAction.label}
              title={publicAction.label}
            >
              <span aria-hidden="true">{publicIcon}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function YoutubePlaylistCard({
  playlist,
  expanded,
  onToggle,
}: {
  playlist: YoutubePlaylist;
  expanded: boolean;
  onToggle: (playlistId: string) => void;
}) {
  return (
    <button
      type="button"
      className="showcase-youtube-playlist-card"
      aria-expanded={expanded}
      onClick={() => onToggle(playlist.id)}
    >
      {playlist.thumbnail ? (
        <img src={playlist.thumbnail} alt="" loading="lazy" />
      ) : (
        <div
          className="showcase-youtube-playlist-placeholder"
          aria-hidden="true"
        >
          ▶
        </div>
      )}
      <div className="showcase-youtube-playlist-copy">
        <strong>{playlist.title}</strong>
        <span>
          {playlist.itemCount} {playlist.itemCount === 1 ? "video" : "videos"}
        </span>
        {playlist.description && <p>{playlist.description}</p>}
        <span className="showcase-youtube-playlist-open">
          {expanded ? "Hide songs −" : "Show songs ＋"}
        </span>
      </div>
    </button>
  );
}

function openYoutubeTarget(rawUrl: string, target: "app" | "browser") {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return;
  }
  const playlistId = url.searchParams.get("list");
  const videoId = url.searchParams.get("v");
  const contentPath = playlistId
    ? `playlist?list=${encodeURIComponent(playlistId)}`
    : `watch?v=${encodeURIComponent(videoId || "")}`;
  const webUrl = `https://www.youtube.com/${contentPath}`;
  if (target === "browser") {
    window.open(webUrl, "_blank", "noopener,noreferrer");
    return;
  }
  const agent = navigator.userAgent || "";
  if (/Android/i.test(agent)) {
    window.location.assign(
      `intent://www.youtube.com/${contentPath}#Intent;package=com.google.android.youtube;scheme=https;end`,
    );
  } else if (/iPhone|iPad|iPod/i.test(agent)) {
    window.location.assign(`youtube://www.youtube.com/${contentPath}`);
  } else {
    window.open(webUrl, "_blank", "noopener,noreferrer");
  }
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
  onLoad: (playlistId: string, pageToken?: string) => void;
}) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (videos || !sectionRef.current) return;
    const section = sectionRef.current;
    const root = section.closest(".showcase-youtube-library-scroll");
    if (typeof IntersectionObserver === "undefined") {
      onLoad(playlist.id);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          onLoad(playlist.id);
        }
      },
      { root, rootMargin: "120px 0px" },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [onLoad, playlist.id, videos]);

  useEffect(() => {
    const pageToken = videos?.nextPageToken;
    if (!pageToken || videos?.loading || videos?.error || !loadMoreRef.current)
      return;
    if (typeof IntersectionObserver === "undefined") return;
    const sentinel = loadMoreRef.current;
    const root = sentinel.closest(".showcase-youtube-library-scroll");
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          onLoad(playlist.id, pageToken);
        }
      },
      { root, rootMargin: "180px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    onLoad,
    playlist.id,
    videos?.nextPageToken,
    videos?.loading,
    videos?.error,
  ]);

  const retry = () => onLoad(playlist.id, videos?.nextPageToken);

  return (
    <section
      ref={sectionRef}
      className="showcase-youtube-playlist-rows"
      aria-label={playlist.title}
    >
      <div className="showcase-youtube-playlist-heading">
        <div>
          <h3>{playlist.title}</h3>
          <span>
            {playlist.itemCount} {playlist.itemCount === 1 ? "video" : "videos"}
          </span>
        </div>
        <div className="showcase-youtube-open-actions">
          <button
            type="button"
            onClick={() => openYoutubeTarget(playlist.url, "app")}
          >
            Open in app
          </button>
          <button
            type="button"
            onClick={() => openYoutubeTarget(playlist.url, "browser")}
          >
            Open in browser
          </button>
        </div>
      </div>
      {playlist.description && (
        <p className="showcase-youtube-playlist-description">
          {playlist.description}
        </p>
      )}
      {!videos && (
        <p className="showcase-empty showcase-playlist-loading">
          Videos load as this playlist comes into view.
        </p>
      )}
      {videos?.loading && videos.items.length === 0 && (
        <p className="showcase-empty showcase-playlist-loading" role="status">
          Loading playlist videos…
        </p>
      )}
      {videos?.error && videos.items.length === 0 && (
        <div className="showcase-youtube-load-error">
          <p className="showcase-empty">{videos.error}</p>
          <button
            type="button"
            className="showcase-youtube-load-retry"
            onClick={retry}
          >
            Retry
          </button>
        </div>
      )}
      {Boolean(videos?.items.length) && (
        <div className="showcase-track-list">
          {videos!.items.map((song, index) => (
            <MusicTrack
              song={song}
              key={song.videoId || `${playlist.id}-${index}`}
              onFeature={onFeature}
            />
          ))}
        </div>
      )}
      {videos?.loading && videos.items.length > 0 && (
        <p className="showcase-youtube-scroll-status" role="status">
          Loading more videos…
        </p>
      )}
      {videos?.error && videos.items.length > 0 && (
        <div className="showcase-youtube-load-error">
          <p className="showcase-youtube-scroll-status">
            Could not load the next batch of videos.
          </p>
          <button
            type="button"
            className="showcase-youtube-load-retry"
            onClick={retry}
          >
            Retry
          </button>
        </div>
      )}
      {videos &&
        !videos.loading &&
        !videos.error &&
        videos.items.length === 0 &&
        !videos.nextPageToken && (
          <p className="showcase-empty">
            This playlist has no accessible videos.
          </p>
        )}
      {videos?.nextPageToken && !videos.loading && !videos.error && (
        <div
          ref={loadMoreRef}
          className="showcase-youtube-load-more-sentinel"
          aria-hidden="true"
        />
      )}
    </section>
  );
}

export default function AccountPage() {
  const navigate = useNavigate();
  const { isAdmin, logout, refreshUser } = useAuth();
  const [presence, setPresence] = useState<AdminPresence>({
    online: false,
    activity: "Offline",
    lastSeen: null,
  });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState<ShowcaseLink[]>([]);
  const [linksLoading, setLinksLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkMessage, setLinkMessage] = useState("");
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const youtubePlaylistRequests = useRef<Set<string>>(new Set());
  const [nowPlaying, setNowPlaying] = useState<IntegrationsResponse["spotify"]>(
    {
      configured: false,
      connected: false,
      playing: false,
    },
  );
  const [youtubePlaylists, setYoutubePlaylists] = useState<YoutubePlaylist[]>(
    [],
  );
  const [expandedYoutubePlaylists, setExpandedYoutubePlaylists] = useState<
    Record<string, boolean>
  >({});
  const [youtubeConnected, setYoutubeConnected] = useState(false);
  const [youtubeConfigured, setYoutubeConfigured] = useState(false);
  const [youtubePlaylistsLoading, setYoutubePlaylistsLoading] = useState(true);
  const [youtubePlaylistsError, setYoutubePlaylistsError] = useState("");
  const [youtubePlaylistVideos, setYoutubePlaylistVideos] = useState<
    Record<string, PlaylistVideosState>
  >({});
  const [likedMusic, setLikedMusic] = useState<Song[]>([]);
  const [likedMusicLoading, setLikedMusicLoading] = useState(true);
  const [likedMusicError, setLikedMusicError] = useState("");
  const [ytmusicPickerVisibleCount, setYtmusicPickerVisibleCount] =
    useState(10);
  const [selectedTracksCollapsed, setSelectedTracksCollapsed] = useState(false);
  const [pickerCollapsed, setPickerCollapsed] = useState(false);
  const ytmusicPickerScrollRef = useRef<HTMLDivElement | null>(null);
  const ytmusicPickerSentinelRef = useRef<HTMLDivElement | null>(null);
  const [ytmusicPublic, setYtmusicPublic] = useState<YtMusicPublicState>({
    connected: false,
    lastPlayed: null,
    tracks: [],
  });
  const [ytmusicPublicSaving, setYtmusicPublicSaving] = useState(false);
  const [integrationState, setIntegrationState] = useState<
    Record<string, IntegrationStatus>
  >({});
  const [ytmusicConnectError, setYtmusicConnectError] = useState("");

  const refreshPresence = useCallback(async () => {
    try {
      setPresence(await fetchAdminPresence());
    } catch {
      // Presence is informational. A status failure must not break this page.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api<{ registrationEnabled: boolean }>("/api/auth/registration-status")
      .then((status) => {
        if (!cancelled)
          setRegistrationEnabled(status.registrationEnabled === true);
      })
      .catch(() => {
        if (!cancelled) setRegistrationEnabled(false);
      });
    return () => {
      cancelled = true;
    };
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
      const data = await api<IntegrationsResponse>(
        "/api/showcase/integrations",
      );
      setIntegrationState({
        spotify: data.spotify,
        youtube: data.youtube,
        ytmusic: data.ytmusic,
      });
      setNowPlaying(data.spotify);
    } catch {
      // Keep the account and activity card usable if an external integration is unavailable.
    }
  }, []);

  const loadYoutubePlaylistVideos = useCallback(
    async (playlistId: string, pageToken?: string) => {
      const requestKey = `${playlistId}:${pageToken || "first"}`;
      if (youtubePlaylistRequests.current.has(requestKey)) return;
      youtubePlaylistRequests.current.add(requestKey);
      setYoutubePlaylistVideos((current) => {
        const previous = current[playlistId];
        return {
          ...current,
          [playlistId]: {
            loading: true,
            items: previous?.items || [],
            nextPageToken: previous?.nextPageToken,
          },
        };
      });
      try {
        const query = pageToken
          ? `?pageToken=${encodeURIComponent(pageToken)}`
          : "";
        const data = await api<{ items: Song[]; nextPageToken?: string }>(
          `/api/showcase/youtube/playlists/${encodeURIComponent(playlistId)}/videos${query}`,
          { cache: "no-store" },
        );
        setYoutubePlaylistVideos((current) => {
          const previousItems = pageToken
            ? current[playlistId]?.items || []
            : [];
          const seen = new Set<string>();
          const items = [
            ...previousItems,
            ...(Array.isArray(data.items) ? data.items : []),
          ].filter((song) => {
            const key =
              song.videoId || `${song.title}|${song.artists.join(",")}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          return {
            ...current,
            [playlistId]: {
              loading: false,
              items,
              nextPageToken: data.nextPageToken || undefined,
            },
          };
        });
      } catch {
        setYoutubePlaylistVideos((current) => {
          const previous = current[playlistId];
          return {
            ...current,
            [playlistId]: {
              loading: false,
              items: previous?.items || [],
              nextPageToken: previous?.nextPageToken,
              error: "Playlist videos are temporarily unavailable.",
            },
          };
        });
      } finally {
        youtubePlaylistRequests.current.delete(requestKey);
      }
    },
    [],
  );

  const refreshYoutubePlaylists = useCallback(async () => {
    setYoutubePlaylistsLoading(true);
    setYoutubePlaylistsError("");
    try {
      const data = await api<YoutubePlaylistsResponse>(
        "/api/showcase/youtube/playlists",
      );
      const playlists = Array.isArray(data.playlists) ? data.playlists : [];
      setYoutubePlaylists(playlists);
      setYoutubeConnected(Boolean(data.connected));
      setYoutubeConfigured(Boolean(data.configured));
    } catch (error) {
      setYoutubePlaylists([]);
      setYoutubePlaylistsError(
        "YouTube playlists are temporarily unavailable. Check backend logs.",
      );
    } finally {
      setYoutubePlaylistsLoading(false);
    }
  }, []);

  const refreshLikedLibraries = useCallback(async () => {
    if (!isAdmin) return;
    setLikedMusicLoading(true);
    setLikedMusicError("");
    try {
      const data = await api<{ items: Song[] }>("/api/showcase/ytmusic/liked", {
        cache: "no-store",
      });
      const items = Array.isArray(data.items) ? data.items : [];
      setYtmusicPickerVisibleCount(10);
      setLikedMusic(items);
      setIntegrationState((current) => ({
        ...current,
        ytmusic: { configured: true, connected: true },
      }));
    } catch (error) {
      const message =
        "YouTube Music could not be refreshed. Check backend logs.";
      setLikedMusicError(message);
      setIntegrationState((current) => ({
        ...current,
        ytmusic: {
          configured: current.ytmusic?.configured ?? false,
          connected: false,
          message,
        },
      }));
    } finally {
      setLikedMusicLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin) {
      void updateAdminPresence()
        .then(refreshPresence)
        .catch(() => {
          void refreshUser();
          void refreshPresence();
        });
    } else {
      void refreshPresence();
    }
    const pollId = window.setInterval(() => {
      void refreshPresence();
    }, 20_000);
    const heartbeatId = isAdmin
      ? window.setInterval(() => {
          void updateAdminPresence().catch(() => refreshUser());
        }, 30_000)
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
    if (!isAdmin) return;
    const pollId = window.setInterval(() => {
      void refreshIntegrations();
    }, 30_000);
    return () => window.clearInterval(pollId);
  }, [refreshShowcase, refreshIntegrations, refreshYoutubePlaylists, isAdmin]);

  useEffect(() => {
    if (
      !isAdmin ||
      likedMusicLoading ||
      likedMusicError ||
      ytmusicPickerVisibleCount >= likedMusic.length
    )
      return;
    const root = ytmusicPickerScrollRef.current;
    const sentinel = ytmusicPickerSentinelRef.current;
    if (!root || !sentinel || typeof IntersectionObserver === "undefined")
      return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setYtmusicPickerVisibleCount((current) =>
            Math.min(current + 10, likedMusic.length),
          );
        }
      },
      { root, rootMargin: "100px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    isAdmin,
    likedMusic.length,
    likedMusicLoading,
    likedMusicError,
    ytmusicPickerVisibleCount,
  ]);

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
      await api("/api/admin/showcase/links", {
        method: "POST",
        body: JSON.stringify({ url }),
      });
      setUrl("");
      await refreshShowcase();
      setLinkMessage("Link added. It remains hidden until you publish it.");
    } catch (error) {
      setLinkMessage(
        error instanceof Error ? error.message : "Could not add this link.",
      );
    } finally {
      setLinkBusy(false);
    }
  };

  const featureSong = async (song: Song) => {
    if (!song.url) return;
    setLinkMessage("");
    try {
      await api("/api/admin/showcase/links", {
        method: "POST",
        body: JSON.stringify({ url: song.url, title: song.title }),
      });
      await refreshShowcase();
      setLinkMessage(
        `Added “${song.title}” to Featured links. Publish it from that card when ready.`,
      );
    } catch (error) {
      setLinkMessage(
        error instanceof Error ? error.message : "Could not feature this item.",
      );
    }
  };

  const toggleLink = async (item: ShowcaseLink) => {
    try {
      await api(`/api/admin/showcase/links/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ visible: !item.visible }),
      });
      await refreshShowcase();
    } catch (error) {
      setLinkMessage(
        error instanceof Error ? error.message : "Could not update visibility.",
      );
    }
  };

  const removeLink = async (item: ShowcaseLink) => {
    try {
      await api(`/api/admin/showcase/links/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
      });
      await refreshShowcase();
    } catch (error) {
      setLinkMessage(
        error instanceof Error ? error.message : "Could not remove this link.",
      );
    }
  };

  const connect = async (provider: "spotify" | "youtube") => {
    // Start OAuth with fetch while the Vercel page is still the top-level site.
    // Firefox may partition cross-site cookies, so navigating directly to Render
    // can omit the admin cookie even when authenticated API fetches work.
    try {
      const result = await api<{ authorizationUrl?: string }>(
        `/api/admin/integrations/${provider}/connect`,
        { headers: { Accept: "application/json" } },
      );
      if (result.authorizationUrl)
        window.location.assign(result.authorizationUrl);
    } catch {
      // Integration failures are logged by the backend. Keep diagnostics off the page.
    }
  };

  const refreshYtmusicPublic = useCallback(async () => {
    try {
      const data = await api<YtMusicPublicState>(
        "/api/showcase/ytmusic/public",
        { cache: "no-store" },
      );
      setYtmusicPublic({
        connected: Boolean(data.connected),
        lastPlayed: data.lastPlayed || null,
        tracks: Array.isArray(data.tracks) ? data.tracks.slice(0, 3) : [],
      });
    } catch {
      // Public playback and selections are optional. Detailed errors stay in backend logs.
    }
  }, []);

  const toggleYtmusicPublicTrack = async (song: Song) => {
    if (!song.videoId) return;
    const currentlySelected = ytmusicPublic.tracks.some(
      (item) => item.videoId === song.videoId,
    );
    const nextTracks = currentlySelected
      ? ytmusicPublic.tracks.filter((item) => item.videoId !== song.videoId)
      : [...ytmusicPublic.tracks, song].slice(0, 3);
    if (!currentlySelected && ytmusicPublic.tracks.length >= 3) return;
    setYtmusicPublicSaving(true);
    try {
      const data = await api<{ tracks: Song[] }>(
        "/api/admin/showcase/ytmusic/public-tracks",
        {
          method: "POST",
          body: JSON.stringify({ tracks: nextTracks }),
        },
      );
      setYtmusicPublic((current) => ({
        ...current,
        tracks: Array.isArray(data.tracks)
          ? data.tracks.slice(0, 3)
          : nextTracks,
      }));
    } catch {
      // Keep the UI quiet on API failures; the backend logs the diagnostic.
    } finally {
      setYtmusicPublicSaving(false);
    }
  };

  const disconnectIntegration = async (provider: "spotify" | "ytmusic") => {
    try {
      await api(`/api/admin/integrations/${provider}/disconnect`, {
        method: "POST",
      });
      await refreshIntegrations();
      if (provider === "spotify") {
        setNowPlaying({ configured: true, connected: false, playing: false });
        setIntegrationState((current) => ({
          ...current,
          spotify: {
            configured: current.spotify?.configured ?? false,
            connected: false,
          },
        }));
      } else {
        setLikedMusic([]);
        setLikedMusicError("");
        setIntegrationState((current) => ({
          ...current,
          ytmusic: {
            configured: current.ytmusic?.configured ?? false,
            connected: false,
          },
        }));
        // Keep the saved public snapshot, especially the last-played track, after disconnect.
      }
    } catch {
      // Disconnect failures are recorded in backend logs.
    }
  };

  const connectYtmusic = async () => {
    setYtmusicConnectError("");
    try {
      await api("/api/admin/integrations/ytmusic/connect", { method: "POST" });
      await refreshIntegrations();
      await refreshLikedLibraries();
      await refreshYtmusicPublic();
    } catch (error) {
      setYtmusicConnectError(
        error instanceof Error
          ? error.message
          : "Could not connect YouTube Music. Check the companion service status and backend logs.",
      );
    }
  };

  const syncYtmusicHistory = useCallback(async () => {
    if (!isAdmin || !integrationState.ytmusic?.connected) return;
    try {
      const data = await api<{ lastPlayed: Song | null }>(
        "/api/admin/showcase/ytmusic/sync-history",
        { method: "POST" },
      );
      setYtmusicPublic((current) => ({
        ...current,
        connected: true,
        lastPlayed: data.lastPlayed || current.lastPlayed,
      }));
      await refreshYtmusicPublic();
    } catch {
      // The last successful track remains visible until a newer one is found.
    }
  }, [isAdmin, integrationState.ytmusic?.connected, refreshYtmusicPublic]);

  useEffect(() => {
    void refreshYtmusicPublic();
    const pollId = window.setInterval(() => {
      void refreshYtmusicPublic();
    }, 60_000);
    return () => window.clearInterval(pollId);
  }, [refreshYtmusicPublic]);

  useEffect(() => {
    if (!isAdmin || !integrationState.ytmusic?.connected) return;
    void refreshLikedLibraries();
    void syncYtmusicHistory();
    const historyPoll = window.setInterval(() => {
      void syncYtmusicHistory();
    }, 60_000);
    return () => window.clearInterval(historyPoll);
  }, [
    isAdmin,
    integrationState.ytmusic?.connected,
    refreshLikedLibraries,
    syncYtmusicHistory,
  ]);

  const integration = (provider: string): IntegrationStatus =>
    integrationState[provider] || { configured: false, connected: false };
  const visibleLinks = links.filter(
    (item) => item.provider !== "ytmusic" && (isAdmin || item.visible),
  );
  const ytmusicLeadSong =
    ytmusicPublic.lastPlayed || ytmusicPublic.tracks[0] || null;

  return (
    <div className="account-page typewriter-font">
      <div className="account-page-shell">
        <header className="account-page-header">
          <Link to="/feed" className="account-page-nav-link">
            BLOG FEED
          </Link>
          <span className="account-page-rule" aria-hidden="true" />
          <Link to="/blog" className="account-page-nav-link">
            BLOG PROFILE
          </Link>
        </header>

        <main className="account-page-main account-page-main-stack">
          <div className="account-dashboard-grid">
            <section
              className="account-status-card account-dashboard-status"
              aria-labelledby="account-status-heading"
            >
              <p className="account-eyebrow">ADMIN</p>
              <h1 id="account-status-heading" className="account-status-title">
                Administrator status
              </h1>
              <div className="account-presence-row" aria-live="polite">
                <span
                  className={`account-presence-pill ${presence.online ? "is-online" : "is-offline"}`}
                >
                  <span className="account-presence-dot" />
                  {presence.online ? "Online" : "Offline"}
                </span>
              </div>
              {isAdmin ? (
                <>
                  <label
                    className="account-field-label"
                    htmlFor="admin-activity"
                  >
                    Activity
                  </label>
                  <select
                    id="admin-activity"
                    value={
                      ACTIVITIES.includes(presence.activity as AdminActivity)
                        ? presence.activity
                        : "Reading"
                    }
                    disabled={busy}
                    onChange={(event) =>
                      void changeActivity(event.target.value as AdminActivity)
                    }
                    className="account-activity-select"
                  >
                    {ACTIVITIES.map((activity) => (
                      <option key={activity} value={activity}>
                        {activity}
                      </option>
                    ))}
                  </select>
                  {message && (
                    <p className="account-message" role="status">
                      {message}
                    </p>
                  )}
                  <div className="account-card-footer account-status-actions">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleLogout()}
                      className="account-secondary-button"
                    >
                      {busy ? "Please wait…" : "Log out"}
                    </button>
                  </div>
                </>
              ) : (
                <div className="account-status-actions">
                  <Link to="/login" className="account-primary-link">
                    Admin login
                  </Link>
                  {registrationEnabled && (
                    <Link to="/register" className="account-secondary-button">
                      Create administrator
                    </Link>
                  )}
                </div>
              )}
            </section>

            <section className="account-showcase-section account-dashboard-youtube">
              <div className="showcase-section-heading">
                <div>
                  <p className="account-eyebrow">YOUTUBE LIBRARY</p>
                  <h2>Public playlists</h2>
                  <p>Public playlists from your YouTube account.</p>
                </div>
                {isAdmin && (
                  <button
                    type="button"
                    className="showcase-outline-button"
                    onClick={() => connect("youtube")}
                  >
                    {integration("youtube").connected
                      ? "Reconnect YouTube"
                      : "Connect YouTube"}
                  </button>
                )}
              </div>
              <div
                className="showcase-youtube-library-scroll"
                role="region"
                aria-label="YouTube public library"
                tabIndex={0}
              >
                {youtubePlaylistsLoading ? (
                  <p className="showcase-empty">
                    Loading public YouTube playlists…
                  </p>
                ) : youtubePlaylistsError ? (
                  <p className="showcase-empty" role="status">
                    YouTube playlists are temporarily unavailable. Check backend
                    logs.
                  </p>
                ) : !youtubeConnected ? (
                  <p className="showcase-empty">
                    {isAdmin
                      ? youtubeConfigured
                        ? "Connect YouTube to load public playlists from that account."
                        : "YouTube is not configured yet."
                      : "No public YouTube playlists are available right now."}
                  </p>
                ) : youtubePlaylists.length === 0 ? (
                  <p className="showcase-empty">
                    No public playlists were found on the connected account. Set
                    a playlist to Public on YouTube, then refresh this page.
                  </p>
                ) : (
                  <div className="showcase-youtube-playlist-grid">
                    {youtubePlaylists.map((playlist) => (
                      <div
                        className="showcase-youtube-playlist-entry"
                        key={playlist.id}
                      >
                        <YoutubePlaylistCard
                          playlist={playlist}
                          expanded={Boolean(
                            expandedYoutubePlaylists[playlist.id],
                          )}
                          onToggle={(playlistId) =>
                            setExpandedYoutubePlaylists((current) => ({
                              ...current,
                              [playlistId]: !current[playlistId],
                            }))
                          }
                        />
                        {expandedYoutubePlaylists[playlist.id] && (
                          <YoutubePlaylistRows
                            playlist={playlist}
                            videos={youtubePlaylistVideos[playlist.id]}
                            onFeature={isAdmin ? featureSong : undefined}
                            onLoad={loadYoutubePlaylistVideos}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <div className="account-dashboard-media-stack">
              <section className="account-showcase-section account-showcase-mini-section">
                <div className="showcase-mini-heading">
                  <p className="account-eyebrow">NOW PLAYING</p>
                  <h2>Spotify</h2>
                </div>
                <div className="showcase-mini-integration-layout">
                  <div className="showcase-mini-music-card">
                    {nowPlaying.playing && nowPlaying.track?.thumbnail ? (
                      <img
                        src={nowPlaying.track.thumbnail}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <div
                        className="showcase-mini-music-placeholder"
                        aria-hidden="true"
                      >
                        ♪
                      </div>
                    )}
                    <div className="showcase-mini-music-copy">
                      <strong>
                        {nowPlaying.playing && nowPlaying.track
                          ? nowPlaying.track.title
                          : "Not connected"}
                      </strong>
                      {nowPlaying.playing &&
                      nowPlaying.track?.artists.length ? (
                        <span>{nowPlaying.track.artists.join(", ")}</span>
                      ) : null}
                    </div>
                    {nowPlaying.playing && nowPlaying.track?.url && (
                      <a
                        href={nowPlaying.track.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Open in Spotify"
                      >
                        ↗
                      </a>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="showcase-mini-actions">
                      {integration("spotify").connected ? (
                        <button
                          type="button"
                          className="showcase-outline-button"
                          onClick={() => void connect("spotify")}
                        >
                          Reconnect
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="showcase-outline-button"
                          onClick={() => void connect("spotify")}
                        >
                          Connect
                        </button>
                      )}
                      {integration("spotify").connected && (
                        <button
                          type="button"
                          className="showcase-outline-button is-danger"
                          onClick={() => void disconnectIntegration("spotify")}
                        >
                          Disconnect
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </section>

              <section className="account-showcase-section account-showcase-mini-section account-showcase-ytmusic-section">
                <div className="showcase-mini-heading">
                  <p className="account-eyebrow">NOW PLAYING</p>
                  <h2>YouTube Music</h2>
                </div>
                <div className="showcase-mini-integration-layout">
                  <div className="showcase-mini-music-card">
                    {ytmusicLeadSong?.thumbnail ? (
                      <img
                        src={ytmusicLeadSong.thumbnail}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <div
                        className="showcase-mini-music-placeholder"
                        aria-hidden="true"
                      >
                        ♪
                      </div>
                    )}
                    <div className="showcase-mini-music-copy">
                      <span className="showcase-mini-track-label">
                        {ytmusicPublic.lastPlayed
                          ? "LAST PLAYED"
                          : ytmusicLeadSong
                            ? "PUBLIC PICK"
                            : "YOUTUBE MUSIC"}
                      </span>
                      <strong>
                        {ytmusicLeadSong
                          ? ytmusicLeadSong.title
                          : "No public track shared yet"}
                      </strong>
                      {ytmusicLeadSong ? (
                        <span>
                          {ytmusicLeadSong.artists.join(", ") ||
                            "Unknown artist"}
                          {ytmusicLeadSong.album
                            ? ` · ${ytmusicLeadSong.album}`
                            : ""}
                        </span>
                      ) : (
                        <span>
                          {isAdmin
                            ? "Connect YouTube Music and select up to three songs for visitors."
                            : "Public tracks appear here when selected by the administrator."}
                        </span>
                      )}
                    </div>
                    {ytmusicLeadSong?.url && (
                      <a
                        href={ytmusicLeadSong.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Open in YouTube Music"
                      >
                        ↗
                      </a>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="showcase-mini-actions">
                      {integration("ytmusic").connected ? (
                        <button
                          type="button"
                          className="showcase-outline-button"
                          onClick={() => void connectYtmusic()}
                        >
                          Reconnect
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="showcase-outline-button"
                          onClick={() => void connectYtmusic()}
                        >
                          Connect
                        </button>
                      )}
                      {integration("ytmusic").connected && (
                        <button
                          type="button"
                          className="showcase-outline-button is-danger"
                          onClick={() => void disconnectIntegration("ytmusic")}
                        >
                          Disconnect
                        </button>
                      )}
                      {integration("ytmusic").connected && (
                        <button
                          type="button"
                          className="showcase-outline-button"
                          onClick={() => void refreshLikedLibraries()}
                          disabled={likedMusicLoading}
                        >
                          {likedMusicLoading ? "Refreshing…" : "Refresh"}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {ytmusicConnectError && isAdmin && (
                  <p className="showcase-ytmusic-connect-error" role="alert">
                    {ytmusicConnectError}
                  </p>
                )}

                {ytmusicPublic.tracks.length > 0 && (
                  <div className="showcase-ytmusic-public-block">
                    <div className="showcase-ytmusic-subsection-heading">
                      {isAdmin ? (
                        <button
                          type="button"
                          className="showcase-ytmusic-collapse-toggle"
                          aria-expanded={!selectedTracksCollapsed}
                          onClick={() =>
                            setSelectedTracksCollapsed(
                              (collapsed) => !collapsed,
                            )
                          }
                        >
                          <span className="showcase-ytmusic-section-title">
                            Selected for visitors
                          </span>
                          <span
                            className="showcase-ytmusic-collapse-mark"
                            aria-hidden="true"
                          >
                            {selectedTracksCollapsed ? "+" : "−"}
                          </span>
                        </button>
                      ) : (
                        <h3>Selected for visitors</h3>
                      )}
                    </div>
                    {(!isAdmin || !selectedTracksCollapsed) && (
                      <div className="showcase-track-list">
                        {ytmusicPublic.tracks.slice(0, 3).map((song, index) => (
                          <MusicTrack
                            song={song}
                            key={song.videoId || index}
                            publicAction={
                              isAdmin
                                ? {
                                    label: "Remove from public",
                                    disabled: ytmusicPublicSaving,
                                    onClick: () =>
                                      void toggleYtmusicPublicTrack(song),
                                  }
                                : undefined
                            }
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {isAdmin && (
                  <>
                    <div className="showcase-ytmusic-admin-heading">
                      <button
                        type="button"
                        className="showcase-ytmusic-collapse-toggle"
                        aria-expanded={!pickerCollapsed}
                        onClick={() =>
                          setPickerCollapsed((collapsed) => !collapsed)
                        }
                      >
                        <span className="showcase-ytmusic-section-title">
                          Choose public tracks
                        </span>
                        <span className="showcase-ytmusic-selected-count">
                          {ytmusicPublic.tracks.length}/3 selected
                        </span>
                        <span
                          className="showcase-ytmusic-collapse-mark"
                          aria-hidden="true"
                        >
                          {pickerCollapsed ? "+" : "−"}
                        </span>
                      </button>
                    </div>
                    {!pickerCollapsed && (
                      <>
                        <div
                          className="showcase-ytmusic-picker-scroll"
                          ref={ytmusicPickerScrollRef}
                          role="region"
                          aria-label="Choose public tracks from liked songs"
                          tabIndex={0}
                        >
                          {likedMusicLoading ? (
                            <p className="showcase-empty" role="status">
                              Loading liked songs…
                            </p>
                          ) : likedMusicError ? (
                            <p className="showcase-empty" role="status">
                              YouTube Music could not be refreshed. Check
                              backend logs.
                            </p>
                          ) : likedMusic.length ? (
                            <div className="showcase-track-list">
                              {likedMusic
                                .slice(0, ytmusicPickerVisibleCount)
                                .map((song, index) => {
                                  const alreadySelected =
                                    Boolean(song.videoId) &&
                                    ytmusicPublic.tracks.some(
                                      (item) => item.videoId === song.videoId,
                                    );
                                  return (
                                    <MusicTrack
                                      song={song}
                                      key={song.videoId || index}
                                      publicAction={{
                                        label: alreadySelected
                                          ? "Remove from public"
                                          : ytmusicPublic.tracks.length >= 3
                                            ? "Limit reached"
                                            : "Show to visitors",
                                        disabled:
                                          ytmusicPublicSaving ||
                                          (!alreadySelected &&
                                            ytmusicPublic.tracks.length >= 3),
                                        onClick: () =>
                                          void toggleYtmusicPublicTrack(song),
                                      }}
                                    />
                                  );
                                })}
                            </div>
                          ) : (
                            <p className="showcase-empty">
                              {integration("ytmusic").connected
                                ? "No liked songs were returned. Check backend logs if this seems wrong."
                                : "Connect YouTube Music to load liked songs."}
                            </p>
                          )}
                          {!likedMusicLoading &&
                            !likedMusicError &&
                            ytmusicPickerVisibleCount < likedMusic.length && (
                              <div
                                ref={ytmusicPickerSentinelRef}
                                className="showcase-ytmusic-picker-sentinel"
                                aria-hidden="true"
                              />
                            )}
                        </div>
                      </>
                    )}
                  </>
                )}
              </section>
            </div>

            <section className="account-showcase-section account-showcase-featured-section account-dashboard-featured-row">
              <div className="showcase-section-heading">
                <div>
                  <p className="account-eyebrow">HAND-PICKED</p>
                  <h2>Featured links</h2>
                  <p>
                    Share videos, songs, notes, articles, and links from any
                    public website with rich preview cards.
                  </p>
                </div>
              </div>
              {isAdmin && (
                <form className="showcase-add-link-form" onSubmit={addLink}>
                  <label htmlFor="showcase-url">Paste a link</label>
                  <div className="showcase-add-link-row">
                    <input
                      id="showcase-url"
                      type="url"
                      required
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      placeholder="https://…"
                    />
                    <button type="submit" disabled={linkBusy}>
                      {linkBusy ? "Adding…" : "Add link"}
                    </button>
                  </div>
                  {linkMessage && (
                    <p className="account-message" role="status">
                      {linkMessage}
                    </p>
                  )}
                </form>
              )}
              {linksLoading ? (
                <p className="showcase-empty">Loading featured links…</p>
              ) : visibleLinks.length ? (
                <div className="showcase-links-grid">
                  {visibleLinks.map((item) => (
                    <ShowcaseCard
                      key={item.id}
                      item={item}
                      editable={isAdmin}
                      onVisibility={toggleLink}
                      onDelete={removeLink}
                    />
                  ))}
                </div>
              ) : (
                <p className="showcase-empty">
                  No featured links have been published yet.
                </p>
              )}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
