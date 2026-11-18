# Security headers on the web origin

**Status:** accepted · **Date:** 2026-08-19

`climate.timsint.com` served no security headers at all — measured on the live
response: no `strict-transport-security`, no `content-security-policy`, no
`x-frame-options`. The admin console was framable and MIME-sniffable, and it holds a
session JWT in `localStorage` that cross-service revocation cannot recall inside its
window — 24 hours when this was written, and one idle window (60 minutes as shipped)
since the idle session timeout made `SessionTimeoutMinutes` the token's lifetime.
`web/vercel.json` now sets them.

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


## The one per-path header: `X-Robots-Tag` on `/shared/reports/(.*)` (#139)

Every header above is site-wide. This one is not, and the scoping is the decision.

`/shared/reports/{token}` is the public consumption side of a report share link — the
one route in the product that serves a company's climate data to anybody holding a URL.
It must not end up in a search index, so `SharedReportPage` mounts
`<meta name="robots" content="noindex, nofollow">` (`web/src/lib/noIndex.ts`). That tag
is the weak half: a crawler only reads it if it renders the page. `X-Robots-Tag` is
obeyed by a fetcher that never runs JavaScript at all, which is why the header belongs
here as well.

It is **not** added to the site-wide block, because deindexing the whole product is a
different decision — one about the marketing surface — and not one a report page gets
to make. `web/src/lib/noIndex.test.ts` asserts both directions off this file: the
shared-report rule carries the header and its `source` matches a real token URL, and the
site-wide rule does not carry it.

`Referrer-Policy` was checked for the same page and needs no per-path value. The URL of
a shared report *is* the credential, but the site-wide
`strict-origin-when-cross-origin` already sends only the origin on a cross-origin
request, so the token cannot leave in a `Referer`.

## Amended 2026-11-18: the CSP is enforced, and the old App Runner host is gone from it

`web/vercel.json` now sends the policy as **`Content-Security-Policy`**, and `connect-src`
no longer names `https://bhgrdkd4gt.us-east-1.awsapprunner.com`. No other directive
changed: the inventory below found nothing the policy written on 2026-08-19 does not already
allow. The text above is left as written; where it says "Report-Only" or "the App Runner host
the deployed API answers on today", this section supersedes it by date.

### Why the second host could go

- The live production bundle calls one API origin. `GET https://climate.timsint.com/`
  (build-commit `074930f4`: the entry `/assets/index-H3Dkjcsr.js` and the eight further JS
  chunks and one stylesheet reachable from it)
  contains `https://api.climate.timsint.com` 119 times and `awsapprunner.com` **zero** times.
- The old host does not exist. `dig +short bhgrdkd4gt.us-east-1.awsapprunner.com @1.1.1.1`
  returns nothing and `curl` reports `Could not resolve host`: it was the pre-12-Oct service
  in account 747814092517. In 795965600143 / us-east-2, `ListServices` returns exactly one
  App Runner service, `climate-project-api-prod`, whose custom domain
  `api.climate.timsint.com` is `active` (`DescribeCustomDomains`).

### How it was verified, since production cannot be signed into

The procedure above ("open the live site, confirm the console") needs a signed-in session on
production, which an agent may not open. The same check was made against the same code:

- `main` at `074930f4` built with `VITE_API_BASE_URL` pointed at a local API (Release build,
  local Postgres clone of `climate_project` migrated to `main`), `dist/` served by a small node
  server that applies **every header of `web/vercel.json` as written**, its `/logos/:companyId`
  rewrite and the SPA fallback. One substitution only: the production API origin replaced by
  the local one, in `connect-src` and in the `/logos` rewrite destination.
- Chromium 159.0.8154.6 (playwright-core 1.65.1), a `securitypolicyviolation` listener
  installed before any page script, console CSP messages collected, and every request to an
  origin other than the two local ones aborted.
- 51 route visits: `/login`, `/register`, a public `/s/{token}` answered and **submitted**, a
  closed `/s/{token}`, a `/shared/reports/{token}`, `/maintenance.html`, an unknown route; and
  signed in as super_admin, company_admin, leader and employee — dashboards, survey list,
  detail, results, distribution, exports, templates, trends, people, departments, demographic
  fields, reports, analytics, benchmarks, AI insights, audit, system, profile, privacy,
  notifications. Exercised on the way: a company **logo uploaded** and loaded from
  `/logos/{id}?v=…` (every signed-in page of that company, and visibly on the respondent's
  landing page), the **QR** drawn and
  downloaded as PNG, the results **PDF export** downloaded, charts on the dashboard and results.
- Result, under Report-Only and again under enforcement: **0** violation events, **0** console
  CSP messages, **0** page errors. A positive control on the same page (an external image, an
  external `fetch`, an inline `<script>`, an `eval` from a page-owned callback) produced four
  `enforce` violations and neither script ran — so the listener does see what it is looking
  for. An `eval` issued from DevTools (`page.evaluate`) is exempt from the check and is not a
  valid control.

### The inventory, per directive

| directive | what the shipped web uses | evidence |
|---|---|---|
| `script-src 'self'` | its own module chunks only; no third-party script, no Google SDK | `web/index.html:18`; production `index.html` has one `<script>`. Google sign-in is a top-level redirect (`web/src/auth/googleOAuth.ts:56`, `web/src/auth/next/LoginNextPage.tsx:165`), which CSP does not govern, and it is off in production: `googleClientId()` compiles to `function Ds(){return null}` in `index-H3Dkjcsr.js` |
| no `'unsafe-eval'` | no reachable `eval` | `dist/`: 0 `eval(`, 0 `new Function(`; the one `Function('return this')()` is `decimal.js-light` (via recharts, `web/node_modules/decimal.js-light/decimal.js:2008-2009`) behind `typeof self != 'undefined' && self && self.self == self ? self :`, which a window always satisfies |
| `style-src 'self' 'unsafe-inline'` | unchanged, still needed | one inline `<style>` on every route, sonner's Toaster (`[data-sonner-toaster]…`, `web/node_modules/sonner/dist/index.mjs:5`, mounted at `web/src/main.tsx:35`); `react-style-singleton` adds one when a dialog locks scroll; `web/public/maintenance.html:32` is an inline `<style>` by design |
| `font-src 'self'` | `@fontsource` files bundled to `/assets/` as `.woff2` and `.woff` | `web/src/styles/fonts.css:12-18`, `web/src/styles/storefront.css:66`; production CSS has 14 `url(/assets/…woff*)` and no `data:` font |
| `img-src 'self' data:` | `/brand/*`, `/auth-sede.webp`, `/logos/{id}` (same-origin rewrite, `web/vercel.json:4`); `data:` for the CSS checkbox mask, the QR rasterisation and the maintenance favicon | `web/src/auth/next/AuthCanvas.tsx:291`, `web/src/index.css:497`, `web/src/features/surveys/components/ShareLinkQr.tsx:325`, `web/public/maintenance.html:31`. No `blob:` image: every `createObjectURL` feeds an `<a download>` (`web/src/lib/downloadBlobFile.ts:16`, `web/src/lib/downloadTextFile.ts:43`, `ShareLinkQr.tsx:379`, `web/src/features/surveys/ClimateWorkbookPage.tsx:54`) |
| `connect-src 'self' https://api.climate.timsint.com` | the API, including `POST /client-errors` | `web/src/App.tsx:9` (175 occurrences of `import.meta.env.VITE_API_BASE_URL` in `web/src`), `web/src/app/crashReporter.ts:43,174`. Measured in Chromium: 332 `fetch` requests to the API origin and one same-origin, `/settings/undefined/api/planes-accion` — `/settings/privacy` asks the tracking service even though `VITE_TRACKING_API_BASE_URL` is unset (`web/src/features/profile/next/usePrivacyModel.ts:58-59`). `'self'` covers it; it is a defect of its own, not a CSP need |
| `frame-src` / `child-src` / `worker-src` | none — `default-src 'self'` covers them | no `<iframe>`, `Worker`, `SharedWorker` or service worker in `web/src` (tests excluded) |
| `form-action 'self'` | forms submit through `onSubmit` handlers | 59 `<form>` tags in `web/src`, none with an `action` attribute |
| `object-src 'none'`, `base-uri 'self'` | none used | no `<object>`, `<embed>` or `<base>` in `web/src` |

### What enforcing now obliges

- **Any new API origin is a `connect-src` edit in the same change, or the browser blocks it.**
  Three are on record: the tracking service (`VITE_TRACKING_API_BASE_URL`,
  `web/src/features/tracking/api/config.ts:14-16`; `.github/workflows/deploy-tracking-prod.yml:649`
  names the Vercel step), staging (`docs/operational-readiness.md` §6.5,
  `docs/runbooks/staging-provisioning.md` §5b), and any future API domain move. Neither of the
  first two is live today: no tracking host is in the production bundle, `ListServices` finds
  no staging or tracking App Runner service in us-east-1, us-east-2 or us-west-2 of
  795965600143, and `https://climate-staging.vercel.app/` answers `404`
  `x-vercel-error: DEPLOYMENT_NOT_FOUND`. §6.5's "do not promote before both are settled"
  is therefore not violated by this change; it becomes the rule above.
- **Preview deployments still point at the dead host.** The newest Preview
  (`climate-okfd5vevi-federicos-projects-21f2ff63.vercel.app`, build-commit `a29738d0`) names
  `bhgrdkd4gt.us-east-1.awsapprunner.com` 119 times and `api.climate.timsint.com` zero times,
  so Vercel's Preview-scope `VITE_API_BASE_URL` still holds the pre-move value. Those previews
  reach no API today because the name does not resolve; after this change the browser refuses
  the call first. The fix is that Vercel variable, not this file. The same Preview HTML also
  carries Vercel's injected toolbar script from `https://vercel.live`, which `script-src 'self'`
  now blocks on previews; production HTML carries no injected script.
- **Rollback** is the same one-line rename in reverse (`Content-Security-Policy` back to
  `Content-Security-Policy-Report-Only`), deployed like any web change.

Prose elsewhere still describes the header as Report-Only and was not edited here:
`src/ClimateProject.Application/OrgStructure/BrandingValidation.cs:27`,
`tests/ClimateProject.UnitTests/OrgStructure/BrandingValidationTests.cs:31`,
`docs/operational-readiness.md:64,590-606,750`, `docs/runbooks/cutover.md:97`,
`docs/runbooks/api-custom-domain.md:253`, `docs/runbooks/staging-provisioning.md:379-406`,
`docs/runbooks/tracking-service-provisioning.md:698-703`, `docs/decisions/web-hosting.md:95-98`,
`docs/decisions/legacy-dependency-inventory.md:216,424`, and
`infra/aws/climate-project-synthetic-probe.yml:106` (which also still says the CSP names the
App Runner origin).
