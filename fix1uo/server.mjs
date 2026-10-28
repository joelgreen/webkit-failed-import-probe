// Static server for the fix1uo toy. Usage: node server.mjs <port> <logFile> <generation>
// Asset headers follow the probed app's current static handler: hashed assets are
// `public, max-age=31536000, immutable` with a weak ETag and Last-Modified (304 on a match),
// pages are `no-cache` with no validators, and a missing asset is a 404 with `no-store`.
import http from "node:http";
import fs from "node:fs";

const [port, logFile, gen] = process.argv.slice(2);
const started = new Date(Math.floor(Date.now() / 1000) * 1000);

// /default/ and /fix/ load the same entry; the page says whether the fix runs.
const page = (fix) => `<!doctype html>
<html><head><meta charset="utf-8"><title>fix1uo</title>
<script>window.__docId = Math.random().toString(36).slice(2); window.__FIX = ${fix};</script>
<script type="module" crossorigin src="/assets/entry-f1x1u0.js"></script>
</head><body><p>fix1uo toy</p></body></html>`;

const entry = fs.readFileSync(new URL("./entry.js", import.meta.url), "utf8");

// chunk-<tag> imports depa-<tag> and depb-<tag>; depa-<tag> imports depc-<tag>. A lazy chunk's
// preload list names the chunk and all three, as a bundler's does.
function moduleFor(kind, tag) {
  if (kind === "chunk") return `import { a } from "./depa-${tag}.js";\nimport { b } from "./depb-${tag}.js";\nexport const v = "chunk-${tag}:" + a + b;\n`;
  if (kind === "depa") return `import { c } from "./depc-${tag}.js";\nexport const a = "a" + c;\n`;
  return `export const ${kind.slice(3)} = "${kind.slice(3)}";\n`;
}

function asset(req, res, body) {
  const etag = `W/"${Buffer.byteLength(body).toString(16)}-${started.getTime().toString(16)}"`;
  const headers = { "Content-Type": "text/javascript", "Cache-Control": "public, max-age=31536000, immutable", ETag: etag, "Last-Modified": started.toUTCString() };
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  res.writeHead(200, headers);
  res.end(body);
}

const server = http.createServer((req, res) => {
  fs.appendFileSync(logFile, `${Date.now()} gen=${gen} ${req.method} ${req.url} inm=${req.headers["if-none-match"] ? 1 : 0}\n`);
  const path = req.url.split("?")[0];
  if (path === "/default/" || path === "/fix/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(page(path === "/fix/"));
  }
  if (path === "/assets/entry-f1x1u0.js") return asset(req, res, entry);
  const m = /^\/assets\/(chunk|depa|depb|depc)-([\w-]+)\.js$/.exec(path);
  if (m) return asset(req, res, moduleFor(m[1], m[2]));
  res.writeHead(404, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
  res.end("Not Found");
});
server.listen(Number(port), "127.0.0.1", () => process.stdout.write(`listening ${port} gen=${gen}\n`));
process.on("SIGTERM", () => process.exit(0));
