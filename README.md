# webkit-failed-import-probe

Minimal generic repro: does Safari keep a failed dynamic `import()` (origin down, connection refused) across `location.reload()` once the server is back?

`server.mjs` serves a page, an entry module and `chunk-*.js` with no Cache-Control. `driver.mjs` drives a WebDriver endpoint (safaridriver or chromedriver) through the variants in `variants.mjs` (including a Vite-style `__vitePreload` mirror: modulepreload links plus import) and logs every request the server sees. Results are uploaded as workflow artifacts.

## fix1uo

`fix1uo/` checks one fix for the failure above: the page remembers each same-origin file whose
`<link rel=modulepreload>` failed (sessionStorage) and fetches it with `{cache: "reload"}` as the
next page boots, and before its own Reload. The toy server sends long-lived immutable caching
headers with validators. Run it with the `fix1uo` workflow (workflow_dispatch).
