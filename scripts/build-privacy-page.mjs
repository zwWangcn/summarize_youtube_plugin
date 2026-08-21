import { readFile, mkdir, writeFile } from "node:fs/promises";
import { marked } from "marked";

const source = await readFile("PRIVACY.md", "utf8");
const content = await marked.parse(source, { gfm: true });
const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Privacy Policy · YouTube AI Summary & Translation</title>
  <style>
    :root { color-scheme: light dark; font: 16px/1.65 system-ui, sans-serif; }
    body { max-width: 820px; margin: 0 auto; padding: 32px 20px 72px; }
    h1, h2, h3 { line-height: 1.25; margin-top: 1.6em; }
    h1 { margin-top: 0; }
    a { color: #e52b45; }
    code { padding: .1em .35em; border-radius: 4px; background: color-mix(in srgb, currentColor 10%, transparent); }
  </style>
</head>
<body>${content}</body>
</html>`;

await mkdir(".pages-dist/privacy", { recursive: true });
await writeFile(".pages-dist/privacy/index.html", page);
await writeFile(".pages-dist/index.html", '<!doctype html><meta http-equiv="refresh" content="0; url=privacy/">');
