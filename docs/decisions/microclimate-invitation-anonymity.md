# What microclimate invitation tracking records, and what it promises

**Issue:** #130 — "Anonymity boundary: tracking that a specific invitee participated,
combined with a single response in that window, de-anonymises them. Define what is
recorded and what guarantee is being made, and write it down."

This is the written-down version. The enforced version is
`MicroclimateInvitationStatuses.AnonymityCeiling` in
`src/ClimateProject.Application/Microclimates/`, and the two must not drift: the constant
is what the code obeys, this file is what it means.

---

## The shape of the problem

A `microclimate_invitations` row names one person — `user_id`, `email` — and carries four
timestamps: `sent_at`, `opened_at`, `started_at`, `completed_at`. Filling in the last two
asserts that **this named person submitted an answer, at this second**.

A microclimate does not store answers per respondent. `POST /microclimates/{id}/responses`
folds each submission straight into the parent row's `response_count`,
`live_results.word_cloud_data`, `live_results.engagement_level` and `updated_at`, and
discards the individual answers. There is no `MicroclimateResponse` entity and no DbSet for
one. That is the product's existing anonymity story, and it is a good one.

**A per-invitee `completed_at` breaks it.** Not by joining two tables offline the way a
survey's would — a microclimate is worse, because it publishes the other half of the join
in real time:

- `GET /microclimates/{id}/live-results` serves `response_count` and the word cloud on
  demand while the session is running.
- `MicroclimateRealtimeSettings.ShowLiveResults` defaults to `true`, and
  `MicroclimateLivePage` in the web app exists to draw exactly that, refreshing.
- `microclimates.updated_at` is stamped by every submission.

So an administrator watching the live page sees the count tick from 4 to 5 and the cloud
gain the word *agotado*. A `completed_at` written in the same second names who wrote it.
With a small audience — and a microclimate is a *pulse*, deliberately small and short — the
correlation is not probabilistic. It is exact.

There is nowhere to hide, either. A survey respondent is one row among many in `responses`;
a microclimate respondent is one increment in an aggregate. One attributable timestamp is
enough to attribute one answer, because there is only ever one answer between two ticks.

---

## The rule

`MicroclimateInvitationStatuses.Progression` is
`pending → sent → opened → started → completed`.

**For a microclimate with `RealtimeSettings.AnonymousResponses == true` — the default — the
ladder stops at `opened`.**

| State | Anonymous session | Why |
|---|---|---|
| `pending` | recorded | The row was minted. Says nothing about the person. |
| `sent` | recorded | A notification was queued for them. True of people who never answer. |
| `opened` | recorded | They looked at the invitation. True of people who never answer. |
| `started` | **accepted, not persisted** | Asserts a submission is in progress, at a time. |
| `completed` | **accepted, not persisted** | Asserts a submission happened, at a time. |

For a microclimate with `AnonymousResponses == false` the full ladder is recorded. That
session already requires respondents to authenticate (`SubmitResponseAsync` returns 401 to
an anonymous caller and 403 to another tenant's), so participation is attributable by
configuration and tracking it discloses nothing the session did not already say.

### "Accepted, not persisted" is deliberate, and it is visible

`POST /microclimate-invitations/{token}/started` on an anonymous session answers **200**,
writes nothing, and returns:

```json
{
  "recorded": false,
  "suppressedForAnonymity": true,
  "reason": "This microclimate is anonymous, so 'started' is not recorded against an individual invitation. …",
  "anonymity": { "anonymous": true, "highestRecordableState": "opened", "suppressedStates": ["started", "completed"], "guarantee": "…" }
}
```

Two properties, both load-bearing:

- **The respondent's client does not branch on anonymity.** One client, one call sequence,
  one implementation of the ceiling — server-side, in the place that owns the rows. A client
  that decided for itself would be a second copy of this boundary, and the two would
  eventually disagree.
- **A suppressed write is never reported as a successful one.** `recorded: false` with a
  reason, not a cheerful 204. Telling a caller you stored something you did not is the exact
  lie this whole guarantee is built to avoid.

---

## What is therefore true, and what is not

**Guaranteed, for an anonymous microclimate:**

1. No column in this database records that a specific named invitee submitted an answer to
   a specific microclimate. Not `completed_at`, not `started_at`, not a status string, not a
   metadata blob.
2. Participation is available only as an aggregate: `microclimates.response_count` against
   `target_participant_count`.
3. Nothing that *is* recorded can be lined up against the response stream, because
   `sent_at` and `opened_at` are equally true of the invitees who never answered.

**Not guaranteed, stated plainly rather than left implied:**

1. **An anonymous microclimate with one invitee is de-anonymised by its own response
   count**, and no per-invitation rule can fix that. That floor is a separate guard and it
   already exists: `MicroclimateExportProjection` withholds the whole export below
   `SurveyResultsPrivacy.MinimumRespondents` (5) and individual words below
   `MinimumWordRespondents` (2).

   It is **not** `MicroclimateRealtimeSettings.ParticipationThreshold`. That is a stored
   column defaulting to 3 that nothing in this repository reads — checked, not assumed. It
   is named here only so the next reader does not go looking to it for a guarantee it does
   not provide. Note also that the live-results route is *not* covered by the export's
   floor, which is a gap outside this issue's scope and worth its own.
2. **`opened_at` is still a fact about a named person.** It says they read their mail. It is
   kept because response-rate diagnosis is impossible without it ("nobody opened it" and
   "everybody opened it and nobody answered" are different problems with different fixes),
   and because it asserts nothing about a response.
3. **This is not transport anonymity.** The submission still arrives from an IP address and
   the rate limiter still buckets by one. What is claimed is about what is *stored*.
4. **An administrator with database access can read `microclimate_invitations` directly.**
   The guarantee is that there is nothing there to read, not that reading is prevented.

---

## Why the ceiling is `opened` and not lower

`sent` and `opened` could both be dropped, and the invitation row could carry no state at
all. That was considered and rejected: an invitation surface that cannot tell an
administrator whether mail is arriving is an invitation surface that cannot be operated. The
first question when a pulse gets three responses is always "did the invitations go out", and
`sent_at`/`opened_at` are the only two facts that answer it. Neither implies a response
exists, which is the whole test this ceiling applies.

## Why it is not higher

`started` was the tempting one — it means "they opened the questions", not "they answered".
But `MicroclimateRespondPage` posts its answers from the same screen it renders the
questions on, seconds later, and a respondent who starts a one-question pulse and abandons
it is a rounding error. In practice `started_at` and the response are the same event with a
few seconds between them, which is well inside the resolution of the live counter. A state
that *usually* asserts a response is a state that asserts one.

---

## Where this is enforced

| Enforcement point | File |
|---|---|
| The constant, and `IsRecordable` / `HighestRecordableState` derived from it | `src/ClimateProject.Application/Microclimates/MicroclimateInvitationStatuses.cs` |
| The refusal to write, and the `suppressedForAnonymity` answer | `MicroclimateInvitationEndpoints.RecordStateAsync` |
| The guarantee shipped as data on every payload | `MicroclimateAnonymityGuaranteeDto`, on the token detail, the state result and the admin listing |
| Tests | `tests/ClimateProject.UnitTests/Microclimates/MicroclimateInvitationStatusesTests.cs`, `tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateInvitationEndpointsTests.cs` |

## Relationship to the survey side (#116)

Identical shape, member for member, because #130 is the reference for #116's survey
invitation states and both are read by the same web client. Deliberately **not** identical
code: `SurveyInvitationStatuses` and `MicroclimateInvitationStatuses` are separate classes
over separate tables, and the reason is in
`src/ClimateProject.Application/Notifications/MicroclimateNotificationData.cs` — a shared
vocabulary is one short step from a shared notification payload, and a
`microclimate_invitations` id written into a field only ever looked up in
`survey_invitations` fails silently and mails every invitee a link-less email.

The arguments differ in one place worth noting. A survey's re-identification requires an
administrator to join `survey_invitations` against `responses` offline. A microclimate's
does not: the product streams the other half of the join to a live page. The conclusion is
the same and the reasoning is stronger here.
