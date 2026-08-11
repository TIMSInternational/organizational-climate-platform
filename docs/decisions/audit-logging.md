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

**Deciding "audit" is not the same as auditing, and the test knows the difference.**
`audit_logs.company_id` is NOT NULL, so a request whose caller the application never
identified has no tenant to file under and no row is written. That is a property of the
endpoint, not of the request, so `AuditCoverageTests.Every_mutating_endpoint_is_audited`
reads the live `EndpointDataSource` and asserts *both* halves: every mutating route decides
"audit", and every one of them requires an identified caller except an exactly-pinned set
(`UnattributableMutatingRoutes`). A new mutating endpoint mapped without
`RequireAuthorization()` fails that test instead of silently joining the blind spot, and one
that gains an identified caller fails it too, so the list cannot flatter itself.
`AuditLoggingTests.An_unidentified_mutation_writes_no_row` pins the same fact behaviourally.

**Middleware rather than a `SaveChanges` interceptor.** The issue offered either. Reads call
no `SaveChanges`, so an interceptor cannot answer "who read this report" or "who exported
this data" at all; and a mutating request that is refused, or that changes nothing, produces
no tracked change either, which is exactly the attempt a security trail wants. The
interceptor that does exist, `AuditLogAppendOnlyInterceptor`, does the one job it is better
at: refusing UPDATE and DELETE of an audit row.

What the choice costs, stated plainly: an interceptor is the only one of the two that holds
the before and after values (`EntityEntry.OriginalValues` / `CurrentValues`), so middleware
cannot produce "before/after where meaningful" on its own. See
[Before and after](#before-and-after) for what covers it instead and what is still open.

### What a row contains

| Column | Source |
| --- | --- |
| `user_id` | the acting user, resolved from `sub` via `ActingUserResolver` |
| `company_id` | that user's own `users.company_id` — never the token's `companyId` claim |
| `action` | `{resource}.{verb}`, e.g. `admin.benchmarks.update` |
| `resource` | the route pattern's static segments, dotted: `/surveys/{id}/status` → `surveys.status` |
| `resource_id` | the last Guid-valued route value, or what the handler set |
| `success`, `error_message` | the response status; the exception *type name* if one was thrown |
| `details` | `{Method, Path, Status, Changes}` as jsonb. `Status` is null when the request ended in an exception — the exception handler runs after this row is built, so the status is genuinely not decided yet, and 200 would be a lie. `Changes` is null unless the handler recorded a diff |
| `ip_address` | the socket peer |

A handler can improve `action`, `resource` and `resource_id` through the scoped `AuditEntry`
service, and record before/after values with it. Nothing it can do stops a row being written.

### Before and after

`AuditEntry.RecordChange(field, before, after)` puts a field's old and new value into
`details.Changes`. It is per-field and opt-in, because the handler is the only thing holding
both values and because the alternative — copying whatever changed — would drag request
bodies into the table the section below promises to keep them out of. Identical values are
dropped, and each value is capped at 200 characters.

`PUT /admin/departments/{id}` is the worked example (name, isActive).
`AuditLoggingTests.An_update_records_the_before_and_after_of_the_fields_it_changed` covers
it. Surveys have the richer facility already: `SurveyAuditTrail` writes a field-level diff
and a version number to `survey_audit_logs`, which is what `GET /surveys/{id}/history`
renders.

**Outstanding:** the other mutating handlers record no diff — a line each, the same shape as
the `resource_id` rollout below. Owner: #143 follow-up, to be filed per domain rather than as
one sweep, since "meaningful" differs by entity and secrets must never be passed.

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
employee's own history is `GET /profile/activity`, filtered on their user id **and** on
`resource = 'profile'` — it is the three self-service events its screen has copy for, not a
cross-resource activity feed. A general "everything I did" view needs its own screen.

`GET /audit/{resource}/{resourceId}` matches the resource **as a prefix**. One entity's rows
are filed under whichever route touched it — `surveys`, `surveys.status`,
`surveys.duplicate`, `surveys.responses` — all carrying that entity's id in `resource_id`, so
an exact match answered "what happened to this survey" with a fraction of the answer.
`surveys` now returns itself and everything under `surveys.`; `surveys.status` still narrows
to that route. A route that names a nested row instead (`.../invitations/{invitationId}/revoke`)
records the nested id, so it appears under that id's trail rather than the survey's.

`GET /audit/export` is itself audited. Pulling a copy of the trail appears in the trail.

Every field of the CSV export is prefixed with an apostrophe when it begins with `=`, `+`,
`-`, `@`, a tab or a carriage return. Quoting a field does not stop a spreadsheet evaluating
it, and two of the columns (`user_name`, `user_email`) are strings an ordinary Employee
controls while the reader is by definition an administrator.

## Append-only

`AuditLogAppendOnlyInterceptor` is registered on the `ClimateProjectDbContext` in both the
API and the worker. Any `SaveChanges` with a Modified or Deleted `AuditLog` or
`SurveyAuditLog` throws.

**This is an application-level guarantee, and it is worth being explicit that that is all it
is.** It binds anything going through `ClimateProjectDbContext`'s change tracker; it does not
bind a `DELETE` typed into `psql`, because nothing running inside the application can. The
database-level version is a `BEFORE UPDATE OR DELETE` trigger, or `REVOKE UPDATE, DELETE ON
audit_logs, survey_audit_logs` from the application role — both schema changes, and this wave
permitted exactly one migration, on another branch. *Owner:* #143 follow-up, blocked on the
same migration slot as item 1 below; until it lands, treat database credentials as able to
rewrite history, which is the usual assumption for any audit table without a trigger.

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

## GDPR: `audit_logs` is excluded from erasure; `survey_audit_logs` is deleted

A subject-access erasure request (Art. 17) **does not delete that person's `audit_logs` rows,
and does delete their `survey_audit_logs` rows**. The split is deliberate and the two halves
have different reasons.

* The lawful basis is legitimate interest / legal obligation (Art. 17(3)(b), (e)) — a
  security trail that a subject can erase is not a security trail, and "who exported this
  data" cannot be answered afterwards by a table the exporter could empty.
* `audit_logs` stores no free-text personal data: a user id, a company id, an action name, a
  path, an IP address and a user agent. The identifying columns are foreign keys, so erasing
  the `users` row is what removes the name and email; `audit_logs.user_id` carries `ON DELETE
  SET NULL`, so a deleted user's rows survive as anonymous records of the actions.
* `survey_audit_logs` is treated differently, and this is a decided trade rather than an
  oversight. It *denormalises* `user_name`, `user_email` and `user_role` onto every row on
  purpose, so history reads correctly after a rename — which makes those three columns personal
  data that outlives the `users` row. **An erasure now DELETES the subject's rows in this table**
  (#144).

  The alternative considered was redacting the three identity columns and keeping the row: that
  preserves the change history and pseudonymises the actor, and it is the more conservative
  option. Deletion was chosen instead. The cost is stated rather than implied: along with the
  personal data goes the record that those changes were made at all, so the per-survey history
  behind `GET /surveys/{id}/history` will have gaps that nothing marks as gaps.

  Mechanically this needs a hole in the append-only interceptor, since that guard refuses
  `DELETE` as well as `UPDATE`. The hole is exactly one shape — `DELETE`, on
  `survey_audit_logs` only, only while an erasure is running — and `audit_logs` is never exempt
  and `UPDATE` is never exempt. Every one of those edges has a test that fails if the scope is
  widened in that direction, plus a positive control that fails if the scope stops working
  entirely; see `AuditLogAppendOnlyInterceptor.AllowSubjectErasureDeletes`.

## Outstanding work

Each item says what is missing, what closing it needs, and who owns it. None of them is
waiting on a decision that has not been made; they are waiting on a migration this wave did
not permit, or on a line of code per handler.

1. **Mutating endpoints that accept an unidentified caller write no row.**
   `audit_logs.company_id` is NOT NULL behind a RESTRICT foreign key, so a request the
   application never attributed to a user has no tenant to file under; the middleware logs a
   warning and abandons the write. The set is not enumerated here on purpose — a hand-copied
   list goes stale, and this one had. It is derived from the live route table and asserted
   exactly by `AuditCoverageTests.UnattributableMutatingRoutes`, so it cannot change without
   a build failure.
   *Closing it:* make `company_id` nullable, which is a migration, and then decide per
   endpoint what an untenanted row means for the tenant-scoped read endpoints.
   *Owner:* #143 follow-up, blocked until a wave permits a second migration.
2. **A company-less SuperAdmin (#191) is unattributable**, for the same reason and behind
   the same migration. *Owner:* #191.
3. **Creates record no `resource_id` unless the handler sets one.** A create has nothing in
   its route to name the row it made, and no endpoint in this application returns a
   `Location` header (`Results.Created` appears zero times). `DepartmentEndpoints.CreateAsync`
   sets it as the worked example; the other creates are a line each.
   *Owner:* #143 follow-up, per domain.
4. **Before/after is recorded only where a handler records it** — see
   [Before and after](#before-and-after). *Owner:* #143 follow-up, per domain.
5. **A request refused before it reaches an endpoint is not audited.** There is no endpoint
   to name a resource after and no handler that could have changed anything; the rate limiter
   and the authentication middleware both log their own refusals.
   *Owner:* not planned — reconsider if a route ever needs an authentication-failure trail of
   its own, which is a different feature (per-account lockout, #146's neighbourhood) rather
   than a hole in this one.
6. **Retention has no policy and no job.** *Owner:* needs a policy decision before an
   implementation. (The `survey_audit_logs` erasure half that used to sit here is done — see
   the GDPR section above.)