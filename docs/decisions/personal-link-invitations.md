# Decision: a survey may mail each person their own link, and the link is their key

**Status: RULED 2026-11-18 by Federico. Owner: Federico.** Built on branch
`procomer-personal-link` for PROCOMER's application of its 2026 climate survey, which starts
on 1 December 2026: *each employee enters by a link — no username, no password.*

## What it amends, and what it does not

On 2026-10-19 (#606, commit `dd59ea80`) Federico ruled, from the rehearsal's own mail:
*"delete this email completely, as if it never existed ... the one with the username and
password is the ONLY one the application will be sending out"*, and of the reminder, *"we
never want to send that."* There is no decision record for that ruling in this folder; it
lives in that commit's message and in the comments it left on
`NewSurveyDefaults.Apply`, `SurveyDistributionEndpoints.ResendInvitationAsync` and
`SurveyDistributionEndpoints.SendRemindersAsync`. This record is therefore the first written
home of both rulings.

**Amended, for one mode only.** A survey in credential mode `personal_link` mails each
invitee their own `/survey-invitations/{token}` link instead of a username and a password.
`shared` and `per_survey` are untouched: the invitation route mints rows (and, in
`per_survey`, mails the key) exactly as before, and the one-person resend still answers 410
in both.

**Not amended: reminders.** *"Reminders still never."* `POST /surveys/{id}/invitations/reminders`
still answers a constant zero and reads nothing, and `InvitationReminderJob` still sweeps no
survey. Since this change an invitation can reach `sent` again, so the constant on that route
is now the only thing between a `sent` row and a reminder —
`PersonalLinkInvitationTests.No_reminder_is_ever_produced_for_a_personal_link` holds it, with
the reminder switch on and the invitation backdated a week.

## The mode

`CredentialModes.PersonalLink = "personal_link"` — it fits `settings_credential_mode`
(`varchar(20)`), so **no migration**.

- **A survey's mode, never a company's.** `CompanyEndpoints` validates against
  `CredentialModes.ForCompany` (`shared`, `per_survey`). A company's mode also decides what the
  roster import mails and whether an account may be given a password, and neither has a ruled
  answer for a company whose people are never given one.
- **Settable at create** (the builder's mode select, `POST /surveys` `settings.credentialMode`,
  the template path) **and, unlike the other two, on an existing survey** — PROCOMER's survey
  already exists. `PUT /surveys/{id}` accepts a move to or from `personal_link` only while
  nothing has been issued under the current mode: no `survey_credentials` row and no
  invitation with a `SentAt`. Otherwise `400 credential_mode_in_use`. The #617 freeze is
  otherwise exactly as it was: `shared` ↔ `per_survey` is still `credential_mode_frozen`
  (`SurveyCredentialModeTests` unchanged and green).
- **Where an operator sets it:** Distribución, «Cómo entran las personas», one switch. On
  such a survey the launch checklist never asks for the public link (measured on the local
  stack: with three links mailed the readiness tile said «Falta el enlace público», nudging an
  operator to open exactly the door this mode exists to avoid); it asks for the links still
  owed instead.

## Sending

`POST /surveys/{id}/invitations` in this mode:

- **Recipients are the audience THIS request resolves** — `userIds`, `departmentIds` or
  `allTargeted`, through the same `ResolveAudienceAsync` as every mode — **and nobody else.**
  A row minted by an earlier call for somebody else is not a request to mail them now. This is
  the 28 Oct 2026 rule (`CLAUDE.md`, *"Never send anything to someone the client did not
  name"*) as code, and `A_personal_link_goes_exactly_to_the_people_the_request_resolves_and_no_one_else`
  holds it.
- **Mailed once.** A person whose link went (`SentAt` set) is skipped on every re-run; the
  one-person resend is the deliberate way to mail them again. A revoked invitation is skipped.
- **Batched like `per_survey`**: at most 100 recipients per call, never-attempted people
  first, and `Remaining` says how many in the resolved audience still have no link — the
  client loops on it. One outbound message each against App Runner's 120 s ceiling.
- **A failed send leaves the row unsent, with its token**, so the same request mails it again;
  the response names who did not get theirs (`LinksNotSentEmails`).
- The link mailed lives as long as the request says (the survey's close, or `ExpiresInDays`),
  refreshed on a row minted earlier, and goes to the account's current address.

### Moving the close moves the links

A mailed link carries the close the survey had when it went. `PUT /surveys/{id}` with a new
`endDate` on a `personal_link` survey moves, in the same save, the expiry of every unrevoked
invitation whose expiry equalled the old close (one shortened on purpose by `ExpiresInDays`
keeps its own). Without it, extending PROCOMER's window after the send — ESPH's was moved twice
after launch — would have locked every holder out at the old close, with a resend per person as
the only repair. The other two modes mail no link and are untouched
(`Moving_the_close_moves_the_mailed_links_with_it_in_personal_link_mode_only`).

### Inline, not queued — and where the token is at rest

The token is a credential: it opens this survey as its person. It is at rest in exactly one
place, `survey_invitations.invitation_token`, where it has always been — it is the lookup key
of the four `/survey-invitations/{token}` routes, which existed before this change.

The mail is composed and handed to the transport **inline**, inside the request, as the
per-survey credentials mail is. The composed message — the only other thing that ever holds the
link — exists in memory between `PersonalLinkEmailComposer` and the transport and is written
nowhere. Nothing logs the token, the link or the address (`EmailPersonalLinkEmailSender`,
`LoggingPersonalLinkEmailSender`).

Queuing through `notifications` was considered and rejected. It would not have put the token
at rest anywhere new either (the notification row carries ids; the sender resolves the token at
delivery), but it would have re-attached survey invitations to the consent policy, the retry
budget and the delivery sweep that #606 took apart — the same machinery the reminder rides on —
and the operator would learn who did not get their link minutes later instead of in the
response to the click. Inline keeps the deleted path deleted.

**Development only:** `Email:Provider = pickup` writes each message, link included, to
`Email:PickupDirectory` so a person can read what was composed for a seeded `@acme.test`
address. Both hosts refuse to start with it outside the Development environment.

## The message

`PersonalLinkEmailComposer`:

- **Subject and body are the survey's own** `InvitationCustomSubject*` /
  `InvitationCustomMessage*`, edited on Distribución («Correo de invitación»). A blank field
  reads a short neutral default in that language. The other language's text is never borrowed.
- **The language is the company's**, by the credentials mail's rule: a single company locale is
  that locale alone; `both` or none is both blocks. The recipient's `UserPreferences.Language`
  is not read (it defaults to `en` and the import never sets it).
- **The company's logo and accent**, the link as a button **and** as plain text, a note that
  the link is personal and when the survey closes, and **no username, no password and no
  sign-in page** — `No_username_no_password_and_no_sign_in_page_anywhere` reads every part.

## Resending one person

`POST /surveys/{id}/invitations/{invitationId}/resend` answers again in this mode only:

- a **new token** is minted, saved, then mailed; the previous link stops working (the answer to
  "I forwarded my link"); a part-finished response is unaffected, because resume is keyed on the
  person, never on the token;
- a failed send **puts the previous token back** and answers `502 personal_link_not_sent`;
- a deactivated account answers `409 personal_link_recipient_inactive`;
- a revoked invitation is revived (the route's documented contract before #606), and a
  completed one is refused as before.

## The respondent

### What happened before this change (measured in source)

A climate survey opened through `/survey-invitations/{token}` rendered the landing card
(`SurveyInvitationPage`), recorded `opened`, and on «Comenzar» mounted the respond form with
`publicEntry`. Its two requests went out **unauthenticated and without the token**, so:

- `ResolveRespondentAsync` served them only while the survey had a **live public link**; a
  survey with none answered `Unavailable()` and the invitee could not answer at all;
- when it did serve them, the respondent was an **anonymous visitor**: no department, the
  demographics **asked on screen** (if the survey self-declares them) or not recorded at all,
  no participation row, nothing tied to the invitee;
- `/completed` was posted, and on an anonymous survey suppressed by the anonymity ceiling.

### What happens now

On `/survey-invitations/{token}` the web sends the token in the `X-Survey-Invitation` header
on `GET /surveys/{id}/respond` and `POST /surveys/{id}/responses` (a header, never the query
string, which every access log keeps). On a `personal_link` survey the API resolves the
invitee — token of THIS survey, not revoked, not expired, person active in the survey's
company — and answers **exactly as for a signed-in respondent** (it takes precedence over a
bearer the browser may also carry). On any other survey the header is ignored.

| | personal link, anonymous survey | personal link, identified survey |
|---|---|---|
| sign-in screen | none | none |
| department | from the account, through the write-time floor (headcount ≥ 3) | from the account |
| demographics | from the account, through the cohort floor; **never asked** | from the account; never asked |
| `responses.user_id` | **null** — the survey's promise | the person |
| who answered | `survey_participations` (name, email, day) and the roster, via the derived resume session | the invitation, and the roster |
| invitation `completed` | **not recorded** — the anonymity ceiling (`SurveyInvitationStatuses.AnonymityCeiling = opened`) is unchanged | recorded, `CompletedOn` = the company-local day |

**The ceiling was deliberately not moved.** Recording `completed` on an anonymous survey's
invitation is the per-person completion mark the 2026-10-12 ruling forbids; "who has answered"
on an anonymous survey is the roster's job, and it already answers it for a personal link.

**Leaving halfway and opening the link again** resumes, on any device, through the existing
signed-in path unchanged: `ResumeSessionIdFor` derives the session from (survey, person) with
`SurveyResumeKey`, so the answers carry no user id and the partial is found again
(`Leaving_halfway_and_opening_the_link_again_resumes_on_any_device`). After a complete
submission the form shows "already answered" from `inProgress.isComplete`; on an anonymous
survey the landing card itself still shows first, because its invitation never reaches
`completed`.

## What this accepts, said plainly

- **A forwarded link answers as its person.** #606 named this "a second door"; in this mode it
  is the only door, by ruling. Mitigations: the mail says the link is personal; the resend
  rotates it; a revoke kills it; it expires at the close.
- **If the survey's public link is also open**, anyone holding it answers anonymously without
  account data. Distribución says so beside the switch; revoking it is the operator's call.
- **Rate limiting** of the unauthenticated respond routes is per IP (600/min), as for a QR
  survey: a whole office behind one NAT shares it.
- **The roster's bulk account-credentials resend** (an account's username and password) is
  hidden on a `personal_link` survey. The API route behind it is account-level and cannot know
  the survey, so it is not refused server-side.
