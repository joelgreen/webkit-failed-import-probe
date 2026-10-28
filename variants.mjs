// style: "plain" = import(chunk); "vite" = append <link rel=modulepreload as=script> for chunk + deps, then import(chunk)
//        (what Vite's __vitePreload does for a lazy chunk). The same style is used while down and on retry,
//        unless retryStyle says otherwise.
// dep: chunk statically imports a dep chunk.  co: crossorigin="" on the preload links (Vite sets it).
// recover: reload = location.reload(); href = location.href = page + '?reload=' + Date.now();
//          nav = WebDriver navigate to the same page URL; none = same document.
// newtab: open a new tab, close the old one, load the page there. primeFetch: fetch(url, {cache:'reload'}) for chunk + deps before retry.
// bust: retry imports chunk + '?r=1' (its dep URL is unchanged).  preloadAfter: add a modulepreload link after recovery.
export const variants = {
  a: { desc: "plain import(), location.reload()", style: "plain", recover: "reload" },
  b: { desc: "plain, reload, then <link rel=modulepreload> before import()", style: "plain", recover: "reload", preloadAfter: true },
  c: { desc: "plain, reload, import(chunk?r=1)", style: "plain", recover: "reload", bust: true },
  d: { desc: "plain, location.href = page?reload=<now>", style: "plain", recover: "href" },
  e: { desc: "plain, no reload (same document retry)", style: "plain", recover: "none" },
  f: { desc: "plain, navigate to same page URL", style: "plain", recover: "nav" },
  g: { desc: "VITE-STYLE (preload links crossorigin + dep), reload", style: "vite", dep: true, co: true, recover: "reload" },
  h: { desc: "plain import of chunk with static dep, reload", style: "plain", dep: true, recover: "reload" },
  i: { desc: "vite-style, no dep, reload", style: "vite", co: true, recover: "reload" },
  j: { desc: "vite-style with dep, links WITHOUT crossorigin, reload", style: "vite", dep: true, co: false, recover: "reload" },
  k: { desc: "vite-style with dep, reload, retry vite-style import(chunk?r=1)", style: "vite", dep: true, co: true, recover: "reload", bust: true },
  n: { desc: "vite-style with dep, reload, retry plain import(chunk?r=1)", style: "vite", dep: true, co: true, recover: "reload", bust: true, retryStyle: "plain" },
  l: { desc: "vite-style with dep, location.href = page?reload=<now>", style: "vite", dep: true, co: true, recover: "href" },
  m: { desc: "vite-style with dep, navigate to same page URL", style: "vite", dep: true, co: true, recover: "nav" },
  o: { desc: "vite-style with dep, close tab, open the page in a new tab", style: "vite", dep: true, co: true, recover: "newtab" },
  q: { desc: "vite-style with dep, reload, fetch(chunk+dep, {cache:'reload'}) before vite-style import", style: "vite", dep: true, co: true, recover: "reload", primeFetch: true },
};

export function names(key, runId, v) {
  const tag = v.dep ? `${key}-withdep-${runId}` : `${key}-${runId}`;
  return { chunkPath: `/assets/chunk-${tag}.js`, depPath: v.dep ? `/assets/dep-${tag}.js` : null };
}

// Browser-side import call: [url, deps|null, co] -> result object.
export const importScript = `const cb = arguments[arguments.length - 1];
const [u, deps, co] = arguments;
const t0 = performance.now();
(deps ? window.__vimp(u, deps, co) : window.__imp(u)).then(
  (m) => cb({ ok: true, v: m.v, ms: Math.round(performance.now() - t0) }),
  (e) => cb({ ok: false, err: String(e), ms: Math.round(performance.now() - t0) }));`;
