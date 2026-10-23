import { Router } from "express";
import { getDB } from "../db/mongoDBConnect.ts";
import { authenticationMiddleware } from "../middleware/authenticationMiddleware.ts";
import { adminMiddleware } from "../middleware/adminMiddleware.ts";

const router = Router();
const SNAPSHOT_KEY = "public-feed";
const SNAPSHOT_COLLECTION = "feedShareSnapshots";
const MAX_PNG_BYTES = 3 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const getFrontendBaseUrl = () =>
  (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

router.get("/share/feed", async (_req, res, next) => {
  try {
    const frontendBase = getFrontendBaseUrl();
    const shareUrl = `${frontendBase}/feed`;
    const snapshot = await getDB()
      .collection(SNAPSHOT_COLLECTION)
      .findOne({ key: SNAPSHOT_KEY }, { projection: { updatedAt: 1 } });
    const updatedAt =
      snapshot?.updatedAt instanceof Date
        ? snapshot.updatedAt.getTime()
        : snapshot?.updatedAt
          ? new Date(snapshot.updatedAt).getTime()
          : 0;
    const imageVersion =
      Number.isFinite(updatedAt) && updatedAt > 0
        ? String(updatedAt)
        : "unavailable";
    // The image is the PNG captured from the real, browser-rendered feed via
    // html-to-image. No stock/fallback artwork is used for this share preview.
    const imageUrl = `${frontendBase}/share/feed/og-image.png?v=${imageVersion}`;
    const title = "Blogg Feed";
    const description =
      "Recent notes and public updates from Blogg, captured directly from the live feed.";
    const safeTitle = escapeHtml(title);
    const safeDescription = escapeHtml(description);
    const safeShareUrl = escapeHtml(shareUrl);
    const safeImageUrl = escapeHtml(imageUrl);
    const imageAlt = escapeHtml("A captured preview of the Blogg feed");
    const redirectTarget = JSON.stringify(shareUrl).replace(/</g, "\\u003c");

    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, must-revalidate");
    return res.status(200).type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle} | Blogg</title>
    <meta name="description" content="${safeDescription}" />
    <meta name="robots" content="index,follow" />
    <link rel="canonical" href="${safeShareUrl}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Blogg" />
    <meta property="og:title" content="${safeTitle}" />
    <meta property="og:description" content="${safeDescription}" />
    <meta property="og:url" content="${safeShareUrl}" />
    <meta property="og:image" content="${safeImageUrl}" />
    <meta property="og:image:secure_url" content="${safeImageUrl}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${imageAlt}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${safeTitle}" />
    <meta name="twitter:description" content="${safeDescription}" />
    <meta name="twitter:image" content="${safeImageUrl}" />
  </head>
  <body>
    <main>
      <h1>${safeTitle}</h1>
      <p>${safeDescription}</p>
      <p><a href="${safeShareUrl}">Open the Blogg feed</a></p>
    </main>
    <script>
      // Crawlers read the complete metadata above; humans continue to the live feed.
      window.location.replace(${redirectTarget});
    </script>
  </body>
</html>`);
  } catch (error) {
    next(error);
  }
});

router.get("/share/feed/og-image.png", async (_req, res, next) => {
  try {
    const snapshot = await getDB()
      .collection(SNAPSHOT_COLLECTION)
      .findOne(
        { key: SNAPSHOT_KEY },
        { projection: { pngBase64: 1, updatedAt: 1 } },
      );

    if (typeof snapshot?.pngBase64 !== "string" || !snapshot.pngBase64) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(404).type("text").send(
        "Feed preview snapshot has not been captured yet. Use Share Feed on the feed page and update the snapshot.",
      );
    }

    const image = Buffer.from(snapshot.pngBase64, "base64");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", String(image.length));
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, must-revalidate");
    if (snapshot.updatedAt) {
      res.setHeader("Last-Modified", new Date(snapshot.updatedAt).toUTCString());
    }
    return res.status(200).send(image);
  } catch (error) {
    next(error);
  }
});

router.put(
  "/api/admin/share/feed-snapshot",
  authenticationMiddleware,
  adminMiddleware,
  async (req, res, next) => {
    try {
      const pngBase64 = req.body?.pngBase64;
      if (
        typeof pngBase64 !== "string" ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(pngBase64)
      ) {
        return res.status(400).json({ message: "A valid base64 PNG snapshot is required." });
      }
      if (pngBase64.length > Math.ceil((MAX_PNG_BYTES * 4) / 3) + 8) {
        return res.status(413).json({
          message: "The feed snapshot is too large. The maximum PNG size is 3 MB.",
        });
      }

      const image = Buffer.from(pngBase64, "base64");
      if (
        image.length < 24 ||
        image.length > MAX_PNG_BYTES ||
        !image.subarray(0, 8).equals(PNG_SIGNATURE)
      ) {
        return res.status(400).json({
          message: "The feed snapshot must be a valid PNG smaller than 3 MB.",
        });
      }
      const width = image.readUInt32BE(16);
      const height = image.readUInt32BE(20);
      if (width !== 1200 || height !== 630) {
        return res.status(400).json({
          message: "The feed snapshot must be 1200 × 630 pixels.",
        });
      }

      const updatedAt = new Date();
      // A single stable record is replaced on every capture; there is no image history.
      await getDB()
        .collection(SNAPSHOT_COLLECTION)
        .updateOne(
          { key: SNAPSHOT_KEY },
          {
            $set: {
              key: SNAPSHOT_KEY,
              pngBase64,
              contentType: "image/png",
              width,
              height,
              updatedAt,
            },
          },
          { upsert: true },
        );
      return res.status(200).json({
        ok: true,
        updatedAt: updatedAt.getTime(),
        width,
        height,
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
