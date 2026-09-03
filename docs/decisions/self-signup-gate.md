# Self-service signup: there is no gate

**Status: UNDECIDED. Needs Federico.**
**Measured 2026-09-03 at `835bcee`.** Every line below was re-opened in the working tree
before it was written here.

---

## 1. The finding

The route is `POST /auth/signup`. There is no `/auth/register`.

| Fact | Evidence |
|---|---|
| **Anonymous.** The `/auth` group carries no `RequireAuthorization()`; the only policy on signup is a rate limit | `src/ClimateProject.Api/Endpoints/AuthEndpoints.cs:29` `var group = app.MapGroup("/auth");` → `:37` `group.MapPost("/signup", SignupAsync).RequireRateLimiting(RateLimitPolicies.Authentication);` |
| **The tenant is resolved by string-matching the email domain.** Nothing else | `AuthEndpoints.cs:133` `var domain = email.Split('@')[1];` → `:134` `var company = await db.Companies.FirstOrDefaultAsync(c => c.EmailDomain == domain, cancellationToken);` |
| **The account is minted as an employee** | `AuthEndpoints.cs:148` `Role = Roles.Employee,` |
| **It is active immediately** | `AuthEndpoints.cs:149` `IsActive = true,` |
| **A session token is issued on the spot, 201** | `AuthEndpoints.cs:163` `successStatusCode: 201` |
| **No email verification anywhere.** `grep -n "EmailVerified\|EmailConfirmed\|VerificationToken"` over `src/ClimateProject.Domain/Entities/User.cs` and `AuthEndpoints.cs` returns nothing. No column, no token, no confirmation step | measured 2026-09-03 |
| **No allowlist, no invitation check, no approval step.** The whole gate between an anonymous POST and a live account is: non-blank name/email/password (`:102`), the platform kill switches (`:108`), minimum password *length* (`:117`), an email-shape regex (`:122`), a duplicate-email 409 (`:130`), and the domain lookup at `:134` | `AuthEndpoints.cs:93-164` |
| **The only off-switch disables login for everyone.** `CheckSystemSettingsGateAsync` reads two flags: `MaintenanceMode` → 503, `LoginEnabled` → 403 | `AuthEndpoints.cs:428` and `:435` |
| **`SystemSettings` has no registration field at all** | `src/ClimateProject.Domain/Entities/SystemSettings.cs:5-17` — `LoginEnabled`, `MaintenanceMode`, `MaintenanceMessageEn/Es`, `MaxLoginAttempts`, `SessionTimeoutMinutes`, `PasswordPolicy`, `EmailSettings`. No `RegistrationEnabled`, no `AllowSelfSignup` |
| **Google sign-in follows the same rule.** An unknown user on a known domain is auto-provisioned identically | `AuthEndpoints.cs:218` (same `EmailDomain == domain` lookup), `:230` `Role = Roles.Employee,`, `:231` `IsActive = true,` |
| **Password complexity is configured and not enforced here.** Signup checks length only; the four complexity flags exist on the entity, are editable through the settings endpoint, and are never consulted from signup | `AuthEndpoints.cs:448` `return settings?.PasswordPolicy.MinLength ?? 8;` vs `SystemSettings.cs:23-26` `RequireUppercase`, `RequireLowercase`, `RequireNumbers`, `RequireSpecialChars` |

The code's own comment calls this invitation-only —
`AuthEndpoints.cs:20`: *"Registration is invitation-only: an account can only be created for
a domain some company already owns."* The mechanism is a **domain match**, not an
invitation. The comment describes an intent the code does not implement.

## 2. The consequence, plainly

**Any person who can spell a customer's email domain can create themselves a live, active
employee account inside that customer's tenant — unattended, with no invitation, no
approval, no allowlist, no email verification, and no way to switch it off short of
disabling login for every user on the platform.**

For this product specifically, that is worse than it sounds. This is an anonymous-survey
platform sold to a government client. An employee account is not a read-only account: it is
a respondent identity. An outsider who guesses `procomer.go.cr` (or whatever
`companies.email_domain` holds) gets:

- a seat inside the tenant, counted among the population the anonymity guarantees are
  computed over;
- the ability to answer surveys and microclimates as an employee of that company, which
  means an outsider can inject responses into a climate measurement the client will act on;
- whatever an employee's seven self-service routes expose about the tenant.

The suppression floor of 5 is a privacy control, not an authenticity control — it protects
respondents from being identified, and does nothing about a respondent who should not be
there. Nothing else in the stack checks that a respondent belongs to the company whose
climate is being measured.

The email-verification gap compounds it: because no confirmation is ever sent, the attacker
does not need to control a mailbox at that domain. `firstname.lastname@customer.com` only
has to *parse* and be unused.

## 3. Options

### Option A — a per-company `SelfSignupEnabled` flag, default OFF

Invitation-only becomes true rather than aspirational: an account is created only through
the invitation flow that already exists (`InvitationEndpoints`, `AcceptInvitationPage`,
`InvitationEmailComposer`).

- **Cost:** one boolean on `Company`, one migration, one branch in `SignupAsync` before the
  domain lookup at `AuthEndpoints.cs:134`, the same branch in `GoogleLoginAsync` at `:218`,
  a toggle on the company admin surface, and a pair of i18n keys for the refusal. Small —
  hours, not days. The refusal message already exists (`NoCompanyForDomainMessage`,
  `AuthEndpoints.cs:24`) and can be reused so the two paths keep agreeing.
- **Blast radius if it goes wrong:** the flag defaults OFF, so a bug fails *closed* — the
  worst case is that a legitimate new employee is refused and needs an invitation, which is
  the intended flow anyway. It breaks nothing already deployed: today's five seeded accounts
  and every invited user are unaffected. The one real risk is a company that has been
  relying on self-signup to onboard without invitations; nobody has measured whether any
  production tenant has.
- **What it gates:** the `/register` UAT gap (`docs/runbooks/uat-script.md` covers no step
  for it), and any honest answer to a client security question about who can create an
  account.

### Option B — email verification before activation

Keep self-signup, but create the user with `IsActive = false`, send a confirmation mail, and
flip the flag when the link is followed.

- **Cost:** a verification-token column and expiry on `User` plus a migration, a new
  composer alongside `NotificationEmailComposer` and `InvitationEmailComposer`, a public
  confirmation endpoint and route, resend handling, and a decision about unverified rows
  that are never confirmed. Larger than A — days — and it puts a new dependency on production
  mail, which is **armed at the template layer but unproven at the delivery layer**: UAT
  gate 2, "a real mail delivered to a real inbox from the deployed service", is still unmet.
- **Blast radius if it goes wrong:** fails *open* in the wrong direction and fails *closed*
  in a costly one. If mail does not deliver, nobody can sign up at all and the failure is
  invisible to the user (`LoggingNotificationSender` marks rows `sent` and delivers nothing
  when `Email:Provider` is not `smtp`). Shipping this before gate 2 passes would make an
  unproven mail path load-bearing for account creation.
- **What it gates:** it raises the bar to "controls a mailbox at that domain" — meaningfully
  higher than today — but it does **not** make registration invitation-only. A contractor,
  a departed employee with a live alias, or anyone with a forwarded address still self-serves
  a seat. Option B answers a different question from Option A, and the two compose.

### Option C — keep it as is, with a written acceptance

Record that self-signup on a matched domain is the intended behaviour, that account
authenticity is delegated to the customer's control of their own email domain, and that this
is accepted for the 16 November go-live.

- **Cost:** an hour of writing. Zero code.
- **Blast radius:** unchanged from today — which is the point of writing it down, and the
  reason it needs a signature rather than a shrug. If the client's security review asks who
  can create an account on their tenant, the honest answer is "anyone who can spell your
  domain", and that answer should be one somebody chose.
- **What it gates:** nothing technical. It closes the audit finding by accepting it, and it
  should name who accepted it and on what date, so a later reader knows this was a decision
  rather than an oversight.

**A and B compose.** A is the gate; B is the identity check for whatever A lets through. If
the answer is A alone, B becomes unnecessary for signup because invitations already prove
mailbox control. If the answer is B alone, the tenant boundary stays as weak as the domain
string.

## 4. UNDECIDED — for Federico

> **Decision:** `____`  (A, B, A+B, or C)
>
> **Date:** `____`   **By:** `____`
>
> If A: does `SelfSignupEnabled` default OFF for **existing** companies as well as new ones?
> (Defaulting existing tenants to ON preserves today's behaviour and preserves today's hole;
> defaulting them OFF is the safe read and may refuse a real employee tomorrow morning.)
>
> If C: name the acceptance explicitly — *"account authenticity is delegated to the
> customer's control of their email domain"* — so the sentence exists to show a reviewer.
>
> Independent of A/B/C: **should signup enforce the four `PasswordPolicy` complexity flags
> that are already configured and already implemented?** Today it checks length only
> (`AuthEndpoints.cs:448`), so an administrator who turns on "require special characters" in
> system settings gets a setting that silently does nothing on the path that creates
> accounts. This one is arguably a defect rather than a decision, but it changes a rule that
> applies to real users, so it is put here rather than fixed unasked.

---

**Related:** `docs/audits/2026-09-03-functional-gaps.md` §4 and §9 item 14.
