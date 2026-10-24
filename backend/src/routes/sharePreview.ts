import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../db/mongoDBConnect.ts";
import {
  isConfiguredAdminRequest,
  optionalAuthenticationMiddleware,
} from "../middleware/authenticationMiddleware.ts";

const sharePreviewRouter = Router();

const getFrontendBaseUrl = () =>
  (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const textFromBlocks = (blocks: unknown): string => {
  if (!Array.isArray(blocks)) return "";
  const parts: string[] = [];

  for (const rawBlock of blocks) {
    if (!rawBlock || typeof rawBlock !== "object") continue;
    const block = rawBlock as { type?: unknown; content?: unknown; children?: unknown };

    if (typeof block.content === "string") {
      parts.push(block.content);
    } else if (Array.isArray(block.content)) {
      for (const part of block.content) {
        if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
          parts.push((part as { text: string }).text);
        }
      }
    }

    if (Array.isArray(block.children)) parts.push(textFromBlocks(block.children));
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
};

const isPublicHttpsUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
};

type FirstBlockMetadata = { text: string; imageUrl?: string };

const firstBlockMetadata = (blocks: unknown): FirstBlockMetadata => {
  if (!Array.isArray(blocks)) return { text: "" };

  for (const rawBlock of blocks) {
    if (!rawBlock || typeof rawBlock !== "object") continue;
    const block = rawBlock as {
      type?: unknown;
      props?: { url?: unknown; src?: unknown; image?: unknown; title?: unknown; description?: unknown };
    };

    // The rich preview represents the first meaningful top-level BlockNote
    // block, not an unrelated image buried later in the document.
    if (block.type === "image") {
      const imageUrl = block.props?.url ?? block.props?.src;
      return { text: "", ...(isPublicHttpsUrl(imageUrl) ? { imageUrl } : {}) };
    }

    const linkImage = block.props?.image;
    if (block.type === "linkPreview" && isPublicHttpsUrl(linkImage)) {
      const text = [block.props?.title, block.props?.description]
        .filter((value): value is string => typeof value === "string")
        .join(". ")
        .replace(/\s+/g, " ")
        .trim();
      return { text, imageUrl: linkImage };
    }

    const text = textFromBlocks([block]);
    if (text) return { text };
  }

  return { text: "" };
};

const descriptionFor = (note: Record<string, unknown>) => {
  const subtitle = typeof note.subtitle === "string" ? note.subtitle.trim() : "";
  const firstBlock = firstBlockMetadata(note.content);
  const description = subtitle || firstBlock.text || "Open this note on Blogg.";
  return description.length > 220 ? `${description.slice(0, 217).trimEnd()}…` : description;
};

const buildMetadataHtml = ({
  title,
  description,
  shareUrl,
  readUrl,
  imageUrl,
}: {
  title: string;
  description: string;
  shareUrl: string;
  readUrl: string;
  imageUrl: string;
}) => {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeShareUrl = escapeHtml(shareUrl);
  const safeReadUrl = escapeHtml(readUrl);
  const safeImageUrl = escapeHtml(imageUrl);
  const redirectTarget = JSON.stringify(readUrl).replace(/</g, "\\u003c");
  const safeImageAlt = escapeHtml(`${title} preview on Blogg`);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle} | Blogg</title>
    <meta name="description" content="${safeDescription}" />
    <link rel="canonical" href="${safeShareUrl}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="Blogg" />
    <meta property="og:title" content="${safeTitle}" />
    <meta property="og:description" content="${safeDescription}" />
    <meta property="og:url" content="${safeShareUrl}" />
    <meta property="og:image" content="${safeImageUrl}" />
    <meta property="og:image:secure_url" content="${safeImageUrl}" />
    <meta property="og:image:alt" content="${safeImageAlt}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${safeTitle}" />
    <meta name="twitter:description" content="${safeDescription}" />
    <meta name="twitter:image" content="${safeImageUrl}" />
  </head>
  <body>
    <main>
      <h1>${safeTitle}</h1>
      <p>${safeDescription}</p>
      <p><a href="${safeReadUrl}">Read this note on Blogg</a></p>
    </main>
    <script>
      // Preview crawlers read the metadata above without executing JavaScript.
      // Browsers and in-app webviews continue to the real React reader.
      window.location.replace(${redirectTarget});
    </script>
  </body>
</html>`;
};

const notFoundHtml = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Note not found | Blogg</title></head><body><h1>Note not found</h1><p>This shared note may have been removed or is private.</p></body></html>";

sharePreviewRouter.get(
  "/share/:bloggId",
  optionalAuthenticationMiddleware,
  async (req, res, next) => {
    try {
      const requestedId = req.params.bloggId;
      const collection = getDB().collection("bloggs");
      const objectId = /^[a-f\d]{24}$/i.test(requestedId) ? new ObjectId(requestedId) : null;
      const filter = objectId
        ? { $or: [{ blogg_id: requestedId }, { _id: objectId }] }
        : { blogg_id: requestedId };
      const note = await collection.findOne(filter);

      // An absent isPublic field is legacy data and is treated as public.
      // Private metadata must not be sent to public sharing crawlers.
      if (!note || (note.isPublic === false && !isConfiguredAdminRequest(req))) {
        res.setHeader("Cache-Control", "private, no-store");
        return res.status(404).type("html").send(notFoundHtml);
      }

      const isPublic = note.isPublic !== false;
      const noteId = String(note.blogg_id || note._id);
      const frontendBase = getFrontendBaseUrl();
      const shareUrl = `${frontendBase}/share/${encodeURIComponent(noteId)}`;
      const readUrl = `${frontendBase}/read/${encodeURIComponent(noteId)}`;
      const title = typeof note.title === "string" && note.title.trim()
        ? note.title.trim()
        : "Untitled note";
      const description = descriptionFor(note as Record<string, unknown>);
      const firstBlock = firstBlockMetadata(note.content);
      const savedSnapshot = await getDB()
        .collection("bloggShareSnapshots")
        .findOne({ blogg_id: noteId }, { projection: { updatedAt: 1 } });
      const savedAt = savedSnapshot?.updatedAt instanceof Date
        ? savedSnapshot.updatedAt.getTime()
        : savedSnapshot?.updatedAt
          ? new Date(savedSnapshot.updatedAt).getTime()
          : 0;
      const imageUrl = savedAt > 0
        ? `${frontendBase}/share/blog/${encodeURIComponent(noteId)}/og-image.png?v=${savedAt}`
        : firstBlock.imageUrl || `${frontendBase}/og-default.png`;

      // Private administrator previews must never be stored in a shared cache.
      res.setHeader("Cache-Control", isPublic ? "public, max-age=60, s-maxage=300" : "private, no-store");
      return res.status(200).type("html").send(
        buildMetadataHtml({ title, description, shareUrl, readUrl, imageUrl }),
      );
    } catch (error) {
      next(error);
    }
  },
);

export default sharePreviewRouter;
