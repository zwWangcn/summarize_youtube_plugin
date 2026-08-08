import { crx } from "@crxjs/vite-plugin";
import { defineConfig } from "vite";
import manifest from "./src/manifest.json" with { type: "json" };

export default defineConfig(({ mode }) => ({
  // CRXJS 2.7 creates one Vite environment per extension entry. Vitest must
  // stay a single environment or it discovers the same tests more than once.
  plugins: mode === "test" ? [] : [crx({ manifest })],
  build: {
    target: "es2022",
    outDir: "dist",
    // Chrome extension resources can be loaded in different execution worlds.
    // A preload created in one world cannot be reused in another, so Chrome
    // reports a noisy cross-world mismatch even though the module loads later.
    modulePreload: false,
  },
}));
