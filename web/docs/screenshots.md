# Screenshots — looking at a screen

The Vitest suite runs on happy-dom (see `vite.config.ts`), which has **no layout
engine**. A component can be mispositioned, overlap another, or collapse to zero height
with every assertion in its test file still green — that has already happened in this
repository. `npm run shot` is the way to actually look at a screen.

## One-time setup

```sh
cd web
npm ci
npx playwright-core install chromium
```

`playwright-core` is a devDependency; unlike `playwright` it has no postinstall step and
downloads no browser, which is why CI's `npm ci` costs nothing extra. The second command
downloads Chromium into the shared `~/Library/Caches/ms-playwright` (macOS) /
`~/.cache/ms-playwright` (Linux) cache and is a no-op once it is there. `shot` tells you
to run it if the browser is missing.

## The command

```sh
cd web && npm run shot -- <route> <out.png> [options]
```

Use an **absolute** path for `<out.png>`; a relative one resolves against `web/`.
Parent directories are created for you.

```sh
# the two acceptance shots, one per theme
cd web && npm run shot -- /dev/chart-gallery /tmp/shots/gallery-light.png --theme light
cd web && npm run shot -- /dev/chart-gallery /tmp/shots/gallery-dark.png  --theme dark

# an authenticated admin screen — no login, no backend
cd web && npm run shot -- /admin/companies /tmp/shots/companies-dark.png --theme dark
```

Then **read the PNG**. A file on disk is not evidence; the picture is.

### Options

| Option | Default | What it does |
| --- | --- | --- |
| `--theme light\|dark` | `light` | Sets `admin-theme` in localStorage. The run fails if `<html>` does not end up carrying the matching `data-admin-theme`. |
| `--width <px>` | `1440` | Viewport width. |
| `--height <px>` | `900` | Viewport height. |
| `--scale <n>` | `2` | Device pixel ratio. `--scale 1` for a smaller file. |
| `--role <r>` | `super_admin` | The `role` claim: `super_admin`, `company_admin`, `leader`, `supervisor`, `employee`. Drives `RoleBasedNav` and every role-dispatching page. |
| `--name <n>` | `Ada Lovelace` | The `name` claim, shown in the sidebar user menu. |
| `--company <guid>` | `11111111-…-111111111111` | The `companyId` claim, and the stored company context. |
| `--lang en\|es` | `en` | Sets `preferredLocale`. Use it — half the copy defects in this app only appear in Spanish. |
| `--fixtures <file>` | `scripts/shot-fixtures/default.json` | API responses (see below). |
| `--server <url>` | — | Reuse a dev server instead of starting one. It must have been started with `VITE_API_BASE_URL=http://api.shot.invalid`. |
| `--port <n>` | `5199` | Port for the dev server `shot` starts. Not 5173, so it does not fight a `npm run dev` you already have open. |
| `--settle <ms>` | `400` | Extra wait after network idle and web fonts. |
| `--viewport` | off | Clip to the viewport instead of capturing the full page. |

## How it gets past the login screen

`RequireAuth` reads a JWT out of `localStorage['climate_platform_token']` and
`src/auth/jwt.ts` decodes it **without verifying the signature** — deliberately, because
its only job is reading `role`/`companyId` client-side. So the harness writes an
unsigned token with the claims the shell reads, before the app's first script runs.

Nothing under `web/src` changes for this. A dev-only bypass inside `RequireAuth` would
be a branch living in the shipped bundle; this is a branch living in one browser
process. The token has no signature and the real API rejects it.

## API responses

`shot` starts the dev server with `VITE_API_BASE_URL=http://api.shot.invalid` — a TLD
RFC 2606 reserves as unresolvable — and answers every request to that origin from a
fixture file. Nothing reaches a real backend, and a request to any *other* origin is
aborted and reported, so a misconfigured `--server` cannot smuggle live data into a
screenshot.

Fixtures are a JSON object keyed `"<METHOD> <path>"`, value = the response body:

```json
{
  "GET /admin/companies": { "companies": [] },
  "GET /admin/companies/*/users": { "users": [] },
  "/notifications/mine": { "notifications": [] }
}
```

- A key with no method is a `GET`.
- `*` matches exactly one path segment.
- Query strings are ignored, so `?lang=es` and `?unreadOnly=true` need no key.
- Anything with no fixture gets a 404, and **is listed on stdout at the end of the
  run** — that listing is how you find out which endpoints your screen needs:

```
shot: 2 API call(s) had no fixture and were answered 404:
  GET /admin/companies
  GET /notifications/mine
```

`scripts/shot-fixtures/default.json` covers the shell (`/notifications/mine`, which
every admin screen polls) plus `/admin/companies`. For your own screen, copy it, add
what the listing named, and pass `--fixtures`.

## It does not run in CI

Nothing in `scripts/` is imported by `src/`, and `tsconfig.app.json` includes only
`src`, so `npm run typecheck` and `npm run build` never see it. The only test that
touches the harness is `scripts/shot-harness.test.mjs`, which covers the pure helpers
(fixture matching, the dev token, request classification) and launches no browser.
