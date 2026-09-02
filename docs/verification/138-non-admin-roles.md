# #138 — verified by logging in as each role

> Issue #138, *Non-admin experience — employee, supervisor and leader roles*.
> Its fifth acceptance criterion is **"Verified by logging in as each role, not by reading
> code."** By its own wording no amount of reading discharges it, so this file records a
> run: what was signed into, what was driven, what each screen actually said, and — just
> as load-bearing — **what was not exercised and why**.
>
> Run on **2026-09-01** against `main` at `1ef86b8`.

## The stack this was measured on

Nothing here is a fixture. `web/scripts/shot.mjs` answers every call from
`scripts/shot-fixtures/*.json` and signs in with a token the API would reject; that
instrument cannot see a contract drift and cannot discharge this criterion. This run used
the real one.

| Piece | What it was |
| --- | --- |
| Postgres | `localhost:5432`, database `climate_project`, the documented local stack |
| API | **built from this worktree at `1ef86b8`** — `dotnet build ClimateProject.slnx --configuration Release` → `Build succeeded. 0 Warning(s) 0 Error(s)`, 16.41s — run on `http://localhost:5081` |
| Web | `VITE_API_BASE_URL=http://localhost:5081 npm run dev -- --port 5173 --strictPort`, Vite 8.2.0 |
| Browser | Chromium via `playwright-core`, 1440×900 |
| Tracking service | **not running.** See "What was NOT exercised" |

**Why port 5081 and not 5080.** A `dotnet run --project src/ClimateProject.Api` process
was already listening on 5080, started **19 Aug 2026** — it predates `a62b772`
(*"feat(dashboard): the team's own climate, floored"*, 27 Aug), which is the backend half
of the `leader`/`supervisor` team-climate surface #409 added. Driving the UI against it
would have photographed a dashboard the current code does not produce. A second instance
built from this worktree answers the question the criterion actually asks.

**One migration behind.** `__EFMigrationsHistory` in the local database tops out at
`20260826020342_AddQuestionBankProvenance`; `1ef86b8` carries one more,
`20260826192030_AddReportShares`. No route reachable by a non-admin role touches
`report_shares`, and no migration was applied by this run — the database was left as it
was found. This is why only the three non-admin roles were driven and the two
administrator roles were not.

## 1. All five accounts authenticate

Real `POST /auth/login` against the real API — email and password, no planted token:

```
super_admin   200
company_admin 200
leader        200
supervisor    200
employee      200
```

## 2. The whole non-admin nav, walked

`node scripts/e2e.mjs --api http://localhost:5081 --server http://localhost:5173 --roles leader,supervisor,employee`

```
e2e: 58 routes in router.tsx, 58 covered
e2e: no tracking service at http://localhost:5091 — its routes are NOT exercised, not failed.

e2e: leader — 7 reachable routes (company 22cc8ed9-2e02-401a-8d52-52068ff5e6c0)
e2e: supervisor — 7 reachable routes (company 22cc8ed9-2e02-401a-8d52-52068ff5e6c0)
e2e: employee — 7 reachable routes (company 22cc8ed9-2e02-401a-8d52-52068ff5e6c0)

e2e: 21 route visits — 21 pass, 0 warn, 0 broken, 0 skipped
e2e: broken means a visible error state, a console error, or a page that would not load.

e2e: NOT EXERCISED — no tracking service at http://localhost:5091 (6 role/route pairs):
e2e:   /tracking/mis-tareas  <- leader, supervisor, employee
e2e:   /tracking/planes  <- leader
e2e:   /tracking/planes/:id  <- leader
e2e:   /tracking/tablero  <- leader
```

`broken` is the app's own verdict, not an HTTP status: a `[data-slot="error-state"]`
carrying `role="alert"`, a console error, or a page that would not load. **Zero of them,
and zero 4xx of any kind**, across 21 visits.

Every call that crossed the wire, from `.e2e/journal.jsonl` (duplicate lines are React's
double-invoked effects in dev):

```
leader      /dashboard                    200 GET /notifications/mine | 200 GET /dashboard/department-admin
leader      /notifications                200 GET /notifications/mine
leader      /profile                      200 GET /profile | 200 GET /profile/activity | 200 GET /profile/preferences | 200 GET /notifications/mine
leader      /settings/notifications       200 GET /notifications/preferences | 200 GET /notifications/mine
leader      /settings/privacy             200 GET /notifications/mine
leader      /surveys/{id}/respond         200 GET /surveys/{id}/respond
leader      /surveys/my                   200 GET /surveys/my | 200 GET /notifications/mine
supervisor  /dashboard                    200 GET /notifications/mine | 200 GET /dashboard/department-admin
supervisor  /notifications                200 GET /notifications/mine
supervisor  /profile                      200 GET /profile | 200 GET /profile/activity | 200 GET /profile/preferences | 200 GET /notifications/mine
supervisor  /settings/notifications       200 GET /notifications/preferences | 200 GET /notifications/mine
supervisor  /settings/privacy             200 GET /notifications/mine
supervisor  /surveys/{id}/respond         200 GET /surveys/{id}/respond
supervisor  /surveys/my                   200 GET /surveys/my | 200 GET /notifications/mine
employee    /dashboard                    200 GET /notifications/mine | 200 GET /dashboard/employee | 200 GET /dashboard/employee/last-outcome
employee    /notifications                200 GET /notifications/mine
employee    /profile                      200 GET /profile | 200 GET /profile/activity | 200 GET /profile/preferences | 200 GET /notifications/mine
employee    /settings/notifications       200 GET /notifications/preferences | 200 GET /notifications/mine
employee    /settings/privacy             200 GET /notifications/mine
employee    /surveys/{id}/respond         200 GET /surveys/{id}/respond
employee    /surveys/my                   200 GET /surveys/my | 200 GET /notifications/mine
```

The role dispatch `DashboardPage` promises is visible in the wire log rather than inferred
from the source: `leader` and `supervisor` fetch `/dashboard/department-admin`, `employee`
fetches `/dashboard/employee` **and** `/dashboard/employee/last-outcome`. Nobody's
dashboard called anybody else's.

## 3. A real form login, and where it lands

Not a planted token: `/login` opened with an empty session, the address and password typed
into the form, the submit button clicked, and the app followed wherever it went. Run twice
per role, once with `preferredLocale=en` and once with `es`, which is the fifth acceptance
criterion measured on the same pass.

| Role | Locale | Landed on | `<h1>`/`<h2>`/`<h3>` on that screen | Sidebar |
| --- | --- | --- | --- | --- |
| leader | en | `/dashboard` | Dashboard · Your team's climate · Current Ongoing Surveys | Dashboard · My Surveys · Notifications |
| leader | es | `/dashboard` | Panel de Control · El clima de tu equipo · Encuestas Actuales en Curso | Panel de Control · Mis Encuestas · Notificaciones |
| supervisor | en | `/dashboard` | Dashboard · Your team's climate · Current Ongoing Surveys | Dashboard · My Surveys · Notifications |
| supervisor | es | `/dashboard` | Panel de Control · El clima de tu equipo · Encuestas Actuales en Curso | Panel de Control · Mis Encuestas · Notificaciones |
| employee | en | `/dashboard` | Good evening, Fede employee · Q4 Climate Survey (open) · What came of the last one | Dashboard · My Surveys · Notifications |
| employee | es | `/dashboard` | Buenas noches, Fede employee · Encuesta de Clima Q4 (abierta) · Qué pasó con la anterior | Panel de Control · Mis Encuestas · Notificaciones |

Three things this settles that the wire log alone could not:

- **The nav is non-empty and it is exactly three rows** — `/dashboard`, `/surveys/my`,
  `/notifications` — for all three roles, in both languages. Every one of those three was
  loaded in §2 and answered 200. No dead link, no 403 link.
- **`resolveInitialRoute` puts every role somewhere it can load.** All six sign-ins ended
  on `/dashboard` with content, not on a list page and not on an error.
- **#409's team surface is really there.** *"Your team's climate" / "El clima de tu
  equipo"* renders for `leader` and `supervisor`, and does not render for `employee`,
  whose screen is the personal one.

Both locales were captured from the same run, so the Spanish column is a rendered screen
and not a key lookup in `es.json`.

## 4. The other direction — an admin route a non-admin is not offered

Typed into the address bar rather than clicked, because no nav row offers it. Same signed-in
session, immediately after the landing above:

| Role | Navigated to | Result |
| --- | --- | --- |
| leader / supervisor / employee | `/admin/companies` | stays on `/admin/companies`; heading **Companies** / **Empresas**; one `role="alert"` reading **`Request failed: 403`**; sidebar still the three non-admin rows |

**This is not an acceptance-criteria failure and it is worth writing down.** The criterion
is "a non-empty nav with no dead or 403 links", and the nav has no such link — this route
is reachable only by typing it. The server is the real gate and it held — every request the
page made came back 403, and the only heading on it was the page's own title. But
`RequireAuth` checks a token and the
`isActive` claim and **no role**, and `app/router.tsx` registers no role guard, so the
admin shell mounts, the page renders its chrome, and the user is shown the string
`Request failed: 403`.

Two consequences, both for a follow-up rather than for this issue:

1. a non-admin who follows a stale bookmark or a link pasted by a colleague gets a raw
   error rather than "this page is not for your account";
2. this is the same shape as the finding recorded in *"A test can defend the bug"* — the
   user-visible text is the transport's message, not the product's.

## What was NOT exercised

Written out rather than left silent, because a run that quietly drops routes reads as a run
that covered them.

| Not exercised | Why | What would close it |
| --- | --- | --- |
| `/tracking/tablero`, `/tracking/planes`, `/tracking/planes/:id` (leader), `/tracking/mis-tareas` (all three) | `services/tracking-api` was not running, and `web/.env.example` ships `VITE_TRACKING_API_BASE_URL` **commented out on purpose**, so the module is off in the default local stack and those screens are in nobody's sidebar. Starting the service needs the `TrackingJwtSecret` dev secret, which this run could not read. | the command below |
| `GET /gdpr/access` | `/settings/privacy` loaded for all three roles and rendered its title plus the four erasure-scope sections ("Deleted outright", "Kept, with the link to you severed", "Kept, with your details overwritten", "What erasure does not remove") — but the only call it made was `GET /notifications/mine`, because `DataAccessPanel` fires the request from a **button** (`onClick={onRequest}`), not on mount. The page was verified; that endpoint was not called. | click the data-request button on `/settings/privacy` as any role |
| The post-invitation-accept landing | `resolvePostAcceptRoute` delegates to `resolveInitialRoute` for all three non-admin roles, and both are covered by the Vitest suite — but no invitation was minted and accepted in a browser during this run. The third acceptance criterion is therefore **half** measured: "after login" yes, "after invitation accept" no. | mint an invitation as a company_admin, open `/accept-invitation/{token}` in a fresh session, complete it, record where it lands |
| `super_admin`, `company_admin` | out of #138's scope, and the local database is one migration short of `1ef86b8` (`AddReportShares`), which their surface reaches and the non-admin surface does not | apply the migration, then drop `--roles` |

### The exact command for the tracking half

A human with the dev secret can close the first row. From the repo root, with Postgres up:

```bash
# 1. the tracking service, on the port the harness expects
dotnet user-secrets set TrackingJwtSecret "<the SAME value as src/ClimateProject.Api>" \
  --project services/tracking-api/src/ClimateTracking.Api
ASPNETCORE_URLS=http://localhost:5091 \
  dotnet run --project services/tracking-api/src/ClimateTracking.Api

# 2. the dev server, with the module switched ON (it is off by default, and turning it on
#    REPLACES the Action Plans nav row — see web/.env.example)
cd web && VITE_API_BASE_URL=http://localhost:5081 \
  VITE_TRACKING_API_BASE_URL=http://localhost:5091 \
  npm run dev -- --port 5173 --strictPort

# 3. re-run, and expect 27 visits instead of 21 with an empty NOT EXERCISED block
node scripts/e2e.mjs --api http://localhost:5081 --server http://localhost:5173 \
  --roles leader,supervisor,employee
```

The port is not negotiable: the API allows exactly one origin in Development,
`http://localhost:5173`.

## Reproducing this run

```bash
dotnet build ClimateProject.slnx --configuration Release
ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5081 \
  dotnet src/ClimateProject.Api/bin/Release/net10.0/ClimateProject.Api.dll

cd web && npm ci
VITE_API_BASE_URL=http://localhost:5081 npm run dev -- --port 5173 --strictPort

node scripts/e2e.mjs --api http://localhost:5081 --server http://localhost:5173 \
  --roles leader,supervisor,employee
```

The five local accounts are `fede.{super,admin,leader,supervisor,employee}@acme.test`;
`scripts/e2e.mjs` holds the mapping and the dev password default.

## Two harness defects this run had to fix first

Both are in `web/scripts/e2e.mjs` and both were blocking the evidence, not cosmetic.

1. **The harness could not start at all.** `deriveMatrix` is deliberately fatal on a router
   path that no coverage table names, and PR #406 (`a9bf184`) added
   `/microclimate-invitations/:token` to `router.tsx` without adding it anywhere. From that
   merge onward every `e2e.mjs` run exited 2 before launching a browser — for every role,
   not just these three. It is an anonymous route (the API group takes no `ClaimsPrincipal`;
   the token in the path is the credential) and is now listed as one.
2. **The employee's one job reported SKIP.** `discoverIds` looked for a survey id through
   `GET /surveys`, which is `Roles.Admin`. All three non-admin roles are 403'd by it, so
   `/surveys/:id/respond` — the single thing this product asks an employee to do — reported
   `SKIP: no id available` on every run, which reads as "there is no survey" and was really
   the harness asking the administrator's question. It now falls back to `GET /surveys/my`,
   the caller's own list, and the route drives.

A third change is a judgement call rather than a defect: the harness drove
`reachableRoutes(role, true)` unconditionally, so on any stack without a tracking service it
reported five tracking routes as **BROKEN** when the app was correctly rendering *"no se
pudo contactar el servicio de seguimiento"* for a service that is not there. That is exactly
the false-positive report the file's own `WHAT COUNTS AS BROKEN` note was written against.
The drive list now follows a probe of the tracking origin, the coverage matrix still demands
the full route set, and anything dropped is printed under `NOT EXERCISED`. Verified in both
directions: pointing `--tracking` at an origin that answers `/health` puts the employee's
route count back to 8 and drives `/tracking/mis-tareas` again.
