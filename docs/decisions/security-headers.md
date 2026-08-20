# Security headers on the web origin

**Status:** accepted · **Date:** 2026-08-19

`climate.timsint.com` served no security headers at all — measured on the live
response: no `strict-transport-security`, no `content-security-policy`, no
`x-frame-options`. The admin console was framable and MIME-sniffable, and it holds a
24-hour session JWT in `localStorage` that cross-service revocation cannot recall
inside its window. `web/vercel.json` now sets them.

## The four that are enforced, and one that is not

`Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options`,
`Referrer-Policy` and `Permissions-Policy` are enforced. None of them can break a
single-page app, and `X-Frame-Options: DENY` closes clickjacking on its own — so
nothing of value waits on the decision below.

**The CSP ships as `Content-Security-Policy-Report-Only`.** One directive in it can
take production down and cannot be verified from this repository: `connect-src` pins
the API origin, which is supplied to the build as `VITE_API_BASE_URL` from Vercel's
dashboard rather than from any file here. Pin the wrong host and the app reaches no
API at all. #160 (custom API domain) would change it, and the value in the policy is
the App Runner host the deployed API answers on today.

To enforce it: open the live site, confirm the console reports no violation, then
rename the header key in `vercel.json`. That is the whole procedure. Report-Only
gives identical visibility with no chance of an outage, which is the right trade for
a header nobody can test before it is live.

## Why `style-src` needs `'unsafe-inline'` — measured, not assumed

The first draft assumed it was needed because 26 components set `style={{…}}`. **That
assumption was wrong**, and the measurement is worth keeping because it points at the
real constraint.

The production build was served locally with the policy *enforcing* and probed:

| how a style is applied | under `style-src 'self'` |
| --- | --- |
| `node.style.backgroundColor = …` — how React applies `style={{…}}` | **applied** |
| `setAttribute('style', …)` — an HTML style attribute | blocked |

React writes through the CSSOM, and CSP's `style-src` governs `<style>` elements and
HTML `style=""` attributes parsed from markup — not CSSOM writes. So every chart fill
in `ClimateMap` would have survived a strict policy untouched.

What actually requires the keyword is `style-src-elem`: three distinct inline `<style>`
elements are injected at runtime on every route, including `/login`, which is the
signature of a component library managing its own styles rather than anything this
codebase writes. With `'unsafe-inline'` present the same build produces **zero**
violations.

Two consequences worth stating. Tightening this to hashes is possible but would pin
this repository's CSP to a dependency's internal stylesheets, which change on any
upgrade with no test to catch it — not a trade worth making for a policy whose main
job here is `script-src`. And `img-src` allows `data:` because the protected-cell
hatch is authored as a gradient rather than shipped as two PNGs; it does not allow
`blob:`, which the CSV export uses only for an anchor download and which no fetched
subresource needs.

## What was checked

Built with the production API host, served with the policy as a real header, loaded
in Chromium, and every `securitypolicyviolation` event collected. `/dev/chart-gallery`
is **not** a useful route for this: `router.tsx` gates the dev routes behind
`import.meta.env.DEV`, so a production build answers it with the not-found page. The
finding above came from `/login`, which every visitor sees.
