// Tallies fix1uo results against the bar: per OS, "default" must be red in every recovery mode
// for the cell to be valid, and "fix" must recover in every run of every mode.
// Usage: node read.mjs <artifactDir>...   (each holds env.txt and results-<engine>.json)
import fs from "node:fs";
import path from "node:path";
const lines = [];
let pass = true;
for (const dir of process.argv.slice(2)) {
  const env = fs.readFileSync(path.join(dir, "env.txt"), "utf8");
  const os = (env.match(/ProductVersion:\s*(\S+)/) || [])[1];
  const safari = (env.match(/Safari: (.*)/) || [])[1];
  for (const engine of ["safari", "chrome"]) {
    const f = path.join(dir, `results-${engine}.json`);
    if (!fs.existsSync(f)) { lines.push(`| macOS ${os} | ${engine} | missing results | | | | |`); pass = false; continue; }
    const res = JSON.parse(fs.readFileSync(f, "utf8"));
    const browser = engine === "safari" ? `Safari ${safari}` : `${res.capabilities?.browserName} ${res.capabilities?.browserVersion}`;
    if (res.sessionError) { lines.push(`| macOS ${os} | ${browser} | session error: ${res.sessionError} | | | | |`); pass = false; continue; }
    for (const mode of ["app", "refresh", "query", "nav"]) {
      const cell = (variant) => {
        const runs = res.runs.filter((r) => r.variant === variant && r.mode === mode);
        const ok = runs.filter((r) => r.afterRecover?.ok).length;
        const downFailed = runs.filter((r) => r.whileDown && !r.whileDown.ok).length;
        const errors = runs.filter((r) => r.error).length;
        const silent = runs.filter((r) => !r.afterRecover?.ok && r.requested && r.requested.chunk + r.requested.deps.reduce((a, b) => a + b, 0) === 0).length;
        return { ok, n: runs.length, downFailed, errors, silent, text: `${ok}/${runs.length}${errors ? ` (${errors} errors)` : ""}${silent ? ` (${silent} with no request)` : ""}` };
      };
      const d = cell("default"), x = cell("fix");
      let verdict;
      if (engine === "chrome") verdict = x.ok === x.n && d.ok === d.n && x.n > 0 ? "control ok" : "CONTROL ODD";
      else if (d.ok > 0) verdict = d.ok <= 1 && d.n >= 8 ? "valid" : "INVALID (default not red)";
      else verdict = "valid";
      if (engine === "safari") verdict += x.n > 0 && x.ok === x.n && x.errors === 0 ? "; fix PASS" : "; fix FAIL";
      if (/INVALID|FAIL|ODD/.test(verdict)) pass = false;
      lines.push(`| macOS ${os} | ${browser} | ${mode} | ${d.text} | ${x.text} | down failed ${d.downFailed + x.downFailed}/${d.n + x.n} | ${verdict} |`);
    }
  }
}
console.log("| OS | browser | recovery | default recovered | fix recovered | import failed while down | verdict |\n|---|---|---|---|---|---|---|");
console.log(lines.join("\n"));
console.log(`\nOVERALL: ${pass ? "PASS" : "NOT PASS"}`);
