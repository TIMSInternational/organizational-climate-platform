# The maintenance page — serving it while the product is down

`public/maintenance.html` is a single self-contained file: no script, no stylesheet, no font,
no image request (asserted by `src/app/maintenancePage.test.ts`). Vite copies `public/` into
`dist/` untouched, so every deployment already carries it at `/maintenance.html`. It says what
the in-app maintenance screen says, in Spanish then English, and bakes in no date.

This document is about the one thing the file cannot do for itself: **become the page people
see at `/`**. It exists because `docs/runbooks/cutover.md` C8 ("maintenance page ready to
serve") was blank, and because the in-app maintenance mode (`SystemSettings.MaintenanceMode` →
API `503` → `web/src/auth/authReason.ts` → the maintenance screen) needs the app **up** to show
anything.

## Two different outages, two different levers

| The outage | What the user sees today | The lever |
|---|---|---|
| **The API is down or in maintenance; the web is fine.** | The SPA loads, calls the API, gets `503` (or nothing), and shows its own maintenance screen — built, tested (`authPages.test.tsx`), and switched from the admin UI (`SystemSettings.MaintenanceMode`, `MaintenanceMessageEn/Es`). | In-app. Nothing in this document is needed. |
| **The web deployment itself is broken, or must be taken out of service** (a bad build shipped, a cutover step that touches the web). | Whatever the broken build does. | **This page**, served at `/` by Vercel, below. |

## How to put it in front of `/` — verified against Vercel's reference, NOT rehearsed here

`web/vercel.json` today rewrites every path to the SPA:

```json
"rewrites": [ { "source": "/(.*)", "destination": "/index.html" } ]
```

Two facts from Vercel's own configuration reference
(`https://vercel.com/docs/project-configuration/vercel-json`, read 2026-09-03) decide how this
works:

1. *"precedence is given to the filesystem prior to rewrites being applied"* — so a request
   for `/maintenance.html` is answered by the file, **not** captured by the `/(.*)` rewrite.
   That is why the file is reachable on every deployment already.
2. `cleanUrls` defaults to `false` and is not set here, so `/maintenance.html` keeps its
   extension (with `cleanUrls: true` it would 308 to `/maintenance`).

### The switch-on

Change the one rewrite so that everything lands on the maintenance page, commit, and let
Vercel deploy it (a `vercel.json` change is part of the deployment; it does not take effect
from the dashboard):

```json
"rewrites": [ { "source": "/(.*)", "destination": "/maintenance.html" } ]
```

Because the filesystem wins before rewrites (fact 1), `/assets/*` and `/maintenance.html` itself
keep resolving to their files while every route the SPA owns — `/`, `/login`, `/surveys/…`,
`/s/{token}` — lands on the page. That is the expectation from the reference; the rehearsal
below is what turns it into a measurement.

What this costs: **one commit and one Vercel deployment** (the build is the normal `tsc -b &&
vite build`, ~1–3 min on Vercel). What it does NOT need: an API change, a DNS change, a secret.

### The switch-off

Revert that commit (or restore `"destination": "/index.html"`) and deploy. Vercel's **Instant
Rollback** to the previous production deployment should be the faster path if the maintenance
deployment was the only change since — a rollback re-promotes the previous deployment, and a
deployment carries its own `vercel.json`. Not verified on this project; see the table.

### What has and has not been rehearsed

| | Status |
|---|---|
| The file renders self-contained, both colour schemes, one request, zero external | **Verified locally 2026-09-03** — served by `vite` and driven with `playwright-core`: `requests=1 external=0` in light and in dark; screenshots read. |
| `/maintenance.html` is reachable on a Vercel deployment despite the catch-all rewrite | **Observed 2026-09-03** on this PR's preview deployment: `curl` → `200 text/html; charset=utf-8`, body is this file (`En mantenimiento` present), while `/login` on the same host still serves the SPA. One addition on **preview** deployments only: Vercel injects its feedback-toolbar `<script src="https://vercel.live/_next-live/feedback/feedback.js">` into every HTML response; production (`climate.timsint.com`, measured the same day) carries no such injection. Re-check on production after this lands: `curl -I https://climate.timsint.com/maintenance.html` → `200`. |
| The switch-on rewrite puts the page at `/` | **Not rehearsed.** Rehearse on a **preview deployment** first (Vercel's own recommendation: *"Use Vercel's preview deployments to test your rewrites before going to production"*), e.g. a PR that flips the destination, then `curl -I <preview-url>/login` → the maintenance page. |
| Instant Rollback restores the SPA | **Not rehearsed** on this project; `rollback.md` §3.1 records that a web rollback via Vercel has never been executed here. Treat it as the same open item. |

### Why not a toggle that avoids a deployment

Two are known and neither is done here, on purpose:

- **Routing Middleware reading an environment variable or Edge Config.** Would let an operator
  flip the page without a deploy. It adds a runtime component to a web deployment that today is
  pure static output, and a middleware that fails takes the whole site down — the opposite of
  what a maintenance page is for. If the client asks for a no-deploy switch, this is the design
  to evaluate, as its own change.
- **Serving the page from the API.** The API being up is the case where the in-app screen
  already works.

## The in-app path is unchanged

`SystemSettings.MaintenanceMode` still governs the API and the in-app screen. The two screens
carry the same words (`auth.maintenanceTitle` / `auth.maintenanceDetail`, both catalogues), so a
user who hits one and then the other reads the same sentence. If the in-app copy changes,
`maintenancePage.test.ts` fails until this file is updated to match — that is the point of the
test.
