import { existsSync, readdirSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const STATE_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".svg"]);

function publicStateAssetsPlugin(): Plugin {
  let publicDirectory = "";
  const virtualModuleId = "virtual:public-state-assets";
  const resolvedVirtualModuleId = `\0${virtualModuleId}`;

  const discoverAssets = (): string[] => {
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
          STATE_IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())
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
      return id === virtualModuleId ? resolvedVirtualModuleId : null;
    },
    load(id) {
      if (id !== resolvedVirtualModuleId) return null;
      return `export const publicStateAssets = ${JSON.stringify(discoverAssets())};`;
    },
    configureServer(server) {
      if (!publicDirectory || !existsSync(publicDirectory)) return;
      server.watcher.add(publicDirectory);
      const refreshAssetList = (changedPath: string) => {
        const filePath = resolve(changedPath);
        if (!filePath.startsWith(`${publicDirectory}${sep}`)) return;
        if (!STATE_IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase())) return;
        const virtualModule = server.moduleGraph.getModuleById(resolvedVirtualModuleId);
        if (virtualModule) server.moduleGraph.invalidateModule(virtualModule);
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.on("add", refreshAssetList);
      server.watcher.on("unlink", refreshAssetList);
      // Keep these listeners for the lifetime of the dev server. configureServer's
      // returned function is a post-hook, not a teardown callback, and FSWatcher.off
      // is not available in this project's TypeScript watcher definitions.
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
    },
  },
});
