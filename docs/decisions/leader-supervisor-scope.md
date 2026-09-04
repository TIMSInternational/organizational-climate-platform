# Decision needed: what are `leader` and `supervisor`?

Written 2026-08-17 against main `cd4ced9`, from a code walk of every guard and every
role-conditional render. This is the product decision the redesign has been waiting on.
Nothing here is an engineering judgement call — `docs/requirements/README.md:18-21` says
dropping requirements needs the client's sign-off, and most of the PRD's leader/supervisor
matrix is currently dropped in fact if not on paper.

## The facts

**What ships for these roles today** (both roles, identically):

- Three nav rows: Dashboard, My surveys, Notifications. The Cmd+K palette offers the same
  three. Every admin surface — surveys list, results, action plans, microclimates,
  analytics, reports, departments, users — is guarded to `super_admin`/`company_admin`
  and 403s them (nine near-identical guards; three carry comments naming the exclusion
  as deliberate).
- One real capability: `GET /dashboard/department-admin` — a department overview of
  COUNTS (responses per 100, team size, active surveys, open/overdue action plans).
  No scores, per the payload's own design: the department payload carries no dimension
  data at all.
- The full respondent path (answer surveys, notifications, profile), same as employee.

**The one broken affordance:** the department dashboard renders an "overdue action plans"
alert whose button links to `/action-plans` — a page whose API call 403s a leader. They
can be told there are 3 overdue plans and cannot open, create, or update any of them
(`DepartmentAdminDashboardView.tsx:163` vs `ActionPlanEndpoints.cs:49-52`).

**Leader ≡ supervisor in code.** One call site in the whole API names either role
(`DashboardEndpoints.cs:276-282`), and it treats them as one ("both run a department, so
both land here"). No client component distinguishes them. `labels.ts` orders them as
distinct rungs "in ascending order of reach" and nothing honours it.

**What the binding documents say** (they disagree with the code and with each other):

- `TECH_SPEC.md:19-29`: FOUR roles, one "Department Admin — manage evaluations and
  insights only for their department".
- `General_Structure.md:45-54`: FIVE roles, and the only doc distinguishing the two —
  "Area Leader: views team reports and manages action plans. Supervisor: tracks assigned
  tasks and KPIs."
- The PRD Access Control Matrix (`ORGANIZATIONAL_CLIMATE_PLATFORM_PRD.md:229-262`) gives
  Department Admin: department-scoped survey creation, question library, department
  analytics, action-plan create/assign, microclimate launch/moderate; Supervisor:
  pulse-only creation, own-team analytics, action-plan execution. Of ~20 matrix
  capabilities, ONE ships (the counts dashboard).

**The prerequisite policy question — suppression on the leader surface.** The department
dashboard prints response counts with NO anonymity floor applied — flagged in the code
itself as "a policy call rather than a redesign one" (`DepartmentAdminDashboardView.tsx:55-60`).
A leader of a 2-person team sees "2 responses". Everywhere else the floor is 5, enforced
three times server-side. Any widening of leader analytics must settle this first, because
the department view is the one place the audience is small BY CONSTRUCTION. The safe
default: apply the same floor of 5 to any leader-facing number that could expose an
individual's participation, and say so on the screen the way the results page does.

## The three positions (pick one)

**Option 1 — Collapse to one role ("department lead").** Honest about what the code
already is. Migration: keep both strings as aliases, one experience. Costs a client
sign-off (General_Structure separates them). Cheapest; removes standing confusion.

**Option 2 — Build the leader tier properly (recommended shape if the client still wants
the matrix).** Sequenced by leverage:
  1. Fix the broken affordance: department-scoped action plans (list/open/progress-update
     for plans targeting their department). The counts and the link already exist; this
     is one guard + one filter away. Supervisor gets execution-only (progress updates),
     leader gets create/assign — the one distinction General_Structure actually names.
  2. Department-scoped results: a projection over the existing `SurveyAggregation`
     (already suppression-correct, already the single source) filtered to their
     department's segment, floor-of-5 applied, protected rows drawn as protected.
  3. Only then the authoring surfaces (pulse creation, microclimates) — each is a full
     design round of its own.
  Suppression decision above is a hard prerequisite for step 2.

**Option 3 — Scope-reduce explicitly.** Write against the PRD matrix which rows are
dropped, get the client's signature, and delete the leader/supervisor rows from the
invitation RoleSelector so the product stops minting roles that lead nowhere.

## What I need from Federico

1. Which option (or which hybrid).
2. If option 2: confirm the floor-of-5 applies to leader-facing counts (the safe default),
   or explicitly accept the current "leader sees raw counts for their own team" behavior.
3. If option 1 or 3: whether to remove the second role from RoleSelector now.

---

## Measured 2026-09-03

Appended, not edited: everything above stands as written. This block records route counts
measured at `835bcee` and decides nothing.

**In production, `leader` and `supervisor` reach exactly the same seven routes.**

| Role | Reachable routes in production (tracking off) | With tracking on |
|---|---|---|
| `super_admin` | 36 | 40 |
| `company_admin` | 33 | 37 |
| `leader` | **7** | 11 |
| `supervisor` | **7** | 8 |
| `employee` | 7 | 8 |

Derivation, from `web/src/navigation/roleCapabilities.ts`: the group sizes are
`SELF_SERVICE` 7 (none tracking-gated), `SUPER_ADMIN_ONLY` 3, `COMPANY_SCOPED` 5,
`ADMIN_SHARED` 22 (1 tracking-gated), `TRACKING_PLANS` 2 (both gated), `TRACKING_TASKS` 1
(gated). `supervisor` is declared as `[...SELF_SERVICE, TRACKING_TASKS]`
(`roleCapabilities.ts:532`); `leader` is `SELF_SERVICE` plus `/tracking/tablero` plus
`TRACKING_PLANS` plus `TRACKING_TASKS` (`:518-530`) — and every route that separates the two
carries `requiresTracking: true`. `reachableRoutes(role, trackingEnabled = false)` filters
those out (`:543-556`, the filter at `:556`), and `isTrackingEnabled()` is false whenever
`VITE_TRACKING_API_BASE_URL` is blank (`web/src/features/tracking/api/config.ts:55-57`),
which it is in production. So the one route that distinguishes a leader from a supervisor
belongs to a module whose service has never been deployed.

Both roles land on the same component. `web/src/features/dashboard/components/DepartmentAdminDashboardView.tsx:65`
states it in the file's own header: *"`leader` and `supervisor` both land here. This repo has
no `department_admin` role; those two are its department-scoped roles, and both run a
team."*

`docs/runbooks/uat-script.md:486` (§8.1) already records the consequence for testing — a leader's
rail looks identical to a supervisor's, and the script calls that expected today.

**No decision is taken here.** The three options above and the three questions under "What I
need from Federico" are unchanged and still open.

**Related:** `docs/audits/2026-09-03-functional-gaps.md` §1 and §9 item 13.
