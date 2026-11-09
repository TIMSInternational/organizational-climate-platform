# Decision: what a TIMS operator may undo, exclude or delete from the screen

**Status: RULED 2026-11-08.** Owner: Federico. Built the same day (branch `operator-rulings`).

The 8 Nov operator walkthrough (`docs/audits/2026-11-08-operator-ui-walkthrough.md`, §E) left four
operations that only a developer could do. Three of them the product refused **on purpose**, so they
were rulings before they were code. Federico ruled all four on 2026-11-08, each the recommended
option, quoted here as offered:

| | Ruling |
|---|---|
| Reopen a closed survey | **"Super admin + date + reason"**: «Reabrir» on a closed (not archived) survey, TIMS only. A new future close and a written reason, kept in the activity log. Warns that results already delivered will change. The link, QR and codes keep working. |
| Take one response out of the results | **"Reversible, from the roster"**: TIMS only. On the row of someone who finished, «Excluir de los resultados» + reason. The answer stays stored but leaves every result, report, export, dashboard and the response workbook; it can be put back. Answers are never shown. Only where the response can be traced to the person. |
| Delete a company or a person | **"Empty companies + erase people"**: a company only if it has no responses, after typing its name; one with responses stays a developer request (the survey rule, one level up). A person: «Eliminar persona» runs the existing GDPR erasure. |
| A client's own questionnaire | Load it from the screen (the audit's "build" row). Built as **«Pegar desde Excel»** in the survey wizard. |

## Reopen — `POST /surveys/{id}/reopen`

- Super admins only (403 otherwise). Only `closed` (409 `survey_not_closed`). A reason of 5–200
  characters (400 `survey_reopen_reason_required`). A new close at least 30 minutes ahead and after
  the opening (400 `survey_reopen_end_too_soon`) — the lifecycle sweep runs every five minutes.
- Writes status and close in ONE save; the new status is `active`, or `scheduled` when the survey
  was closed before it ever opened. That is all a close ever wrote, so nothing else is undone.
- `closed -> active` stays OUT of `SurveyStatuses`' transition map, so `PUT /status` and every client
  administrator keep refusing it. The route is the sanctioned exception, with the cost said on screen.
- Audit: filed under the survey's company (a company-less operator would otherwise write no row), with
  `status`, `endDate` and `reason`.

## Exclude a response — `POST /surveys/{id}/response-exclusions[/restore]`

- `responses.excluded_at` (migration `OperatorRulings`). The row and its answers stay.
- A **named EF query filter**, `ResponseQueryFilters.Counted`, hides excluded rows from EVERY query by
  default — results, statistics, real-time counts, reports, PDFs, CSVs, the response workbook,
  dashboards, benchmarks, question-bank metrics. A results reader written later that never heard of
  exclusions still excludes. The opt-outs are exactly the reads about the PERSON or the ROW:
  the respond flow (an excluded person answered and must not be offered the survey again), the
  roster and "my surveys", every "has this survey been answered" guard (survey delete, revert, key
  withdrawal, the company deletion check) and GDPR access/erasure/compliance.
- `surveys.response_count` moves with it (relative update, so a concurrent completion is not lost).
- Found by the person: user id on an identified survey, the derived resume id on an anonymous one.
  A response through a public link has neither and is refused (409 `exclusion_no_response`).
- **Privacy.** Whoever knows whose response left and compares results before and after can
  recover that person's answers by subtraction. So: super admins only; the person travels in the
  request BODY (the audit trail records the path, never the body); the audit row's resource is the
  survey and it carries the reason, never the person; the roster's `excludedFromResults` is true for
  super admins only. The confirmation states the subtraction risk and that the reason is readable by
  the client's administrators. At database level the exclusion is attributable (as the derived
  session id already is to anyone holding the database and the key) — that is not new exposure.

## Delete a company — `GET /admin/companies/{id}/deletion`, `DELETE /admin/companies/{id}`

- Super admins only; the company's name typed exactly (400 `company_name_mismatch`).
- Refused while it holds ANY answer — counted or excluded responses, a microclimate that took one,
  a link participation (409 `company_has_responses`) — or a super admin, whose account would go with
  it (409 `company_holds_super_admins`).
- Deleted table by table in one transaction (`CompanyDeletionEndpoints.DeleteEverythingOfAsync`):
  people's manager links and self-referencing parents cleared first, surveys before people (their
  RESTRICT edges into users), company-owned templates/library/bank/categories **deleted explicitly**
  — their company key is SET NULL and null means GLOBAL, so the cascade would have published a
  client's private questionnaire to every tenant. Anything still referenced from another tenant rolls
  the whole thing back (409 `company_people_referenced`).
- **`audit_logs` lost its two foreign keys** (same migration). `company_id` was RESTRICT — no company
  with history could be deleted without deleting the history, which the append-only rule forbids —
  and `user_id` was SET NULL, so a person's deletion rewrote their audit rows behind
  `AuditLogAppendOnlyInterceptor`. Both ids stay as written. The deletion's own row is filed under
  the deleted company's id.

## Delete a person — «Eliminar persona»

- The existing `POST /gdpr/erasure` (pseudonymisation, `docs/compliance/gdpr-subject-rights.md`),
  now behind a button in the super admin's person editor, with the person's email typed to confirm.
  Name, email and password overwritten, account closed, survey codes deleted, answers kept
  anonymous in the results, audit kept. It erases excluded responses too (opt-out above).
- `GET /admin/users` leaves erased accounts out (their email ends `@erased.invalid`): a row reading
  "Erased user" in the list it was deleted from would read as the delete having failed.

## A client's questionnaire — «Pegar desde Excel»

- In the wizard's add-question menu. The operator copies the rows in Excel and pastes them; picks the
  question column per survey language, the dimension and the type column (or one type for all) and
  the scale's end words; sees every row before anything is added.
- Verbatim or not at all, the rule `build-instrument-from-workbook.mjs` followed: a type that cannot
  be read ("Ranking", "5-1") is named by its line and nothing is added; bounds are read
  ("Likert 1-5", "Escala 1 a 7"), and 0–10 is a `rating`, as the script decided for eNPS.
- Paste, not upload: no spreadsheet dependency, and the sheet's shape — PROCOMER's had four wording
  columns — stays the operator's to choose. The library importer script stays for the question
  library itself.

## Still a developer request

- Deleting a company that **has** answers.
- Excluding a response that cannot be traced to a person (public link).
- Reopening an **archived** survey.
