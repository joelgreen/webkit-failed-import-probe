// Ways out of a stuck tab in Safari as a person runs it (opened with `open -a Safari`, no
// WebDriver, the runner's own profile), without the fix.
// Usage: REPS=<n> node quit-driver.mjs <outDir>
// Per run: open the page, server down (the bundler-way chunk load fails), server back, the page
// goes to the same URL with ?phase=stuck in its own tab (must stay failed: the precondition), then:
//   newtab  `open -a Safari <url>` while Safari runs: a new tab, the stuck tab kept
//   quit    quit Safari (AppleScript, else SIGTERM to its pid on this throwaway runner), then
//           `open -a Safari <url>`
// and the page reports whether the chunk loads.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const [outDir] = process.argv.slice(2);
const REPS = Number(process.env.REPS ?? 1);
const PORT = 8125;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const here = path.dirname(new URL(import.meta.url).pathname);
fs.mkdirSync(outDir, { recursive: true });
const logFile = path.join(outDir, "server-quit.log");
fs.writeFileSync(logFile, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let server = null, gen = 0;
const portOpen = () => new Promise((resolve) => { const s = net.connect(PORT, "127.0.0.1"); s.once("connect", () => (s.destroy(), resolve(true))); s.once("error", () => resolve(false)); });
async function startServer() {
  gen += 1;
  server = spawn(process.execPath, [path.join(here, "quit-server.mjs"), String(PORT), logFile, String(gen)], { stdio: ["ignore", "ignore", "inherit"] });
  while (!(await portOpen())) await sleep(50);
}
async function stopServer() {
  const c = server; server = null;
  const exited = new Promise((r) => c.once("exit", r));
  c.kill("SIGTERM");
  await exited;
  while (await portOpen()) await sleep(50);
}
const reports = (tag) => fs.readFileSync(logFile, "utf8").split("\n").filter((l) => l.includes(`REPORT tag=${tag} `)).map((l) => l.split("what=")[1]);
async function waitFor(tag, prefix, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const r = reports(tag).find((w) => w.startsWith(prefix)); if (r) return r; await sleep(200); }
  return `${prefix}timeout`;
}
const safariPids = () => { try { return execFileSync("pgrep", ["-x", "Safari"]).toString().trim().split("\n").filter(Boolean); } catch { return []; } };
async function quitSafari() {
  try { execFileSync("osascript", ["-e", 'tell application "Safari" to quit'], { timeout: 15000 }); } catch {}
  for (let i = 0; i < 50 && safariPids().length; i++) await sleep(200);
  const left = safariPids();
  if (left.length) { for (const p of left) try { process.kill(Number(p), "SIGTERM"); } catch {} ; for (let i = 0; i < 50 && safariPids().length; i++) await sleep(200); return "sigterm"; }
  return "applescript";
}
const runId = Math.random().toString(36).slice(2, 8);
const results = { runId, reps: REPS, startedAt: new Date().toISOString(), runs: [] };
for (let rep = 1; rep <= REPS; rep++) {
  for (const way of ["newtab", "quit"]) {
    const tag = `${runId}-${way}-${rep}`;
    const r = { way, rep, tag };
    try {
      await startServer();
      execFileSync("open", ["-a", "Safari", `${ORIGIN}/q/?tag=${tag}&phase=fail`]);
      r.loaded = await waitFor(tag, "loaded");
      await stopServer();
      await sleep(3000);
      await startServer();
      r.down = await waitFor(tag, "down-");
      r.stuck = await waitFor(tag, "stuck-");
      if (way === "quit") r.quitBy = await quitSafari();
      execFileSync("open", ["-a", "Safari", `${ORIGIN}/q/?tag=${tag}&phase=after`]);
      r.after = await waitFor(tag, "after-");
      r.requests = fs.readFileSync(logFile, "utf8").split("\n").filter((l) => l.includes(` gen=${gen} `) && l.includes(`/assets/`) && l.includes(tag)).length;
    } catch (e) {
      r.error = String(e).slice(0, 300);
    } finally {
      if (server) await stopServer();
    }
    console.log(JSON.stringify(r));
    results.runs.push(r);
  }
  await quitSafari();
}
results.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(outDir, "results-quit.json"), JSON.stringify(results, null, 2));
const lines = ["| way | stuck first (same tab, same URL) | recovered (of stuck) |", "|---|---|---|"];
for (const way of ["newtab", "quit"]) {
  const runs = results.runs.filter((x) => x.way === way);
  const stuck = runs.filter((x) => x.stuck === "stuck-failed");
  lines.push(`| ${way} | ${stuck.length}/${runs.length} | ${stuck.filter((x) => x.after === "after-loaded").length}/${stuck.length} |`);
}
fs.writeFileSync(path.join(outDir, "READ-quit.md"), lines.join("\n") + "\n");
console.log(lines.join("\n"));
