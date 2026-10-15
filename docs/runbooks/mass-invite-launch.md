# Runbook: launching a mass-invite climate survey

For the shape ESPH asked for: a few hundred people are uploaded from a spreadsheet, each is
mailed a generated `usuario` and a temporary password, and an administrator watches who has
finished and chases the rest.

Every claim here is measured against the code it names. As of 2026-10-15 every step it describes
is merged and deployed — production serves `62b461dd` — so nothing here is waiting on a branch.
What is still unproven is in §4, and it is unproven by a human rather than by code.

## 0. Before the invite goes out

**Name the company exactly as it should appear in the username — before the first import, not
after.** `MassInviteCredentials.PrefixFor` folds the company name to lower-case alphanumerics and
cuts it at **8 characters**, then appends `-` plus eight more. "Empresa de Servicios Públicos de
Heredia" therefore mails `empresad-k7m2q9xa`; a company recorded as "ESPH" mails `esph-k7m2q9xa`.

There is no later fix. A resend keeps the username and replaces only the password
(`ResendManyAsync`), so a person imported under the long name keeps `empresad-…` for the life of
the account. This is the one step in this runbook with a hard ordering requirement.

**The survey may stay anonymous, and an anonymous survey still says who finished.** The two
things the client asked for — *"obviamente no puedes asociar las respuestas con cada uno de esos
correos"* and *"saber quiénes han respondido"* — are both served, by keeping them in separate
tables with no column to join them by
(`docs/decisions/participation-is-not-linked-to-answers.md`).

What actually happens when a signed-in person finishes an anonymous survey: the answers are
written with `user_id` NULL — `SurveyResponseEndpoints.Respondent.StoredUserId` returns null for
an anonymous survey, so they carry no user id and cannot acquire one later — and
`RecordAccountParticipationAsync` then writes one row into `survey_participations` holding the
name, the lower-cased email and a calendar day, taken from the account the import created.
Nothing is asked of the respondent and nothing new is collected. The roster matches that row back
by email, which is the key the table's unique index is built on and the one a resend cannot
change.

**So choose the mode knowing which question each can answer:**

| | anónima | identificada |
|---|---|---|
| terminó | yes, by email | yes |
| no terminó | yes | yes |
| **empezó pero no terminó** | **no** | yes |
| an answer traceable to a person | no, and cannot become so | stored, shown nowhere |

The middle row is not a gap in the screen, it is unknowable: with no user id on the answers, a
half-finished response belongs to nobody, so somebody who stopped halfway is indistinguishable
from somebody who never opened it. The roster says `not_completed` rather than `not_started`
precisely so it does not claim otherwise (`SurveyParticipationEndpoints.BuildRosterAsync`).

**This cannot be changed once anybody has answered**, because the answers already written carry
no user id and nothing can supply one.

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

**Load the whole file; the wizard sends it in batches of a hundred.** Each row costs one bcrypt
hash at work factor 12 — measured at 1.09 s on the 0.25 vCPU instance production ran until
2026-10-15, so about 0.27 vCPU-seconds, and the instance is 1 vCPU now — and the emails then go
sequentially through a process-wide pacer defaulting to 10 a second. Roughly
`rows x 0.27 + rows / 10` seconds:

| rows in one request | | |
|---|---|---|
| 100 | ~37 s | fine |
| 200 | ~74 s | fine |
| 300 | ~111 s | 9 s of margin |
| 400 | ~148 s | **killed** |
| 800 | ~296 s | **killed** |

**App Runner ends every HTTP request at 120 seconds and the limit is not configurable** — *"There
is a total of 120 seconds request timeout limit on the HTTP requests"* (AWS, *Developing
application code for App Runner*). So the whole 800-person file in one request cannot finish.
`IntakeWizard` therefore sends one request per `IMPORT_CHUNK_ROWS` (100) rows and reports
progress across them; eight batches of a hundred is about five minutes with a count on screen.
Splitting the spreadsheet by hand is no longer necessary.

The preview is deliberately still one request for the whole file — it hashes nothing and mails
nothing, and it is the only place the server can see an email repeated at rows 50 and 150 as a
repeat. Preview the real file at full size; it creates nothing
(`A_preview_creates_no_account_and_sends_nothing`).

**If it stops part-way, do NOT load the file again.** The accounts in each batch commit before
that batch's emails, so the screen reports how many people landed and tells you to import the
remainder in a new file and use the people list to resend to anyone who was not mailed. Loading
the same file again would create the people who already exist a second time.

## 2. Capacity on launch morning

Sign-in is rate limited **per caller address**, and several hundred staff behind one corporate
NAT present one. The ceiling is `RateLimiting:AuthenticationPermitsPerMinute`, default **400**
a minute (`RateLimitPolicies.DefaultAuthenticationPermitsPerMinute`). Live in production since
the deploy of 2026-10-15; before it the figure was 20 a minute and the twenty-first person to try
got a 429 instead of a sign-in page.

**The instance is sized for it.** Production runs 1 vCPU / 2 GB with a minimum of two instances,
a maximum of four, and `MaxConcurrency` 12 (measured from App Runner, 2026-10-15). The
concurrency figure is the one that matters and is deliberately low: each instance holds ten
Npgsql connections (`DatabaseConnectionStringPolicy.DefaultMaxPoolSize`), so a request admitted
beyond that waits on a pool of ten and Npgsql throws rather than queues — and App Runner reads
concurrency as its scale-out signal, so a high number piles a burst onto one instance and never
asks for a second. At 0.27 vCPU-seconds a sign-in that is about 222 a minute per instance, ~444
on the two that are always warm.

It is configuration, so it can be raised without a code change:

    RateLimiting__AuthenticationPermitsPerMinute=600

Do not set it above `GlobalPermitsPerMinute` (600): every one of these requests also passes that
coarser ceiling, so a higher number only moves the refusal to the other limiter.

To measure rather than assume, against a LOCAL api only — the script refuses any non-localhost
`--api` in code, because pointing a few hundred sign-in attempts at a deployed environment is a
denial of service against real respondents:

    node scripts/load-signin.mjs --api http://localhost:5000 --people 300

## 3. Watching it, and chasing the rest

The roster lives under the survey's distribution screen.

- Filter to the people who have not finished, select them, and send.
- **The reminder replaces their password and signs them out.** `ResendManyAsync` generates a new
  password and rotates the security stamp for everyone it mails — and the roster filter selects
  precisely the half-finished, so the mail chasing them is also the mail that ends their session.
  The reminder copy says so.
- Send at most 100 at a time; the client chunks automatically (`MaxBatch = 100`).
- A half-finished survey is not lost: a signed-in respondent resumes
  (`SurveyResponseEndpoints.cs`, `AllowPartialResponses` defaults true).

## 4. What is still unproven

Everything below needs a person, not a commit. Doing them in this order proves each link in the
chain before the one that depends on it.

1. **Rename the company to ESPH** (§0). Nothing else may happen first.
2. **Decide anónima or identificada** (§0). Irreversible once anybody answers.
3. **Import ONE row — yourself — through the wizard, with CREDENTIALS.** This single action is
   the only test of the whole untested chain: account → generated `usuario` → email → SES →
   a real inbox → the greeting → the link → signing in with a generated username → answering →
   leaving → resuming on another device → finishing. It also proves step 1, because the username
   it mails will read `esph-…` or it will not.
   - **No credentials email has ever reached a real inbox.** Production logs its own configuration
     at startup — SMTP to `email-smtp.us-east-1.amazonaws.com:587`, STARTTLS on, as
     `no-reply@timsint.com`, paced at 10 a second — and forty hours of those logs contain no
     `not verified`, no `SmtpException` and no `Configuration set` error. That is an absence of
     failure, not a delivery.
4. **Preview-import the real spreadsheet at full size.** Creates nothing, sends nothing. The
   EAGLE workbook failed with 26 problems; a different shape is a different outcome, and this is
   where you find out for free. Check the "macroproceso" mapping here above all (§1).
5. **Then the real import.** One file, the wizard batches it (§1).

Not proven and deliberately not attempted: **a live load test at 300–800 concurrent sign-ins.**
`scripts/load-signin.mjs` refuses any non-localhost `--api` in code, and localhost measures the
operator's laptop rather than the instance. The arithmetic in §2 is a measurement of one sign-in
multiplied out, which is a different and weaker thing than having watched 800 people arrive.
