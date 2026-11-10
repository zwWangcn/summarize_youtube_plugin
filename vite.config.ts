import { crx } from "@crxjs/vite-plugin";
import { defineConfig } from "vite";
import manifest from "./src/manifest.json" with { type: "json" };

export default defineConfig(({ mode, command }) => ({
  // CRXJS 2.7 creates one Vite environment per extension entry. Vitest must
  // stay a single environment or it discovers the same tests more than once.
  plugins: mode === "test" ? [] : [crx({
    manifest,
    contentScripts: {
      // Chrome directly injects self-contained build scripts. A runtime import
      // from the host page can otherwise hit extension-origin loading errors.
      // Keep the isolated script's HMR loader only for the live dev server.
      standaloneFiles: command === "build"
        ? ["src/content/caption-main.ts", "src/content/youtube.ts"]
        : ["src/content/caption-main.ts"],
    },
  })],
  build: {
    target: "es2022",
    outDir: "dist",
    // Chrome extension resources can be loaded in different execution worlds.
    // A preload created in one world cannot be reused in another, so Chrome
    // reports a noisy cross-world mismatch even though the module loads later.
    modulePreload: false,
  },
}));
