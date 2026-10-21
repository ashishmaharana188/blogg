import { Router } from "express";

const router = Router();

const getFrontendBaseUrl = () =>
  (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

router.get("/share/account", (_req, res) => {
  const frontendBase = getFrontendBaseUrl();
  const shareUrl = `${frontendBase}/share/account`;
  const destinationUrl = `${frontendBase}/account?view=public`;
  const imageUrl = `${frontendBase}/og-dashboard.png`;
  const title = "Blogg · Public Dashboard";
  const description = "Explore the public Blogg dashboard: admin presence, Spotify and YouTube Music, public YouTube playlists, featured links, and Samsung Health metrics.";

  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeShareUrl = escapeHtml(shareUrl);
  const safeDestinationUrl = escapeHtml(destinationUrl);
  const safeImageUrl = escapeHtml(imageUrl);
  const imageAlt = escapeHtml("Blogg public dashboard preview");
  const redirectTarget = JSON.stringify(destinationUrl).replace(/</g, "\\u003c");

  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
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
      // Preview crawlers read the metadata above; regular browsers open public mode.
      window.location.replace(${redirectTarget});
    </script>
  </body>
</html>`);
});

export default router;
