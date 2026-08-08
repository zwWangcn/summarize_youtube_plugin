import { crx } from "@crxjs/vite-plugin";
import { defineConfig } from "vite";
import manifest from "./src/manifest.json" with { type: "json" };

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    target: "es2022",
    outDir: "dist",
    // Chrome extension resources can be loaded in different execution worlds.
    // A preload created in one world cannot be reused in another, so Chrome
    // reports a noisy cross-world mismatch even though the module loads later.
    modulePreload: false,
  },
});
