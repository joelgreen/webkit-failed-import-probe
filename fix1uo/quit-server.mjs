// Server for the quit/new-tab check in a real, signed-in-style Safari (no WebDriver): the page
// drives itself and reports what happened to /report, which this server logs.
// Usage: node quit-server.mjs <port> <logFile> <generation>
// Asset headers match server.mjs: hashed assets immutable with a weak ETag, pages no-cache.
import http from "node:http";
import fs from "node:fs";

const [port, logFile, gen] = process.argv.slice(2);
const started = new Date(Math.floor(Date.now() / 1000) * 1000);
const log = (line) => fs.appendFileSync(logFile, `${Date.now()} gen=${gen} ${line}\n`);

// phase=fail: report "loaded", wait for the server to go away, load the chunk the bundler way
// (it fails), wait for the server to come back, then go to phase=stuck in the same tab.
// phase=stuck: load it again (the stuck check). phase=after: load it again (after the way out).
const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>fix1uo quit</title></head><body><p>fix1uo quit check</p>
<script type="module">
const q = new URLSearchParams(location.search);
const tag = q.get("tag"), phase = q.get("phase");
const chunk = "/assets/chunk-" + tag + ".js";
const deps = ["depa", "depb", "depc"].map((k) => "/assets/" + k + "-" + tag + ".js");
const vimp = () => {
  for (const d of [chunk, ...deps]) {
    const l = document.createElement("link");
    l.rel = "modulepreload"; l.as = "script"; l.crossOrigin = ""; l.href = d;
    document.head.appendChild(l);
  }
  return import(chunk).then(() => "loaded", () => "failed");
};
const report = (what) => fetch("/report?tag=" + tag + "&what=" + what, { cache: "no-store" }).catch(() => {});
const up = () => fetch("/ping", { cache: "no-store" }).then(() => true, () => false);
const until = async (want) => { while ((await up()) !== want) await new Promise((r) => setTimeout(r, 200)); };
if (phase === "fail") {
  await report("loaded");
  await until(false);
  const down = await vimp();
  await until(true);
  await report("down-" + down);
  location.href = "/q/?tag=" + tag + "&phase=stuck";
} else {
  await report(phase + "-" + (await vimp()));
}
</script></body></html>`;

function moduleFor(kind, tag) {
  if (kind === "chunk") return `import { a } from "./depa-${tag}.js";\nimport { b } from "./depb-${tag}.js";\nexport const v = "chunk-${tag}:" + a + b;\n`;
  if (kind === "depa") return `import { c } from "./depc-${tag}.js";\nexport const a = "a" + c;\n`;
  return `export const ${kind.slice(3)} = "${kind.slice(3)}";\n`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/ping") { res.writeHead(204, { "Cache-Control": "no-store" }); return res.end(); }
  log(`${req.method} ${req.url}`);
  if (url.pathname === "/report") {
    log(`REPORT tag=${url.searchParams.get("tag")} what=${url.searchParams.get("what")}`);
    res.writeHead(204, { "Cache-Control": "no-store" });
    return res.end();
  }
  if (url.pathname === "/q/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(page);
  }
  const m = /^\/assets\/(chunk|depa|depb|depc)-([\w-]+)\.js$/.exec(url.pathname);
  if (m) {
    const body = moduleFor(m[1], m[2]);
    const etag = `W/"${Buffer.byteLength(body).toString(16)}-${started.getTime().toString(16)}"`;
    const headers = { "Content-Type": "text/javascript", "Cache-Control": "public, max-age=31536000, immutable", ETag: etag, "Last-Modified": started.toUTCString() };
    if (req.headers["if-none-match"] === etag) { res.writeHead(304, headers); return res.end(); }
    res.writeHead(200, headers);
    return res.end(body);
  }
  res.writeHead(404, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
  res.end("Not Found");
});
server.listen(Number(port), "127.0.0.1", () => process.stdout.write(`listening ${port} gen=${gen}\n`));
process.on("SIGTERM", () => process.exit(0));
