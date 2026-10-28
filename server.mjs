// Minimal static server. Usage: node server.mjs <port> <logFile> <generation>
// Mirrors the probed app's static serving: no Cache-Control, no ETag, no Last-Modified.
import http from "node:http";
import fs from "node:fs";

const [port, logFile, gen] = process.argv.slice(2);

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>probe</title>
<script>window.__docId = Math.random().toString(36).slice(2); window.__navStart = Date.now();</script>
<script type="module" crossorigin src="/assets/entry-1a2b3c.js"></script>
</head><body><p id="s">probe page</p></body></html>`;

// __vimp mirrors Vite's __vitePreload: append <link rel=modulepreload as=script crossorigin> for the
// chunk and its deps (not awaited), then import() the chunk.
const entry = `window.__imp = (u) => import(u);
window.__vimp = (u, deps, co = true) => {
  for (const d of [u, ...deps]) {
    const l = document.createElement("link");
    l.rel = "modulepreload"; l.as = "script"; if (co) l.crossOrigin = ""; l.href = d;
    document.head.appendChild(l);
  }
  return import(u);
};
window.__entryLoaded = true;
`;

const server = http.createServer((req, res) => {
  fs.appendFileSync(logFile, `${Date.now()} gen=${gen} ${req.method} ${req.url}\n`);
  const path = req.url.split("?")[0];
  if (path === "/" || path === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(html);
  }
  if (path === "/assets/entry-1a2b3c.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    return res.end(entry);
  }
  const m = /^\/assets\/((chunk|dep)-[\w-]+)\.js$/.exec(path);
  if (m) {
    // chunk-*-withdep-* statically imports dep-<same suffix>.js, like a Vite chunk importing a shared chunk.
    const dep = m[1].startsWith("chunk-") && m[1].includes("-withdep-") ? `import { d } from "./dep-${m[1].slice(6)}.js";\n` : "";
    res.writeHead(200, { "Content-Type": "text/javascript" });
    return res.end(`${dep}export const v = ${JSON.stringify(m[1])};\n${dep ? "" : "export const d = 1;\n"}export default 1;\n`);
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

server.listen(Number(port), "127.0.0.1", () => {
  process.stdout.write(`listening ${port} gen=${gen}\n`);
});
process.on("SIGTERM", () => process.exit(0));
