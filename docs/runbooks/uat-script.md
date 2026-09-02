# UAT script — organizational climate platform

**Issue #161, "User acceptance testing with real users before cutover."**

The real users are not available yet. This is the script they will follow, so that UAT starts
the day the client is ready rather than the day someone writes a script.

**Status: NOT EXECUTED.** Nothing below has been walked against a running system by the author.
Every route, endpoint, floor and expectation was read out of the source tree at `main` `b371a9d`
(2026-09-02) and is cited with a file and a line so a tester can check the claim before trusting
the step. Where a claim comes from a document rather than from code it says so, and one such
document was found to be stale — see §9.

**Method rule for whoever runs this.** A step has three outcomes: **pass**, **fail**, and
**blocked**. "Blocked" is not a soft fail — it means the data or the provisioning the step needs
does not exist yet, and it points at §2 or §8, not at a defect report. The repository's standing
rule applies to the tester too: *state the measurement, not the inference.* Write down the screen
you were on, the exact text you saw, and the HTTP status if you looked, not your reading of it.

---

## 1. Scope, in one paragraph

Five roles (`super_admin`, `company_admin`, `leader`, `supervisor`, `employee` —
`web/src/navigation/roleCapabilities.ts:75-81`, checked against the backend's own `Roles.All` by
`roleCapabilities.test.ts`), one climate-survey lifecycle end to end, one microclimate lifecycle,
the invitation loop, **both** public link surfaces — the survey share link `/s/{token}` (§6.5)
and the public report link `/shared/reports/{token}` (§6.4) — and the two languages. It does
**not** cover the tracking module, the question library, or anything on staging: §8 says why for
each, and §8.6 names two microclimate routes that exist on the API and have no screen at all.

---

## 2. Setup before UAT

### 2.1 Accounts

Five seeded role accounts already exist in production, one per role. They are named in the
project's deployment note and their password is not printed here or anywhere in this repository.
Get them from Federico. All five were confirmed to log in on 2026-09-02, and an `employee` was
confirmed to receive `403` on admin routes.

**Use real client users for the real UAT.** The seeded accounts are for the dry run: they let a
tester walk every screen before the client's people are in the room, and they are the accounts
§3's login step is written against. A client user is created only by invitation — see §6.1, and
`UsersListPage.tsx:181` ("invitation is the only way a person enters a company here").

### 2.2 The data that must exist, or nothing below is walkable

| # | What must exist | Why, and what happens without it |
|---|---|---|
| 1 | A company (tenant) with **departments** | `/departments` (`router.tsx:333`); a survey's audience step targets departments, and the department breakdown is where the anonymity floor is exercised |
| 2 | **At least 5 users per department** you intend to read results for | The floor. See §2.3 |
| 3 | One survey in `draft` that can be published | Statuses are `draft` / `scheduled` / `active` / `closed` / `archived` (`SurveyStatuses.cs:20-32`); `/surveys/:id/results` is only interesting once responses exist |
| 4 | **At least 5 completed responses** on that survey, and at least 5 within any one department you want a breakdown for | Two different floors, both 5. See §2.3 |
| 5 | One microclimate that can be activated | `POST /microclimates/{id}/activate` (`MicroclimateEndpoints.cs:85`) |
| 6 | A verified mailbox the tester can actually open | The invitation flow (§6.1) is only testable if someone can read the mail |

Users can be created in bulk through `POST /admin/users/bulk-import`
(`BulkImportEndpoints.cs:19`). **A bulk import creates invitations, not accounts.** The
non-preview branch constructs a `UserInvitation` — `InvitationType = employee_direct`,
`Status = pending`, a fresh `InvitationToken`, an expiry of `now + InvitationLifetime` — adds it
to `db.UserInvitations` and reports the row as `"invited"`. There is no `new User` and no
password of any kind anywhere in that path (`BulkImportEndpoints.cs:180-197`). The uploaded
`Name` is deliberately not carried, because the accept flow asks the person for their own name
and password (`BulkImportEndpoints.cs:174-179`; the requirement itself is
`InvitationAcceptEndpoints.cs:53-56`).

> **So "an imported person cannot log in yet" is the design, not a defect.** They enter through
> §6.1's invitation/accept flow, and their invitation expires after **7 days**
> (`InvitationEndpoints.cs:14`, `InvitationLifetime = TimeSpan.FromDays(7)`).
>
> An earlier version of this branch did write a `User` whose `PasswordHash` was a hashed
> throwaway GUID — active, addressable, and impossible for anybody including its owner to sign
> in to. **That defect is fixed.** The comment describing it *in the past tense* is still in the
> file at `BulkImportEndpoints.cs:167-172`, and reading that comment as current behaviour is the
> trap this paragraph exists to close.

### 2.3 The anonymity floor, and why a small test tenant makes every result screen look broken

There are three floors, all in `src/ClimateProject.Application/Surveys/SurveyResultsPrivacy.cs`:

| Floor | Value | Line | What it governs |
|---|---|---|---|
| `MinimumRespondents` | **5** | `SurveyResultsPrivacy.cs:61` | The survey as a whole. Below it, **no** per-question result is computed at all |
| `MinimumSegmentRespondents` | **5** | `SurveyResultsPrivacy.cs:75` | One department or demographic segment. Bound to `DemographicSnapshotPrivacy.MinimumGroupSize = 5` (`DemographicSnapshotPrivacy.cs:54`) rather than restating the literal |
| `MinimumWordRespondents` | **2** | `SurveyResultsPrivacy.cs:78` | A word in a free-text word cloud — a lower floor on purpose, because 5 empties the cloud at the sizes this product runs at |

Proven by `tests/ClimateProject.UnitTests/Surveys/SurveyResultsPrivacyTests.cs`:
`The_survey_floor_admits_exactly_five_and_above` (line 30),
`The_segment_floor_admits_exactly_five_and_above` (line 39),
`The_word_floor_admits_two_and_above` (line 53), and
`The_segment_floor_is_bound_to_the_demographic_snapshot_floor` (line 19).

> **Consequence for UAT, and the single most likely false defect report in this whole
> document.** A test tenant with 3 respondents will show *withheld* on every result screen, every
> breakdown and the leader's team climate grid. That is the product working. Seed **5 or more
> completed responses per segment you intend to look at**, or every §5 and §6 result step will
> "fail" for the right reason.
>
> Participation counters are still shown below the floor, deliberately — "a count of responses
> identifies nobody" (`SurveyResultsPrivacy.cs` summary; the UI sentence is
> `surveyResults.suppressedParticipationStillShown`).

### 2.4 Environment

| Thing | Value | How known |
|---|---|---|
| Web app | `https://climate.timsint.com` | Orchestrator-verified 200 on 2026-09-02 |
| API | `https://bhgrdkd4gt.us-east-1.awsapprunner.com`, commit `b371a9d`, built `2026-09-02T18:04:34Z` | `/health` 200, `/version`, verified 2026-09-02 |
| Legacy app (still answering) | `https://organizational-climate-platform.vercel.app` | Verified 200. **Do not run UAT here** — §8.4 |
| Outbound mail | SES SMTP, `no-reply@timsint.com`, links built from `https://climate.timsint.com` | `infra/aws/climate-project-api-prod-service.yml:265-294` |

---

## 3. Every role does these three steps first

Run §3 for each of the five roles before running that role's own journey. They are the steps
that fail for everybody at once if something is wrong with the deployment.

### 3.1 Log in

| | |
|---|---|
| **Page** | `/login` (`router.tsx:201`) |
| **Action** | Enter the account's email and password, submit |
| **Endpoint** | `POST /auth/login` (`AuthEndpoints.cs:36`), rate-limited |
| **Expect** | Signed in, and redirected off `/login` |
| **Failure looks like** | Staying on `/login` with an error; a spinner that never resolves; landing on `/auth/error` (`router.tsx:215`) or `/auth/inactive` (`router.tsx:216`) — the second means the account is disabled, not that login is broken |

### 3.2 The landing page

| | |
|---|---|
| **Page** | `/dashboard` (`router.tsx:310`) |
| **Action** | None — observe where login put you. Then open `https://climate.timsint.com/` directly and observe again |
| **Expect** | **`/dashboard`, for every one of the five roles.** `resolveInitialRoute()` returns `/dashboard` unconditionally (`resolveInitialRoute.ts:36`), and the bare `/` route redirects through the same function (`router.tsx:200`, `HomeRedirect`) |
| **And then** | `DashboardPage` dispatches on the role claim and, for one role, on the tenant switcher (`DashboardPage.tsx:51-72`): `company_admin` → CompanyAdmin view (`:62-65`), `leader` **and** `supervisor` → the same DepartmentAdmin (team) view (`:67-69`), `employee` **and any unrecognised role** → the Employee view (`:71`). For `super_admin` read the note below before recording anything. Four endpoints, one per view: `GET /dashboard/super-admin`, `/company-admin`, `/department-admin`, `/employee` (`DashboardEndpoints.cs:97-100`) |
| **Failure looks like** | A 403 or "Request failed" banner on the dashboard itself; a `leader` seeing the employee view; landing anywhere other than `/dashboard` |

> **A `super_admin` has two dashboards on one route, and both are correct.** With **no tenant
> selected** they get the platform-wide SuperAdmin view; **once they pick a company in the header
> switcher**, the same `/dashboard` renders the CompanyAdmin view for *that* tenant, with an
> explicit `companyId` — `scope.status === 'ready' && scope.companyId` chooses
> `CompanyAdminDashboardView`, otherwise `SuperAdminDashboardView`
> (`DashboardPage.tsx:54-60`). `useCompanyScope` reports `needs-selection` rather than guessing a
> tenant (`useCompanyScope.ts:28-30`).
>
> **This is the most likely false defect in §3.** The ordinary UAT session is "log in as the
> operator, pick the client's tenant, look at the dashboard" — and that shows the *company*
> dashboard, on purpose. To see the platform view, clear the switcher first. What **would** be a
> defect: a `company_admin`'s switcher selection changing what they see. Their claim is used
> instead and this branch cannot widen anything (`DashboardPage.tsx:47-49`, `:62-65`).

> A `super_admin` whose token carries no `companyId` is a **global** admin (#191). Their
> dashboard offers a tenant switcher and their `/surveys/my` is legitimately empty
> (`roleCapabilities.ts:490-497`). Empty is not a failure for that role.

### 3.3 Switch language (do this once per role, on that role's busiest screen)

| | |
|---|---|
| **Page** | Any authenticated screen — the switcher is in the shell (`ShellControls.tsx:178`, used by `AdminLayout.tsx:243`), on the login/auth screens (`AuthShell.tsx:118,205`), and on the respondent shell (`RespondShell.tsx:107`) |
| **Action** | Switch English → Español, look at the page, switch back |
| **Expect** | Every visible label changes language; **no key-looking strings** (`navigation.dashboard`, `surveys.results`) and no blank labels. The choice is remembered across a reload — it is stored under `preferredLocale` (`locale.ts:22`) |
| **Evidence the parity exists** | `web/src/i18n/en.json` and `web/src/i18n/es.json` each contain **2,795 leaf keys** (counted 2026-09-02 by walking both trees). `keysExist.test.ts`, `catalogues.test.ts` and `noHardcodedStrings.test.ts` are the suite's guards |
| **Failure looks like** | A raw dotted key on screen; an English sentence surviving in Spanish; the choice not surviving a reload; a page that renders in one language and 404s/errors in the other |

> On first visit with no stored choice, the app follows the **browser's** language and falls back
> to English (`locale.ts:36-51`). A Spanish-speaking client user on a Spanish browser should land
> in Spanish without touching the switcher — worth confirming once, on a fresh profile.

---

## 4. Per-role journeys

Each step gives the **page**, the **action**, the **expected result in plain language**, and
**what a failure looks like**. Every route named here was read out of `web/src/app/router.tsx` at
the cited line. Every endpoint named here was read out of `src/ClimateProject.Api/Endpoints/`.

### 4.1 `super_admin`

The platform operator. Nobody at the client holds this role; TIMS does. Walk it first — it is
the role that sets up everything the other four journeys need.

| # | Page (route) | Action | Expect | Failure looks like |
|---|---|---|---|---|
| 1 | §3.1–3.3 | — | — | — |
| 2 | `/dashboard` (`router.tsx:310`) | Read the sidebar | Sections **Administration** (Dashboard, System administration → Companies, System settings), **Workspace** (Benchmarks, Action plans, Microclimates, AI insights, Surveys, Survey templates, Climate trends, Departments, System health, Question bank), **Communication** (Notifications) — `navSections.ts:337-420` | A row that 403s when clicked. Every row in this rail is asserted against `roleCapabilities.ts` by `roleCapabilities.test.ts`, so a 403 here is a real defect |
| 3 | `/admin/companies` (`router.tsx:311`) | Open the tenant list | The client's company is listed. `GET /admin/companies` is **super_admin only** (`CompanyEndpoints.ListAsync`) | 403 — means the role claim is wrong, not that the page is broken |
| 4 | `/admin/companies/:id` (`router.tsx:312`) | Open the client company | Company settings load; links onward to Users, Demographic fields, Reports, Analytics | A dead link, or a child page that 403s |
| 5 | `/admin/companies/:companyId/users` (`router.tsx:313`) | Read the roster and the invitations list | Both render. `GET /admin/users?companyId=` and `GET /admin/invitations?companyId=` (`InvitationEndpoints.cs:23`) | Either list empty **and** erroring — an empty roster on a fresh tenant is correct |
| 6 | `/departments` (`router.tsx:333`) | Confirm the client's departments exist | The list matches the org chart the client gave us | Missing departments — a §2.2 blocker, not a defect |
| 7 | `/admin/system` (`router.tsx:318`) | Open System health | Status renders. `GET /admin/system/status`, super_admin only (`roleCapabilities.ts:432-437`) | 403, or a page that says the API is unreachable |
| 8 | `/admin/system-settings` (`router.tsx:317`) | Open, read, do not change | Settings render read-only to the eye | — |
| 9 | `/analytics/benchmarks` (`router.tsx:408`) | Open Benchmarks | For this role the page is genuinely cross-company: `GET /admin/benchmarks` returns every tenant's plus the global rows (`navSections.ts:352-357`) | A single company's numbers presented as the platform's |
| 10 | `/admin/question-bank` (`router.tsx:329`) | Open the question **bank** | Loads, scoped to global + every tenant for this role (`roleCapabilities.ts:317-322`) | Confusing this with the question **library**, which has no production UI — §8.2 |
| 11 | Hand off | — | Everything §4.2 needs now exists | — |

### 4.2 `company_admin`

The client's own administrator. **This is the role the client will spend UAT in.**

| # | Page (route) | Action | Expect | Failure looks like |
|---|---|---|---|---|
| 1 | §3.1–3.3 | — | — | — |
| 2 | `/dashboard` (`router.tsx:310`) | Read the sidebar | **Administration** (Dashboard, Company administration → Company settings, Users, Demographic fields), **Workspace** (Action plans, Microclimates, Surveys, Survey templates, Climate trends, Benchmarks, AI insights, Reports, Analytics, Departments, Question bank), **Communication** (Notifications) — `navSections.ts:428-505` | A row that 403s |
| 3 | `/admin/companies/:companyId/users` (`router.tsx:313`) | Read the roster | Only **their own** company's users. `UserEndpoints.CanAccessCompany` (`roleCapabilities.ts:452-457`) | Another tenant's users appearing — stop UAT and report immediately |
| 4 | `/admin/companies/:companyId/demographic-fields` (`router.tsx:314`) | Read the demographic fields | The fields that will become result breakdowns | — |
| 5 | `/surveys` (`router.tsx:349`) | Open the survey list | Only their own company's surveys — `ListAsync` overwrites the scope with their own company for this role (`roleCapabilities.ts:272-275`) | Another tenant's survey in the list |
| 6 | §6 survey lifecycle | Run **all of §6.2** | — | — |
| 7 | `/surveys/climate-trends` (`router.tsx:371`) | Open Climate trends | Company-level trend across surveys. `GET /surveys/climate-trends`, admin-only, scoped to their own company (`roleCapabilities.ts:327-331`) | 403; or trends over a company that is not theirs |
| 8 | `/analytics/ai-insights` (`router.tsx:409`) | Open AI insights | Renders for their own company — this endpoint **requires** a company id (`roleCapabilities.ts:391`) | A "no company" state for a role that always has one |
| 9 | `/admin/companies/:companyId/reports` (`router.tsx:315`) | Create a report, then download it | An alert states plainly that **report rendering is not built**: "Creating a report records it and marks it complete, and downloading records the request — no file is produced" (`ReportsListPage.tsx:143`, key `reports.generationStubbed`) | A tester filing "download does nothing" as a defect. It is disclosed on the page. **No file is expected** |
| 10 | `/admin/companies/:companyId/analytics` (`router.tsx:316`) | Open Analytics. It is a nav row for this role (`navSections.ts:498-502`), so it must not be skipped | Two **independent** sections: **benchmarks** (`GET /admin/benchmarks`) and **AI insights** (`GET /admin/ai-insights?companyId=` — `AIInsightEndpoints.cs:35-40`, registered at `Program.cs:654`). They are fetched separately so that one failing does not blank the other (`AnalyticsDashboardPage.tsx:44-51`). Company comes from the **URL**, never from the viewer's JWT (`AnalyticsDashboardPage.tsx:31-33`) | Both sections erroring together — that means the page regressed to a single fetch. **Note for whoever reads the source:** the comment at `AnalyticsDashboardPage.tsx:47` says `/admin/ai-insights` "is not registered in `Program.cs` … so every call 404s today". **That comment is stale** — the group *is* registered (`Program.cs:654`). A 404 from that section today is a defect, not a documented gap |
| 11 | `/action-plans` (`router.tsx:334`) | Open Action plans | Loads. `ActionPlanEndpoints.CanAccessCompany` — super_admin, or company_admin on their own company, **and nobody else** (`roleCapabilities.ts:395-401`) | — |
| 12 | §6 microclimate | Run **all of §6.3** | — | — |

### 4.3 `leader` (the node leader / jefe de nodo)

A leader's reachable surface is **short**, and that shortness is a finding the repo made
deliberately, not an omission — `roleCapabilities.ts:52-62` and `:498-504`. There is exactly
**one** team-scoped read in the whole backend.

> **`GET /dashboard/department-admin` (`DashboardEndpoints.cs:99`) admits four roles, not two.**
> The handler computes `runsADepartment = currentUser.Role is Roles.Leader or Roles.Supervisor`
> and then refuses only when the caller is *also* neither `SuperAdmin` nor `CompanyAdmin`
> (`DashboardEndpoints.cs:278-282`). The two admin roles take the other branch — they must supply
> a `departmentId` query parameter and get that department (`:314-322`) — while a leader or
> supervisor gets their own row's department and may not name another (`:284-313`).
>
> Said here because `roleCapabilities.ts:54-55` describes this route as leader/supervisor-scoped.
> That file is a hand-written capability comment, not the guard. **An admin receiving 200 from
> this route is not a leak and must not be filed as one.** This document's own rule applies to
> this document: a sentence is a hypothesis until the handler is read.

| # | Page (route) | Action | Expect | Failure looks like |
|---|---|---|---|---|
| 1 | §3.1–3.3 | — | — | — |
| 2 | `/dashboard` (`router.tsx:310`) | Read the sidebar | Only **Workspace** (Dashboard, My surveys) and **Communication** (Notifications) — `navSections.ts:545-553`. Tracking rows appear only where the deployment has a tracking service, which production does not — §8.1 | Any admin row (Surveys, Departments, Action plans, Reports) appearing for this role. That is the exact defect `roleCapabilities.ts:13-16` was written about |
| 3 | `/dashboard` | Read the team view | The DepartmentAdmin view renders: their **own** department, resolved from their user row and never from the token, because people move teams (`DashboardEndpoints.cs:293-299`). Naming somebody else's `departmentId` is a **403, not a lookup** (`:306-310`). Read the note above this table before recording a 200 as a leak | Another department's figures; or a 403 on their own team |
| 4 | `/dashboard` | Read the **team climate grid** | Each dimension named, with this team's score — **provided the team has 5+ respondents in a survey that itself has 5+**. `DashboardEndpoints.cs:715-772` | See row 5 before reporting anything |
| 5 | `/dashboard` | Same grid, on a team **below** the floor | The dimension **names** still appear, with the scores hatched/withheld and the floor of 5 stated. This is on purpose: which dimensions were asked is not the protected fact; this team's scores are (`DashboardEndpoints.cs:733-745`) | A **blank row with no columns** — that is the failure the code comments say `ProtectedCell` exists to prevent, and it reads as missing data rather than as withheld data |
| 6 | `/dashboard` | Team below the survey's **own** floor | Everything withheld, including the dimension list — a big team inside a small survey does not satisfy the survey floor (`DashboardEndpoints.cs:725-731`) | — |
| 7 | `/surveys/my` (`router.tsx:362`) | Open My surveys | Surveys assigned to them personally. `GET /surveys/my` resolves their own user row and reads no role claim (`roleCapabilities.ts:188-193`) | — |
| 8 | `/notifications` (`router.tsx:404`) | Open the inbox | `GET /notifications/mine`, scoped to their own user id (`roleCapabilities.ts:156`) | Another user's notifications |
| 9 | `/profile` (`router.tsx:391`), `/settings/notifications` (`:394`), `/settings/privacy` (`:401`) | Open each from the user menu | All three load. Every endpoint behind them resolves the caller from their own token and takes **no user id** (`roleCapabilities.ts:160-178`) | A 403, or a page asking which user |
| 10 | **Negative test** | Type `/surveys` and `/action-plans` into the address bar | **The page loads its own error state, not a blank screen** — the routes are not role-gated in the router (`router.tsx:329` comment); the *server* refuses. `GET /surveys` and `GET /action-plans` are admin-gated (`roleCapabilities.ts:272,397`) | Data appearing. A leader must not be able to list surveys or action plans |
| 11 | **Negative test** | Type `/surveys/<a real survey id>/results` | Refused. `GET /surveys/{id}/results` is `CanAdminister` — "a leader or supervisor following this link gets 403" (`roleCapabilities.ts:286,298`) | Results rendering. This is the boundary that keeps the leader on aggregates only |

### 4.4 `supervisor`

> **Read this before writing any supervisor defect.** A supervisor's reachable list and an
> employee's **differ by nothing at all** (`roleCapabilities.ts:532-533`, and the paragraph at
> `:498-504`). The one thing that distinguishes a supervisor — running a team — has exactly one
> endpoint behind it, and that endpoint is reached at `/dashboard`, which every role already has.
> "Supervisor has no extra pages" is the design, verified, not a gap to file.

| # | Page (route) | Action | Expect | Failure looks like |
|---|---|---|---|---|
| 1 | §3.1–3.3 | — | — | — |
| 2 | `/dashboard` (`router.tsx:310`) | Read the sidebar | Identical to §4.3 row 2: Dashboard, My surveys, Notifications | An admin row |
| 3 | `/dashboard` | Read the team view | The **same** DepartmentAdmin team view a leader gets (`DashboardPage.tsx:67-69`), scoped to their own department | The employee view instead — means the role claim did not arrive |
| 4 | `/dashboard` | Team climate grid, above and below the floor | Exactly as §4.3 rows 4–6 | — |
| 5 | `/surveys/my` (`router.tsx:362`) | Open My surveys | Their own assigned surveys | — |
| 6 | `/notifications`, `/profile`, `/settings/notifications`, `/settings/privacy` | Open each | All load | — |
| 7 | **Negative test** | Type `/surveys`, `/action-plans`, `/departments` | Refused by the server, error state shown | Data appearing |

### 4.5 `employee`

The role most of the client's people hold. This journey is the product for them.

| # | Page (route) | Action | Expect | Failure looks like |
|---|---|---|---|---|
| 1 | §3.1–3.3 | — | — | — |
| 2 | `/dashboard` (`router.tsx:310`) | Read the page | **One question answered: is there anything I have to do?** A prominent task card for the nearest survey and quieter rows beneath it, or — if nothing is waiting — a centred empty state saying so **in words**. There are deliberately no counter tiles (`EmployeeDashboardView.tsx:25-47`) | A grid of zeroes; an empty table with no explanation. Both were deliberately removed |
| 3 | `/dashboard` | Look at the task card | An **"Anonymous" chip** appears when, and only when, the survey is anonymous. There is no "Not anonymous" chip — absence is the signal (`EmployeeDashboardView.tsx:268-294`) | A chip on a non-anonymous survey — that is a broken promise, report it |
| 4 | `/dashboard` | Compare the card list with the count | If more surveys are pending than are listed, the page says so and links to `/surveys/my` — the list is capped at 5 (`EmployeeDashboardView.tsx:53-58`) | A capped list with no hint that anything was left off |
| 5 | `/surveys/my` (`router.tsx:362`) | Open My surveys | Active surveys targeted at their company and department, that they have not completed (`src/ClimateProject.Infrastructure/Persistence/SurveyQueries.cs:64-86`; `SurveyQueries.cs` below always means this file) | A survey from another department appearing |
| 6 | `/surveys/:id/respond` (`router.tsx:303`) | Open a survey from the card | The **respondent shell**, not the admin rail: no sidebar, no company switcher, no notification bell. Language switcher present (`RespondShell.tsx:107`). This route sits outside `AdminLayout` on purpose (`router.tsx:288-302`) | The admin chrome wrapped around a questionnaire — "made the two halves of one flow look like two different products" |
| 7 | `/surveys/:id/respond` | Answer every question and submit | Submission accepted. `POST /surveys/{id}/responses` (`SurveyResponseEndpoints.cs:80`) | A generic "Request failed" with a raw exception; a validation error with no field named |
| 8 | `/surveys/my` | Reload after submitting an **anonymous** survey | **The survey is STILL LISTED.** An anonymous survey stores no user id, so nothing can mark it answered for you — the code says so in as many words: *"the alternative is identifying respondents to an anonymous survey, which is the one thing it promises not to do"* (`SurveyQueries.cs:81-85`) | A tester filing this as "my submission was lost". **It is the anonymity guarantee.** Verify the submission landed by checking the admin's participation counter (§6.2 step 8) instead |
| 9 | `/surveys/my` | Reload after submitting a **non-anonymous** survey | The survey **disappears** from the list — `AssignedTo` excludes surveys with a complete response carrying your user id (`SurveyQueries.cs:85` — the predicate; `:86` is the closing brace) | It stays. That is the real defect this pair of steps separates from row 8 |
| 10 | `/notifications` (`router.tsx:404`) | Open the inbox | Their own notifications; the sidebar badge matches and disappears at zero (`navSections.ts:withUnreadBadge`) | A "0" badge rendered |
| 11 | `/settings/notifications` (`router.tsx:394`) | Change a preference, reload | It persists. `GET/PUT /notifications/preferences`, no user id in the call (`roleCapabilities.ts:169`) | — |
| 12 | `/settings/privacy` (`router.tsx:401`) | Open, request their own data | Self-service GDPR access: `GET /gdpr/access` **with no userId** is the self-service case and needs no role (`roleCapabilities.ts:174-177`) | A page asking which user, or a 403 |
| 13 | `/profile` (`router.tsx:391`) | Edit and save their own name | Saves | — |
| 14 | **Negative test** | Type `/surveys`, `/microclimates`, `/admin/companies`, `/action-plans` | Refused. Confirmed by the orchestrator on 2026-09-02: an employee gets 403 on admin routes | Any admin data appearing |

---

## 5. Common failure signatures (read before filing anything)

| What you saw | What it probably is | Where to check first |
|---|---|---|
| "Withheld" on every result screen | Fewer than 5 respondents | §2.3 |
| An anonymous survey still listed after you answered it | Expected — `SurveyQueries.cs:81-85` | §4.5 row 8 |
| The question picker is empty in the survey wizard | The library has never been imported | §8.2 |
| No tracking rows in any sidebar | No tracking service in production | §8.1 |
| Report downloads produce no file | Rendering is not built, and the page says so | §4.2 row 9 |
| A raw exception message rendered on screen | **A real defect.** This repo has a standing lesson about tests that asserted `err.message` was on screen | File it |
| A 403 answering a *missing parameter* | **A real defect**, and a known recurring class here | File it with the exact request |
| A `super_admin` seeing a company dashboard on `/dashboard` | A tenant is selected in the header switcher. Both views are correct | §3.2 note |
| No insights and no export control on a microclimate screen | Neither was ever built into the web app | §8.6 |
| "There is no export button" on `/microclimates/:id/results` | Correct — the two export routes have no web caller | §8.6, §6.3 row 8 |
| A `/s/<token>` link that lands on an error page | Revoked, regenerated, out of window, or made up — the server will not say which | §6.5 row 6 |
| An imported user who cannot log in | A bulk import writes invitations, not accounts | §2.2 |

---

## 6. Cross-role flows

These are the flows that matter to a climate survey, and they are the reason UAT needs more than
one person in the room at a time. Run them in order.

### 6.1 The invitation loop — admin invites, person receives mail, accepts, lands somewhere they can load

| # | Who | Page / channel | Action | Expect | Failure looks like |
|---|---|---|---|---|---|
| 1 | `company_admin` | `/admin/companies/:companyId/users` (`router.tsx:313`) | Fill the invitation form: email, role, department | The invitation appears in the invitations list with status `sent`. `POST /admin/invitations` (`InvitationEndpoints.cs:20`) | A 400 with no message; the row not appearing |
| 2 | — | — | — | **A company_admin may not invite a `super_admin` or another `company_admin`** — the request is refused (`InvitationEndpoints.cs:80,176`). Try it once, on purpose | The invitation being accepted. That is a privilege-escalation defect; stop and report |
| 3 | Invitee | Their mailbox | Wait for the mail | It arrives from **`no-reply@timsint.com`**, sender name **"TIMS Clima Organizacional"**, over SES SMTP `email-smtp.us-east-1.amazonaws.com:587` with STARTTLS, stamped with the `tims-transactional` configuration set. All six values are in `infra/aws/climate-project-api-prod-service.yml:265-294` | **Nothing arrives.** Check spam first; then check whether the notification was recorded as failed. Before #100's block existed, the service ran with `Email:Provider` defaulting to `none` and every mail was recorded failed — the template comment at `:260-264` records that history |
| 4 | Invitee | The mail | Click the link | It points at **`https://climate.timsint.com/accept-invitation/<token>`**. The origin comes from `Email__AppBaseUrl` (`…prod-service.yml:280-281` — the web origin, **not** the App Runner hostname, "a recipient opens it in a browser"); the path from `InvitationEmailComposer.AcceptPathTemplate = "accept-invitation/{0}"` (`InvitationEmailComposer.cs:36`), which the composer's own comment ties to `router.tsx` | A link to the App Runner hostname, or to the legacy Vercel domain; a link that 404s |
| 5 | Invitee | `/accept-invitation/:token` (`router.tsx:219`) | Set name and password, submit | Account created and signed in. `POST /invitations/{token}/accept` (`InvitationAcceptEndpoints.cs:25`), unauthenticated and rate-limited **per token** (`:22-26`) | An error naming the token; a redirect to `/login` |
| 6 | Invitee | — | Observe where you land | `resolvePostAcceptRoute` (`postAcceptRoute.ts:36-53`): `super_admin` → `/admin/companies`; `company_admin` → `/admin/companies/{companyId}/users`; **`leader`, `supervisor`, `employee` and any unrecognised role → `/dashboard`**, the same page login gives them | A 403 on the landing page. That was the original defect: an unconditional `/admin/companies` 403'd for everyone the endpoint exists to onboard (`postAcceptRoute.ts:6-9`) |
| 7 | Invitee | — | Accept an invitation for a user with **no company at all** | The page shows an inline "your account was created" message and does **not** navigate — `resolvePostAcceptRoute` returns `null` for that one case (`postAcceptRoute.ts:37-39`) | A navigation to a page that then 403s |
| 8 | Invitee | Log out, log back in next day | — | You land on `/dashboard` — the **same** screen as after accepting. One answer to "where does a signed-in person start" (`postAcceptRoute.ts:16-22`) | Two different screens for the same person |
| 9 | `company_admin` | `/admin/companies/:companyId/users` | Resend an invitation | A new mail arrives. `POST /admin/invitations/{id}/resend` (`InvitationEndpoints.cs:22`) | — |
| 10 | `company_admin` | Same page | Create a **shareable link** for a role, and follow it | It accepts an email at accept time; the email format is validated server-side, not just checked for an `@` (`InvitationAcceptEndpoints.cs:14-17`). `POST /admin/invitations/shareable-link` (`InvitationEndpoints.cs:21`) | A malformed email being accepted |
| 11 | Invitee | `/accept-invitation/:token` | Accept the **same** invitation a second time | Refused with **409** and the message "Invitation has already been accepted" (`InvitationAcceptEndpoints.cs:43-46`) | A second account being created; a 500 |
| 12 | Invitee | `/accept-invitation/:token` | Follow an invitation older than its lifetime | Refused with **400**, "Invitation has expired". An invitation lives **7 days** (`InvitationEndpoints.cs:14`); the check is `InvitationAcceptEndpoints.cs:48-51` | An expired token still creating an account. Note the *order*: already-accepted is answered before expiry, so a stale accepted token says "already accepted", not "expired" |
| 13 | Invitee | `/accept-invitation/:token` | Submit with a blank name, then a 5-character password | Both refused with **400** and a message naming what is missing: "Name and password are required" (`:53-56`), "Password must be at least 8 characters long" (`:58-60`) | A generic "Request failed" with nothing named — this repository has a standing lesson about exactly that |

### 6.2 The survey lifecycle — admin creates and publishes, employee responds, results respect the floor, leader sees the team surface, public link shows no words

This is the flow the whole product exists for. It needs a `company_admin`, at least **5**
employees who will actually answer, and a `leader` on one of the targeted departments.

| # | Who | Page (route) | Action | Expect | Failure looks like |
|---|---|---|---|---|---|
| 1 | admin | `/surveys/new` (`router.tsx:353`) | Walk the wizard: **basics → schedule → audience → questions → review** (`SurveyCreatePage.tsx:131-133`) | A step rail that says, for every step, what it still wants — without you having to walk to it and press submit (`SurveyCreatePage.tsx:108-112`) | A step that lets you pass with a missing required field, or blocks with no reason given |
| 2 | admin | Wizard, basics step | Choose the content language, and either a template or "start blank" | Choosing a template **changes which endpoint creates the survey**: `POST /survey-templates/{id}/use` (`SurveyTemplateEndpoints.cs:53`) **instead of** `POST /surveys`, with the **server** copying the questions; the questions step becomes a read-only preview (`SurveyCreatePage.tsx:136-141`). If you are watching the network tab to diagnose a failure at this step, watch `/survey-templates/{id}/use` — **not** `/surveys` | The questions step showing an editor when a template was chosen — it becomes a preview instead. A flattened survey (missing option values, scale bounds, comment prompts) means the template was re-created through `POST /surveys`, which is the exact failure `SurveyCreatePage.tsx:143-150` argues against |
| 3 | admin | Wizard, audience step | Target one or more **departments** | Targeting nothing means **company-wide**; targeting departments means only those (`SurveyQueries.cs:74-79`). Choose deliberately — it decides who sees the survey in step 8 | The department list failing to load. That does **not** block the flow by design (`SurveyCreatePage.tsx:231`), so check whether targeting actually saved |
| 4 | admin | Wizard | Leave the browser mid-wizard, come back | The draft is recovered **and the step is restored** — coming back to step 1 of a survey you had taken to review is most of the frustration of having lost it (`SurveyCreatePage.tsx:318-326`) | Recovering the values but dumping you on step 1 |
| 5 | admin | `/surveys/:id` (`router.tsx:372`) | Read the survey at a glance | Type, content language, start/end dates, responses, targeted departments, **anonymity** and version all shown (`SurveyDetailPage.tsx:204-256`) | The anonymity row disagreeing with the chip the employee sees in §4.5 row 3 — they are projected from the same column, so a disagreement is a real defect |
| 6 | admin | `/surveys/:id/questions` (`router.tsx:386`) | Try to edit questions | Editable only while the survey is a **draft** with no responses. The page states which of the two locks applies — `questionEditor.lockedByResponses` vs `lockedByStatus` (`SurveyDetailPage.tsx:289-295`); `PUT /surveys/{id}` is `CanAdminister` and draft-only (`roleCapabilities.ts:292`) | Questions editable after publication, or a lock with no reason named |
| 7 | admin | `/surveys/:id` | **Publish** — move `draft` → `active` | Publishing is a **separate guarded transition** with its own route, `PUT /surveys/{id}/status` (`SurveyEndpoints.cs:42`), not a field on the update body (`SurveyEndpoints.cs:38`). Allowed transitions come from `SurveyStatuses.AllowedTransitionsFrom` (`SurveyStatuses.cs:78`) | Publishing succeeding on a survey with zero questions; or an illegal transition being accepted |
| 8 | admin | `/surveys/:surveyId/distribution` (`router.tsx:407`) | Set up distribution, then **send invitations** | A count is reported, and **skips are reported with it** — "40 invitations were queued" after asking for 45 must not leave the admin to discover the gap (`SurveyDistributionPage.tsx:190-200`). `POST /surveys/{id}/invitations` (`SurveyDistributionEndpoints.cs:130`). **If the client's workforce has no individual mailboxes, run §6.5 instead of — or as well as — steps 9–10**: the same page mints an open `/s/{token}` link, and the two distribution modes coexist on one survey (`SurveyAccessTokens.cs:139-140`) | A bare success with no count; a count that silently swallowed skips |
| 9 | employee ×5 | Mailbox | Open the invitation mail | The link is **`https://climate.timsint.com/survey-invitations/<token>`** — `SurveyAccessTokens.InvitationLinkPrefix = "/survey-invitations/"` (`SurveyAccessTokens.cs:59,76`), resolved by `EmailNotificationSender` at send time (`EmailNotificationSender.cs:244`) and matched by `router.tsx:249` | A link to a path the app does not register. The token is a **bearer credential for one employee's survey** and is never persisted into `notifications.data`, so it must not be visible on any admin screen (`router.tsx:236-247`) — check that too |
| 10 | employee ×5 | `/survey-invitations/:token` (`router.tsx:249`) | Follow the link **without being signed in** | It resolves — no redirect to `/login` (`router.tsx:228-247`) | A redirect to login that destroys the destination |
| 11 | employee ×5 | Respond flow | Answer and submit — **at least five of them** | Five completed responses is what unlocks step 13. Fewer, and everything below reads "withheld" | See §2.3 |
| 12 | admin | `/surveys/:surveyId/distribution` | Watch participation, then **send reminders** | Progress updates; reminder counts accumulate per invitation (`SurveyDistributionPage.tsx:285-287`, `POST /surveys/{id}/invitations/reminders` at `SurveyDistributionEndpoints.cs:131`) | Participation not moving after a confirmed submission |
| 12a | admin | `/surveys/:surveyId/distribution` | **Revoke** one invitation from the invitation table — the page has the control (`revokeSurveyInvitation`, imported at `SurveyDistributionPage.tsx:32` and called at `:457`; `surveyDistribution.ts:314`; `POST …/invitations/{id}/revoke` at `SurveyDistributionEndpoints.cs:133`) | The row flips to **revoked** and its expiry is set to now — belt and braces, so a future path that forgets the status check still fails closed (`SurveyDistributionEndpoints.cs:796-807`) | The row still showing as live |
| 12b | that invitee | Their mailbox and their link | Wait one mail sweep, then follow the link you were sent before the revoke | **No further mail arrives, and the link is dead.** Revoking cancels every message already queued for that invitation, in the same `SaveChanges` as the status flip — "an invitation is never left revoked with its mail still deliverable" (`SurveyDistributionEndpoints.cs:809-818`). This is the guarantee #383/#404 added; it is worth one row of UAT on its own | A reminder or invitation mail landing *after* the revoke. **Known, bounded exception, do not file it blind:** a revoke that commits *during* a reminder sweep can leave one already-inserted `survey_reminder` queued, and the remedy is to **revoke again**, which re-runs the cancellation (`SurveyDistributionEndpoints.cs:745-764`). File it only if a second revoke does not stop it |
| 12c | that invitee | The dead link | Read the page | It says **revoked**, not "expired" — the two share a status and the client separates them by the server's reason (`linkFailure.ts:23-26` — the server answers 410 for both and separates them by `reason`; the map is `:71-72`, tested at `linkFailure.test.ts:22-28`) | "Expired" on a link you just revoked. A revoked invitee is a named person entitled to know why their link stopped working — unlike the share link, §6.5 row 6 |
| 13 | admin | `/surveys/:id/results` (`router.tsx:379`) | Open results with **5+** completed | Per-question distributions, dimension scores and department breakdowns render. `GET /surveys/{id}/results`, `CanAdminister` (`roleCapabilities.ts:298`) | 403 for an admin of that company |
| 14 | admin | `/surveys/:id/results` | Open results with **fewer than 5** completed | A stated withholding, not a blank page: *"Fewer than 5 people have completed this survey. Showing per-question results would come close to reading individual answers back, so they are withheld until more responses arrive"* (`surveyResults.suppressedBelowMinimum`), plus *"Participation figures are still shown: a count of responses identifies nobody"* (`surveyResults.suppressedParticipationStillShown`) | Numbers appearing below the floor — **stop UAT and report immediately.** Or a blank page with no explanation, which is a different, lesser defect |
| 15 | admin | `/surveys/:id/results` | Look at a department **below** 5 in a survey **above** 5 | That department is listed as withheld and the reason names the floor: *"Withheld groups: … Each has fewer than 5 respondents, so its answers are not shown — and its participation is withheld with them, because a percentage over a known headcount would publish the count"* (`surveyResults.segmentsWithheld`) | The small department's scores rendering; or the small department vanishing silently — withheld counts are always reported so totals reconcile (`SurveyResultsPrivacy.cs` summary) |
| 16 | admin | `/surveys/:id/results` | Look at an **open-text** question's word cloud | Words with counts, **never a sentence and never a sample answer** (`SharedReportSections.tsx:56`). Singleton words are withheld and the count says so: `surveyResults.wordsWithheld` | A verbatim answer on screen |
| 17 | **leader** | `/dashboard` (`router.tsx:310`) | Open the team view for a targeted department | Their own team's dimension scores — **and nothing else**. This is the single team-scoped read that exists (`roleCapabilities.ts:52-62`) | Any per-question detail, any other department, any respondent-level anything |
| 18 | **leader** | address bar | Try `/surveys/:id/results` for the same survey | Refused — `CanAdminister` (`roleCapabilities.ts:286`) | Sub-floor detail reaching a leader |
| 19 | admin | `/surveys/:id` | Close the survey (`active` → `closed`) | Transition accepted (`SurveyStatuses.cs:66-78`) | — |
| 20 | employee | `/dashboard` | Look for the outcome panel | After a company's first closed survey, the employee dashboard shows what came of it — how many answered, how many groups, **how many groups were withheld**, and the floor applied (`DashboardEndpoints.cs:617-630`). A department name is shown **only** if that department was not withheld (`DashboardEndpoints.cs:625-628`) | A withheld department's name appearing in the plans list. That is a leak through a side channel — report it |
| 21 | employee | `/dashboard` | Same, for a company that has **never** closed a survey | The panel is **absent**, not empty — the endpoint answers a JSON `null` at 200 (`DashboardEndpoints.cs:650`) | "0 answers across 0 departments" — a sentence about a survey that never happened |

### 6.3 The microclimate flow — admin creates and activates, a participant responds

| # | Who | Page (route) | Action | Expect | Failure looks like |
|---|---|---|---|---|---|
| 1 | admin | `/microclimates` (`router.tsx:336`) | Open the list | Loads. `GET /microclimates` — `Roles.Admin` **plus a company match** (`roleCapabilities.ts:342`) | A leader or employee reaching this |
| 2 | admin | `/microclimates/new` (`router.tsx:341`) | Walk the wizard | Same `WizardStepper`, same step order and same validation split as the survey wizard — it was extracted for exactly this (`SurveyCreatePage.tsx:131-136`) | Two wizards that behave differently |
| 3 | admin | `/microclimates/:id` (`router.tsx:343`) | **Activate** | `POST /microclimates/{id}/activate` (`MicroclimateEndpoints.cs:85`) — its own verb rather than a status write, because it is "the transition with consequences … and therefore what runs the **translation gate**" (`MicroclimateEndpoints.cs:78-85`) | Activation succeeding with a missing translation. That is what the gate is for — try activating with one language blank, on purpose |
| 4 | admin | `/microclimates/:id` | Send invitations | `POST /microclimates/{microclimateId}/invitations` (`MicroclimateInvitationEndpoints.cs:159`) | — |
| 5 | participant | Mailbox | Open the mail, click | The link is **`https://climate.timsint.com/microclimate-invitations/<token>`** — `MicroclimateInvitationLinks.LinkPrefix = "/microclimate-invitations/"` (`MicroclimateInvitationLinks.cs:42`) on the C# side, `router.tsx:263` on this side; the route is public because "a microclimate is answered anonymously by default so many of them have no account at all" (`router.tsx:252-262`) | A redirect to `/login`; a 404 |
| 6 | participant | `/microclimate-invitations/:token` → `/microclimates/:id/respond` (`router.tsx:220`) | Answer and submit | Accepted **without a session**. `GET /microclimates/{id}` is `AllowAnonymous` but serves a **reduced** public payload, and only when the microclimate is both configured for anonymous responses **and** currently active (`MicroclimateEndpoints.cs:66-74`). `POST /microclimates/{id}/responses` is rate-limited per caller (`MicroclimateEndpoints.cs:124`) | The full admin detail payload reaching an anonymous reader; a submission accepted against an inactive microclimate |
| 7 | admin | `/microclimates/:id/live` (`router.tsx:347`) | Watch live results while people answer | Counts move. `GET /microclimates/{id}/live-results` (`MicroclimateEndpoints.cs:76`) | — |
| 8 | admin | `/microclimates/:id/results` (`router.tsx:348`) | Read the results screen | Aggregates for the session. **Do not look for an export control on this page — there is none.** Both export routes exist on the API and have **no web caller**; see §8.6, which is where they get checked | A tester filing "there is no export button". That is §8.6, not a defect |
| 9 | admin | — | Ask for a **PDF** export | There is none, deliberately — no PDF renderer exists in the solution and adding one carries a licence question (`MicroclimateEndpoints.cs:95-104`). A caller asking for PDF gets a 404 | Filing "PDF export is broken". It was never built, on the record |
| 10 | admin | — | Ask for **per-respondent** microclimate responses | There are none. A microclimate persists no per-respondent row: submissions fold straight into the parent aggregate and the individual answers are discarded. *"That is the anonymity guarantee, not an oversight"* (`MicroclimateEndpoints.cs:105-112`; `:113` is a different route) | Any screen offering to show who said what |
| 11 | admin | `/microclimates/analytics` (`router.tsx:342`) | Open the cross-session analytics page. **Expect no server insights payload — it does not call one** | Five headline numbers, a "responses by session" bar chart, a pie by status and a table — **all aggregated in the browser** from one call, `GET /microclimates?companyId=`. That listing is the page's only API import (`web/src/features/microclimates/pages/MicroclimateAnalyticsPage.tsx:23`), and the page says so itself: *"Built from the listing, because there is no analytics endpoint"* (`:38-44`). The bar chart is capped at `MAX_BARS = 10` (`:33`) | **Not** "the insights did not load" — nothing on this page requests insights. A real failure here is the *listing* failing (one error state for the whole page) or the numbers disagreeing with `/microclimates`. `GET /microclimates/{id}/insights` exists on the API and has no caller anywhere in `web/src`; it is checked in §8.6, not here |
| 12 | admin | — | Ask for engagement-over-time, a benchmark comparison, or a theme across sessions | **There is none, and there cannot be**: microclimate responses are not stored individually, so the data to compute them does not exist (`MicroclimateAnalyticsPage.tsx:46-49`, and row 10 above) | Filing it as missing analytics. It is the same anonymity guarantee as row 10, seen from the other end |

### 6.4 The public share link — a report read by someone with no account

**Read §8.3 first: there is no UI to mint the token.** This flow is walkable only with an
operator who can call the API directly.

| # | Who | Page / call | Action | Expect | Failure looks like |
|---|---|---|---|---|---|
| 1 | operator | `POST /admin/reports/{id}/share` (`ReportShareEndpoints.cs:57`) | Mint a share token for a report on a company **with at least one below-floor department** | A token. Tokens are stored as SHA-256 hashes in `report_shares`, carry a finite expiry, and can be revoked (`sharedReports.ts:13-14`); `GET /admin/reports/{id}/shares` lists them (`ReportShareEndpoints.cs:62`) | — |
| 2 | anyone, **signed out** | `/shared/reports/:token` (`router.tsx:281`) | Open the link in a private window | The report renders. The route is public because it is *the consumption side of a share link* — "a report sent to a board member, an auditor, a ministry contact — people the product has no user row for and never will" (`router.tsx:265-280`). `GET /shared/reports/{token}` (`ReportShareEndpoints.cs:87`) | A redirect to `/login`. `RequireAuth` here would not defer the destination, it would **destroy** it — no `state.from`, no `?next=` |
| 3 | anyone | `/shared/reports/:token` | Find an **open-text question** in the report | **The word list is empty and the page says how many were withheld** — never a word, never a phrase. `PublicReportDocument.WithoutWords` passes a literal `[]` for the words and sets the count to `SuppressedWordCount + Words.Count` (`PublicReportDocument.cs:714,728-729`). The page renders the block on `words.length > 0 \|\| suppressedWordCount > 0` (`SharedReportSections.tsx:330`), so the withheld sentence is what appears (`SharedReportSections.tsx:459-462`) | **Any word from a respondent's own writing on that URL.** This is the highest-severity defect in this document — stop UAT and report immediately. Proven in the suite by `PublicReportProjectionTests.Word_frequencies_are_emptied_and_reported_as_withheld` (`:366`) |
| 4 | anyone | `/shared/reports/:token` | Look at an open question **nobody answered** | It reports **nothing withheld** — 0, so the page says there is nothing rather than that something is held back (`PublicReportDocument.cs:704-710`; test `A_question_with_no_words_at_all_still_reports_nothing_withheld`, `:393`) | "N words withheld" on a question with no answers |
| 5 | anyone | `/shared/reports/:token` | Look for **withheld segment names and headcounts** | Neither reaches an anonymous reader — the withheld headcounts are stripped by name (`PublicReportDocument.cs:486,498`; test `Unfloored_segment_names_and_withheld_headcounts_do_not_reach_an_anonymous_reader`, `:258`) | A suppressed department named, or its headcount printed |
| 6 | anyone | `/shared/reports/:token` | Look at **distributions and benchmarks** | They survive the projection — option counts are not suppressed even to a bucket of one, because a bucket over a population that already passed the survey floor says nothing about *which* respondent (`PublicReportDocument.cs:688-692`; `:676-685` is the words-only rationale, a different paragraph; test at `:412`). A benchmark says whether it is global and **never which tenant it belongs to** (test at `:190`) | A tenant name on a benchmark |
| 7 | anyone | `/shared/reports/:token` | Try an **expired**, a **revoked** and a **made-up** token | All three give the **same** "not available" state, indistinguishable by construction on both sides of the wire (`router.tsx:276-279`) | Three different messages — that difference is itself an oracle |
| 8 | anyone | `/shared/reports/:token` | Switch language | The report renders in the other language. The locale is **captured at mount** and the resolve effect does not re-fire on a switch (`SharedReportPage.tsx:57,84-87`) — so expect the page copy to change; a re-fetch is not required | Raw keys; a blank report after switching |

### 6.5 The open share link — distributing a survey to people who have no mailbox

**Run this if the client's workforce does not have individual company mailboxes**, which for a
plant or field population is the likelier case. §6.2 walks the *emailed*, per-person
`/survey-invitations/{token}` path only; this is the other half, and it is a different set of
guarantees. Both can be live on the same survey — "an open share link exists; per-invitee
invitations still work alongside it" (`SurveyAccessTokens.cs:139-140`).

| # | Who | Page (route) | Action | Expect | Failure looks like |
|---|---|---|---|---|---|
| 1 | admin | `/surveys/:surveyId/distribution` (`router.tsx:407`) | Press **Create** in the share-link panel | The panel's Create sends `PUT /surveys/{id}/distribution` with `{ accessType: 'public' }` (`SurveyDistributionPage.tsx:474-479`, `SurveyDistributionEndpoints.cs:125`), and the server mints `public_url` from `SurveyAccessTokens.PublicLinkPath(Mint())` **only when it is null** (`:243-249`); `QrCodeUrl` follows it (`:261`). The two access types are exactly `tokenized` and `public` (`SurveyAccessTokens.cs:136-142`) | Pressing it twice minting a *second* link. One survey has one share link |
| 2 | admin | Same page, share-link panel | Read the panel **before** revealing anything | The link is **masked by default** with a fixed-width placeholder, not with the real characters starred out — a mask that preserves length still leaks length (`ShareLinkPanel.tsx:56-60`). Revealing is a deliberate click, and nothing is auto-copied on mount (`ShareLinkPanel.tsx:24-26`) | The live URL sitting in plain sight on a screen-shared page |
| 3 | admin | Same page | Reveal, copy the link, and note its shape | It is `<web origin>/s/<token>` — `SurveyAccessTokens.PublicLinkPrefix = "/s/"` (`SurveyAccessTokens.cs:40`) is the exact string stored in `survey_distributions.public_url` and printed on QR codes, and `router.tsx:248` registers the matching route. The constants are a cross-language contract no test can enforce (`router.tsx:230-234`) | Any other path. A `/s/` link that lands on the router's error boundary is the exact regression `PublicSurveyLinkPage.tsx:17-23` was written to fix |
| 4 | respondent, **signed out**, ideally on a phone | `/s/:token` (`router.tsx:248`) | Open the link in a private window | The **respondent shell** — heading, language picker, theme picker, nothing that reads a claim. `PublicSurveyLinkPage` renders `RespondShell` for the reason written out on its sibling, `PublicSurveyRespondPage.tsx:9-21`, and says so at `PublicSurveyLinkPage.tsx:39-43`. The token is resolved by `GET /survey-links/{token}` (`SurveyDistributionEndpoints.cs:157`) into a survey id and the form is the *same* `SurveyRespondForm` the two other respond routes use, so the anonymity notice cannot be forgotten on one of three surfaces (`PublicSurveyLinkPage.tsx:34-37`) | A redirect to `/login`; the admin sidebar or a company switcher appearing around a questionnaire |
| 5 | respondent | `/s/:token` | Answer and submit **without signing in** | Accepted. An unauthenticated caller is served **only** when the survey is both configured anonymous **and** currently accepting responses — "the settings describe how it will be answered, not whether it may be" (`SurveyResponseEndpoints.cs:172-181`). `POST /surveys/{id}/responses` (`:80-81`) is rate-limited | A **draft or closed** survey answering an anonymous visitor. Stop and report |
| 5a | respondent | `/s/:token` | Do **not** clear site data mid-questionnaire | An anonymous submission is keyed by a `sessionId` the form mints and keeps (`SurveyRespondForm.tsx:226`); the server refuses an anonymous submission without one, by name: "sessionId is required when responding to an anonymous survey" (`SurveyResponseEndpoints.cs:344-350`) | That message reaching a respondent. It is a 400 aimed at a client, not copy for a person |
| 6 | anyone | `/s/:token` | Try a **revoked** token, a **made-up** one, and one for a survey **outside its window** | **All three are the same 404**, deliberately — the opposite of the invitation rule in §6.2 step 12c. An invitation names one person entitled to know why their link died; a share link is held by anyone at all, and "this existed but was revoked" confirms a tenant's survey to someone who should learn nothing from a dead URL (`SurveyDistributionEndpoints.cs:1035-1040`, and `linkFailure.ts:106-112` on the client) | Three different messages, or a "revoked" wording. The difference is itself an oracle |
| 7 | admin | Distribution page | **Regenerate** the link, then re-open the old URL | The old token stops resolving the instant the save lands — regenerating *is* the revocation plus a mint, in one step (`SurveyDistributionEndpoints.cs:291-300`). The panel states that before you press it, because an admin who does not know it will not use it (`ShareLinkPanel.tsx:24-26`) | The old link still answering |
| 8 | admin | Distribution page | Press **Revoke** in the share-link panel, then re-open the URL | Dead. `POST /surveys/{id}/distribution/link/revoke` (`SurveyDistributionEndpoints.cs:127`, wired at `SurveyDistributionPage.tsx:486-490`) nulls `public_url` outright (`:342-348`), and the resolve then finds no row (`:1047-1052`). The same revocation happens implicitly if the access type is ever switched away from `public` — "a share link that keeps working after the setting saying it exists was turned off is the leak the access type was supposed to describe" (`:251-258`) | The old `/s/` URL still serving the survey. Report immediately |
| 9 | respondent | `/survey/:id` (`router.tsx:226`) | Open a survey by its **id**, signed out | Same public respond surface, same server rule as row 5 (`router.tsx:221-226`). Registered and public by design | A redirect to `/login` |
| 10 | admin | Distribution page | Confirm the counters | `total_accesses` and `last_accessed_at` move on every resolve, updated atomically in SQL because a share link is hit concurrently. **`unique_visitors` deliberately does not move** — counting distinct visitors of an anonymous link means fingerprinting them (`SurveyDistributionEndpoints.cs:1068-1078`) | A unique-visitor count climbing. That would be a privacy regression, not a fixed counter |
| 11 | respondent | `/s/:token` | Switch language on the public page | The page renders in the other language; the server resolves content locale from `?lang` and falls back to the survey's own (`SurveyDistributionEndpoints.cs:1080-1083`), and the frame carrying the picker renders **before** the token resolves, so a visitor who cannot read English is not stuck on "resolving" (`PublicSurveyLinkPage.tsx:45-49`) | The picker only appearing after the survey loads |

---

## 7. Recording a result

For every step, record **six** fields: **role**, **step number**, **route**,
**pass / fail / blocked**, **blocked-by** (the step number or the §8 subsection that stopped it,
empty otherwise), and for a failure the **exact on-screen text** plus the request and status if
you looked. A screenshot in both languages is worth more than a paragraph.

### 7.1 When a step cannot be run because an earlier one did not finish

This happens, and the most likely cause is people rather than software. **§6.2 step 11 needs five
real humans to answer**; if three turn up, steps 13, 15, 16, 17 and 20 cannot be judged, and §6.4
has nothing to share. Recording those as *fail* would put five false defects into the report and
bury whatever genuinely broke.

The rule:

1. **Mark the blocking step's own outcome honestly.** "Only 3 of 5 responses collected" is a
   **blocked**, not a fail — unless the submissions were *attempted and refused*, which is a fail
   on step 11 itself with the exact error text.
2. **Every downstream step is `blocked`, `blocked-by: 6.2 step 11`.** One line each. Do not
   guess what they would have shown.
3. **Then run everything that does not depend on it.** The dependencies in this document are
   narrow and worth knowing, because most of the script survives a short session:
   - **§6.2 steps 13–20 and all of §6.4** need 5+ completed responses (§2.3).
   - **§6.2 step 15** additionally needs one department that is *below* 5 inside a survey that is
     *above* it — that is a seeding decision, not a headcount accident.
   - **§6.4 step 1** needs an operator who can call the API (§8.3). Steps 2–8 need step 1.
   - **§6.5** needs no responses at all beyond row 5, and **§6.1, §3, §4.1–4.5 and §6.3 rows
     1–7** need none of it. Run those first if the room is thin.
4. **A step blocked by §8 is recorded once, against the §8 subsection**, and carries the issue
   number from §10. It is not re-argued per step.
5. **Never mark a step `pass` on inference.** "The others worked so this must too" is the failure
   mode this whole document is written against.

A defect report that says "results are wrong" cannot be acted on. One that says "as
`leader@…` on `/dashboard`, the team climate grid drew no columns at all for Ventas, which has 3
respondents; expected the dimension names with hatched cells and the sentence naming the floor of
5" can be, and points straight at `DashboardEndpoints.cs:733-745`.

---

## 8. What UAT cannot cover yet, and why

Each of these is a **blocked**, not a fail. Do not write steps against them and do not let the
client discover them as surprises in the room — say them out loud at the start of the session.

### 8.1 The tracking module (PROCOMER seguimiento) — not deployed

- The web module ships in the production bundle but is **dormant**: the sidebar rows appear only
  when `VITE_TRACKING_API_BASE_URL` is non-blank, and that one variable is the only signal
  (`web/src/features/tracking/api/config.ts:14-16,55-58`).
- There is **no tracking service in production to point it at.** The PROD account holds exactly
  two CloudFormation stacks, `climate-project-api-prod` and `climate-project-api-bootstrap`
  (verified 2026-09-02). `docs/runbooks/tracking-service-provisioning.md` opens with
  **"Status: NOTHING BELOW HAS BEEN EXECUTED"** — no stack, no secret, no image.
- The module is **single-tenant by construction**: it has no company column in its domain, and
  `ProcomerCompanyId` pins the whole deployment (`infra/aws/climate-tracking-api-prod-service.yml:227,411-412`).
  `appsettings.json` ships `"ProcomerCompanyId": ""`, and a deployment that never sets it would
  ship an export of raw ids while looking healthy (`CrossServiceTokenTests.cs:304`,
  `TrackingInternalStubEndpointsTests.cs:71`). It is not set.
- **Consequence:** `/tracking`, `/tracking/tablero`, `/tracking/planes`, `/tracking/planes/:id`
  and `/tracking/mis-tareas` (`router.tsx:129-161`) are unreachable, and no role's sidebar offers
  them. **A leader's rail therefore looks identical to a supervisor's.** That is expected today.
- One knock-on worth stating to the client: turning tracking on **replaces** Action Plans in the
  nav rather than adding to it — one place to manage plans instead of two that disagree
  (`config.ts:47-53`). So the Action Plans screens UAT signs off in §4.2 are the ones that go away
  when tracking arrives.

### 8.2 The question library — no production UI, and the picker renders EMPTY

- Decided 2026-09-02 by Federico on **#423**: the instrument arrives **once, by import**; the
  authoring UI is deferred deliberately (`docs/runbooks/question-library-import.md`, opening
  paragraph).
- `router.tsx` contains exactly one question-library route, `/dev/question-library`
  (`router.tsx:180`), inside the `import.meta.env.DEV` block — **it does not exist in a production
  build.**
- **What a tester will see:** the picker that consumes the library (`QuestionLibraryBrowser`, used
  by both the survey and the microclimate create wizards) renders an **empty list** in production
  until the import runbook has been run. *"An empty picker is not a defect report; it is this
  task, not yet done"* (`question-library-import.md` §1).
- The sibling `/admin/question-bank` (`router.tsx:329`) is a **different table on purpose** and
  does work — do not let the two be conflated in a defect report.
- Blocked until someone runs `docs/runbooks/question-library-import.md`. That runbook also carries
  an open decision the client must make first (global vs company-owned instrument, §3 there), and
  notes that it **has not itself been executed end to end** against a running API.

### 8.3 The **report** share link has no UI to mint a token

`POST /admin/reports/{id}/share` exists and is registered (`ReportShareEndpoints.cs:57`), but a
sweep of `web/src` finds **no caller** — `ReportsListPage.tsx` offers create, list and download
only, and the only web references to the share route are comments. So §6.4 step 1 must be done
with an API call by a TIMS operator, not by the client clicking. Everything from step 2 onward is
ordinary client-facing UAT.

**This is not the survey share link.** The *survey* one (`/s/{token}`, §6.5) is fully driven from
`ShareLinkPanel` on the distribution page and needs no operator. Two different tokens, two
different subsystems; do not let a defect report conflate them.

Related: **report rendering is not built.** Creating records the report and marks it complete;
downloading records the request; **no file is produced** — and the page says so
(`ReportsListPage.tsx:143`, key `reports.generationStubbed`). Say this before the client clicks
Download.

### 8.4 Staging does not exist, so UAT runs against production

- `deploy-staging.yml` and `rollback-rehearsal-staging.yml` have **0 lifetime runs each**
  (verified 2026-09-02). `docs/runbooks/staging-provisioning.md:157` records the environment as
  not existing, and the tracking runbook adds: *"There is no place to rehearse this."*
- In the DEV account `climate-project-api-staging-bootstrap` exists (created 2026-09-02) but **no
  staging service stack**, because the staging database does not exist yet (verified 2026-09-02).
- **Consequence:** every step above runs against the live production deployment with live data.
  Two rules follow, and they are not negotiable:
  1. **Do not use the seeded role accounts for anything the client will see.** They exist for the
     dry run.
  2. **Every survey, microclimate, report and invitation created during UAT is real production
     data.** Agree a naming convention (`UAT — …`) before the session so it can be found and
     archived afterwards, and agree who deletes it.
- Do **not** run UAT against `https://organizational-climate-platform.vercel.app`. It still
  answers 200 and it is the **legacy** stack; #163 exists precisely to find out what still points
  at it. Signing off against the wrong app is the one mistake this section is here to prevent.

### 8.5 What is out of scope for a different reason

- **Rollback.** `rollback-prod.yml` has 0 lifetime runs (verified 2026-09-02). Rehearsing it is
  #159, not UAT.
- **Monitoring.** There are **zero** CloudWatch alarms whose name contains "climate" in the PROD
  account, and `infra/aws/climate-project-observability.yml` has never been deployed (verified
  2026-09-02). So "we would have been paged" is not an expectation any step here may rely on.
  That is #158.
- **Custom domain on the API.** No custom domain is attached to the App Runner service (verified
  2026-09-02); `web/vercel.json`'s CSP `connect-src` hardcodes the App Runner hostname. That is
  #160, and it means a domain change is a web redeploy, not just DNS.

### 8.6 Two microclimate surfaces exist on the API and cannot be reached from any screen

Same treatment as §8.3, and for the same reason: **a route with no caller is not a missing
button.** A tester sent to "open insights" or "export the results" on a microclimate screen will
hunt for a control that was never built and file the absence as a defect. Both of these are
API-only checks for a TIMS operator, not client-facing UAT steps.

| Route | Mapped at | Web callers | How to check it, if it is checked at all |
|---|---|---|---|
| `GET /microclimates/{id}/insights` | `MicroclimateEndpoints.cs:113` | **None.** A repo-wide grep for `insights` under `web/src/features/microclimates` returns exactly one hit, a stale comment at `MicroclimateResultsPage.tsx:43`. The unrelated `analytics/ai-insights` feature is a different endpoint (§4.2 row 10) | An operator calls it directly. `/microclimates/analytics` does **not** call it — see §6.3 row 11 |
| `GET /microclimates/{id}/export` and `…/export/csv` | `MicroclimateEndpoints.cs:92-93` | **None.** `grep -rniE "csv\|/export" web/src/features/microclimates` returns nothing; the only microclimate reads in the web app are list, detail and `live-results` (`microclimates.ts:242`) | An operator calls both and checks the suppression: **both suppress before they serialise** (`MicroclimateEndpoints.cs:88-91`). Compare the file against what §6.3 row 8 shows on screen. Unsuppressed rows in an export would be the highest-severity finding available here |

`MicroclimateResultsPage.tsx:40-44` already records the shape of this: #129 listed
`/microclimates/{id}/analytics`, `/microclimates/analytics` and `/microclimates/{id}/insights`,
and the endpoints that exist are not those. Read that comment before writing a defect about a
microclimate analytics gap.

---

## 9. One correction to an existing document, so nobody repeats it

`docs/runbooks/legacy-dependencies.md:43` states that
`infra/aws/climate-project-api-prod-service.yml` *"passes no `Email__*` variables, so the new
stack's prod delivery is the logging stub"*.

**That is stale.** At `b371a9d` the template passes eight `Email__*` runtime variables plus two
SMTP secrets: `Email__Provider: smtp`, `Email__SmtpHost`, `Email__SmtpPort: 587`,
`Email__SmtpUseStartTls`, `Email__FromAddress: no-reply@timsint.com`, `Email__FromName`,
`Email__AppBaseUrl: https://climate.timsint.com`, `Email__SesConfigurationSet: tims-transactional`
(`…prod-service.yml:265-294`), with `Email__SmtpUsername` and `Email__SmtpPassword` supplied from
Secrets Manager (`:302-305` — verified 2026-09-02: `:301` is the `InternalApiKey` value line, `:302-305` are the two `Email__Smtp*` name/value pairs; the parameters they reference are declared at `:114-128`).

So the invitation flow in §6.1 is expected to deliver real mail. **What this repository can prove
is that the wiring is present in the template**; whether the deployed prod service currently has
those parameters populated is console state this document did not read. §6.1 step 3 is where that
gets measured — and it is the reason that step's failure column tells the tester what a
never-configured mailer looked like before #100.

---

## 10. Sign-off

UAT is complete when, for each of the five roles, §3 and that role's §4 journey are recorded, and
§6.1 through §6.5 are recorded with the participants they need. Steps marked **blocked** by §8 are
listed on the sign-off with the issue that unblocks them (#219 tracking, #423/import question
library, #156 staging, #158 monitoring, #159 rollback, #160 domains) rather than being counted as
passes, and each carries its **blocked-by** field from §7.1.

### 10.1 Gates — a `blocked` on one of these is as disqualifying as a `fail`

| # | Gate | Measured at | Why it gates |
|---|---|---|---|
| 1 | **Anonymity holds.** No numbers below the floor; no verbatim respondent text on a public URL | §6.2 steps 14–16, §6.4 step 3 | This product's whole argument to a workforce. **Cutover (#162) must not be executed while any of these is a failure** |
| 2 | **A real mail was actually delivered to a real inbox, from the deployed service** | §6.1 step 3 — **the only place in this document where it is measured** | §9 proves the *template* passes eight `Email__*` variables and two SMTP secrets. Whether the **deployed** service carries them is console state this repository cannot read. Until step 3 passes against a mailbox somebody opened, "invitations work" is an inference about a YAML file, not a measurement. A `blocked` here also blocks §6.1 steps 4–8, §6.2 step 9 and §6.3 step 5 |
| 3 | **Role boundaries hold.** No leader or supervisor reaching `/surveys`, `/action-plans` or any `/surveys/:id/results`; no cross-tenant row anywhere | §4.2 rows 3 and 5, §4.3 rows 10–11, §4.4 row 7, §4.5 row 14, §6.2 step 18 | — |
| 4 | **A revoked link is dead.** A revoked survey invitation stops mailing and stops resolving; a revoked or regenerated share link stops serving | §6.2 steps 12a–12c, §6.5 rows 6–8 | — |
| 5 | **Both languages render on every screen walked**, with no raw keys and no English surviving in Spanish | §3.3, once per role, plus §6.4 step 8 and §6.5 row 11 | The client's users are Spanish-first |

Gate 2 is the one most easily assumed into a pass. Nothing else in this script observes the
mailer, and the history is exactly this failure: before #100's block existed the service ran with
`Email:Provider` defaulting to `none` and recorded every message as failed while looking healthy
(`…prod-service.yml:260-264`).
