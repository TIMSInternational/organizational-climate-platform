# Runbook: launching a mass-invite climate survey

For the shape ESPH asked for: a few hundred people are uploaded from a spreadsheet, each is
mailed a generated `usuario` and a temporary password, and an administrator watches who has
finished and chases the rest.

Every claim here is measured against the code it names. Where a step depends on an unmerged
pull request this says so, because the step does not exist until it merges.

## 0. Before the invite goes out

**Name the company exactly as it should appear in the username.** `MassInviteCredentials.PrefixFor`
folds the company name to lower-case alphanumerics and cuts it at **8 characters**, then appends
`-` plus eight more. "Empresa de Servicios Públicos de Heredia" therefore mails
`empresad-k7m2q9xa`; a company recorded as "ESPH" mails `esph-k7m2q9xa`. Cheap to fix before the
invite and awkward afterwards, because a resend keeps the username and only replaces the
password.

**The survey may stay anonymous.** It does not have to be identified for the roster to work:
completion is recorded in `survey_participations`, a separate table from the answers with no
column on either side to join them (`docs/decisions/participation-is-not-linked-to-answers.md`).
*Needs the branch `completion-without-linking-answers`.* Before that branch, an anonymous survey
reports no per-person state at all.

## 1. Importing the roster — the step that is easy to get wrong

**Choose CREDENTIALS, not invitation.** `BulkImportRowsInput.WithCredentials` defaults to
**false** and the wizard's radio defaults to `'invitation'`. Clicking straight through gives
every person the old self-service invitation — an email asking them to choose their own
password, with **no `usuario` at all** — and no roster row that a resend can reach. The default
is deliberate; it is simply not the one this launch wants.

**Use the wizard, not a CSV upload.** The CSV route passes `withCredentials: false`
unconditionally (`BulkImportEndpoints.cs`), so it can never produce a mass invite however the
screen is set. Only the wizard's reviewed-rows path can.

**Demographics arrive only through the wizard's column mapping.** The downloadable template has
four columns — nombre, correo, rol, departamento (`IntakeWorkbook.cs`) — and carries no
demographics whatever. "Macroproceso", "antigüedad" and "edad" reach an account only when the
wizard maps those columns onto the company's demographic fields.

**Map "macroproceso" deliberately.** If it lands on a demographic field rather than on
Departamento, the imported people have `DepartmentId = null`, and a survey targeted at
departments is invisible to all of them (`SurveyQueries.cs`) while the roster still lists them.
Either map it to Departamento or leave the survey untargeted.

**Expect the import to take minutes, and do not retry it.** Each row costs one bcrypt hash at
work factor 12 (~0.25–0.4 s), and the emails then go sequentially through a process-wide pacer
defaulting to 10 a second. For 800 rows that is several minutes in a single HTTP request. The
accounts commit **before** the emails are sent, so a client-side timeout can leave accounts
created whose owners were never told their password — recover with the roster's resend, never by
importing again.

## 2. Capacity on launch morning

Sign-in is rate limited **per caller address**, and several hundred staff behind one corporate
NAT present one. The ceiling is `RateLimiting:AuthenticationPermitsPerMinute`, default **400**
a minute (`RateLimitPolicies.DefaultAuthenticationPermitsPerMinute`). *Needs the branch
`signin-capacity-for-800`;* before it the figure is 20 a minute and the twenty-first person to
try gets a 429 instead of a sign-in page.

It is configuration, so it can be raised without a code change:

    RateLimiting__AuthenticationPermitsPerMinute=600

Do not set it above `GlobalPermitsPerMinute` (600): every one of these requests also passes that
coarser ceiling, so a higher number only moves the refusal to the other limiter.

To measure rather than assume, against a LOCAL api only — the script refuses any non-localhost
`--api` in code, because pointing a few hundred sign-in attempts at a deployed environment is a
denial of service against real respondents:

    node scripts/load-signin.mjs --api http://localhost:5000 --people 300

## 3. Watching it, and chasing the rest

The roster lives under the survey's distribution screen. *Needs #563.*

- Filter to the people who have not finished, select them, and send.
- **The reminder replaces their password and signs them out.** `ResendManyAsync` generates a new
  password and rotates the security stamp for everyone it mails — and the roster filter selects
  precisely the half-finished, so the mail chasing them is also the mail that ends their session.
  The reminder copy says so. *Needs #564;* before it the bulk send re-reads as the original
  invitation.
- Send at most 100 at a time; the client chunks automatically (`MaxBatch = 100`).
- A half-finished survey is not lost: a signed-in respondent resumes
  (`SurveyResponseEndpoints.cs`, `AllowPartialResponses` defaults true).

## 4. What is still unproven

- **No credentials email has ever reached a real inbox.** Send one to yourself before the launch.
- **No human has done the round trip** — mail, sign in, answer, abandon, resume, finish.
- **The client's own spreadsheet has never been loaded.** The EAGLE workbook failed with 26
  problems; a different shape is a different outcome.
