# Audit logging

Issue #143. What the audit trail records, how, what it deliberately does not record, and
what is still missing.

## The mechanism

`AuditWritingMiddleware` (`src/ClimateProject.Api/Infrastructure/Auditing/`) writes one
`audit_logs` row per audited request. It sits between `UseAuthentication` and
`UseAuthorization` in `Program.cs`.

A request is audited when its method is POST, PUT, PATCH or DELETE — no opt-in, no
registration, no per-endpoint call — or when the endpoint carries
`AuditSensitiveReadAttribute`. The only way out is `AuditExemptAttribute`, and
`AuditCoverageTests` asserts the exempt set exactly, so adding one fails the build until it
is written down there with its reason. The set is empty today.

**Middleware rather than a `SaveChanges` interceptor.** The issue offered either. Reads call
no `SaveChanges`, so an interceptor cannot answer "who read this report" or "who exported
this data" at all; and a mutating request that is refused, or that changes nothing, produces
no tracked change either, which is exactly the attempt a security trail wants. The
interceptor that does exist, `AuditLogAppendOnlyInterceptor`, does the one job it is better
at: refusing UPDATE and DELETE of an audit row.

### What a row contains

| Column | Source |
| --- | --- |
| `user_id` | the acting user, resolved from `sub` via `ActingUserResolver` |
| `company_id` | that user's own `users.company_id` — never the token's `companyId` claim |
| `action` | `{resource}.{verb}`, e.g. `admin.benchmarks.update` |
| `resource` | the route pattern's static segments, dotted: `/surveys/{id}/status` → `surveys.status` |
| `resource_id` | the last Guid-valued route value, or what the handler set |
| `success`, `error_message` | the response status; the exception *type name* if one was thrown |
| `details` | `{method, path, status}` as jsonb |
| `ip_address` | the socket peer |

A handler can improve `action`, `resource` and `resource_id` through the scoped `AuditEntry`
service. Nothing it can do stops a row being written.

### What is deliberately not recorded

Request bodies and query strings. Bodies here carry passwords (`PUT /profile/password`,
`/auth/login`) and free-text survey answers; query strings carry demographic filters. This
is a long-retention table readable by every CompanyAdmin in the tenant, and copying any of
that into it would create a second, worse copy of the data the product exists to protect.
Exception *messages* are not stored either — Npgsql and EF messages contain the database
host, the failing SQL and row values — only the exception's type name.

## Reading it

`GET /audit/logs`, `/audit/report`, `/audit/export`, `/audit/{resource}/{resourceId}`.
SuperAdmin sees every tenant; CompanyAdmin sees their own and cannot widen it (the
`companyId` parameter is ignored for them, not honoured); every other role gets 403. An
employee's own history is `GET /profile/activity`, filtered on their user id.

`GET /audit/export` is itself audited. Pulling a copy of the trail appears in the trail.

## Append-only

`AuditLogAppendOnlyInterceptor` is registered on the `ClimateProjectDbContext` in both the
API and the worker. Any `SaveChanges` with a Modified or Deleted `AuditLog` or
`SurveyAuditLog` throws.

**This is not the complete guarantee.** It does not cover raw SQL, `ExecuteUpdate` /
`ExecuteDelete`, or anything else holding the database credentials. The complete version is
a `BEFORE UPDATE OR DELETE` trigger, or `REVOKE UPDATE, DELETE ON audit_logs,
survey_audit_logs` from the application role. Both are schema changes and #143's wave
permitted exactly one migration, on another branch. **Outstanding.**

## `survey_audit_logs` is not a duplicate trail

There are two tables and they answer different questions:

* `audit_logs` — a request happened: who, from where, on what, and whether it succeeded.
* `survey_audit_logs` — what changed *inside* a survey's content, with the field-level diff
  (`changes` jsonb) and the version number, which `GET /surveys/{id}/history` renders and
  `audit_logs` has no column for. Written by `SurveyAuditTrail` inside the handler's own
  unit of work, which is why it only ever records what committed.

Merging them into one table needs a migration. What #143 did instead is stop them being two
*trails to read*: `GET /audit/surveys/{id}` returns both, merged, ordered and tagged by
`AuditSources`, and the append-only guard covers both tables.

## Retention

**No automatic deletion. Rows are kept indefinitely, and nothing in the product deletes
them.** That is the current state, not a considered retention period, and it is stated here
so it is not mistaken for one.

The reasons not to add a purge job in #143: the append-only interceptor would have to be
given an exception for it, which is the one hole an attacker would want; and a retention
period is a policy decision about a product holding confidential employee opinion, not an
implementation detail. When one is set, the job belongs in `ClimateProject.Workers` and must
delete by age alone — never by actor, company, action or outcome, since a purge that can be
aimed is a purge that can be used to erase a specific event.

Volume, so the decision is informed: one row per mutating request, plus report views and
exports. Reads are not audited by default precisely to keep this bounded.

## GDPR: audit records are excluded from erasure

A subject-access erasure request (Art. 17) **does not delete that person's audit rows**, and
this is deliberate.

* The lawful basis is legitimate interest / legal obligation (Art. 17(3)(b), (e)) — a
  security trail that a subject can erase is not a security trail, and "who exported this
  data" cannot be answered afterwards by a table the exporter could empty.
* `audit_logs` stores no free-text personal data: a user id, a company id, an action name, a
  path, an IP address and a user agent. The identifying columns are foreign keys, so erasing
  the `users` row is what removes the name and email; `audit_logs.user_id` carries `ON DELETE
  SET NULL`, so a deleted user's rows survive as anonymous records of the actions.
* `survey_audit_logs` is the exception worth knowing about: it *denormalises* `user_name`,
  `user_email` and `user_role` onto every row on purpose, so history reads correctly after a
  rename. Those three columns are personal data that outlives the `users` row and an erasure
  request has to address them explicitly. Its `user_id` FK is `RESTRICT`, so the `users` row
  cannot be deleted while they exist at all. **Unresolved** — see below.

## Known gaps

1. **Unauthenticated mutating endpoints write no row.** `/auth/login`, `/auth/signup`,
   `/auth/google`, `POST /invitations/{token}/accept`, the two anonymous response
   submissions and the by-token distribution callbacks. `audit_logs.company_id` is NOT NULL
   behind a RESTRICT foreign key, so a request with no resolvable tenant has no row that can
   legally be inserted. The middleware logs a warning for each. Closing this means making
   `company_id` nullable — a migration.
2. **A company-less SuperAdmin (#191) is unattributable**, for the same reason.
3. **Creates record no `resource_id` unless the handler sets one.** A create has nothing in
   its route to name the row it made, and no endpoint in this application returns a
   `Location` header (`Results.Created` appears zero times). `DepartmentEndpoints.CreateAsync`
   sets it as the worked example; the other creates are a line each.
4. **A request refused before it reaches an endpoint is not audited** — a 401 from the
   authentication middleware has no endpoint and no resource to name.
5. **Retention and the `survey_audit_logs` erasure question above are both open.**
