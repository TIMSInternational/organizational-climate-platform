# Ending a session ends it in climate-project-api only — climate-tracking keeps it until the token expires

Decided while closing the cross-service token seam (#153). This records a **known, bounded gap**
so that the next person finds an answer here instead of rediscovering it, and so that anyone who
writes "deactivating a user ends their sessions" has to reckon with the word *which*.

**The gap in one sentence:** climate-project-api can revoke a token mid-life; climate-tracking
cannot see that revocation, so a session ended on one service stays live on the other for the
rest of the token's lifetime — **at most 24 hours, and typically less.**

## The mechanism, on both sides

The two services are separate solutions with separate deployments and separate databases. They
share exactly one thing: the symmetric `TrackingJwtSecret` used to sign and verify HS256 tokens.
Neither side mints an `iss` or an `aud`, and both validate with `ValidateIssuer` and
`ValidateAudience` set to false — the shared secret is the whole proof of provenance.

**climate-project-api mints and revokes.** Every token carries a `securityStamp` claim copied off
`users.security_stamp` at mint time (`JwtTokenService.cs:44`), and
`JwtBearerEvents.OnTokenValidated` compares that claim against the row on every authenticated
request (`src/ClimateProject.Api/Program.cs:242` → `SecurityStampValidation`). Rotating the column
therefore kills every token minted before the rotation, from its next request. Three paths rotate
it, two of them shipped:

| Path | Where |
|---|---|
| A user changes their own password | `ProfileEndpoints.cs:351` (#284, on `main`) |
| An administrator resets credentials | `AuthEndpoints.cs:393` (#284, on `main`) |
| An administrator deactivates an account | `UserEndpoints.cs`, on the `true → false` transition (#286 — PR #312, **in review, not yet on `main` when this was written**) |

The first two are shipped, so this gap is not a forecast: it is the behaviour of the deployed
system today.

**climate-tracking validates and cannot revoke.** Its bearer handler is configured from
`TrackingTokenValidation` and nothing else (`ClimateTracking.Api/Program.cs:52-53`): issuer signing
key, lifetime, name claim. There is no `JwtBearerEvents` and no `OnTokenValidated`, and no code
path under `services/tracking-api/src/` reads the `securityStamp` claim — the only mention of it
there is the remark on `TrackingTokenValidation` explaining why. Everything that can refuse an
inbound token there is in those parameters plus the default authorization policy — signature,
expiry, tenant, and (since this change) the token's own `isActive` claim.
It has no access to `users.security_stamp`: that table is in the other service's database, and
climate-tracking's own database holds no user rows at all (its `PersonaCache` is a name/email/nodo
projection, refreshed on a 15-minute poll, with no active flag and no deletion pass).

So the revocation is real, it is enforced, and it stops at the service boundary.

## The window, stated exactly

**A token revoked on climate-project-api remains valid on climate-tracking until its `exp`.** The
mint's lifetime is 24 hours (`JwtTokenService.cs:12`), so the window is *at most* 24 hours — it is
the token's *remaining* life, which for a session revoked late in its day may be minutes.

Nothing shortens it: there is no refresh cycle that would re-mint on a shorter cadence (the web
client's `authFetch` does not refresh — a 401 clears the token and redirects to `/login`), and no
client re-authenticates against climate-tracking separately.

`CrossServiceTokenTests.The_window_a_revoked_token_stays_live_over_there_for_is_the_token_lifetime`
pins that 24 to the token itself, so this paragraph cannot quietly go stale.

## What is and is not affected

- **Password change / credential reset (#284, shipped).** The user's climate-project session dies
  at once; their climate-tracking session lives on. This is the sharpest case, because the feature
  exists for somebody who believes they are compromised.
- **Deactivation (#286, PR #312, in review).** Same shape once it lands: offboarding closes
  climate-project immediately and climate-tracking with a lag. Note what this means for that PR's
  own claim — it ends the account's sessions *on the service it changes*, and an offboarding note
  that says "ends their sessions" without qualification is wrong by one service.
- **GDPR erasure (#144) — read this carefully, it is not what it looks like.** Erasure does **not**
  rotate the security stamp and does not delete the row; `SubjectErasure.AnonymiseAccount`
  pseudonymises the account and sets `IsActive = false` (`SubjectErasure.cs:345`), which is a
  mint-time check only. An erased subject's live token therefore keeps working **on
  climate-project-api too** — this is a gap in that service, already documented in
  `SubjectErasure`'s own remarks, not a cross-service asymmetry. The one shape that does die is a
  token whose `sub` is a legacy `PersonaExternalId`, because erasure clears that column and the
  `sub` then resolves to no row, which `SecurityStampValidation` refuses. For those tokens, and
  only those, erasure behaves like the rows above: dead here, alive over there.

## What was decided

**Accept the window, bound it, and pin it with tests. Do not close it in this change.**

Three mitigations were weighed.

**1. Shorten the token lifetime.** Rejected for now. The lifetime is one number for the whole
product, so cutting it to bring the cross-service window down logs every user of *both* services
out that much sooner. There is no refresh cycle in the web client to hide that, and building one
is the "server-side session table" design #284 already declined as much larger than the hole it
would close. This is the right lever eventually; it belongs with that work, not here.

**2. Have climate-tracking introspect climate-project-api.** The plumbing exists — see the
follow-up section below — but it puts a synchronous call to another service in the authentication
path of every climate-tracking request, and that forces a choice nobody has made yet: fail closed,
and climate-project-api's availability becomes climate-tracking's; fail open, and the revocation
is unenforceable exactly when an attacker can cause an outage. Making that choice silently, inside
a change whose purpose is to remove a silent gap, would be the same defect wearing different
clothes. It is written up below so that whoever picks it up is implementing rather than scoping.

**3. Accept it, in writing, with tests.** Taken. The window is small, bounded, and now impossible
to ship unknowingly.

Alongside it, one asymmetry that cost nothing to remove **was** removed: climate-tracking now
refuses a token whose own `isActive` claim says the account is deactivated
(`ClimateTracking.Api/Program.cs:94`), which climate-project-api has done since #280.
**That is not revocation and must not be described as such** — the claim carries the account's
state at mint time and never changes afterwards, so it does nothing for any of the three rows in
the table above. It is defence in depth and parity, nothing more.

## The tests that hold this record to the code

| Fact | Test |
|---|---|
| The revocation works on climate-project-api, and the same token still satisfies climate-tracking's contract | `CrossServiceTokenTests.A_session_this_api_has_ended_is_still_accepted_by_climate_tracking` |
| The window is the token lifetime, and that lifetime is 24h | `CrossServiceTokenTests.The_window_a_revoked_token_stays_live_over_there_for_is_the_token_lifetime` |
| climate-tracking really does serve a request on a token whose session has ended, over HTTP | `JwtAuthenticationTests.A_token_whose_session_climate_project_has_already_ended_is_still_accepted_here` |
| The one revocation-adjacent claim both services read, read identically by both | `CrossServiceTokenTests.The_two_services_read_the_isActive_claim_identically` |
| The new deactivation refusal, and its limit | `JwtAuthenticationTests.Returns_403_for_a_token_whose_own_isActive_claim_says_false`, `…A_token_with_no_isActive_claim_is_still_accepted` |

The first three assert the gap. **They are meant to fail the day it is closed** — when that
happens, change them to assert the refusal and rewrite this record. Do not delete them quietly.

## If you are the person closing it

Everything a pull-based check needs already exists; this is the shape it would take.

- **The channel.** climate-tracking already holds an authenticated client to climate-project-api:
  `ClimateProjectClient` sends `Authorization: Bearer {InternalApiKey}` on every call
  (`ClimateProjectClient.cs:23-24`), and `/api/internal/*` is gated by `InternalApiKeyFilter`
  (constant-time comparison, fails closed on an unconfigured key). `ClimateProjectBaseUrl` and
  `ClimateProjectInternalApiKey` are already required at startup in both the API and the Workers
  host, so no new configuration is needed.
- **The endpoint.** A route on the existing `/api/internal` group (`TrackingInternalEndpoints.cs`,
  already mapped and already behind the filter) answering "is this `sub`'s current stamp still
  X?". `ActingUserResolver.ResolveSecurityStampAsync` already answers exactly that in one round
  trip, and returns null for a `sub` that resolves to no row — which must be treated as a refusal,
  the way `SecurityStampValidation` treats it.
- **The call site.** `JwtBearerEvents.OnTokenValidated` in `ClimateTracking.Api/Program.cs`,
  mirroring `src/ClimateProject.Api/Program.cs:242`. A token carrying no `securityStamp` claim must
  be let through, for the same reason that service lets it through: the shared secret means other
  issuers exist, and refusing an absent claim locks them out.
- **The two decisions to make out loud, not in passing.** (a) Fail open or fail closed when
  climate-project-api cannot be reached. (b) Whether an answer may be cached, and for how long —
  a TTL is a window, so a 60-second cache means the honest claim is "revocation propagates within
  ~60s", not "immediately". Whatever is chosen, write the number in this file.

## Related

- `docs/security/rotation-inventory.md` — the shared `TrackingJwtSecret`, which is one value doing
  three jobs and is itself scheduled for rotation. Rotating it ends every session on both services
  at once, which is the only revocation that currently reaches climate-tracking.
- `SecurityStampValidation`'s remarks — why a stamp rather than a denylist, a refresh table or an
  `iat` comparison, and why no cache sits in front of it inside climate-project-api.
- `TrackingTokenValidation`'s remarks — the full contract climate-tracking accepts tokens under.
