import { Router } from "express";
import { getDB } from "../db/mongoDBConnect.ts";
import { authenticationMiddleware } from "../middleware/authenticationMiddleware.ts";
import { adminMiddleware } from "../middleware/adminMiddleware.ts";

const router = Router();
const SNAPSHOT_KEY = "public-dashboard";
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

router.get("/share/account", async (_req, res, next) => {
  try {
    const frontendBase = getFrontendBaseUrl();
    const shareUrl = `${frontendBase}/share/account`;
    const destinationUrl = `${frontendBase}/account?view=public`;
    const snapshot = await getDB()
      .collection("accountShareSnapshots")
      .findOne({ key: SNAPSHOT_KEY }, { projection: { updatedAt: 1 } });
    const updatedAt =
      snapshot?.updatedAt instanceof Date
        ? snapshot.updatedAt.getTime()
        : snapshot?.updatedAt
          ? new Date(snapshot.updatedAt).getTime()
          : 0;
    // The query parameter changes when the one saved snapshot is replaced. This
    // gives preview crawlers a new image URL without storing an image history.
    const imageVersion =
      Number.isFinite(updatedAt) && updatedAt > 0
        ? String(updatedAt)
        : "default";
    const imageUrl =
      updatedAt > 0
        ? `${frontendBase}/share/account/og-image.png?v=${imageVersion}`
        : `${frontendBase}/og-dashboard.png`;
    const title = "Blogg";
    const description = "";

    const safeTitle = escapeHtml(title);
    const safeDescription = escapeHtml(description);
    const safeShareUrl = escapeHtml(shareUrl);
    const safeDestinationUrl = escapeHtml(destinationUrl);
    const safeImageUrl = escapeHtml(imageUrl);
    const imageAlt = escapeHtml(
      "Latest snapshot of the Blogg public dashboard",
    );
    const redirectTarget = JSON.stringify(destinationUrl).replace(
      /</g,
      "\\u003c",
    );

    res.setHeader(
      "Cache-Control",
      "public, max-age=0, s-maxage=60, must-revalidate",
    );
    return res.status(200).type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <meta name="description" content="${safeDescription}" />
    <meta name="robots" content="index,follow" />
    <link rel="canonical" href="${safeShareUrl}" />
    <meta name="theme-color" content="#f8fafc" />
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
      <p><a href="${safeDestinationUrl}">Open the public dashboard on Blogg</a></p>
    </main>
    <script>
      // Preview crawlers read metadata above; people are sent to the real public dashboard.
      window.location.replace(${redirectTarget});
    </script>
  </body>
</html>`);
  } catch (error) {
    next(error);
  }
});

router.get("/share/account/og-image.png", async (_req, res, next) => {
  try {
    const snapshot = await getDB()
      .collection("accountShareSnapshots")
      .findOne(
        { key: SNAPSHOT_KEY },
        { projection: { pngBase64: 1, updatedAt: 1 } },
      );
    if (typeof snapshot?.pngBase64 !== "string" || !snapshot.pngBase64) {
      res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
      return res.redirect(302, `${getFrontendBaseUrl()}/og-dashboard.png`);
    }

    const image = Buffer.from(snapshot.pngBase64, "base64");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", String(image.length));
    res.setHeader(
      "Cache-Control",
      "public, max-age=0, s-maxage=60, must-revalidate",
    );
    if (snapshot.updatedAt)
      res.setHeader(
        "Last-Modified",
        new Date(snapshot.updatedAt).toUTCString(),
      );
    return res.status(200).send(image);
  } catch (error) {
    next(error);
  }
});

router.put(
  "/api/admin/share/account-snapshot",
  authenticationMiddleware,
  adminMiddleware,
  async (req, res, next) => {
    try {
      const pngBase64 = req.body?.pngBase64;
      if (
        typeof pngBase64 !== "string" ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(pngBase64)
      ) {
        return res
          .status(400)
          .json({ message: "A valid base64 PNG snapshot is required." });
      }
      if (pngBase64.length > Math.ceil((MAX_PNG_BYTES * 4) / 3) + 8) {
        return res.status(413).json({
          message:
            "The snapshot is too large. Try a smaller or simpler dashboard view (maximum 3 MB).",
        });
      }

      const image = Buffer.from(pngBase64, "base64");
      if (
        image.length < 24 ||
        image.length > MAX_PNG_BYTES ||
        !image.subarray(0, 8).equals(PNG_SIGNATURE)
      ) {
        return res
          .status(400)
          .json({ message: "The snapshot must be a PNG smaller than 3 MB." });
      }
      const width = image.readUInt32BE(16);
      const height = image.readUInt32BE(20);
      if (width !== 1200 || height !== 630) {
        return res
          .status(400)
          .json({ message: "The snapshot must be 1200 × 630 pixels." });
      }

      const updatedAt = new Date();
      // One stable key and one update operation: every capture replaces the previous
      // image in the same MongoDB document. No files or history records accumulate.
      await getDB()
        .collection("accountShareSnapshots")
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
      return res
        .status(200)
        .json({ ok: true, updatedAt: updatedAt.getTime(), width, height });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
