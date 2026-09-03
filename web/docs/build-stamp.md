# The web build stamp — which commit is the front end at?

The API has answered `GET /version` with its commit since #310. The web never could, which
is why the API/web version gap of 2026-09-01 (`rollback.md` H9) was invisible from outside a
browser: the deployed front end could be any commit and nothing could say which.

Every build now carries two `<meta>` tags in `index.html`, written by the `build-stamp`
plugin in `vite.config.ts`, and the same two values are readable in-app via
`src/app/buildInfo.ts`.

```
<meta name="build-commit" content="<40-hex sha | unknown>" />
<meta name="build-time"   content="<ISO-8601 UTC | unknown>" />
```

## Reading it

```sh
# the deployed web
curl -s https://climate.timsint.com/ | grep -o '<meta name="build-[a-z]*" content="[^"]*"'

# the deployed API, for the drift check
curl -s https://bhgrdkd4gt.us-east-1.awsapprunner.com/version
```

The two commits should be equal or the web's should be an ancestor-or-descendant that
`deploy-drift.yml` already knows about. `git log --oneline <web-sha>..<api-sha>` names the
gap; `docs/runbooks/rollback.md` §1 says what a gap means.

## Where the value comes from, in order

1. `VERCEL_GIT_COMMIT_SHA` — set by Vercel on every build from a git deploy.
2. `git rev-parse HEAD` — a local or CI build from a checkout.
3. `unknown` — a build from a tree that is not a git checkout. Never a crash: a build that
   cannot name its commit is still a build.

All three were exercised on 2026-09-03: a plain `npm run build` in a checkout stamped `HEAD`
(`835bcee7…`); `VERCEL_GIT_COMMIT_SHA=deadbeef… npm run build` stamped `deadbeef…`; a copy
of the tree outside any repository stamped `unknown`.

## What it deliberately is not

- Not a visible UI element. The tag is for `curl` and for `buildInfo`; nothing on screen
  changes.
- Not `import.meta.env.VITE_*` set from the dashboard. Those are build-time too, but they
  would have to be kept in step by hand; the plugin reads what the build already knows.
