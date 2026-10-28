# webkit-failed-import-probe

Minimal generic repro: does Safari keep a failed dynamic `import()` (origin down, connection refused) across `location.reload()` once the server is back?

`server.mjs` serves a page, an entry module and `chunk-*.js` with no Cache-Control. `driver.mjs` drives a WebDriver endpoint (safaridriver or chromedriver) through variants a-f and logs every request the server sees. Results are uploaded as workflow artifacts.
