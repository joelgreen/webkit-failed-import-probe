// Minimal static server. Usage: node server.mjs <port> <logFile> <generation>
// Mirrors the probed app's static serving: no Cache-Control, no ETag, no Last-Modified.
import http from "node:http";
import fs from "node:fs";

const [port, logFile, gen] = process.argv.slice(2);

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>probe</title>
<script>window.__docId = Math.random().toString(36).slice(2); window.__navStart = Date.now();</script>
<script type="module" src="/assets/entry-1a2b3c.js"></script>
</head><body><p id="s">probe page</p></body></html>`;

const entry = `window.__imp = (u) => import(u);
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
  const m = /^\/assets\/(chunk-[\w-]+)\.js$/.exec(path);
  if (m) {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    return res.end(`export const v = ${JSON.stringify(m[1])};\nexport default 1;\n`);
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

server.listen(Number(port), "127.0.0.1", () => {
  process.stdout.write(`listening ${port} gen=${gen}\n`);
});
process.on("SIGTERM", () => process.exit(0));
