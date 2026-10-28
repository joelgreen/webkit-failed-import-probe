// Drives a WebDriver endpoint through the fix1uo toy: a lazy chunk loaded the bundler way fails
// while the server is down, the server restarts, the page recovers, and the chunk loads or not.
// Usage: REPS=<n> node driver.mjs <safari|chrome> <webdriverUrl> <outDir>
// Variants: default (no fix) and fix. Recovery modes:
//   app     the page's own Reload (window.__appReload: refetch with the fix, then location.reload())
//   refresh WebDriver refresh, the browser's reload
//   query   location.href = path + "?reload=<now>"
//   nav     WebDriver navigate to the same URL
//   app-slow  app, with the restarted server sending each chunk and dep after 1000 ms (past the budget)
//   newtab / closetab  (default only) a new tab on the same URL, keeping or first closing the stuck tab
// After recovery the new page asks for the chunk as it boots (entry.js, fix1uo:open).
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const [engine, wd, outDir] = process.argv.slice(2);
const REPS = Number(process.env.REPS ?? 1);
const PORT = 8124;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const here = path.dirname(new URL(import.meta.url).pathname);
fs.mkdirSync(outDir, { recursive: true });
const logFile = path.join(outDir, `server-${engine}.log`);
fs.writeFileSync(logFile, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server = null;
let gen = 0;
const portOpen = () => new Promise((resolve) => { const s = net.connect(PORT, "127.0.0.1"); s.once("connect", () => (s.destroy(), resolve(true))); s.once("error", () => resolve(false)); });
async function startServer(slowMs = 0) {
  gen += 1;
  server = spawn(process.execPath, [path.join(here, "server.mjs"), String(PORT), logFile, String(gen), String(slowMs)], { stdio: ["ignore", "ignore", "inherit"] });
  for (let i = 0; i < 200; i++) { if (await portOpen()) return gen; await sleep(50); }
  throw new Error("server did not start");
}
async function stopServer() {
  const child = server;
  server = null;
  const exited = new Promise((r) => child.once("exit", r));
  child.kill("SIGTERM");
  await exited;
  for (let i = 0; i < 200; i++) { if (!(await portOpen())) return; await sleep(50); }
  throw new Error("port still open after stop");
}
const requests = (g, needle) => fs.readFileSync(logFile, "utf8").split("\n").filter((l) => l.includes(` gen=${g} `) && l.includes(needle));

async function cmd(method, p, body) {
  const res = await fetch(wd + p, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json.value;
}
let sid = null;
async function newSession() {
  const caps = engine === "safari" ? { browserName: "safari" } : { browserName: "chrome", "goog:chromeOptions": { args: ["--headless=new", "--no-first-run"] } };
  const v = await cmd("POST", "/session", { capabilities: { alwaysMatch: caps } });
  sid = v.sessionId;
  await cmd("POST", `/session/${sid}/timeouts`, { script: 30000, pageLoad: 30000 });
  return v.capabilities;
}
async function endSession() { if (sid) await cmd("DELETE", `/session/${sid}`).catch(() => {}); sid = null; }
const exec = (script, args = []) => cmd("POST", `/session/${sid}/execute/sync`, { script, args });
const execAsync = (script, args = []) => cmd("POST", `/session/${sid}/execute/async`, { script, args });
const go = (url) => cmd("POST", `/session/${sid}/url`, { url });
async function waitForNewDoc(oldDocId) {
  for (let i = 0; i < 300; i++) {
    try {
      const s = await exec("return {docId: window.__docId, ready: document.readyState, entry: !!window.__entryLoaded}");
      if (s && s.docId && s.docId !== oldDocId && s.ready === "complete" && s.entry) return s;
    } catch {}
    await sleep(100);
  }
  throw new Error("new document did not load");
}
const importWhileDown = `const cb = arguments[arguments.length - 1];
window.__vimp(arguments[0], arguments[1]).then((m) => cb({ ok: true, v: m.v }), (e) => cb({ ok: false, err: String(e) }));`;
const awaitOpen = `const cb = arguments[arguments.length - 1];
(window.__openResult || Promise.resolve({ ok: false, err: "no open" })).then(cb);`;

const runId = Math.random().toString(36).slice(2, 8);
const SLOW_MS = 1000; // app-slow: the restarted server sends each chunk and dep after this long, past the 300 ms budget
async function run(variant, mode, rep) {
  const tag = `${runId}-${variant}-${mode}-${rep}`;
  const chunk = `${ORIGIN}/assets/chunk-${tag}.js`;
  const deps = ["depa", "depb", "depc"].map((k) => `${ORIGIN}/assets/${k}-${tag}.js`);
  const pageUrl = `${ORIGIN}/${variant}/`;
  const r = { variant, mode, rep, tag };
  await startServer();
  await newSession();
  try {
    await go(pageUrl);
    const s0 = await waitForNewDoc(undefined);
    await stopServer();
    r.whileDown = await execAsync(importWhileDown, [chunk, deps]);
    await exec("sessionStorage.setItem('fix1uo:open', JSON.stringify({u: arguments[0], deps: arguments[1]})); return true;", [chunk, deps]);
    const g = await startServer(mode === "app-slow" ? SLOW_MS : 0);
    if (mode === "app" || mode === "app-slow") await exec("setTimeout(() => window.__appReload(), 50); return true;");
    if (mode === "refresh") await cmd("POST", `/session/${sid}/refresh`, {});
    if (mode === "query") await exec("setTimeout(() => { location.href = location.pathname + '?reload=' + Date.now(); }, 50); return true;");
    if (mode === "nav") await go(pageUrl);
    if (mode === "newtab" || mode === "closetab") {
      // A new tab on the same URL; closetab closes the stuck tab first.
      const nw = await cmd("POST", `/session/${sid}/window/new`, { type: "tab" });
      if (mode === "closetab") await cmd("DELETE", `/session/${sid}/window`);
      await cmd("POST", `/session/${sid}/window`, { handle: nw.handle });
      await go(pageUrl);
    }
    await waitForNewDoc(s0.docId);
    r.afterRecover = await execAsync(awaitOpen);
    r.primeMs = await exec("return sessionStorage.getItem('fix1uo:primeMs')");
    r.requested = { chunk: requests(g, `/chunk-${tag}`).length, deps: deps.map((d) => requests(g, d.replace(ORIGIN, "")).length) };
  } catch (e) {
    r.error = String(e && e.stack ? e.stack : e).slice(0, 500);
  } finally {
    await endSession();
    if (server) await stopServer();
  }
  console.log(JSON.stringify(r));
  return r;
}

const results = { engine, runId, reps: REPS, startedAt: new Date().toISOString(), runs: [] };
try {
  await startServer();
  results.capabilities = await newSession();
  await endSession();
  await stopServer();
} catch (e) {
  results.sessionError = String(e);
}
if (!results.sessionError) {
  for (let rep = 1; rep <= REPS; rep++)
    for (const variant of ["default", "fix"]) {
      for (const mode of ["app", "refresh", "query", "nav", "app-slow"]) results.runs.push(await run(variant, mode, rep));
      // Workarounds for a stuck tab without the fix, for the release notes.
      if (variant === "default") for (const mode of ["newtab", "closetab"]) results.runs.push(await run(variant, mode, rep));
    }
}
results.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(outDir, `results-${engine}.json`), JSON.stringify(results, null, 2));
