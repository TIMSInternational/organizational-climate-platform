# Local review — 15 October 2026

This review combines `origin/main` at `ab4981fd` with the unmerged invitation-email,
anonymous-completion/resume, and single-dimension-floor changes from Claude's worktrees.
The review branch is `codex/local-review-20261015`, checked out at `/tmp/climate-local-review`.
The original checkout and Claude's worktrees remain unchanged.

## Open the application

<http://localhost:5173/login>

| Account | Password | Use |
| --- | --- | --- |
| `ana.rojas@meridiano.test` | `Demo1234!` | Company administrator; use this for the walkthrough and Seguimiento |
| `revision.resume@meridiano.test` | `Demo1234!` | Employee with question 1 already saved in the active verification survey |
| `revision.fresh@meridiano.test` | `Demo1234!` | Employee who has not answered either verification survey |
| `revision.done1@meridiano.test` | `Demo1234!` | Employee recorded as finished in the active verification survey |
| `fede.super@acme.test` | `Local1234!` | Existing local super administrator; select the company before reviewing tenant features |

These are local demonstration accounts, not production credentials. Use a separate browser
profile/private window for the employee so the administrator session stays open.

## Where to verify the work

| Feature | Local page | What to check |
| --- | --- | --- |
| Tracking connection | <http://localhost:5173/tracking> | Five plans across three nodes load, without the service-unavailable banner. Tracking remains a separate API on 5091. |
| Plan detail and owners | <http://localhost:5173/tracking/planes> | Open a plan, inspect owner, deadline, progress and traffic-light status. |
| Single-department results | <http://localhost:5173/surveys/e03db5bb-3068-4898-b46f-2694671d3ae0/results> | The local verification survey has Finanzas = 1 and Ingeniería = 2 completed responses. Both departments show results. Select either department and confirm its own result remains visible. |
| Dashboard agreement | <http://localhost:5173/dashboard> | The latest closed verification survey's department map agrees with its results page. The server's group minimum is used, with a fallback of 1. |
| Departments and trends | <http://localhost:5173/departments> and <http://localhost:5173/surveys/climate-trends> | Small departments are not hidden merely because they have fewer than three responses. |
| Completion roster, user names, reminders | <http://localhost:5173/surveys/52f35d72-f1b6-4c88-a74a-aee5abed72da/distribution> | `revision.done1` is finished; `revision.resume` is unfinished. Anonymous surveys do not pretend to distinguish never-opened from partly answered. Inspect the roster's user/role columns and reminder controls. |
| Cross-device resume | <http://localhost:5173/surveys/52f35d72-f1b6-4c88-a74a-aee5abed72da/respond> | Sign in as `revision.resume`. The first answer (4) is saved. Leave before submitting, sign in as the same person in another browser, and reopen this URL. Continue from saved progress. |
| Fresh respondent copy | Same respond URL, as `revision.fresh` | Read the anonymity notice and the save/resume explanation. Complete the survey, then refresh the administrator's roster. |
| Reports and exports | Results page above; <http://localhost:5173/admin/companies/16c97c29-07f8-4522-86fc-e6cc56298829/reports> | Authenticated exports/reports agree with the results screen. A public report link independently enforces 3 and may omit more rows to prevent subtraction. |
| Bulk import and credentials | <http://localhost:5173/admin/companies/16c97c29-07f8-4522-86fc-e6cc56298829/users> | Import/credential actions show delivery results and generated user names. The invitation greets the full name; reminder copy asks the recipient to sign in and answer. Local email delivery is disabled, so this verifies UI/logged composition, not actual delivery. |

Only the clearly labeled “Verificación local” surveys and six `revision.*` accounts were added
for this review. Existing surveys and account passwords were not reset. The closed fixture is
anonymous, with three signed-in completions; the active fixture has one completion and one
partial response. Both were created through application endpoints, without direct database writes.

## Rules retained

- A whole survey needs three completed responses before scores are disclosed.
- Within a qualifying survey, a single department or demographic value reports from one response.
- Crosses of two or more demographic fields retain the floor of three and complement checks.
- Public report links and tracking findings retain three.
- The employee's last-outcome department-name disclosure retains three, as in Claude's handoff.
- Anonymous completion records are separate from answer rows; unauthenticated public-link answers
  do not establish which account completed a survey.

The verification survey deliberately has no additional demographic fields. To manually exercise
multi-field crosses, use a survey whose completed responses already contain two categorical
fields; creating a field afterward does not retroactively add values to existing responses.
The automated regression suite covers the below-three cross and whole-survey cases.

## Restart all services

Stop the currently running local services first, then:

```sh
cd /tmp/climate-local-review
bash scripts/dev-local.sh
```

Requires the existing local PostgreSQL databases, installed web dependencies and development
user-secrets for both APIs. The script checks ports, starts the climate API (5080), tracking API
(5091), and web (5173), waits for their health endpoints, and reports startup failures. Logs go
to `/tmp/climate-dev/`. Keep its terminal open; Ctrl+C stops the stack.

## Production and validation

Public production `GET /version`, measured during this review, still returned
`900dda7ad5890d6d8127da3525eaa1dcc2441357`. This review does not deploy or change production.
The local branch must be reviewed/merged and the resulting revision deployed before these
changes become production behavior. Production mail delivery and production tracking
provisioning are separate from the verified local stack.

A generated-username account is available for the invitation flow: `grupomer-w776vb7h`
(`revision.generado@meridiano.test`, Revisión Usuario Generado). Its local temporary password
is in `/tmp/climate-generated-user.json`. The import returned `credentials_not_sent`, as expected
with the local logging-only mail sender. The account's login was verified. Search its username
in the distribution roster: it initially appears as **Sin terminar**. The generated credential
email links to `/login`; it is distinct from an unauthenticated public survey URL.

## Acceptance checklist

- [x] Local API, frontend, and tracking respond; authenticated tracking returns HTTP 200.
- [x] Admin and super-admin demo credentials verified.
- [x] Generated username can sign in and appears in the named completion roster.
- [x] A one-person department appears both in the breakdown and when selected alone.
- [x] Cross-device resume works through two independent sessions.
- [x] Resume regression test rejects an intentionally unstable resume key (mutation build succeeded; test failed as expected; source restored).
- [x] Main and tracking Release builds pass.
- [x] Main unit suite: 1,823 passed.
- [x] Frontend: typecheck, production build, lint, and 5,662 tests pass (1 skipped).
- [ ] Final integration and tracking results: pending below.
- [ ] User acceptance of local screens and copy.
- [ ] Review/merge the consolidated branch and deploy its revision.
- [ ] Verify actual credential/reminder delivery in an environment configured to send email.
- [ ] Verify deployed API/web/tracking versions and production health after deployment.

Validation results are recorded below when the final runs finish.
