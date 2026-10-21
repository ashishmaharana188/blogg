import { Router } from "express";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { getDB } from "../db/mongoDBConnect.ts";
import { authenticationMiddleware } from "../middleware/authenticationMiddleware.ts";
import { adminMiddleware } from "../middleware/adminMiddleware.ts";

/**
 * YouTube Music compatibility routes backed by the same Google OAuth connection
 * and YouTube Data API v3 used by the YouTube Library.
 *
 * The Data API does not expose YouTube Music listening history. The public music
 * widget therefore uses an explicitly selected track first, then a liked Music
 * category video as a fallback; it never labels a liked track as recently played.
 */
const router = Router();
const ADMIN_GUARD = [authenticationMiddleware, adminMiddleware] as const;
const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
const FETCH_TIMEOUT_MS = 6500;
const CACHE_TTL_MS = 60_000;
const YOUTUBE_MUSIC_CATEGORY_ID = "10";
const MAX_MUSIC_RESULTS = 50;
const MAX_LIKED_PAGES = 10;

type Song = {
  title: string;
  artists: string[];
  album?: string;
  thumbnail?: string;
  url?: string;
  videoId?: string;
};

type IntegrationStatus = {
  configured: boolean;
  connected: boolean;
  message?: string;
};

type CacheEntry<T> = {
  key: string;
  value: T;
  expiresAt: Date;
  updatedAt: Date;
};

const cleanText = (value: unknown, maxLength = 180): string =>
  typeof value === "string"
    ? value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";

const googleConfigured = () => Boolean(
  process.env.GOOGLE_OAUTH_CLIENT_ID
  && process.env.GOOGLE_OAUTH_CLIENT_SECRET
  && process.env.API_PUBLIC_URL,
);

async function readSetting(key: string) {
  return getDB().collection("adminIntegrationSettings").findOne({ key });
}

async function saveSetting(key: string, values: Record<string, unknown>) {
  await getDB().collection("adminIntegrationSettings").updateOne(
    { key },
    { $set: { key, ...values, updatedAt: new Date() } },
    { upsert: true },
  );
}

async function cached<T>(key: string, ttlMs: number, fetchValue: () => Promise<T>): Promise<T> {
  const collection = getDB().collection<CacheEntry<T>>("adminShowcaseCache");
  const existing = await collection.findOne({ key, expiresAt: { $gt: new Date() } });
  if (existing) return existing.value;
  const value = await fetchValue();
  await collection.updateOne(
    { key },
    { $set: { key, value, expiresAt: new Date(Date.now() + ttlMs), updatedAt: new Date() } },
    { upsert: true },
  );
  return value;
}

function tokenEncryptionKey(): Buffer {
  const value = process.env.TOKEN_ENCRYPTION_KEY || "";
  if (!/^[a-f\d]{64}$/i.test(value)) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be a 32-byte key encoded as 64 hex characters.");
  }
  return Buffer.from(value, "hex");
}

function decryptToken(value: string): string {
  const [iv, tag, ciphertext] = value.split(".");
  if (!iv || !tag || !ciphertext) throw new Error("Stored YouTube refresh token is malformed.");
  const decipher = createDecipheriv("aes-256-gcm", tokenEncryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function encryptToken(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(".");
}

/** Refresh the same encrypted Google OAuth refresh token used by YouTube Library. */
async function getYoutubeAccessToken(): Promise<string | null> {
  const record = await readSetting("youtube");
  if (!record?.refreshTokenEncrypted) return null;

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: decryptToken(String(record.refreshTokenEncrypted)),
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const payload = await response.json().catch(() => ({})) as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !payload.access_token) {
    const detail = [payload.error, payload.error_description].filter(Boolean).map((v) => cleanText(v, 160)).join(": ");
    throw new Error(`YouTube OAuth token refresh failed (${response.status})${detail ? `: ${detail}` : "."}`);
  }

  if (payload.refresh_token) {
    await saveSetting("youtube", {
      refreshTokenEncrypted: encryptToken(payload.refresh_token),
      connectedAt: new Date(),
    });
  }
  return payload.access_token;
}

async function fetchYoutubeJson(url: URL, token: string): Promise<any> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    const message = cleanText(payload?.error?.message, 220);
    const reason = cleanText(payload?.error?.errors?.[0]?.reason, 80);
    throw new Error(
      `YouTube Data API returned HTTP ${response.status}`
      + (message ? `: ${message}` : "")
      + (reason ? ` (reason: ${reason})` : ""),
    );
  }
  return payload;
}

function youtubeMusicSong(video: any): Song | null {
  const videoId = cleanText(video?.id, 100);
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return null;
  const snippet = video?.snippet || {};
  const thumbnail = snippet.thumbnails?.maxres?.url
    || snippet.thumbnails?.high?.url
    || snippet.thumbnails?.medium?.url
    || snippet.thumbnails?.default?.url;
  return {
    videoId,
    title: cleanText(snippet.title, 240) || "YouTube Music track",
    artists: [cleanText(snippet.channelTitle, 120)].filter(Boolean),
    thumbnail: typeof thumbnail === "string" ? thumbnail : undefined,
    // Deliberately open music-category likes in YouTube Music, not ordinary YouTube.
    url: `https://music.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
  };
}

/** Pull liked videos through Data API, retaining only video category 10 (Music). */
async function fetchLikedMusicSongs(token: string, limit = MAX_MUSIC_RESULTS): Promise<Song[]> {
  const songs: Song[] = [];
  const seen = new Set<string>();
  let pageToken = "";
  let pages = 0;

  do {
    const params = new URLSearchParams({
      part: "snippet,contentDetails",
      myRating: "like",
      maxResults: "50",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await fetchYoutubeJson(new URL(`${YOUTUBE_API}/videos?${params.toString()}`), token);
    pages += 1;

    for (const video of Array.isArray(data.items) ? data.items : []) {
      if (String(video?.snippet?.categoryId || "") !== YOUTUBE_MUSIC_CATEGORY_ID) continue;
      const song = youtubeMusicSong(video);
      if (!song || seen.has(song.videoId!)) continue;
      seen.add(song.videoId!);
      songs.push(song);
      if (songs.length >= limit) break;
    }

    pageToken = songs.length >= limit ? "" : cleanText(data.nextPageToken, 1000);
  } while (pageToken && pages < MAX_LIKED_PAGES && songs.length < limit);

  return songs.slice(0, limit);
}

async function cachedLikedMusicSongs(): Promise<Song[]> {
  return cached("youtube-liked-music-v1", CACHE_TTL_MS, async () => {
    const token = await getYoutubeAccessToken();
    if (!token) return [];
    return fetchLikedMusicSongs(token, MAX_MUSIC_RESULTS);
  });
}

function normalizePublicSong(value: any): Song | null {
  const videoId = cleanText(value?.videoId, 100);
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return null;
  const artists = Array.isArray(value?.artists)
    ? value.artists.map((artist: unknown) => cleanText(artist, 100)).filter(Boolean).slice(0, 8)
    : [];
  const thumbnail = typeof value?.thumbnail === "string" && value.thumbnail.startsWith("https://")
    ? value.thumbnail.slice(0, 2048)
    : undefined;
  return {
    videoId,
    title: cleanText(value?.title, 240) || "YouTube Music track",
    artists,
    album: cleanText(value?.album, 180) || undefined,
    thumbnail,
    url: `https://music.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
  };
}

async function getYtmusicStatus(): Promise<IntegrationStatus> {
  const [youtube, enabled] = await Promise.all([
    readSetting("youtube"),
    readSetting("ytmusic-enabled"),
  ]);
  const youtubeConnected = Boolean(youtube?.refreshTokenEncrypted);
  const configured = googleConfigured();
  const connected = configured && youtubeConnected && enabled?.enabled === true;
  return {
    configured,
    connected,
    message: !configured
      ? "Google OAuth is not configured for the YouTube Library."
      : !youtubeConnected
        ? "Connect YouTube in the YouTube Library to use its authenticated liked-videos API."
        : !connected
          ? "YouTube is connected. Enable YouTube Music to load liked Music-category videos."
          : "Connected through the existing YouTube OAuth account.",
  };
}

// Add OAuth-backed YouTube Music status to the existing Spotify/YouTube response
// without replacing the Spotify playback logic.
router.get("/showcase/integrations", async (_req, res, next) => {
  try {
    const status = await getYtmusicStatus();
    const originalJson = res.json.bind(res);
    res.json = ((body: any) => originalJson({
      ...(body && typeof body === "object" ? body : {}),
      ytmusic: status,
    })) as typeof res.json;
    next();
  } catch (error) {
    next(error);
  }
});

router.get("/showcase/ytmusic/liked", ...ADMIN_GUARD, async (_req, res, next) => {
  try {
    const status = await getYtmusicStatus();
    if (!status.connected) {
      return res.status(409).json({ message: status.message || "Connect and enable YouTube Music first." });
    }
    const token = await getYoutubeAccessToken();
    if (!token) return res.status(409).json({ message: "Connect YouTube in the YouTube Library first." });
    const items = await fetchLikedMusicSongs(token, MAX_MUSIC_RESULTS);
    res.setHeader("Cache-Control", "private, no-store");
    return res.json({ items });
  } catch (error) {
    const detail = error instanceof Error ? cleanText(error.message, 240) : "Unknown error";
    console.error(`[youtubeMusicApi] Could not load liked Music-category videos: ${detail}`);
    return res.status(502).json({ message: `Could not load liked Music-category videos${detail ? `: ${detail}` : "."}` });
  }
});

router.post("/admin/integrations/ytmusic/connect", ...ADMIN_GUARD, async (_req, res, next) => {
  try {
    const youtube = await readSetting("youtube");
    if (!youtube?.refreshTokenEncrypted) {
      return res.status(409).json({ message: "Connect YouTube first using the YouTube Library button, then enable YouTube Music." });
    }
    const token = await getYoutubeAccessToken();
    if (!token) return res.status(409).json({ message: "The YouTube OAuth connection is unavailable. Reconnect YouTube in the YouTube Library." });

    // Validate the same authenticated Data API used for playlists before enabling the picker.
    const endpoint = new URL(`${YOUTUBE_API}/videos`);
    endpoint.search = new URLSearchParams({ part: "snippet", myRating: "like", maxResults: "1" }).toString();
    await fetchYoutubeJson(endpoint, token);
    await saveSetting("ytmusic-enabled", { enabled: true, connectedAt: new Date() });
    return res.json({ success: true, connected: true });
  } catch (error) {
    const detail = error instanceof Error ? cleanText(error.message, 240) : "Unknown error";
    console.error(`[youtubeMusicApi] Connect failed: ${detail}`);
    return res.status(502).json({ message: `Could not enable YouTube Music through the YouTube Library${detail ? `: ${detail}` : "."}` });
  }
});

router.post("/admin/integrations/ytmusic/disconnect", ...ADMIN_GUARD, async (_req, res, next) => {
  try {
    await saveSetting("ytmusic-enabled", { enabled: false, disconnectedAt: new Date() });
    // Keep the YouTube OAuth token connected for the YouTube Library itself.
    return res.json({ success: true, provider: "ytmusic" });
  } catch (error) {
    next(error);
  }
});

router.get("/showcase/ytmusic/public", async (_req, res, next) => {
  try {
    const [enabled, saved, youtube] = await Promise.all([
      readSetting("ytmusic-enabled"),
      readSetting("ytmusic-public-showcase"),
      readSetting("youtube"),
    ]);
    const connected = enabled?.enabled === true && Boolean(youtube?.refreshTokenEncrypted);
    const tracks = Array.isArray(saved?.tracks)
      ? saved.tracks.map(normalizePublicSong).filter((track: Song | null): track is Song => Boolean(track)).slice(0, 3)
      : [];
    let fallbackTrack: Song | null = null;
    if (connected && tracks.length === 0) {
      try {
        fallbackTrack = (await cachedLikedMusicSongs())[0] || null;
      } catch (error) {
        const detail = error instanceof Error ? cleanText(error.message, 180) : "Unknown error";
        console.warn(`[youtubeMusicApi] Public liked-track fallback unavailable: ${detail}`);
      }
    }
    res.setHeader("Cache-Control", "public, max-age=30");
    return res.json({
      connected,
      lastPlayed: null,
      tracks,
      fallbackTrack,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/admin/showcase/ytmusic/public-tracks", ...ADMIN_GUARD, async (req, res, next) => {
  try {
    const supplied = req.body?.tracks;
    if (!Array.isArray(supplied) || supplied.length > 3) {
      return res.status(400).json({ message: "Choose no more than three tracks." });
    }
    const tracks = supplied.map(normalizePublicSong);
    if (tracks.some((track: Song | null) => !track)) {
      return res.status(400).json({ message: "One or more selected tracks are invalid." });
    }
    await saveSetting("ytmusic-public-showcase", { tracks });
    res.setHeader("Cache-Control", "no-store");
    return res.json({ tracks });
  } catch (error) {
    next(error);
  }
});

// YouTube Data API does not expose personal listening history. Keep this endpoint
// as a compatibility response for older AccountPage code, but never call a companion.
router.post("/admin/showcase/ytmusic/sync-history", ...ADMIN_GUARD, async (_req, res) => {
  const status = await getYtmusicStatus();
  if (!status.connected) return res.status(409).json({ message: status.message || "YouTube Music is disconnected." });
  res.setHeader("Cache-Control", "private, no-store");
  return res.json({ lastPlayed: null, historyAvailable: false });
});

export default router;
