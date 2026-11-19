import { defineConfig } from "vite";

// Standalone dev server for the store screenshot harness (no CRXJS plugin).
export default defineConfig({
  root: __dirname,
  define: { "import.meta.env.VITE_TEST_BUILD": JSON.stringify("false") },
  server: { host: "127.0.0.1", port: 5199, strictPort: true, fs: { allow: ["../.."] } },
});
