import { crx } from "@crxjs/vite-plugin";
import { defineConfig } from "vite";
import manifest from "./src/manifest.json" with { type: "json" };

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
