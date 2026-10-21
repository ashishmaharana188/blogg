import { existsSync, readdirSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const STATE_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".svg"]);
const STATE_VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".ogg", ".mov", ".m4v"]);
const STATE_MEDIA_EXTENSIONS = new Set([...STATE_IMAGE_EXTENSIONS, ...STATE_VIDEO_EXTENSIONS]);

function publicStateAssetsPlugin(): Plugin {
  let publicDirectory = "";
  const virtualModuleId = "virtual:public-state-assets";
  const resolvedVirtualModuleId = `\0${virtualModuleId}`;
  const virtualMediaModuleId = "virtual:public-state-media";
  const resolvedVirtualMediaModuleId = `\0${virtualMediaModuleId}`;

  const discoverAssets = (extensions: Set<string>): string[] => {
    if (!publicDirectory || !existsSync(publicDirectory)) return [];
    const assets: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const filePath = resolve(directory, entry.name);
        if (entry.isDirectory()) {
          walk(filePath);
        } else if (
          entry.isFile() &&
          entry.name.toLowerCase() !== "og-default.png" &&
          entry.name.toLowerCase() !== "favicon.svg" &&
          extensions.has(extname(entry.name).toLowerCase())
        ) {
          assets.push(`/${relative(publicDirectory, filePath).split(sep).join("/")}`);
        }
      }
    };
    walk(publicDirectory);
    return assets.sort();
  };

  return {
    name: "public-state-assets",
    configResolved(config) {
      publicDirectory = config.publicDir || resolve(config.root, "public");
    },
    resolveId(id) {
      if (id === virtualModuleId) return resolvedVirtualModuleId;
      if (id === virtualMediaModuleId) return resolvedVirtualMediaModuleId;
      return null;
    },
    load(id) {
      if (id === resolvedVirtualModuleId) {
        return `export const publicStateAssets = ${JSON.stringify(discoverAssets(STATE_IMAGE_EXTENSIONS))};`;
      }
      if (id === resolvedVirtualMediaModuleId) {
        return `export const publicStateMedia = ${JSON.stringify(discoverAssets(STATE_MEDIA_EXTENSIONS))};`;
      }
      return null;
    },
    configureServer(server) {
      if (!publicDirectory || !existsSync(publicDirectory)) return;
      server.watcher.add(publicDirectory);
      const refreshAssetList = (changedPath: string) => {
        const filePath = resolve(changedPath);
        if (!filePath.startsWith(`${publicDirectory}${sep}`)) return;
        if (!STATE_MEDIA_EXTENSIONS.has(extname(filePath).toLowerCase())) return;
        const imageModule = server.moduleGraph.getModuleById(resolvedVirtualModuleId);
        const mediaModule = server.moduleGraph.getModuleById(resolvedVirtualMediaModuleId);
        if (imageModule) server.moduleGraph.invalidateModule(imageModule);
        if (mediaModule) server.moduleGraph.invalidateModule(mediaModule);
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.on("add", refreshAssetList);
      server.watcher.on("unlink", refreshAssetList);
    },
  };
}

export default defineConfig({
  envDir: ".",
  plugins: [react(), tailwindcss(), publicStateAssetsPlugin()],
  root: "src",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  resolve: {
    dedupe: [
      "prosemirror-model",
      "prosemirror-state",
      "prosemirror-view",
      "@blocknote/core",
      "@blocknote/react",
    ],
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      // The rich preview and snapshot image are backend-rendered. Without this
      // local proxy, Vite returns the SPA HTML for a PNG request, so the img is blank.
      "/share": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
