# The agent's AWS credentials are administrative, and the read-only rule is not enforced

**Status: FINDING RECORDED 2026-09-05. Remediation DECIDED, NOT YET APPLIED — it is Federico's
to run, and there is a trap in it (§4).**

## 1. The finding

`CLAUDE.md` states, as a rule an agent must follow:

> Do not log in to production, query its database, or call its authenticated endpoints.
> **AWS is read-only for an agent (describe/list/get).**

That sentence describes a convention, not a permission. Measured 2026-09-05:

```
$ AWS_PROFILE=claude aws sts get-caller-identity
{
    "UserId": "AIDA24HJRP3SVS6TJPY7D",
    "Account": "747814092517",
    "Arn": "arn:aws:iam::747814092517:user/claude-code-agent"
}

$ aws iam list-attached-user-policies --user-name claude-code-agent
AdministratorAccess          arn:aws:iam::aws:policy/AdministratorAccess
SecurityAudit                arn:aws:iam::aws:policy/SecurityAudit
claude-code-agent            arn:aws:iam::747814092517:policy/claude-code-agent

$ aws iam list-user-policies   --user-name claude-code-agent   →  []   (no inline policies)
$ aws iam list-groups-for-user --user-name claude-code-agent   →  []   (no groups)
```

The customer-managed `claude-code-agent` policy (v1, the default version) is **Allow-only** and
unrelated to this product — `s3:GetObject`, `s3:ListBucket`, `transcribe:GetTranscriptionJob`,
`transcribe:ListTranscriptionJobs` on `tims-english-audio`. There is **no `Deny` statement
anywhere** on this principal.

**Effective permission on the production account is therefore `AdministratorAccess`.** Any agent
session on this laptop can delete the App Runner service, the database's backups, or the IAM
user itself. The only thing that has prevented it is that the agent read `CLAUDE.md` and chose
to comply.

## 2. Why this is worth a file rather than a shrug

Two reasons specific to this project, not general security hygiene.

- **A government client's employee-survey data is about to arrive.** UAT (#161) runs against
  live production, because there is no staging. The window in which this account holds real
  personal data starts at UAT, not at go-live.
- **This account is the break-glass path.** Cutover's rollback plan treats "GitHub Actions is
  unreachable" as a scenario with no answer. It has one — these credentials — which is why the
  answer is *not* "delete the user". The goal is to keep break-glass and lose standing admin.

## 3. The decision

**Attach a permissions boundary so the agent principal is genuinely read-only**, ruled by
Federico on 2026-09-05.

One documented exception, established the same day: **reading production CloudWatch Logs is
permitted**, logs only. See `CLAUDE.md` and §5 below.

## 4. The trap — read this before applying it

**The same IAM user serves a different product.** Its customer-managed policy grants S3 and
Transcribe access to `tims-english-audio`, which has nothing to do with the climate platform. A
boundary written from this project's needs alone will silently break that one — and it will
break it the way IAM always does, as an `AccessDenied` in something nobody is currently looking
at.

So the boundary must allow, as a union:

1. `describe*`, `list*`, `get*` across the services this project reads (App Runner, CloudWatch
   Logs, CloudFormation, SES, IAM read).
2. `logs:FilterLogEvents` and `logs:GetLogEvents` — the CloudWatch exception in §3.
3. The existing `tims-english-audio` S3 and Transcribe actions, unchanged.

And after applying it, **exercise the other product once** before considering the change done.

An alternative that avoids the shared-principal problem entirely, and is probably the better
shape: leave `claude-code-agent` to the other product, and create a **separate, boundaried
principal** for this repository's agent sessions. That also makes the break-glass credential a
deliberate, separately-held thing rather than a side effect.

Either way this is a production IAM change and it is not an agent's to make — including when
the agent is the one being restricted.

## 5. What was actually done with the access

For the record, so the next reader does not have to wonder:

- **2026-09-05** — production CloudWatch Logs read once, under the explicit ruling above, and
  filtered to eight known literals rather than dumped: `filter-log-events` with
  `--filter-pattern '"Heartbeat: scheduled job"'` over a 24-hour window. Result: all eight
  scheduled jobs heartbeating at their designed cadences. This closed cutover gate **A1**'s exit
  criterion. See `docs/audits/2026-09-05-gap-closures.md`.
- No write call has been made against this account by an agent.

## 6. Related

- `docs/security/rotation-inventory.md` — #70. If these credentials are rotated rather than
  boundaried, that is where the rotation belongs.
- `docs/runbooks/rollback.md` — the break-glass path these credentials underwrite.
- `CLAUDE.md` — the rule this file measures.
