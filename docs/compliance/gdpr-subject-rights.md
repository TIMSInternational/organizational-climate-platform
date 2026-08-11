# Data subject rights: access, erasure, retention

**Status:** implemented, with one stated gap (the tracking service's database). Issue #144.
**Audience:** both a maintainer changing this code and a reviewer asking what the platform does
with an employee's data. It is written to be usable as the reasoning behind a record of
processing, not as an internal note.

## What this platform holds, and why that raises the stakes

The product collects employees' opinions about their employer on that employer's behalf. A
response to a climate survey is an opinion about a manager, a team or a workplace, given by a
named person unless they chose otherwise. That is why the treatments below are argued rather
than asserted: the cost of getting an access export wrong is disclosing one employee's opinions
to someone else, and the cost of getting erasure wrong is either failing an obligation or
destroying the record that shows what was done.

Two databases hold subject data:

| Store | Reached by these endpoints? |
| --- | --- |
| This repository's Postgres | Yes, in full |
| `services/tracking-api`'s Postgres | **No** — see [The gap](#the-gap-servicestracking-api) |

## The machine-readable half

`src/ClimateProject.Application/Gdpr/SubjectDataMap.cs` classifies **every** table in this
database: what it holds about a data subject, the Article 6 basis, the retention rule, what an
access request returns for it, and what an erasure request does to it. The access export, the
erasure and the compliance report all read that one declaration, so none of them can describe a
coverage the others do not have.

The map is checked against the live EF model by `tests/ClimateProject.UnitTests/Gdpr/SubjectDataMapTests.cs`:

- every non-owned entity type must be classified;
- every foreign key to `users` in the model must be declared as a link property;
- every declared link property and table name must exist;
- every string column whose name contains `Email` must be a declared link or an exempted
  column with a written reason.

Add a table, add a `user_id`, add an email column, and those tests fail until somebody has
decided what the new thing holds. That mechanism — not this document — is what keeps the
coverage true.

## Access (Art. 15) — `GET /gdpr/access`

Callable by the data subject about themselves (no `userId`), or by an administrator of the
subject's own tenant. Super admins may ask about anyone.

**Full records** are returned for the tables that exist because that person exists: their
account (including the owned preference, notification-opt-out and consent columns), their
demographic answers, their survey responses and the answers within them, invitations addressed
to them, notifications sent to them, their unsubmitted drafts, and the audit rows recording what
they did.

**References only** — id and label — are returned where the subject appears as an author,
approver or manager. A survey they created is data about them only to the extent of the
attribution; the survey's *responses* are other employees' opinions, and returning them because
one person asked for their own data would be a disclosure rather than an export.

**Credentials are redacted.** The password hash and every invitation token are replaced with a
marker, and the column's existence is still disclosed. A bcrypt hash is offline-crackable and an
invitation token is a bearer credential that would let anyone holding the exported file accept
the invitation. A subject is entitled to the data held about them, not to a copy of the secrets
that authenticate them.

**Columns come from the EF model**, not from a hand-written projection, so a column added to a
table later appears in the export without anyone remembering to widen anything.

## Erasure (Art. 17) — `POST /gdpr/erasure`

Administrators only, never self-service, and the request body must set `confirm: true`. Erasure
is irreversible and there is no undo through this API. #137 builds the page a subject uses to
*raise* a request; a controller acts on it.

### It is pseudonymisation, not DELETE — and here is why

Sixteen foreign keys into `users` are `ON DELETE RESTRICT`: `surveys.created_by`,
`reports.created_by`, `survey_audit_logs.user_id`, `demographic_snapshot_entries.user_id` and
twelve others. A row delete either fails outright or, with those restrictions relaxed, takes the
employer's business records and the platform's audit trail with it. The count is asserted by
`SubjectDataMapTests.The_shape_of_the_foreign_key_graph_into_users_is_what_the_map_says_it_is`,
so if the schema changes the argument has to be re-read rather than the number re-typed.

So erasure overwrites the identifiers on the account row — email (with a non-resolvable
`@erased.invalid` address), name, credential, legacy persona id, last login, department,
manager — deactivates it, sets the consent flags to withdrawn and the notification preferences
to silence. What survives is a row that nothing can resolve to a person.

### Table by table

| Table | Treatment | Reason |
| --- | --- | --- |
| `users` | Pseudonymised | Sixteen `RESTRICT` keys, above. |
| `user_demographics` | **Deleted** | The most directly identifying non-account data. The historical values the aggregates need live in `demographic_snapshot_entries`. |
| `notifications` | **Deleted** | Message bodies plus delivery metadata (IP, user agent, mail client). Nothing aggregates over them and nothing audits from them. |
| `survey_drafts` | **Deleted** | Private, unsubmitted authoring content, already on a 30-day clock. |
| `user_invitation_demographics` | **Deleted** | Demographic values pre-assigned to an invitee. Nothing aggregates over them. |
| `responses` | **Anonymised** | See below. |
| `question_responses`, `response_demographics` | Retained | Details of an already-anonymised response. |
| `survey_invitations`, `microclimate_invitations` | Redacted (email, token, metadata) | The row is the denominator of a reported response rate; deleting it restates a published figure. |
| `user_invitations` (invitee side) | Redacted (email, token, payload) | As above. The `invited_by` side is an administrative act by someone else and is retained. |
| `audit_logs` | **Retained in full** | See below. |
| `survey_audit_logs` | Retained, except the denormalised actor name and email | See below. |
| `demographic_snapshot_entries` | Retained | A snapshot is a historical record that has already been reported on; removing a row silently changes its totals. |
| Authorship rows (`surveys`, `reports`, `action_plans`, …) | Retained | Attribution to a business record. The account it points at is now a pseudonym. |

### Why survey responses are anonymised rather than deleted

Every climate score, benchmark and trend the employer has acted on is an aggregate over
`responses`. Deleting one person's answers silently restates figures that have already been
published and acted on internally.

Article 17 does not reach anonymous data. So the response is anonymised: `user_id` is severed,
and the identifying envelope — IP address, user agent, session id — is cleared, with the session
id replaced by a fresh unique value so that the person's sittings cannot be correlated with each
other either. What remains is an answer that belongs to a survey and a department and to nobody.

**This is the position the issue asks to be stated rather than assumed, and it is only sound
because the envelope goes.** An "anonymised" response that still carried the respondent's IP
address would be pseudonymous at best, and Art. 17 would still reach it.

`is_anonymous` is deliberately **not** flipped to `true`. It records what the respondent chose at
submission time, and rewriting it would put a choice in someone's mouth. The resulting shape —
`is_anonymous = false` with a null `user_id` — is one the schema already provides for:
`responses.user_id` is `ON DELETE SET NULL` precisely so an answer can outlive its author.

### Why audit records are retained

`audit_logs` and `survey_audit_logs` are how the platform can show who did what to whose data —
including who ran the erasure. Deleting them defeats the mechanism the right itself depends on.
They are retained under Art. 17(3)(b) (compliance with a legal obligation) and (e) (establishment,
exercise or defence of legal claims), and the retention sweep deliberately never touches them.

One concession: `survey_audit_logs` denormalises the actor's name, email and role onto every row
so the trail reads without a join. The name and email copies are overwritten, because `user_id`
still resolves to the pseudonymised account and the record stays fully attributable without them.
That is the only part of an audit record erasure can take without breaking what the record is for.

### Known limitations, stated rather than discovered

1. **Free text is not scrubbed.** An open-ended answer (`question_responses.response_text`), an
   audit change payload (`survey_audit_logs.changes`, `audit_logs.details`) or an invitation
   payload can name a person inside prose. No automated rule finds that reliably, so those
   columns are retained as written. A request about a person mentioned only inside someone
   else's free text will not match, either for access or for erasure.
2. **Anonymous responses cannot be matched.** A response submitted anonymously carries no
   `user_id` by design, and so can be neither included in nor removed from a response to a
   request about that person.
3. **`reports.shared_with`** is a `text[]` that nothing in `src/` writes today. The access export
   searches it anyway (matching both the subject's id and their email) because the column exists
   and an import could fill it. Erasure does not touch it: guessing at the element format of a
   column no code writes would be inventing a contract.
4. **The tracking service** — next section.

## Compliance report — `GET /gdpr/compliance-report`

One line per table: lawful basis, retention rule, erasure treatment, rationale, and — for the
tenant-scoped tables — a live row count. Company admins get their own tenant and are refused
another; a super admin may ask about any tenant or about none.

Tables with no `company_id` report a count of `-1` rather than `0`. "Not counted for this
tenant" and "this tenant has none" are different facts, and returning a global figure to one
company's administrator would tell them about every other tenant.

## Retention cleanup — `POST /gdpr/retention-cleanup` and `RetentionCleanupWorker`

Storage limitation, Art. 5(1)(e). Three categories, each with an expiry predicate:

| Category | Predicate | Default window |
| --- | --- | --- |
| `survey_drafts` | `expires_at <= now` | 30 days from last save (`SurveyDraftRetention`) |
| `notifications` | `created_at <= now - window` **and** status is terminal | 365 days |
| `user_invitations` | `expires_at <= now - grace` **and** never accepted | 90 days past expiry |

`audit_logs`, `survey_audit_logs` and `responses` have **no** expiry here. A timer that quietly
removed the audit trail would defeat both the erasure position above and #143; deleting it is a
decision for a retention policy the controller has actually adopted, not a default.

The route is super-admin only: the sweep crosses every tenant, which is not something one
company's administrator should be able to trigger — the same reasoning
`DELETE /surveys/drafts/expired` already uses. The scheduled worker passes a per-category row cap
so a first sweep over a backlog is not one enormous transaction; the route passes none, because a
human asking for the sweep by hand is asking it to finish.

**The capped path deletes by predicate, never by id alone.** Wave 1 had to fix a retention job
that harvested ids and then deleted by id, which reclaims a row that stopped being expired in
between — a notification re-queued for retry, an invitation accepted. Every capped delete here
restates its predicate, and
`RetentionCleanupJobTests.An_invitation_accepted_between_the_select_and_the_delete_survives`
reproduces that interleaving deterministically with a command interceptor rather than trusting
the comment.

## The gap: `services/tracking-api`

That service keeps its **own** Postgres. It caches the employee roster (`PersonaCache`: name and
email) and keys its action plans, progress log (`BitacoraEntry`) and notification recipients by
persona external id.

**This API cannot read it.** There is no project reference, no HTTP client and no connection
string pointed at it, and the only integration between the two services runs the other way: the
tracking service pulls from `/api/internal` here, behind `InternalApiKeyFilter`. This service has
no equivalent inbound surface to call.

Consequently:

- every access, erasure and compliance response is returned with `complete: false`;
- the `sources` array names the tracking database with `included: false` and the reason;
- `limitations` repeats it in prose that can be handed to a data subject.

**A data subject request is therefore not discharged by these endpoints alone.** Until an
internal GDPR endpoint exists on the tracking service, the tracking half must be completed by
hand. Closing the gap needs three things: a subject-scoped internal endpoint there, an outbound
client and shared key here, and a decision on that service's own erasure treatments (the persona
cache is re-synced from this database, so it self-heals once the account here is pseudonymised;
the external-id references on action plans are pseudonymous and should be retained on the same
aggregate-integrity grounds as responses).

## Audit

Every one of the four actions writes an `audit_logs` row attributed to the caller, with the
subject in `resource_id` — including the reads, because an access export is a bulk disclosure of
one person's data and the fact that it happened is what an investigation needs. Erasure and
retention cleanup write theirs *before* acting, so the record survives the deletion it describes.

One gap, shared with `ProfileEndpoints`: `audit_logs.company_id` is `NOT NULL` with a restricting
key to `companies`, and a global super admin (#191) has no company row to attribute an entry to,
so their actions here are not audited. Widening the column is a migration, which #144 does not
add. #143 is landing an audit-logging convention in parallel; these writes should move onto it.
