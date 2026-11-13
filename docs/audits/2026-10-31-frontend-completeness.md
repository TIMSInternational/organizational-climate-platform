# What the screens still cannot do — re-measured 2026-10-31

**Measured against `main` at `e3132f31`**, confirmed equal to `origin/main` (0 commits either way)
before anything below was read. Additive, per the `docs/audits/` convention: this supersedes
`2026-10-22-frontend-api-gap-audit.md` and the "still open" table of `2026-10-28-operations-gap.md`
**by date**, and neither of those files was edited.

## Why this exists, and it is not a flattering reason

The 22 Oct register was used as a work list on 30–31 Oct and **was wrong four times in one
session**, every time in the same direction: it reported a gap that `main` had since closed.

| The 22 Oct register said | What `main` actually has |
|---|---|
| **#1 / G5** no way to add ONE person; `UserEndpoints.cs` is `GET, GET, PUT, PUT` | `AddPersonForm.tsx` → `POST /admin/users/bulk-import/rows` (`BulkImportEndpoints.cs:55`). The claim about `UserEndpoints.cs` is *true and irrelevant* — the importer's single-row route is the add-person path, and deliberately so: it carries the company's language and mints a `per_survey` account keyless |
| **G14** Duplicate drops `userIds`, so a per-person survey silently becomes company-wide | `SurveyDuplication.cs:209` copies `UserTargets`; `:89` `ServiceType`; `:218` `Anonymous`; `:248` `CredentialMode` |
| **G15** a template-built survey is not anonymous | `SurveyTemplateInstantiation.cs:129` calls `NewSurveyDefaults.Apply(...)` |
| **G11** the dashboard's low-participation card offers a reminder that always sends zero | the card offers `surveys.next.distribution.send.seeWhoIsMissing` instead, with a comment saying why |

**The lesson is about the instrument, again** — `feedback-the-working-tree-may-not-be-main` and
`feedback-the-cited-symbol-may-be-the-wrong-caller`. Grepping `UserEndpoints.cs` for a `POST` and
reporting "no way to add a person" is the second of those exactly: the right symbol was in another
file. **Grep the CALLER and the ROUTER, never only the endpoint file you expect.**

```
git rev-parse --short HEAD ; git rev-parse --short origin/main   # before trusting any row below
```

## Method

For each claim: find the client function or route, then grep `web/src` for a caller, **excluding
`*.test.*` and `features/*/pages/`** — `router.tsx:532` records that the `pages/` trees stay
unrouted on purpose, so a caller there is not a screen. Then confirm the path is in `router.tsx`.

Legend: ✅ reachable and routed · 🟡 reachable but incomplete · 🔴 no routed screen ·
⚠️ one grep only, treat as a hypothesis.

## Closed since 22 Oct — do not re-open these without re-measuring

| Was | Now |
|---|---|
| G2 re-send one per-survey code | `POST …/credentials/{userId}/reissue`, button on the roster ✅ |
| G3 change a person's email | `UpdateUserRequest.Email` ✅ |
| #3 revoke a code sent in error | `MapDelete` `SurveyCredentialEndpoints.cs:180`, button per row ✅ |
| #1 add ONE person | `AddPersonForm.tsx` ✅ |
| #7 / G20 per-person status workbook | `StatusWorkbook.cs`; `/admin/companies/{id}/participation/export` and `/surveys/{id}/participation/export`, both with buttons ✅ |
| G17 survey history | `/surveys/:id/history` → `SurveyHistoryPage.tsx` (`router.tsx:500`) ✅ |
| G21 audit log | `/admin/audit` → `AuditLogPage.tsx` (`router.tsx:418`, which cites G21 by name) ✅ |
| G16 delete a survey · duplicate | callers in `useSurveyDetailModel.ts`, `useSurveysListModel.ts` ✅ |
| G16 move a live close date | `endDate` on `PUT /surveys/{id}` ✅ |
| G14 per-person targeting survives a duplicate | `SurveyDuplication.cs` ✅ |
| G24 delete an action plan | `useActionPlanDetailModel.ts` ✅ |
| G29 admin reset of an email login | `PersonDetails.tsx` ✅ |
| G1 read company settings without a write | `GET /admin/companies/{id}/settings` ✅ |

## Still open

### 1. A reminder left no trace — BUILT TODAY, in this change

`SurveyCredential` carried `CreatedAt` and `LastSignInAt` and **nothing about reminders**, so the
route merged yesterday (`e3132f31`) wrote only an `audit_logs` row.

To be exact about what that did and did not cost, because "invisible in the product" would be too
strong: `/admin/audit` **does** list the sends, labelled *"Le recordó a una persona que termine, sin
enviarle un código nuevo"*, and the target's id is in the serialised request path. What was missing
is the answer **on the screen where the decision is made**. The roster is where an operator picks
who to chase, and it could not say whether a person had already been chased — so somebody working
a client's list of names could mail the same person twice from two sittings with no signal, and
ESPH's five reminders of 30 Oct did not show against those five rows the next morning.

Fixed here: `survey_credentials.last_reminded_at` + `reminder_count`, written only on a *delivered*
reminder, published to the roster as a company-zone **day** and a count, rendered per row, named in
the confirmation dialog, and the button reads *"Enviar otro recordatorio"* once there has been one.

Rendered and read, both locales, at
`2026-10-31-frontend-completeness/roster-reminder-history-es.png` (`npm run shot --
/surveys/s1/distribution … --lang es --fixtures scripts/shot-fixtures/distribution-roster-per-survey.json`).
Carlos Rojas reads *"Recordatorio enviado 30 oct 2026"* above **Enviar otro recordatorio**; José
Mora reads *"3 recordatorios, el último 28 oct 2026"*; María Solano, who has never signed in, keeps
**Reenviar credenciales** and shows no reminder line at all. The longer Spanish button does not
wrap and the third line in that cell does not overflow the column.

**The five from 30 Oct stay invisible**: the columns start empty, and the only record of those
sends is `audit_logs.details`. Mining a long-retention compliance table to seed an operational
column is the wrong trade for five rows, each of whom has been written to once already.

### 2. The orphaned automatic-reminder copy 🟡

`surveys.next.distribution.reminder.{awaiting,scheduled*,inactive,off,none}` promise reminders that
*"salen solos cada {days} días"*. **`InvitationReminderJob.RunAsync` sweeps microclimates only** —
its own comment at line 72 reads `SURVEYS ARE NO LONGER SWEPT` — and
`SurveyDistributionEndpoints.SendRemindersAsync` returns a hardcoded `(0,0,0,null)`.

**But no routed screen renders those keys.** The only caller of `sendReminder` is
`features/surveys/pages/SurveyDistributionPage.tsx`, which `router.tsx` deliberately leaves
unrouted. So this is **dead copy, not a live lie** — a catalogue clean-up, size S, no user impact.
Worth doing so the next reader is not misled the way the 22 Oct audit misled this one.

### 3. The dashboard card's rationale is now false ⚠️

`AdminDashboardNextView.tsx` says, in a comment: *"Not 'Enviar recordatorio': there is no reminder
to send."* As of `e3132f31` **there is one**, per person, from the roster. The card's label and
destination are still right — the roster is where the per-person button lives — but the reason
given is stale, and `item.remindersSent` reads invitation reminder counts, which a per-survey
survey never produces, so the card says *"ningún recordatorio enviado todavía"* however many went.
Now that §1 records them, the card could read the truth. Size S.

### 4. No routed screen ⚠️ — each of these is ONE grep, so verify before quoting

| Surface | Evidence |
|---|---|
| Microclimate invitation resend / revoke / reinstate | no caller for `resendMicroclimateInvit*`; `MicroclimateInvitationEndpoints.cs:160` |
| Demographic snapshots (6 routes) | no caller for `demographicSnapshot` |
| Analytics insights (5 routes) | matches in `i18n/*.json` only — **copy shipped ahead of a screen**, or the client function is named something else. Re-grep before believing it |
| Real SES bounces | no bounce table and no handler; 10 of 865 bounced on 20 Oct. Needs the SNS path fixed first (`reference-the-apps-bounces-bypass-the-climate-alerts`) — infrastructure, not product |
| The delivery-audit workbook (`esph-auditoria-envio.py`) | script only |

### 5. Three that are rulings before they are builds — unchanged, and not mine to take

- **Exclude one response from results.** The revoke endpoint's own refusal says what to do with a
  response that should not exist is *"a results decision, not an access one"*.
- **Record a paper response.** Every ESPH respondent was told the company never sees their name
  beside their answers. A typed-in paper form has a known author; whether it carries a `user_id`
  is the whole question. Rafael Ángel Rodríguez Palma's questionnaire (`esph-6jknp443`) waits on it.
- **Delete a company or a person.** There is an existing ruling *against* it —
  `reference-what-can-be-deleted-in-prod`: surveys only, at zero responses. Building the button
  would reverse a decision, not close a gap.

## The access question was answered — stop listing it as a blocker

The 28 Oct audit called this the item that "blocks the whole premise", and **it was ruled the same
day**: `docs/decisions/tims-operators-hold-super-admin.md` (recorded 2026-10-28 against
`3ef40c3a`) gives each TIMS operator `super_admin` and defers the scoped operator role. The
measurement behind it still holds — five roles, nothing between one tenant and every tenant — but
the decision is taken and the file says so.

This is a fifth stale-list error, and it was in a MEMORY as well as in the audit: the memory
`reference-admin-operations-in-the-product` records the ruling correctly. Read the decisions
directory before repeating a blocker.

## Gates

`dotnet build ClimateProject.slnx -c Release` · `dotnet test` on the **solution**, one at a time
under `mkdir /tmp/climate-dotnet-suite.lock`, never rebuilding mid-run · `npm run typecheck`,
`npm run build`, `npm test`, `npm run lint` · keys in **both** catalogues, additive, never
reordered · `npm run shot` and **read the PNG**.

**ESPH's three surveys close 10 Nov**, so every change here stays admin-only: web merges reach
production through Vercel immediately, and a respondent-facing change would land mid-survey.
