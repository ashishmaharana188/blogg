import { Router } from "express";
import {
  createHash,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import { getDB } from "../db/mongoDBConnect.ts";
import { authenticationMiddleware } from "../middleware/authenticationMiddleware.ts";
import { adminMiddleware } from "../middleware/adminMiddleware.ts";

const router = Router();
const ADMIN_GUARD = [authenticationMiddleware, adminMiddleware] as const;
const MAX_LINKS = 80;
const FETCH_TIMEOUT_MS = 6500;
const SPOTIFY_API = "https://api.spotify.com/v1";
type Song = { title: string; artists: string[]; album?: string; thumbnail?: string; url?: string; videoId?: string };
type IntegrationStatus = { configured: boolean; connected: boolean; message?: string };
type CacheEntry<T> = { key: string; value: T; expiresAt: Date; updatedAt: Date };

const cleanText = (value: unknown, maxLength = 180) => typeof value === "string"
  ? value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, maxLength)
  : "";
const frontendBase = () => (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");
const apiBase = () => (process.env.API_PUBLIC_URL || "").replace(/\/+$/, "");
const callbackUrl = (provider: "spotify" | "youtube") => `${apiBase()}/api/admin/integrations/${provider}/callback`;
const spotifyConfigured = () => Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET && apiBase());
const googleConfigured = () => Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.YOUTUBE_API_KEY && apiBase());

// Deliberately allowlist providers instead of fetching arbitrary URLs. This avoids turning the link
// preview feature into an SSRF proxy against private network addresses or cloud metadata endpoints.
function safeProviderUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
      const allowed = new Set([
      "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be",
      "open.spotify.com", "noteonstuff.vercel.app",
    ]);
    if (!allowed.has(host)) return null;
    if (host === "noteonstuff.vercel.app" && !url.pathname.startsWith("/share/")) return null;
    return url;
  } catch {
    return null;
  }
}
function providerFor(url: URL): "youtube" | "ytmusic" | "spotify" | "blogg" {
  if (url.hostname === "open.spotify.com") return "spotify";
  if (url.hostname === "music.youtube.com") return "ytmusic";
  if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(url.hostname)) return "youtube";
  return "blogg";
}

async function readSetting(key: string) {
  return getDB().collection("adminIntegrationSettings").findOne({ key });
}
async function saveSetting(key: string, values: Record<string, unknown>) {
  await getDB().collection("adminIntegrationSettings").updateOne(
    { key }, { $set: { key, ...values, updatedAt: new Date() } }, { upsert: true },
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
function tokenEncryptionKey() {
  const value = process.env.TOKEN_ENCRYPTION_KEY || "";
  if (!/^[a-f\d]{64}$/i.test(value)) throw new Error("TOKEN_ENCRYPTION_KEY must be a 32-byte key encoded as 64 hex characters.");
  return Buffer.from(value, "hex");
}
function encryptToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(".");
}
function decryptToken(value: string) {
  const [iv, tag, ciphertext] = value.split(".");
  if (!iv || !tag || !ciphertext) throw new Error("Stored integration token is malformed.");
  const decipher = createDecipheriv("aes-256-gcm", tokenEncryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}
function createOAuthState() {
  const nonce = randomUUID();
  const secret = process.env.INTEGRATION_STATE_SECRET || process.env.JWT_SECRET || "";
  if (!secret) throw new Error("INTEGRATION_STATE_SECRET or JWT_SECRET must be configured.");
  const signature = createHash("sha256").update(`${secret}:${nonce}`).digest("hex");
  return `${nonce}.${signature}`;
}
function validOAuthState(state: string) {
  const [nonce, signature] = state.split(".");
  const secret = process.env.INTEGRATION_STATE_SECRET || process.env.JWT_SECRET || "";
  if (!nonce || !signature || !secret) return false;
  const expected = createHash("sha256").update(`${secret}:${nonce}`).digest("hex");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

async function getAccessToken(provider: "spotify" | "youtube"): Promise<string | null> {
  const record = await readSetting(provider);
  if (!record?.refreshTokenEncrypted) return null;
  const clientId = provider === "spotify" ? process.env.SPOTIFY_CLIENT_ID : process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = provider === "spotify" ? process.env.SPOTIFY_CLIENT_SECRET : process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const response = await fetch(provider === "spotify" ? "https://accounts.spotify.com/api/token" : "https://oauth2.googleapis.com/token", {
    method: "POST",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(provider === "spotify" ? { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}` } : {}),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: decryptToken(String(record.refreshTokenEncrypted)),
      ...(provider === "youtube" ? { client_id: clientId, client_secret: clientSecret } : {}),
    }),
  });
  if (!response.ok) throw new Error(`${provider} token refresh failed (${response.status}). Reconnect this integration if it persists.`);
  const payload = await response.json() as { access_token: string; refresh_token?: string };
  if (payload.refresh_token) {
    await saveSetting(provider, { refreshTokenEncrypted: encryptToken(payload.refresh_token), connectedAt: new Date() });
  }
  return payload.access_token;
}
function spotifySong(track: any): Song | null {
  if (!track) return null;
  return {
    title: cleanText(track.name, 240) || "Untitled track",
    artists: Array.isArray(track.artists) ? track.artists.map((artist: any) => cleanText(artist.name, 100)).filter(Boolean) : [],
    album: cleanText(track.album?.name, 180) || undefined,
    thumbnail: track.album?.images?.[0]?.url,
    url: track.external_urls?.spotify,
  };
}
function youtubeSong(video: any): Song {
  return {
    title: cleanText(video?.snippet?.title, 240) || "YouTube video",
    artists: [cleanText(video?.snippet?.channelTitle, 120)].filter(Boolean),
    thumbnail: video?.snippet?.thumbnails?.high?.url || video?.snippet?.thumbnails?.medium?.url || video?.snippet?.thumbnails?.default?.url,
    url: video?.id ? `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}` : undefined,
    videoId: cleanText(video?.id, 100) || undefined,
  };
}
function ytmusicSong(song: any): Song {
  return {
    title: cleanText(song?.title, 240) || "Untitled track",
    artists: Array.isArray(song?.artists) ? song.artists.map((artist: any) => cleanText(artist?.name, 100)).filter(Boolean) : [],
    album: cleanText(song?.album?.name, 180) || undefined,
    thumbnail: Array.isArray(song?.thumbnails) ? song.thumbnails.at(-1)?.url : undefined,
    url: song?.videoId ? `https://music.youtube.com/watch?v=${encodeURIComponent(song.videoId)}` : undefined,
    videoId: cleanText(song?.videoId, 100) || undefined,
  };
}

function textFromBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  const pieces: string[] = [];
  for (const item of blocks) {
    if (!item || typeof item !== "object") continue;
    const block = item as { content?: unknown; children?: unknown };
    if (typeof block.content === "string") pieces.push(block.content);
    else if (Array.isArray(block.content)) {
      for (const part of block.content) {
        if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") pieces.push((part as { text: string }).text);
      }
    }
    if (Array.isArray(block.children)) pieces.push(textFromBlocks(block.children));
  }
  return pieces.join(" ").replace(/\s+/g, " ").trim();
}
function firstImageFromBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  for (const item of blocks) {
    if (!item || typeof item !== "object") continue;
    const block = item as { type?: unknown; props?: { url?: unknown; src?: unknown }; children?: unknown };
    if (block.type === "image") {
      const imageUrl = typeof block.props?.url === "string" ? block.props.url : block.props?.src;
      if (typeof imageUrl === "string" && imageUrl.startsWith("https://")) return imageUrl;
    }
    if (Array.isArray(block.children)) {
      const nested = firstImageFromBlocks(block.children);
      if (nested) return nested;
    }
  }
  return "";
}
async function providerPreview(url: URL, provider: "youtube" | "ytmusic" | "spotify" | "blogg") {
  let title = "";
  let description = "";
  let image = "";
  if (provider === "youtube" || provider === "ytmusic" || provider === "spotify") {
    // Host is allowlisted above and the request always targets a fixed provider endpoint.
    const endpoint = provider === "spotify" ? "https://open.spotify.com/oembed" : "https://www.youtube.com/oembed";
    try {
      const previewUrl = new URL(endpoint);
      previewUrl.search = new URLSearchParams({ url: url.toString(), format: "json" }).toString();
      const response = await fetch(previewUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (response.ok) {
        const data = await response.json() as { title?: string; author_name?: string; thumbnail_url?: string; provider_name?: string };
        title = cleanText(data.title, 180);
        description = cleanText(data.author_name ? `By ${data.author_name}` : data.provider_name, 180);
        if (typeof data.thumbnail_url === "string" && data.thumbnail_url.startsWith("https://")) image = data.thumbnail_url;
      }
    } catch { /* Fall back to a useful provider-labelled card if oEmbed is unavailable. */ }
  } else {
    const noteId = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) || "");
    if (noteId) {
      const objectId = /^[a-f\d]{24}$/i.test(noteId) ? new ObjectId(noteId) : null;
      const filter = objectId ? { $or: [{ blogg_id: noteId }, { _id: objectId }] } : { blogg_id: noteId };
      const note = await getDB().collection("bloggs").findOne(filter);
      if (note) {
        title = cleanText(note.title, 180) || "Shared note on Blogg";
        const subtitle = cleanText(note.subtitle, 240);
        const body = textFromBlocks(note.content);
        description = subtitle || (body.length > 220 ? `${body.slice(0, 217).trimEnd()}…` : body) || "Open this note on Blogg.";
        image = firstImageFromBlocks(note.content);
      }
    }
  }
  return { title, description, image };
}
async function integrationStates() {
  const [spotify, youtube, ytmusic] = await Promise.all(["spotify", "youtube", "ytmusic"].map(readSetting));
  return {
    spotify: { configured: spotifyConfigured(), connected: Boolean(spotify?.refreshTokenEncrypted) } satisfies IntegrationStatus,
    youtube: { configured: googleConfigured(), connected: Boolean(youtube?.refreshTokenEncrypted) } satisfies IntegrationStatus,
    ytmusic: { configured: Boolean(process.env.YTMUSIC_SERVICE_URL && process.env.YTMUSIC_SERVICE_TOKEN), connected: Boolean(process.env.YTMUSIC_SERVICE_URL && process.env.YTMUSIC_SERVICE_TOKEN) } satisfies IntegrationStatus,
  };
}

router.get("/showcase", async (req, res, next) => {
  try {
    let isAdmin = false;
    const token = req.cookies?.authToken;
    if (token) {
      try {
        const jwtSecret = process.env.JWT_SECRET || (process.env.NODE_ENV === "production" ? "" : "dev-secret");
        if (jwtSecret) {
          const decoded = jwt.verify(token, jwtSecret) as { email?: string };
          isAdmin = Boolean(decoded.email && decoded.email.trim().toLowerCase() === process.env.ADMIN_EMAIL?.trim().toLowerCase());
        }
      } catch {
        // Invalid cookies receive the same public view as anonymous visitors.
      }
    }
    const collection = getDB().collection("adminShowcaseLinks");
    const records = await collection.find(isAdmin ? {} : { visible: true }).sort({ order: 1, createdAt: -1 }).limit(MAX_LINKS).toArray();
    res.json({ items: records.map((item: any) => ({
      id: String(item.id), url: item.url, title: item.title, description: item.description,
      image: item.image, provider: item.provider, visible: Boolean(item.visible), order: Number(item.order || 0),
    })) });
  } catch (error) { next(error); }
});

router.get("/showcase/integrations", async (_req, res, next) => {
  try {
    const status = await integrationStates();
    let spotify: any = { ...status.spotify, playing: false, provider: "spotify" };
    if (status.spotify.connected) {
      try {
        spotify = await cached("spotify-currently-playing-v1", 20_000, async () => {
          const token = await getAccessToken("spotify");
          if (!token) return { connected: false, playing: false, provider: "spotify" };
          const response = await fetch(`${SPOTIFY_API}/me/player/currently-playing`, {
            headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });
          if (response.status === 204) return { connected: true, playing: false, provider: "spotify" };
          if (!response.ok) throw new Error(`Spotify API returned ${response.status}.`);
          const playback = await response.json() as any;
          return { connected: true, playing: Boolean(playback.is_playing && playback.item), track: spotifySong(playback.item), provider: "spotify" };
        });
      } catch {
        spotify = { connected: true, playing: false, provider: "spotify", message: "Spotify could not be refreshed. Reconnect from the account page if needed." };
      }
    }
    res.json({ spotify, youtube: status.youtube, ytmusic: status.ytmusic });
  } catch (error) { next(error); }
});

router.get("/showcase/youtube/liked", ...ADMIN_GUARD, async (_req, res, next) => {
  try {
    const status = await integrationStates();
    if (!status.youtube.connected) return res.json({ items: [] });
    const token = await getAccessToken("youtube");
    if (!token) return res.json({ items: [] });
    const endpoint = new URL("https://www.googleapis.com/youtube/v3/videos");
    endpoint.search = new URLSearchParams({ part: "snippet", myRating: "like", maxResults: "25", key: process.env.YOUTUBE_API_KEY || "" }).toString();
    const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`YouTube Data API returned ${response.status}.`);
    const data = await response.json() as any;
    res.setHeader("Cache-Control", "private, max-age=60");
    res.json({ items: (data.items || []).map(youtubeSong) });
  } catch (error) { next(error); }
});

router.get("/showcase/ytmusic/liked", ...ADMIN_GUARD, async (_req, res, next) => {
  try {
    const serviceUrl = process.env.YTMUSIC_SERVICE_URL?.replace(/\/+$/, "");
    const serviceToken = process.env.YTMUSIC_SERVICE_TOKEN;
    if (!serviceUrl || !serviceToken) return res.json({ items: [] });
    const response = await fetch(`${serviceUrl}/liked`, {
      headers: { Authorization: `Bearer ${serviceToken}` }, signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) throw new Error(`YouTube Music companion service returned ${response.status}.`);
    const data = await response.json() as { items?: any[] };
    res.json({ items: Array.isArray(data.items) ? data.items.slice(0, 50).map(ytmusicSong) : [] });
  } catch (error) { next(error); }
});

router.get("/admin/integrations/:provider/connect", ...ADMIN_GUARD, async (req, res, next) => {
  try {
    const provider = String(req.params.provider);
    if (provider === "ytmusic") return res.status(200).type("text").send("YouTube Music is configured through the companion Python service. See README_ADMIN_SHOWCASE_SETUP.md for the OAuth file, client credentials, and Render service setup. Then return to /account and refresh the page.");
    if (provider !== "spotify" && provider !== "youtube") return res.status(404).send("Unknown integration.");
    if (provider === "spotify" ? !spotifyConfigured() : !googleConfigured()) {
      return res.status(503).type("text").send("Integration credentials are missing in the backend environment. See README_ADMIN_SHOWCASE_SETUP.md.");
    }
    const state = createOAuthState();
    await saveSetting(`oauth-state-${provider}`, {
      stateHash: createHash("sha256").update(state).digest("hex"),
      stateExpiresAt: new Date(Date.now() + 10 * 60_000),
    });
    const callback = callbackUrl(provider);
    const authUrl = provider === "spotify"
      ? new URL("https://accounts.spotify.com/authorize")
      : new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.search = new URLSearchParams(provider === "spotify" ? {
      client_id: process.env.SPOTIFY_CLIENT_ID!, response_type: "code", redirect_uri: callback,
      scope: "user-read-currently-playing", state,
    } : {
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!, redirect_uri: callback, response_type: "code",
      scope: "https://www.googleapis.com/auth/youtube.readonly", access_type: "offline", prompt: "consent", state,
    }).toString();
    res.redirect(authUrl.toString());
  } catch (error) { next(error); }
});

// OAuth provider redirects are unauthenticated browser requests. The signed, expiring state above
// binds the callback to the administrator's previously initiated connection flow.
router.get("/admin/integrations/:provider/callback", async (req, res, next) => {
  try {
    const provider = String(req.params.provider);
    if (provider !== "spotify" && provider !== "youtube") return res.status(404).send("Unknown integration.");
    if (req.query.error) return res.redirect(`${frontendBase()}/account?integration=${encodeURIComponent(provider)}&error=${encodeURIComponent(String(req.query.error))}`);
    const state = String(req.query.state || "");
    const stored = await readSetting(`oauth-state-${provider}`);
    const expired = !stored?.stateExpiresAt || new Date(stored.stateExpiresAt as Date).getTime() <= Date.now();
    const suppliedHash = createHash("sha256").update(state).digest("hex");
    if (!state || !validOAuthState(state) || expired || suppliedHash !== stored?.stateHash) {
      return res.status(400).type("text").send("OAuth state is invalid or expired. Return to /account and reconnect.");
    }
    const code = String(req.query.code || "");
    if (!code) return res.status(400).send("Authorization code missing.");
    const clientId = provider === "spotify" ? process.env.SPOTIFY_CLIENT_ID! : process.env.GOOGLE_OAUTH_CLIENT_ID!;
    const clientSecret = provider === "spotify" ? process.env.SPOTIFY_CLIENT_SECRET! : process.env.GOOGLE_OAUTH_CLIENT_SECRET!;
    const response = await fetch(provider === "spotify" ? "https://accounts.spotify.com/api/token" : "https://oauth2.googleapis.com/token", {
      method: "POST", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(provider === "spotify" ? { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}` } : {}),
      },
      body: new URLSearchParams({
        grant_type: "authorization_code", code, redirect_uri: callbackUrl(provider),
        ...(provider === "youtube" ? { client_id: clientId, client_secret: clientSecret } : {}),
      }),
    });
    if (!response.ok) throw new Error(`${provider} token exchange failed (${response.status}). Check the registered callback URL.`);
    const tokens = await response.json() as { refresh_token?: string };
    const existing = await readSetting(provider);
    if (!tokens.refresh_token && !existing?.refreshTokenEncrypted) throw new Error(`${provider} returned no refresh token. Reconnect and grant offline access.`);
    if (tokens.refresh_token) await saveSetting(provider, { refreshTokenEncrypted: encryptToken(tokens.refresh_token), connectedAt: new Date() });
    await getDB().collection("adminIntegrationSettings").deleteOne({ key: `oauth-state-${provider}` });
    res.redirect(`${frontendBase()}/account?integration=${encodeURIComponent(provider)}&connected=1`);
  } catch (error) { next(error); }
});

router.post("/admin/showcase/links", ...ADMIN_GUARD, async (req, res, next) => {
  try {
    const url = safeProviderUrl(req.body?.url);
    if (!url) return res.status(400).json({ message: "Use an HTTPS link from YouTube, YouTube Music, Spotify, or the Blogg site." });
    const provider = providerFor(url);
    const metadata = await providerPreview(url, provider);
    const title = cleanText(req.body?.title, 180) || metadata.title || (provider === "spotify" ? "Open on Spotify" : provider === "ytmusic" ? "YouTube Music track" : provider === "youtube" ? "YouTube video" : "Shared note on Blogg");
    const description = metadata.description || (provider === "ytmusic" ? "Listen on YouTube Music." : provider === "youtube" ? "Watch on YouTube." : provider === "spotify" ? "Open this on Spotify." : "Open this note on Blogg.");
    const image = metadata.image;
    const collection = getDB().collection("adminShowcaseLinks");
    if (await collection.countDocuments({}) >= MAX_LINKS) return res.status(409).json({ message: "Showcase limit reached. Remove an older link first." });
    const item = {
      id: randomUUID(), url: url.toString(), title, description, image, provider, visible: false,
      order: await collection.countDocuments({}), createdAt: new Date(),
    };
    await collection.insertOne(item);
    res.status(201).json({ item });
  } catch (error) { next(error); }
});

router.patch("/admin/showcase/links/:id", ...ADMIN_GUARD, async (req, res, next) => {
  try {
    if (typeof req.body?.visible !== "boolean") return res.status(400).json({ message: "visible must be a boolean." });
    const result = await getDB().collection("adminShowcaseLinks").updateOne(
      { id: req.params.id }, { $set: { visible: req.body.visible, updatedAt: new Date() } },
    );
    if (!result.matchedCount) return res.status(404).json({ message: "Link not found." });
    res.json({ success: true });
  } catch (error) { next(error); }
});

router.delete("/admin/showcase/links/:id", ...ADMIN_GUARD, async (req, res, next) => {
  try {
    const result = await getDB().collection("adminShowcaseLinks").deleteOne({ id: req.params.id });
    if (!result.deletedCount) return res.status(404).json({ message: "Link not found." });
    res.json({ success: true });
  } catch (error) { next(error); }
});

export default router;
