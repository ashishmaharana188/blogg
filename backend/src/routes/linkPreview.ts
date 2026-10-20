import { Router } from "express";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import * as https from "node:https";
import { ObjectId } from "mongodb";
import { getDB } from "../db/mongoDBConnect.ts";

const router = Router();
const FETCH_TIMEOUT_MS = 6500;
const MAX_HTML_BYTES = 1_000_000;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_URL_LENGTH = 2048;

type Preview = { url: string; title: string; description: string; image: string; provider: string };

function cleanText(value: unknown, maxLength = 260): string {
  if (typeof value !== "string") return "";
  return decodeEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([\da-f]{1,6});/gi, (_match, hex: string) => decodeCodePoint(hex, 16))
    .replace(/&#(\d{1,7});/g, (_match, decimal: string) => decodeCodePoint(decimal, 10));
}

function decodeCodePoint(value: string, radix: number): string {
  const codePoint = Number.parseInt(value, radix);
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : " ";
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 192 && b === 2) return false;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPublicIpv4(address);
  if (version !== 6) return false;
  const value = address.toLowerCase();
  if (value.startsWith("::ffff:")) {
    const mapped = value.slice("::ffff:".length);
    return isIP(mapped) === 4 && isPublicIpv4(mapped);
  }
  // Only globally-routable IPv6 unicast (2000::/3) is accepted. Exclude documentation and special-use ranges.
  const firstSegment = Number.parseInt(value.split(":")[0] || "0", 16);
  if ((firstSegment & 0xe000) !== 0x2000) return false;
  if (value.startsWith("2001:db8:") || value.startsWith("2001:2:") || value.startsWith("2001:10:")) return false;
  return true;
}

type PublicAddress = { address: string; family: number };
type ValidatedPublicUrl = { url: URL; addresses: PublicAddress[] };

async function validatePublicHttpsUrl(value: unknown): Promise<ValidatedPublicUrl> {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_URL_LENGTH) {
    throw new Error("Paste a valid HTTPS link (maximum 2,048 characters).");
  }
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Paste a valid HTTPS link."); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("Only public HTTPS links are supported for rich previews.");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("This hostname is not allowed for previews.");
  }

  let addresses: PublicAddress[];
  if (isIP(hostname)) {
    addresses = [{ address: hostname, family: isIP(hostname) }];
  } else {
    try {
      addresses = await lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new Error("This hostname could not be resolved for a preview.");
    }
  }
  if (!addresses.length || addresses.some((entry) => !isPublicIp(entry.address))) {
    throw new Error("The link resolves to a private or reserved network address and cannot be previewed.");
  }
  // Return the validated DNS answers and use them for the actual connection below.
  // This avoids a second unconstrained DNS lookup after validation (DNS rebinding).
  return { url, addresses };
}

function providerFor(url: URL): string {
  if (url.hostname === "open.spotify.com") return "Spotify";
  if (url.hostname === "music.youtube.com") return "YouTube Music";
  if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(url.hostname)) return "YouTube";
  if (url.hostname === "noteonstuff.vercel.app" && url.pathname.startsWith("/share/")) return "Blogg";
  return url.hostname.replace(/^www\./i, "");
}

function readAttribute(tag: string, attributeName: string): string {
  const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`\\b${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return cleanText(match?.[1] ?? match?.[2] ?? match?.[3] ?? "", 4000);
}

function metaContent(html: string, names: string[]): string {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const name of names) {
    for (const tag of tags) {
      const key = readAttribute(tag, "property") || readAttribute(tag, "name") || readAttribute(tag, "itemprop");
      if (key.toLowerCase() === name.toLowerCase()) {
        const content = readAttribute(tag, "content");
        if (content) return content;
      }
    }
  }
  return "";
}

function absoluteHttpsImage(value: string, baseUrl: URL): string {
  if (!value) return "";
  try {
    const image = new URL(value, baseUrl);
    if (image.protocol !== "https:" || image.username || image.password) return "";
    return image.toString();
  } catch {
    return "";
  }
}

type HttpsHtmlResponse = { statusCode: number; location: string | null; contentType: string; html: string };

/** Make an HTTPS request over one of the already-validated public IPs. The URL
 * hostname is retained for Host and TLS SNI, while socket DNS lookup is pinned. */
function requestPublicHtml(url: URL, addresses: PublicAddress[]): Promise<HttpsHtmlResponse> {
  return new Promise((resolve, reject) => {
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const lookupPinned = ((
      _requestedHostname: string,
      options: { all?: boolean } | number,
      callback: (...args: any[]) => void,
    ) => {
      if (typeof options === "object" && options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    }) as import("node:net").LookupFunction;

    let settled = false;
    const finish = (result: HttpsHtmlResponse) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const request = https.request({
      protocol: "https:",
      hostname,
      port: 443,
      method: "GET",
      path: `${url.pathname}${url.search}`,
      headers: {
        Host: url.host,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        "User-Agent": "BloggLinkPreview/1.0",
        "Accept-Encoding": "identity",
      },
      lookup: lookupPinned,
      ...(isIP(hostname) ? {} : { servername: hostname }),
    }, (response) => {
      response.on("error", (error) => { if (!settled) { settled = true; reject(error); } });
      const statusCode = response.statusCode || 0;
      const locationHeader = response.headers.location;
      const location = Array.isArray(locationHeader) ? locationHeader[0] || null : locationHeader || null;
      const contentType = String(response.headers["content-type"] || "");

      if ((statusCode >= 300 && statusCode < 400) || statusCode < 200 || statusCode >= 300 || !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        response.destroy();
        finish({ statusCode, location, contentType, html: "" });
        return;
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remaining = MAX_HTML_BYTES - totalBytes;
        if (remaining <= 0) {
          response.destroy();
          finish({ statusCode, location, contentType, html: Buffer.concat(chunks).toString("utf8") });
          return;
        }
        const accepted = buffer.subarray(0, remaining);
        chunks.push(accepted);
        totalBytes += accepted.byteLength;
        if (accepted.byteLength < buffer.byteLength || totalBytes >= MAX_HTML_BYTES) {
          response.destroy();
          finish({ statusCode, location, contentType, html: Buffer.concat(chunks).toString("utf8") });
        }
      });
      response.on("end", () => finish({ statusCode, location, contentType, html: Buffer.concat(chunks).toString("utf8") }));
    });

    request.setTimeout(FETCH_TIMEOUT_MS, () => request.destroy(new Error("Preview request timed out.")));
    request.on("error", (error) => { if (!settled) { settled = true; reject(error); } });
    request.end();
  });
}

async function fetchPublicHtml(initialUrl: URL): Promise<string> {
  let currentUrl = initialUrl;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    // Validate every target and pin the actual socket connection to those DNS answers.
    const validated = await validatePublicHttpsUrl(currentUrl.toString());
    const response = await requestPublicHtml(validated.url, validated.addresses);
    if (response.statusCode >= 300 && response.statusCode < 400) {
      if (!response.location || redirects === 3) return "";
      try { currentUrl = new URL(response.location, validated.url); }
      catch { return ""; }
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) return "";
    if (!/text\/html|application\/xhtml\+xml/i.test(response.contentType)) return "";
    return response.html;
  }
  return "";
}

function parseHtmlPreview(html: string, url: URL, provider: string): Omit<Preview, "url"> {
  const titleFromTag = cleanText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1], 220);
  const title = metaContent(html, ["og:title", "twitter:title"]) || titleFromTag || url.hostname.replace(/^www\./i, "");
  const description = metaContent(html, ["og:description", "twitter:description", "description"]);
  const imageValue = metaContent(html, ["og:image", "og:image:url", "twitter:image"]);
  return {
    title: cleanText(title, 220),
    description: cleanText(description, 360),
    image: absoluteHttpsImage(imageValue, url),
    provider,
  };
}

async function fetchOEmbed(url: URL, provider: string): Promise<Omit<Preview, "url"> | null> {
  const endpoint = url.hostname === "open.spotify.com"
    ? "https://open.spotify.com/oembed"
    : "https://www.youtube.com/oembed";
  try {
    const endpointUrl = new URL(endpoint);
    endpointUrl.search = new URLSearchParams({ url: url.toString(), format: "json" }).toString();
    const response = await fetch(endpointUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return null;
    const data = await response.json() as { title?: string; author_name?: string; thumbnail_url?: string; provider_name?: string };
    return {
      title: cleanText(data.title, 220) || url.hostname,
      description: cleanText(data.author_name ? `By ${data.author_name}` : data.provider_name, 360),
      image: absoluteHttpsImage(data.thumbnail_url || "", url),
      provider,
    };
  } catch {
    return null;
  }
}

function textFromBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  const parts: string[] = [];
  for (const raw of blocks) {
    if (!raw || typeof raw !== "object") continue;
    const block = raw as { content?: unknown; children?: unknown };
    if (typeof block.content === "string") parts.push(block.content);
    else if (Array.isArray(block.content)) {
      for (const part of block.content) {
        if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") parts.push((part as { text: string }).text);
      }
    }
    if (Array.isArray(block.children)) parts.push(textFromBlocks(block.children));
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function firstImageFromBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  for (const raw of blocks) {
    if (!raw || typeof raw !== "object") continue;
    const block = raw as { type?: unknown; props?: { url?: unknown; src?: unknown }; children?: unknown };
    if (block.type === "image") {
      const image = block.props?.url ?? block.props?.src;
      if (typeof image === "string" && image.startsWith("https://")) return image;
    }
    const nested = firstImageFromBlocks(block.children);
    if (nested) return nested;
  }
  return "";
}

async function bloggSharePreview(url: URL): Promise<Omit<Preview, "url"> | null> {
  const configuredHost = (() => {
    try { return new URL(process.env.FRONTEND_URL || "https://noteonstuff.vercel.app").hostname.toLowerCase(); }
    catch { return "noteonstuff.vercel.app"; }
  })();
  if (!["noteonstuff.vercel.app", configuredHost].includes(url.hostname.toLowerCase()) || !url.pathname.startsWith("/share/")) return null;
  const noteId = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) || "");
  if (!noteId) return null;
  const objectId = /^[a-f\d]{24}$/i.test(noteId) ? new ObjectId(noteId) : null;
  const filter = objectId ? { $or: [{ blogg_id: noteId }, { _id: objectId }] } : { blogg_id: noteId };
  const note = await getDB().collection("bloggs").findOne(filter);
  if (!note) return { title: "Shared note on Blogg", description: "Open this note on Blogg.", image: "", provider: "Blogg" };
  const title = cleanText(note.title, 220) || "Shared note on Blogg";
  const subtitle = cleanText(note.subtitle, 360);
  const body = textFromBlocks(note.content);
  return {
    title,
    description: subtitle || cleanText(body, 360) || "Open this note on Blogg.",
    image: firstImageFromBlocks(note.content),
    provider: "Blogg",
  };
}

async function buildPreview(url: URL): Promise<Preview> {
  const provider = providerFor(url);
  let metadata = await bloggSharePreview(url);
  if (!metadata && (url.hostname === "open.spotify.com" || ["youtube.com", "www.youtube.com", "youtu.be", "music.youtube.com", "m.youtube.com"].includes(url.hostname))) {
    metadata = await fetchOEmbed(url, provider);
  }
  if (!metadata) {
    const html = await fetchPublicHtml(url).catch(() => "");
    metadata = parseHtmlPreview(html, url, provider);
  }
  return {
    url: url.toString(),
    title: cleanText(metadata.title, 220) || url.hostname.replace(/^www\./i, ""),
    description: cleanText(metadata.description, 360),
    image: metadata.image || "",
    provider: cleanText(metadata.provider, 100) || provider,
  };
}

router.post("/link-preview", async (req, res, next) => {
  try {
    const validatedUrl = await validatePublicHttpsUrl(req.body?.url);
    const url = validatedUrl.url;
    const canonicalUrl = url.toString();
    const cache = getDB().collection<{ url: string; preview: Preview; expiresAt: Date; updatedAt: Date }>("linkPreviewCache");
    const cached = await cache.findOne({ url: canonicalUrl, expiresAt: { $gt: new Date() } });
    if (cached) return res.json({ preview: cached.preview });

    const preview = await buildPreview(url);
    await cache.updateOne(
      { url: canonicalUrl },
      { $set: { url: canonicalUrl, preview, expiresAt: new Date(Date.now() + CACHE_TTL_MS), updatedAt: new Date() } },
      { upsert: true },
    );
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.json({ preview });
  } catch (error) {
    if (error instanceof Error && /valid HTTPS|Only public HTTPS|hostname is not allowed|private or reserved|could not be resolved/.test(error.message)) {
      return res.status(400).json({ message: error.message });
    }
    return next(error);
  }
});

export default router;
