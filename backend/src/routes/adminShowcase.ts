import { Router } from "express";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import * as http from "node:http";
import * as https from "node:https";
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
const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_PUBLIC_CACHE_MS = 60_000;
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

// Accept ordinary public HTTPS pages for rich previews, but never fetch local/private
// network targets. Redirect targets are revalidated before every follow-up request.
function isPublicIp(address: string): boolean {
  if (isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    const [a, b, c] = parts;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 192 && b === 0 && c === 0) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    if (a === 192 && b === 0 && c === 2) return false;
    return true;
  }
  if (isIP(address) === 6) {
    const value = address.toLowerCase();
    if (value === "::" || value === "::1" || value.startsWith("::ffff:")) return false;
    // Require globally allocated unicast space (2000::/3), excluding special-purpose
    // 2001::/23, 6to4 (2002::/16), and the 3fff::/20 documentation block.
    const segments = value.split(":");
    const firstSegment = parseInt(segments[0] || "0", 16);
    const secondSegment = parseInt(segments[1] || "0", 16);
    if (firstSegment < 0x2000 || firstSegment > 0x3fff) return false;
    if ((firstSegment === 0x2001 && secondSegment < 0x0200) || firstSegment === 0x2002 || value.startsWith("3fff:")) return false;
    return true;
  }
  return false;
}

async function safePreviewUrl(value: unknown): Promise<URL | null> {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const defaultPort = url.protocol === "https:" ? "443" : "80";
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || (url.port && url.port !== defaultPort)) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".test")) return null;
    // Do not accept IP literals. Normal site URLs should use DNS hostnames.
    if (isIP(host)) return null;
    const records = await lookup(host, { all: true, verbatim: true });
    if (!records.length || records.some((record) => !isPublicIp(record.address))) return null;
    url.hostname = host;
    return url;
  } catch {
    return null;
  }
}

function providerFor(url: URL): "youtube" | "ytmusic" | "spotify" | "blogg" | "web" {
  const host = url.hostname.toLowerCase();
  if (host === "open.spotify.com") return "spotify";
  if (host === "music.youtube.com") return "ytmusic";
  if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(host)) return "youtube";
  if (host === "noteonstuff.vercel.app") return "blogg";
  return "web";
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
function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, decimal) => {
      const codePoint = Number(decimal);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : "";
    })
    .replace(/&#x([\da-f]+);/gi, (_match, hexadecimal) => {
      const codePoint = parseInt(hexadecimal, 16);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : "";
    });
}

function attributeValue(tag: string, attribute: string): string {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return decodeHtml(match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function htmlMeta(html: string, names: string[]): string {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = (attributeValue(tag, "property") || attributeValue(tag, "name") || attributeValue(tag, "itemprop")).toLowerCase();
    if (names.includes(key)) {
      const value = attributeValue(tag, "content");
      if (value) return cleanText(value, 500);
    }
  }
  return "";
}

type PublicHtmlResponse = { status: number; location: string; contentType: string; body: string };

async function requestPublicHtml(url: URL): Promise<PublicHtmlResponse> {
  // Resolve once, reject every non-public answer, and pin the socket to the validated
  // address. This prevents the HTTP client from performing a second, unvalidated DNS lookup.
  const records = await lookup(url.hostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => !isPublicIp(record.address))) {
    throw new Error("Preview host did not resolve exclusively to public addresses.");
  }
  const address = records[0];
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result: PublicHtmlResponse) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const request = transport.request({
      hostname: address.address,
      family: address.family,
      port,
      method: "GET",
      path: `${url.pathname}${url.search}`,
      headers: {
        Host: url.host,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        "User-Agent": "BloggLinkPreview/1.0",
        Connection: "close",
      },
      ...(url.protocol === "https:" ? { servername: url.hostname, rejectUnauthorized: true } : {}),
    }, (response) => {
      const status = response.statusCode || 0;
      const location = typeof response.headers.location === "string" ? response.headers.location : "";
      const contentType = typeof response.headers["content-type"] === "string" ? response.headers["content-type"] as string : "";
      const chunks: Buffer[] = [];
      let byteCount = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remaining = 500_000 - byteCount;
        if (remaining > 0) {
          const accepted = buffer.length > remaining ? buffer.subarray(0, remaining) : buffer;
          chunks.push(accepted);
          byteCount += accepted.length;
        }
        if (byteCount >= 500_000) {
          finish({ status, location, contentType, body: Buffer.concat(chunks).toString("utf8") });
          response.destroy();
        }
      });
      response.on("end", () => finish({ status, location, contentType, body: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", () => finish({ status, location, contentType, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.setTimeout(FETCH_TIMEOUT_MS, () => request.destroy(new Error("Preview request timed out.")));
    request.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    request.end();
  });
}

async function getHtmlPreview(startUrl: URL): Promise<{ title: string; description: string; image: string }> {
  let currentUrl = startUrl;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    const safeUrl = await safePreviewUrl(currentUrl.toString());
    if (!safeUrl) return { title: "", description: "", image: "" };
    let response: PublicHtmlResponse;
    try {
      response = await requestPublicHtml(safeUrl);
    } catch {
      return { title: "", description: "", image: "" };
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.location || redirectCount === 3) return { title: "", description: "", image: "" };
      try { currentUrl = new URL(response.location, safeUrl); } catch { return { title: "", description: "", image: "" }; }
      continue;
    }
    if (response.status < 200 || response.status >= 300 || !/text\/html|application\/xhtml\+xml/i.test(response.contentType) || !response.body) {
      return { title: "", description: "", image: "" };
    }
    const html = response.body;
    const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] || "";
    const rawImage = htmlMeta(html, ["og:image", "og:image:url", "twitter:image"]);
    let image = "";
    if (rawImage) {
      try {
        const imageUrl = new URL(rawImage, safeUrl);
        if (imageUrl.protocol === "https:" && !imageUrl.username && !imageUrl.password) {
          const safeImageUrl = await safePreviewUrl(imageUrl.toString());
          if (safeImageUrl) image = safeImageUrl.toString();
        }
      } catch { /* Ignore malformed or non-public preview image URLs. */ }
    }
    return {
      title: htmlMeta(html, ["og:title", "twitter:title"]) || cleanText(decodeHtml(titleTag.replace(/<[^>]*>/g, "")), 180),
      description: htmlMeta(html, ["og:description", "description", "twitter:description"]),
      image,
    };
  }
  return { title: "", description: "", image: "" };
}

async function providerPreview(url: URL, provider: "youtube" | "ytmusic" | "spotify" | "blogg" | "web") {
  let title = "";
  let description = "";
  let image = "";
  if (provider === "youtube" || provider === "ytmusic" || provider === "spotify") {
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
    } catch { /* Fall through to standard Open Graph metadata. */ }
  } else if (provider === "blogg" && url.pathname.startsWith("/share/")) {
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
  if (!title || !description || !image) {
    const generic = await getHtmlPreview(url);
    title ||= generic.title;
    description ||= generic.description;
    image ||= generic.image;
  }
  const domainLabel = url.hostname.replace(/^www\./i, "");
  title ||= provider === "spotify" ? "Open on Spotify" : provider === "ytmusic" ? "YouTube Music" : provider === "youtube" ? "YouTube video" : provider === "blogg" ? "Open on Blogg" : domainLabel;
  description ||= provider === "spotify" ? "Open this on Spotify." : provider === "ytmusic" ? "Listen on YouTube Music." : provider === "youtube" ? "Watch on YouTube." : provider === "blogg" ? "Open this page on Blogg." : `Visit ${domainLabel}.`;
  return { title, description, image };
}

function isYoutubePlaylistId(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,100}$/.test(value);
}

async function fetchYoutubeJson(url: URL, token: string): Promise<any> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as any;
    const detail = cleanText(body?.error?.message, 180);
    throw new Error(`YouTube Data API returned ${response.status}${detail ? `: ${detail}` : ""}. Check the Google OAuth connection and YouTube Data API configuration.`);
  }
  return response.json();
}

async function fetchPublicYoutubePlaylists(token: string) {
  const playlists: Array<{ id: string; title: string; description: string; thumbnail?: string; url: string; itemCount: number }> = [];
  let pageToken = "";
  // Limit the returned list to 200 public playlists, but keep paging past private/unlisted ones.
  do {
    const params = new URLSearchParams({ part: "snippet,contentDetails,status", mine: "true", maxResults: "50", key: process.env.YOUTUBE_API_KEY || "" });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await fetchYoutubeJson(new URL(`${YOUTUBE_API}/playlists?${params.toString()}`), token);
    for (const item of data.items || []) {
      if (item?.status?.privacyStatus !== "public" || !item.id) continue;
      const snippet = item.snippet || {};
      playlists.push({
        id: String(item.id),
        title: cleanText(snippet.title, 180) || "Untitled playlist",
        description: cleanText(snippet.description, 280),
        thumbnail: snippet.thumbnails?.maxres?.url || snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url,
        url: `https://www.youtube.com/playlist?list=${encodeURIComponent(item.id)}`,
        itemCount: Number(item.contentDetails?.itemCount || 0),
      });
      if (playlists.length >= 200) break;
    }
    pageToken = playlists.length >= 200 ? "" : String(data.nextPageToken || "");
  } while (pageToken);
  return playlists;
}

async function fetchYoutubePlaylistVideos(token: string, playlistId: string): Promise<Song[]> {
  const items: Song[] = [];
  let pageToken = "";
  // YouTube playlists can be large; paginate the playlist rather than silently taking only the first page.
  do {
    const params = new URLSearchParams({ part: "snippet,contentDetails", playlistId, maxResults: "50", key: process.env.YOUTUBE_API_KEY || "" });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await fetchYoutubeJson(new URL(`${YOUTUBE_API}/playlistItems?${params.toString()}`), token);
    for (const entry of data.items || []) {
      const videoId = entry?.contentDetails?.videoId || entry?.snippet?.resourceId?.videoId;
      const privacyTitle = String(entry?.snippet?.title || "").toLowerCase();
      if (!videoId || privacyTitle === "private video" || privacyTitle === "deleted video") continue;
      items.push(youtubeSong({ id: videoId, snippet: entry.snippet || {} }));
    }
    pageToken = items.length >= 5000 ? "" : String(data.nextPageToken || "");
  } while (pageToken);
  return items.slice(0, 5000);
}

async function ytmusicIntegrationStatus(): Promise<IntegrationStatus> {
  const serviceUrl = process.env.YTMUSIC_SERVICE_URL?.replace(/\/+$/, "");
  const serviceToken = process.env.YTMUSIC_SERVICE_TOKEN;
  if (!serviceUrl || !serviceToken) {
    return { configured: false, connected: false, message: "YouTube Music companion service URL or service token is missing in the Node backend." };
  }

  try {
    const response = await fetch(`${serviceUrl}/health`, {
      headers: { Authorization: `Bearer ${serviceToken}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      return { configured: true, connected: false, message: `YouTube Music companion service health check returned HTTP ${response.status}.` };
    }
    const health = await response.json() as {
      ok?: boolean;
      authConfigured?: boolean;
      tokenConfigured?: boolean;
      oauthConfigured?: boolean;
    };
    const ready = Boolean(health.ok && health.authConfigured && health.tokenConfigured && health.oauthConfigured);
    return {
      configured: true,
      connected: ready,
      message: ready
        ? "YouTube Music companion service is reachable and its required configuration is present."
        : "YouTube Music companion service is reachable, but its auth file, service token, or OAuth credentials are not configured.",
    };
  } catch {
    return { configured: true, connected: false, message: "Could not reach the YouTube Music companion service health endpoint." };
  }
}

async function integrationStates() {
  const [[spotify, youtube], ytmusic] = await Promise.all([
    Promise.all([readSetting("spotify"), readSetting("youtube")]),
    ytmusicIntegrationStatus(),
  ]);
  return {
    spotify: { configured: spotifyConfigured(), connected: Boolean(spotify?.refreshTokenEncrypted) } satisfies IntegrationStatus,
    youtube: { configured: googleConfigured(), connected: Boolean(youtube?.refreshTokenEncrypted) } satisfies IntegrationStatus,
    ytmusic,
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
        spotify = await cached("spotify-currently-playing-v2", 20_000, async () => {
          const token = await getAccessToken("spotify");
          if (!token) return { connected: false, playing: false, provider: "spotify" };
          const headers = { Authorization: `Bearer ${token}` };
          const requestOptions = { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) };
          let response = await fetch(`${SPOTIFY_API}/me/player/currently-playing`, requestOptions);
          let usedPlaybackStateFallback = false;

          // Spotify occasionally reports 204 from currently-playing even while audio
          // is audible. Try GET /me/player once before telling the user nothing is playing.
          // This fallback needs the additional user-read-playback-state OAuth scope.
          if (response.status === 204) {
            usedPlaybackStateFallback = true;
            response = await fetch(`${SPOTIFY_API}/me/player`, requestOptions);
            if (response.status === 204) {
              return {
                connected: true,
                playing: false,
                provider: "spotify",
                message: "Spotify's API returned HTTP 204 from both playback endpoints. If music is audible, the API is not exposing that device's playback state right now. Keep Spotify open in the foreground and refresh, or try Spotify Web Player.",
              };
            }
          }

          if (!response.ok) {
            // Capture Spotify's response body to distinguish insufficient scope from
            // Development Mode allowlist, account, and endpoint-access errors.
            // Never log or expose Authorization headers or access tokens.
            const responseText = await response.text().catch(() => "");
            let providerDetail = responseText;
            try {
              const payload = JSON.parse(responseText);
              const errorValue = payload?.error;
              providerDetail = typeof errorValue === "string"
                ? errorValue
                : (errorValue?.message || payload?.message || payload?.error_description || responseText);
            } catch { /* Some upstream errors are plain text. */ }
            providerDetail = cleanText(providerDetail, 240);
            throw new Error(
              `Spotify playback API returned HTTP ${response.status}${usedPlaybackStateFallback ? " on the playback-state fallback" : ""}`
              + (providerDetail ? `: ${providerDetail}` : "")
              + ". Check Spotify OAuth permissions and the app's Development Mode user allowlist. Reconnect Spotify to grant user-read-playback-state.",
            );
          }
          const playback = await response.json() as any;
          const track = spotifySong(playback.item);
          if (playback.is_playing === true && !playback.item) {
            return {
              connected: true,
              playing: false,
              provider: "spotify",
              message: "Spotify reported active playback but returned no current track. Refresh the Account page and try again.",
            };
          }
          return { connected: true, playing: Boolean(playback.is_playing && track), track, provider: "spotify" };
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unknown Spotify playback error.";
        console.error(`[adminShowcase] Spotify playback lookup failed: ${reason}`);
        spotify = {
          connected: true,
          playing: false,
          provider: "spotify",
          message: `Could not read Spotify playback (${reason}). Check the backend logs if the problem persists.`,
        };
      }
    }
    res.json({ spotify, youtube: status.youtube, ytmusic: status.ytmusic });
  } catch (error) { next(error); }
});

router.get("/showcase/youtube/playlists", async (_req, res, next) => {
  try {
    const status = await integrationStates();
    const setting = await readSetting("youtube-playlist-display-mode");
    const mode = setting?.mode === "rows" ? "rows" : "playlist";
    if (!status.youtube.connected) return res.json({ configured: status.youtube.configured, connected: false, mode, playlists: [] });
    const playlists = await cached("youtube-public-playlists-v1", YOUTUBE_PUBLIC_CACHE_MS, async () => {
      const token = await getAccessToken("youtube");
      if (!token) return [];
      return fetchPublicYoutubePlaylists(token);
    });
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({ configured: status.youtube.configured, connected: true, mode, playlists });
  } catch (error) { next(error); }
});

router.get("/showcase/youtube/playlists/:playlistId/videos", async (req, res, next) => {
  try {
    const playlistId = String(req.params.playlistId || "");
    if (!isYoutubePlaylistId(playlistId)) return res.status(400).json({ message: "Invalid YouTube playlist ID." });
    const playlists = await cached("youtube-public-playlists-v1", YOUTUBE_PUBLIC_CACHE_MS, async () => {
      const token = await getAccessToken("youtube");
      return token ? fetchPublicYoutubePlaylists(token) : [];
    });
    if (!playlists.some((playlist) => playlist.id === playlistId)) {
      return res.status(404).json({ message: "This playlist is not one of the connected account's public playlists." });
    }
    const videos = await cached(`youtube-public-playlist-videos-v1-${playlistId}`, YOUTUBE_PUBLIC_CACHE_MS, async () => {
      const token = await getAccessToken("youtube");
      return token ? fetchYoutubePlaylistVideos(token, playlistId) : [];
    });
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({ items: videos });
  } catch (error) { next(error); }
});

router.post("/admin/showcase/youtube/display-mode", ...ADMIN_GUARD, async (req, res, next) => {
  try {
    const mode = req.body?.mode;
    if (mode !== "playlist" && mode !== "rows") {
      return res.status(400).json({ message: "mode must be 'playlist' or 'rows'." });
    }
    await saveSetting("youtube-playlist-display-mode", { mode });
    res.json({ success: true, mode });
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
    if (!serviceUrl || !serviceToken) {
      return res.status(503).json({ message: "YouTube Music companion service URL or service token is missing in the Node backend." });
    }
    const response = await fetch(`${serviceUrl}/liked`, {
      headers: { Authorization: `Bearer ${serviceToken}` }, signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) {
      let detail = "";
      try {
        const upstream = await response.json() as { detail?: unknown; message?: unknown };
        if (typeof upstream.detail === "string") detail = cleanText(upstream.detail, 180);
        else if (typeof upstream.message === "string") detail = cleanText(upstream.message, 180);
      } catch { /* The upstream may return a non-JSON error response. */ }
      const reason = detail ? `: ${detail}` : "";
      return res.status(502).json({ message: `YouTube Music companion service returned HTTP ${response.status}${reason}.` });
    }
    const data = await response.json() as { items?: any[] };
    if (!Array.isArray(data.items)) {
      return res.status(502).json({ message: "YouTube Music companion service returned an invalid response: expected an items array." });
    }
    res.setHeader("Cache-Control", "private, no-store");
    return res.json({ items: data.items.slice(0, 50).map(ytmusicSong) });
  } catch (error) {
    const reason = error instanceof Error ? cleanText(error.message, 180) : "Unknown error";
    return res.status(502).json({ message: `Could not load YouTube Music liked songs${reason ? `: ${reason}` : "."}` });
  }
});

router.get("/admin/integrations/:provider/connect", ...ADMIN_GUARD, async (req, res, next) => {
  try {
    const provider = String(req.params.provider);
    const wantsJson = (req.get("accept") || "").toLowerCase().includes("application/json");
    if (provider === "ytmusic") {
      const status = await ytmusicIntegrationStatus();
      const message = status.message || (status.connected
        ? "YouTube Music companion service is reachable. Use Refresh Music on the account page to load liked songs."
        : "YouTube Music companion service is not ready.");
      if (wantsJson) return res.status(status.connected ? 200 : 503).json({ ...status, message });
      return res.status(status.connected ? 200 : 503).type("text").send(message);
    }
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
      scope: "user-read-currently-playing user-read-playback-state", show_dialog: "true", state,
    } : {
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!, redirect_uri: callback, response_type: "code",
      scope: "https://www.googleapis.com/auth/youtube.readonly", access_type: "offline", prompt: "consent", state,
    }).toString();
    // Fetch-based initiation lets the Vercel page send its partitioned auth cookie
    // to the API. The frontend then navigates directly to the provider, not Render.
    if (wantsJson) return res.json({ authorizationUrl: authUrl.toString() });
    return res.redirect(authUrl.toString());
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
    const tokens = await response.json() as { refresh_token?: string; scope?: string };
    const existing = await readSetting(provider);
    if (!tokens.refresh_token && !existing?.refreshTokenEncrypted) throw new Error(`${provider} returned no refresh token. Reconnect and grant offline access.`);
    const tokenSettings: Record<string, unknown> = { connectedAt: new Date() };
    if (tokens.refresh_token) tokenSettings.refreshTokenEncrypted = encryptToken(tokens.refresh_token);
    if (tokens.scope) tokenSettings.grantedScopes = tokens.scope.split(/\s+/).filter(Boolean);
    await saveSetting(provider, tokenSettings);
    await getDB().collection("adminIntegrationSettings").deleteOne({ key: `oauth-state-${provider}` });
    res.redirect(`${frontendBase()}/account?integration=${encodeURIComponent(provider)}&connected=1`);
  } catch (error) { next(error); }
});

router.post("/admin/showcase/links", ...ADMIN_GUARD, async (req, res, next) => {
  try {
    const url = await safePreviewUrl(req.body?.url);
    if (!url) return res.status(400).json({ message: "Enter a valid public HTTP or HTTPS link. Private/internal network addresses are not allowed." });
    const provider = providerFor(url);
    const metadata = await providerPreview(url, provider);
    const domainLabel = url.hostname.replace(/^www\./i, "");
    const title = cleanText(req.body?.title, 180) || metadata.title || domainLabel;
    const description = metadata.description || `Visit ${domainLabel}.`;
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
