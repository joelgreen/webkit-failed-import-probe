// Drives a WebDriver endpoint through the failed-dynamic-import scenario.
// Usage: node driver.mjs <engine:safari|chrome> <webdriverUrl> <outDir>
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { variants, names, importScript } from "./variants.mjs";

const [engine, wd, outDir] = process.argv.slice(2);
const PORT = 8123;
const ORIGIN = `http://127.0.0.1:${PORT}`;
fs.mkdirSync(outDir, { recursive: true });
const logFile = path.join(outDir, `server-${engine}.log`);
const traceFile = path.join(outDir, `trace-${engine}.log`);
fs.writeFileSync(logFile, "");
fs.writeFileSync(traceFile, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const trace = (...a) => {
  const line = `${new Date().toISOString()} ${a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}`;
  console.log(line);
  fs.appendFileSync(traceFile, line + "\n");
};

// ---------- server control (only PIDs we spawn) ----------
let server = null;
let gen = 0;
function portOpen() {
  return new Promise((resolve) => {
    const s = net.connect(PORT, "127.0.0.1");
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
  });
}
async function startServer() {
  gen += 1;
  server = spawn(process.execPath, [path.resolve("server.mjs"), String(PORT), logFile, String(gen)], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  for (let i = 0; i < 100; i++) {
    if (await portOpen()) return gen;
    await sleep(50);
  }
  throw new Error("server did not start");
}
async function stopServer() {
  const child = server;
  server = null;
  const exited = new Promise((r) => child.once("exit", r));
  child.kill("SIGTERM");
  await exited;
  for (let i = 0; i < 100; i++) {
    if (!(await portOpen())) return;
    await sleep(50);
  }
  throw new Error("port still open after stop");
}
function requestsSince(genNo, needle) {
  return fs
    .readFileSync(logFile, "utf8")
    .split("\n")
    .filter((l) => l.includes(` gen=${genNo} `) && l.includes(needle));
}

// ---------- WebDriver ----------
async function cmd(method, p, body) {
  const res = await fetch(wd + p, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${JSON.stringify(json).slice(0, 400)}`);
  return json.value;
}
let sid = null;
async function newSession() {
  const caps =
    engine === "safari"
      ? { browserName: "safari" }
      : { browserName: "chrome", "goog:chromeOptions": { args: ["--headless=new", "--no-first-run"] } };
  const v = await cmd("POST", "/session", { capabilities: { alwaysMatch: caps } });
  sid = v.sessionId;
  await cmd("POST", `/session/${sid}/timeouts`, { script: 30000, pageLoad: 30000 });
  return v.capabilities;
}
async function endSession() {
  if (sid) await cmd("DELETE", `/session/${sid}`).catch(() => {});
  sid = null;
}
const exec = (script, args = []) => cmd("POST", `/session/${sid}/execute/sync`, { script, args });
const execAsync = (script, args = []) => cmd("POST", `/session/${sid}/execute/async`, { script, args });
const go = (url) => cmd("POST", `/session/${sid}/url`, { url });

async function pageState() {
  return exec(
    "return {docId: window.__docId, ready: document.readyState, entry: !!window.__entryLoaded, href: location.href}",
  );
}
async function waitForNewDoc(oldDocId) {
  for (let i = 0; i < 200; i++) {
    try {
      const s = await pageState();
      if (s && s.docId && s.docId !== oldDocId && s.ready === "complete" && s.entry) return s;
    } catch {}
    await sleep(100);
  }
  throw new Error("new document did not load");
}
async function importUrl(url, deps, co) {
  return execAsync(importScript, [url, deps, co]);
}
async function addModulePreload(url) {
  return execAsync(
    `const cb = arguments[arguments.length - 1];
     const l = document.createElement('link');
     l.rel = 'modulepreload'; l.href = arguments[0];
     const t = setTimeout(() => cb('timeout'), 5000);
     l.onload = () => { clearTimeout(t); cb('load'); };
     l.onerror = () => { clearTimeout(t); cb('error'); };
     document.head.appendChild(l);`,
    [url],
  );
}

// ---------- variants ----------
const runId = Math.random().toString(36).slice(2, 8);
async function runVariant(key) {
  const v = variants[key];
  const { chunkPath, depPath } = names(key, runId, v);
  const chunkUrl = `${ORIGIN}${chunkPath}`;
  const deps = v.style === "vite" ? (depPath ? [ORIGIN + depPath] : []) : null;
  const retryDeps = (v.retryStyle ?? v.style) === "vite" ? deps : null;
  const r = { variant: key, desc: v.desc, chunk: chunkPath, dep: depPath };
  await startServer();
  await newSession();
  try {
    await go(`${ORIGIN}/`);
    const s0 = await waitForNewDoc(undefined);
    await stopServer();
    r.downImport = await importUrl(chunkUrl, deps, v.co);
    const g = await startServer();
    r.restartGen = g;
    if (v.recover === "reload") {
      await exec("setTimeout(() => location.reload(), 50); return true;");
      await waitForNewDoc(s0.docId);
    } else if (v.recover === "href") {
      await exec("setTimeout(() => { location.href = location.pathname + '?reload=' + Date.now(); }, 50); return true;");
      await waitForNewDoc(s0.docId);
    } else if (v.recover === "nav") {
      await go(`${ORIGIN}/`);
      await waitForNewDoc(s0.docId);
    }
    r.pageRequestsAfterRestart = requestsSince(g, "GET /").filter((l) => !l.includes("/assets/")).length;
    if (v.preloadAfter) r.modulepreload = await addModulePreload(chunkUrl);
    const target = v.bust ? `${chunkUrl}?r=1` : chunkUrl;
    r.retryImport = await importUrl(target, retryDeps, v.co);
    const seen = () => ({
      chunk: requestsSince(g, chunkPath).map((l) => l.split(" ").slice(2).join(" ")),
      dep: depPath ? requestsSince(g, depPath).map((l) => l.split(" ").slice(2).join(" ")) : [],
    });
    r.requestsAfterRestart = seen();
    if (!r.retryImport.ok && v.recover === "reload") {
      const s1 = await pageState();
      await exec("setTimeout(() => location.reload(), 50); return true;");
      await waitForNewDoc(s1.docId);
      r.secondReloadImport = await importUrl(target, retryDeps, v.co);
      r.requestsAfterRestart = seen();
    }
  } catch (e) {
    r.error = String(e && e.stack ? e.stack : e);
  } finally {
    await endSession();
    if (server) await stopServer();
  }
  trace(engine, key, r);
  return r;
}

const results = { engine, runId, startedAt: new Date().toISOString(), variants: [] };
try {
  await startServer();
  results.capabilities = await newSession();
  await endSession();
  await stopServer();
} catch (e) {
  results.sessionError = String(e);
  trace("session error", results.sessionError);
}
const only = process.env.VARIANTS ? process.env.VARIANTS.split(",") : Object.keys(variants);
if (!results.sessionError) {
  for (const k of only) results.variants.push(await runVariant(k));
}
fs.writeFileSync(path.join(outDir, `results-${engine}.json`), JSON.stringify(results, null, 2));

// summary table
const short = (x) => (x.ok ? "loaded" : `FAILED (${x.err})`);
const rows = results.variants.map((v) => {
  const res = v.error ? `ERROR ${v.error.split("\n")[0]}` : short(v.retryImport);
  const extra = v.secondReloadImport ? `; 2nd reload: ${short(v.secondReloadImport)}` : "";
  const q = v.requestsAfterRestart;
  const seen = q ? `chunk ${q.chunk.length ? "yes" : "no"}${v.dep ? `, dep ${q.dep.length ? "yes" : "no"}` : ""}` : "?";
  return `| ${engine} | ${v.variant} | ${v.desc} | ${v.downImport ? short(v.downImport) : "?"} | ${res}${extra} | ${seen} |`;
});
const table = ["| engine | variant | what | import while down | after recovery | request seen after restart |", "|---|---|---|---|---|---|", ...rows].join("\n");
console.log(table);
fs.writeFileSync(path.join(outDir, `summary-${engine}.md`), table + "\n");
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### ${engine}\n\n${table}\n`);
