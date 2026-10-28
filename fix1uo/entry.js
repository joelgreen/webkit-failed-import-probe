// The toy page's entry. window.__vimp loads a lazy chunk the way a bundler's preload helper does:
// a <link rel=modulepreload crossorigin> for the chunk and each dep, then import().
window.__vimp = (u, deps) => {
  for (const d of [u, ...deps]) {
    const l = document.createElement("link");
    l.rel = "modulepreload";
    l.as = "script";
    l.crossOrigin = "";
    l.href = d;
    document.head.appendChild(l);
  }
  return import(u);
};

// The fix under test (window.__FIX): remember each same-origin /assets/ file whose <link> failed,
// in sessionStorage, and fetch it with {cache: "reload"} (the body read to the end) as the page
// boots, without waiting, and before the page's own Reload, for at most 300 ms there. A file that
// got any answer is dropped; one still unanswered is fetched again on the next page.
const KEY = "fix1uo:failed";
const failed = () => {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};
const keep = (list) => (list.length ? sessionStorage.setItem(KEY, JSON.stringify(list)) : sessionStorage.removeItem(KEY));
async function refetch(timeoutMs) {
  const list = failed();
  if (!list.length) return;
  const stop = new AbortController();
  const timer = timeoutMs ? setTimeout(() => stop.abort(), timeoutMs) : 0;
  const got = await Promise.all(list.map((u) => fetch(u, { cache: "reload", signal: stop.signal }).then((r) => r.arrayBuffer()).then(() => u, () => null)));
  clearTimeout(timer);
  keep(failed().filter((u) => !got.includes(u)));
}
if (window.__FIX) {
  document.addEventListener("error", (event) => {
    const link = event.target;
    if (!(link instanceof HTMLLinkElement)) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith("/assets/")) return;
    if (!failed().includes(url.href)) keep([...failed(), url.href]);
  }, true);
  refetch();
}

// The page's own Reload: once the page's URL answers, (with the fix) refetch for at most the
// app's budget, 300 ms, then reload. window.__primeMs records how long the refetch took.
const BUDGET_MS = 300;
window.__appReload = async () => {
  const r = await fetch(location.href, { cache: "no-store", redirect: "manual" });
  if (r.status >= 500) return;
  const t0 = performance.now();
  if (window.__FIX) await refetch(BUDGET_MS);
  sessionStorage.setItem("fix1uo:primeMs", String(Math.round(performance.now() - t0)));
  location.reload();
};

// A surface open when the page loads asks for its chunk as the page boots, right after the
// boot refetch starts: the driver leaves {u, deps} in sessionStorage for that.
const open = sessionStorage.getItem("fix1uo:open");
if (open) {
  const { u, deps } = JSON.parse(open);
  window.__openResult = window.__vimp(u, deps).then((m) => ({ ok: true, v: m.v }), (e) => ({ ok: false, err: String(e) }));
}
window.__entryLoaded = true;
