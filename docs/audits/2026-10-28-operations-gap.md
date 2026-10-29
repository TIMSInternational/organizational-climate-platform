# What an administrator can do in the product, against what October did by hand

**Measured 2026-10-28 against `main` at `3ef40c3a`** (the deployed head). Additive, per the
`docs/audits/` convention: a later audit supersedes this one by date, never by editing it.

## Why this audit exists

Between 2026-10-13 and 2026-10-28 three live ESPH surveys and one Eagle survey were run almost
entirely from `~/Desktop/TIMS-NEXA-Clima` — **61 shell scripts, 64 SQL files and 6 Python
scripts**. The question this audit answers is which of those files are still load-bearing, now
that a TIMS employee is to be given the platform and expected to do all of it from a screen.

### The first finding is about the measurement, not the product

The first pass of this audit was taken against a **worktree 28 commits behind `main`** and
reported eight gaps that `main` had already closed — among them the one that had just been
done by hand that afternoon. Re-measured against `3ef40c3a`, **more than half of the October
gap list is already built**. Before using any gap list here, confirm the tree:

```
git rev-parse --short HEAD ; git rev-parse --short origin/main
```

This repeats a rule already paid for — `feedback-the-working-tree-may-not-be-main`. It was
paid for twice today: the afternoon's four-step SQL re-send of one person's Teletrabajo code
**already existed in the product as a button** (§D2 below).

Nothing below is inferred from a DTO. Every "no screen" was measured by grepping the
**callers** in `web/src`, per `feedback-the-screens-did-not-ask`.

Legend: ✅ reachable from a screen · 🟡 reachable but incomplete · 🔴 not reachable.

---

## Already closed on `main` — stop scripting these

| Operation | October did it with | Where it lives now |
|---|---|---|
| Create a company | `esph-0-empresa.sh`, `create-eagle-company.sh` | `POST /admin/companies`; `CompaniesListNextPage.tsx:60` ✅ |
| **Read** a company's settings | — | `GET /admin/companies/{id}/settings` (`CompanyEndpoints.cs:20`) ✅ — the old web code read them by issuing an empty `PUT` |
| `credentialMode` `shared`\|`per_survey` on a company | `set-credential-mode.sh` | `CredentialModeCard.tsx` in the settings screen ✅ |
| `credentialMode` on one survey | frozen at create by script | `wizardValues.ts:231,925`; the workbook preview reports it (`ClimateWorkbookPage.tsx:79`) ✅ |
| Branding (logo, colours) | `set-branding.sh`, `ship-email-branding.sh` | `CompanySettingsNextView.tsx` ✅ |
| Result bands · demographic fields · licences | workbook import / none | `features/result-bands`, `/demographic-fields`, `api/licenses.ts` ✅ |
| **Move a live survey's close date** | `cambiar-cierre-esph.sh`, `cambiar-cierre-eagle.sh`, `eagle-4-mover-cierre-al-30.sh` — ≥ 6 runs | `surveys.ts:584` sends `endDate` on `PUT /surveys/{id}` ✅ |
| Open now / close now | `open-survey-now.sh`, `eagle-3-cerrar-ya.sql` | `PUT /surveys/{id}/status`; `updateSurveyStatus` ✅ |
| Aim a survey at named people | `create-teletrabajo.sh` + raw `survey_user_targets` | `userIds` on distribution; `AudienceSelector.tsx:69` ✅ |
| **Re-send ONE person's per-survey code** | **12 `reenviar-clave-*.sql` + `krissly-1..4` + `esph-reenviar.sh`** | `POST /surveys/{id}/credentials/{userId}/reissue` (`SurveyCredentialEndpoints.cs:102`), seven stable refusal codes, button in `SurveyRosterPanel.tsx:513` ✅ |
| See whether a code was mailed, and first sign-in | `revisar-clave-*.sql` (14 files) | `SurveyRosterRow.SurveyUsername / CredentialIssuedOn / LastSignInOn`, rendered at `SurveyRosterPanel.tsx:555-557` ✅ |
| Mail codes to a roster past the 100 cap | `silence-activate-invite.sh`, `esph-real-1-enviar.sh` | the client repeats the request while pending remains (`surveyDistribution.ts:244`) ✅ |
| **Change a person's email** | 6 `cambiar-correo-*.sql` | `UpdateUserRequest.Email` (`UserDtos.cs:66`) ✅ |
| Deactivate a person (the audience-safe removal) | `delete-rehearsal-NOW.sql` | `IsActive` on `PUT /admin/users/{id}`; `AdminUsersView.tsx` ✅ |
| Delete a survey · delete a microclimate | `delete-survey.sh`, `cleanup-test-surveys.sh` | `DELETE /surveys/{id}`, `MicroclimateEndpoints.cs:82` ✅ |
| Public / QR link | `create-public-link.sh` | `ShareLinkPanel.tsx` ✅ |
| Import a roster · import a whole climate | `import.sh`, `import-climate-workbook.mjs` | IntakeWizard, `/surveys/import` ✅ |

## The access question, which comes before any of the gaps

Handing the platform to TIMS staff so they can work "from scratch" means each of them needs
**`super_admin`**. There are five roles (`Roles.cs`: `super_admin`, `company_admin`, `leader`,
`supervisor`, `employee`) and **nothing between "one tenant" and "every tenant"**.

Measured — these refuse anyone who is not `super_admin`:

| Operation | Gate |
|---|---|
| List companies · create a company · read one · update one | `CompanyEndpoints.cs:31, 51, 115, 139` |
| Grant or adjust a service licence / seats | `CompanyLicenseEndpoints.cs:33, 67, 109` |
| The question library and the question bank | `QuestionLibraryEndpoints.cs:77, 231`, `QuestionBankEndpoints.cs:144, 163` |
| Export responses | `ResponseExportEndpoints.cs:87` |
| System settings · audit logs · notification templates | `SystemSettingsEndpoints.cs:90`, `AuditEndpoints.cs:93`, `NotificationTemplateEndpoints.cs:74` |
| Cross-company benchmarks | `BenchmarkEndpoints.cs:123, 477`, `BenchmarkAnalyticsEndpoints.cs:390, 522` |

A `company_admin` can run a tenant it already belongs to — settings (`CompanyEndpoints.cs:341`
admits the company's own admin), surveys, the roster, distribution, the reissue button — but
cannot create the company in the first place.

**So the decision is:** give each TIMS operator `super_admin`, which also grants them
cross-tenant read of every client's results and exports; or add an operator role that can
create and configure companies without reading their results. The first is one action and
available today. The second is an authorization change touching every table above, and it is a
ruling to make before it is code — it should go in `docs/decisions/`, not be invented here.

Worth naming because this product's privacy posture is deliberate and documented: a floor of 3
respondents, no verbatim open text, and every survey anonymous **to the client**. "Anonymous to
the client" has always meant TIMS can see more than the client can — so several TIMS operators
holding `super_admin` may be exactly right. It should be a decision that was taken, not one
that happened.

## Still open — what a TIMS employee cannot do from a screen

Ordered by how often October needed it.

| # | Operation | October did it with | What exists | What is missing |
|---|---|---|---|---|
| **1** | **Add ONE person** to a company | the intake wizard, i.e. a spreadsheet for one row | only `POST /admin/users/bulk-import*` (`BulkImportEndpoints.cs:27-55`) | **no `POST /admin/users`** — `UserEndpoints.cs:20-23` is `GET, GET, PUT, PUT`. One new hire needs a file. 🔴 |
| **2** | **Remove ONE person from one climate's audience** | `quitar-teletrabajo-6.sh`, `quitar-teletrabajo-28oct.sh` (2 runs, 12 people) | `PUT /surveys/{id}/distribution` **replaces the whole target set** | no "take this person off this survey". Deactivating the account removes them from *every* survey, which is the wrong tool. 🟡 |
| **3** | **Revoke a code sent in error** | `esph-quitar-clave-clima-mal-enviadas.sql`, `esph-quitar-clave-asancho.sql` | `reissue` can replace a key; nothing can *withdraw* one | this is the 28 Oct ten-person mis-send. The product can give someone a new key but not take a key away. 🔴 |
| **4** | **Exclude one response from results** | `esph-respuesta-asancho.sql` | nothing | a response from someone who should never have been mailed still counts in every mean. 🔴 |
| **5** | Record someone who answered **on paper** | `usuarios-papel-3.sql`, `esph-papel-eduardo-28oct.sql` | no such concept | they read as `not_started` for ever and depress the rate. 🔴 |
| **6** | Real **bounces** per survey | `check-suppressed.sh` + an SQS debug queue | `UndeliverableAddresses` refuses reserved domains *before* sending; the invite response reports `undeliverable` | an address that bounced *at SES* is invisible in the product. 10 of 865 on 20 Oct. 🔴 |
| **7** | The client's **per-person status workbook** | `esph-estatus-descargar.sh` + `esph-estatus-excel.py`, ~12 runs | `ResponseWorkbook` has a `PENDIENTES` sheet (`ResponseWorkbook.cs:105`); the roster carries all three states | no export of the three-state per-person sheet per survey. 🟡 |
| **8** | The **delivery audit** workbook | `esph-auditoria-envio.py` | nothing | 🔴 |
| **9** | Delete a company · delete a person | `delete-esph-both.sql`, `delete-rehearsal-NOW.sql` | neither route exists (`MapDelete` absent from both endpoint files) | a **policy** question before a build one — `reference-what-can-be-deleted-in-prod` says only surveys, only at zero responses. 🔴 |

## Found and fixed in this pass: "Editar audiencia" left the participation rate wrong

Not on the October list, because October never hit it — the shell script compensated by hand.

`TargetAudienceCount` is the denominator every participation rate divides by
(`surveyListView.ts:96`, the dashboard, the public report). The screen's audience editor sends
`userIds` **alone** (`surveyAudience.ts`, called from `useSurveyDetailModel.ts:164`), and the
server only wrote the count when a caller sent it (`SurveyEndpoints.cs`, `UpdateAsync`). So
taking six people off a 240-person survey from the product left the rate dividing by 240 for
ever. `quitar-teletrabajo-6.sh` posted `targetAudienceCount` beside the ids precisely to avoid
that — its own comment says *"so the results' response rate divides by 234, not 240"* — which
means the only reason ESPH's Teletrabajo rate is right today is that the removal was done by
script rather than from the screen.

**The fix** recounts the stored denominator when the targets move and the caller sent no figure
of its own, through `SurveyQueries.Audience` — the single expression of who an audience is,
whose own remarks record that it had been written out four times and the fourth had already
drifted. Counting the ids in the request would have been a fifth copy.

**The rule it respects, which is why the fix is narrower than it first looks.** A declared
count follows its audience; an **undeclared** one stays undeclared. `null` is not "unset
pending a default" — it is the stored meaning *"there is nothing to measure against"*, which
`surveyParticipationPercent` passes through as an em dash rather than printing a false 0 %.
So this corrects a denominator that has become wrong and never invents one that was
deliberately absent. An explicit `targetAudienceCount` still wins, and a request that does not
touch the targets cannot disturb the count — which is what keeps the three narrow settings
PUTs the detail page sends from rewriting a declared number.

Eleven tests in `SurveyAudienceEditTests` cover it, and they have teeth: inverting the
condition fails three of them, while the mutation still compiles.

**Left undone deliberately:** `POST /surveys` has the same shape — the wizard's audience-count
field is blank by default, so a survey aimed at 240 named people stores `null` and shows no
rate at all until somebody types the number. Deriving it there would turn "not declared" into
"declared" for every new survey in every tenant, which is a product decision about what the em
dash means, not a bug fix. It is the first question for the next pass.

## Built in this pass

| Gap | What shipped | Verified by |
|---|---|---|
| **#3** Revoke a code sent in error | `DELETE /surveys/{id}/credentials/{userId}` (`SurveyCredentialEndpoints`) + a *Retirar el código* button per person on the roster. Refuses anyone who has answered — withdrawing a key does not withdraw a response — reports rather than refuses a key already used, and leaves the account, the audience and the invitation alone. | 11 integration tests; 4 web tests; mutation of the response guard fails exactly 1 |
| **#1** Add ONE person | *Agregar persona* on the users page, posting a single row through `POST /admin/users/bulk-import/rows`. **No new endpoint**: that route already takes one row, and a second creation path would not carry the importer's decisions (the company's language, a `per_survey` account minted keyless). Mails nothing, and says so on the form. | 4 web tests; mutation of `withCredentials` fails exactly 1 |
| **#7** The status workbook | `GET /admin/companies/{id}/participation/export` → one `.xlsx`, a sheet per distributed survey, with a count and a percentage (`StatusWorkbook.cs`), and a *Descargar estado (Excel)* button on the surveys list. Drafts excluded; every sheet's columns come from `SurveyRosterCsv.Headers`/`Fields`, so they cannot drift from the screen or the CSV. | 9 unit + 9 integration + 2 web tests; mutation of the percentage denominator fails exactly 1 |

**One deliberate difference from the script it replaces.** `esph-estatus-excel.py` prints Nombre
and Apellidos in two columns by guessing that the last two words are the surnames — and it
reports its own doubts, for a human to check, because that guess is right for
"ADRIANA DE LOS ANGELES SANCHO PORRAS" and wrong for a name with a particle in the wrong place.
The product writes the name as **one cell, exactly as stored**: an export that prints a guess
into a client's deliverable with no doubt column beside it would be shipping a quiet error. A
two-column layout stays a reviewed step outside the product.

**#2 reassessed.** "Remove one person from one climate's audience" is not a missing route: the
audience editor already does it, and this pass fixed the denominator it was leaving stale. For a
**department-targeted** survey — ESPH's Clima — there is no person list to edit at all, so
withdrawing the key (#3) is the only way to close one survey to one person, which is why it was
built instead.

## The order of work, and why

0. **The access decision above.** It is not code and it blocks the whole premise: until it is
   taken, "give TIMS staff the platform" has no defined meaning.
1. **#1, #2, #3 together** — they are one story: *one person*, added, taken off a climate, or
   un-issued a code. These are the week-one corrections a TIMS employee will hit first, and
   they are the user's own words: "individually per climate, per company, per users, adding
   them, deleting them".
2. **#7 + #8** — the two workbooks, as exports. ~14 script runs in October between them, and
   they are what the client actually reads.
3. **#4 + #5** — results hygiene. Both change published numbers, so both need a ruling on who
   may do it and whether it is reversible, before code.
4. **#6** — needs the SES notification path fixed first
   (`reference-the-apps-bounces-bypass-the-climate-alerts`), which is infrastructure, not product.
5. **#9** — a ruling first. Not built on the strength of this audit alone.

## Gates every one of these must pass

`dotnet build ClimateProject.slnx -c Release` · `dotnet test` on the **solution**, ~18 min,
Docker, one at a time under `mkdir /tmp/climate-dotnet-suite.lock` · `npm run typecheck`
(`tsc -b`), `npm run build`, `npm test`, `npm run lint` (`oxlint --max-warnings 10`, a hard
ceiling) · no user-facing English literals, keys added to **both** `en.json` and `es.json` ·
the suite has no layout engine, so render with `npm run shot` and **read the PNG**.

**While ESPH is live to Friday 30 Oct 17:59 CR, every change here is admin-only.** Web merges
reach production instantly through Vercel, so a respondent-facing change would reach live
respondents mid-survey.
