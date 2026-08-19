# Decision: the API process is the scheduler (#275)

Recorded 2026-08-19 against `1567e70`, after the fact — the code landed before the decision
was written down, which is the gap this file closes. #275's first acceptance criterion asks
for the choice to live in `docs/decisions/`; until now it existed only as a comment in
`src/ClimateProject.Api/ClimateProject.Api.csproj`.

## The incident this comes from

`Dockerfile.workers` existed at the repo root and was referenced by **no workflow**.
`ClimateProject.Api.csproj` had no `ProjectReference` to `ClimateProject.Workers`, and
`infra/aws/` defined exactly one service. So every job in `WorkerJobs.All` —
`notification-dispatch`, `invitation-reminders`, `digests`, `scheduled-reports`,
`survey-draft-retention`, `retention-cleanup` — had **never run in production**, while the
legacy Vercel cron kept running `/api/cron/send-reminders` every 15 minutes.

Nothing anywhere reported this. That is the actual defect: not that the workers were
undeployed, but that being undeployed was invisible.

## The two options, and the choice

**Chosen: co-host.** `Program.cs` calls `AddClimateProjectScheduling`, so the six jobs and
the heartbeat monitor ship inside the API image that `deploy-prod.yml` already builds.

**Rejected: a second App Runner service** built from `Dockerfile.workers`. It is not wrong —
the advisory-lease design in `docs/superpowers/specs/2026-08-06-scheduling-design.md` makes
either correct — but it doubles the deployable surface, the secret wiring and the rollback
story for six jobs whose combined duty cycle is minutes per hour. `Dockerfile.workers`
remains in the tree as the opt-out path if the jobs ever need a dedicated instance.

**Why co-hosting is safe at any instance count:** every job runs under a Postgres advisory
lease (single-flight), keys its notifications deterministically, and persists its send state.
Twenty-five API instances are exactly one scheduler.

`ClimateProject.Workers` deliberately ships no `appsettings.json` (see `WorkerHostFactory`)
so the reference cannot race the API's own configuration files into the publish output.

## What makes it non-silent

Three independent things, because a monitor sharing a fate with the thing it monitors is not
a monitor:

1. **A positive heartbeat per tick.** Every job logs a structured line on every run, including
   runs that did nothing. #158 alarms on the *absence* of it.
2. **`GET /admin/system/status` reports every job** — interval, last attempt, last success,
   consecutive failures, and a status word — and a `stale` or `failing` job degrades the
   platform verdict. The queue alone could not do this: it only shows a backlog once work is
   *due*, so a dispatcher that died an hour after the last notification looks perfect until
   the next one is scheduled.
3. **`WorkerHostingRegistrationTests`** fails if a worker stops being registered in the API
   host, or if `AddClimateProjectScheduling` stops being called at all.

## Synchronous sends (#275's fourth criterion)

**Survey invitations send synchronously, inside the request.** `InvitationEndpoints.cs:141`
(create) and `:243` (resend) both `await emailSender.SendAsync(...)` in the handler rather
than enqueueing. Everything else — reminders, digests, scheduled reports, notification rows
generally — is enqueued and drained by `notification-dispatch`.

Two consequences worth stating rather than discovering: an invitation send is inside the
caller's latency budget and its failure surfaces as a failed request; and because it never
becomes a notification row, an invitation send is **not** visible in the queue depth or in
`dispatcher.lastDispatchAt`. Whether that should change is not decided here.

## Status

Deployed and live: production `1567e70` reports `dispatcher.lastDispatchAt` advancing, and
`Scheduling:Enabled` defaults to `true` with no override in
`infra/aws/climate-project-api-prod-service.yml`.

**#275 is not closed by this file alone.** Its second criterion asks for jobs demonstrably
executing in production evidenced by a heartbeat — that becomes checkable from the product
once this change deploys and `/admin/system/status` reports all six. Verify there, then close.
