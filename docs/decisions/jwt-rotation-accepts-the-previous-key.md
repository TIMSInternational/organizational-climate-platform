# Decision: rotating the shared JWT secret accepts the previous key for one token lifetime (#70)

**Status: DECIDED and implemented. Owner: Federico** (chosen 2026-09-24). Recorded against
`main` at `bd7b0f91`. This does not rotate anything — it makes rotating possible without a mass
logout, which is the precondition #70 was stuck behind.

## The problem, measured

`TrackingJwtSecret` is one string doing three jobs, and
`docs/security/rotation-inventory.md` §A already said so:

- `JwtTokenService` **signs** every token this API issues with it.
- `ClimateProject.Api/Program.cs` **validates** with it.
- climate-tracking's API and Workers validate with the same value.

Validation took a single key — `IssuerSigningKey`, singular, on both sides. So changing the
secret invalidated every live session in **both** products at the same instant. Tokens live 24
hours (`JwtTokenService.TokenLifetime`), so the blast radius was every signed-in user, at
whatever moment the rotation landed.

That is the part that mattered: **it made an urgent rotation something nobody wanted to
perform.** #70 has been open since 2 August. A security control that is painful to use is a
security control that does not get used, and the runbook had grown a whole "the one decision to
make before sitting down" section asking the operator to choose between a mass logout and a code
change that had not been written.

Compounding it, `Program.cs` sets `ValidateIssuer = false` and `ValidateAudience = false` (there
is no issuer or audience on these tokens; the shared secret is what proves provenance). So
anything holding that secret can mint a token production accepts. If the value is the one the
malware-compromised legacy app used, that is an authentication bypass — which is exactly why
rotating it needed to be cheap.

## The decision

**Validation accepts the current secret and, while a rotation is in flight, the previous one.
Signing always uses the current secret alone.**

Rotation becomes rolling: the new secret is deployed as current with the old one as previous,
tokens already in the wild keep validating until they expire on their own, and nobody is logged
out. One token lifetime later the previous key is cleared.

Concretely: `IssuerSigningKeys` (plural) built by `JwtSigningKeys.ForValidation(current,
previous)` on the climate side, mirrored by `TrackingTokenValidation.CreateParameters` on the
tracking side, fed by a new optional `TrackingJwtSecretPrevious` setting.

### What was rejected

**A hard logout, which the runbook recommended.** Simple and loud, and genuinely fine for a
*scheduled* rotation. It is the wrong shape for an *urgent* one: the moment you most need to
rotate is the moment you least want to sign every user out of two products with no warning. The
cost of keeping it was a standing disincentive to rotate.

**Shortening the token lifetime instead.** It narrows the window rather than removing it, and it
logs people out continuously instead of once — a worse trade for the same class of problem. It
is also already ruled on for a different reason in
[`cross-service-session-revocation.md`](cross-service-session-revocation.md).

## What this costs, stated rather than glossed over

**The overlap widens what both services accept.** For its duration, the secret being rotated
away from still authenticates. That is the whole point — and it is also why clearing it is a
*step of the rotation*, not cleanup afterwards. A rotation that leaves
`TrackingJwtSecretPrevious` set has bought nothing at all: the compromised value still opens the
door.

The runbook now finishes with that step and with the probe that proves it — the saved old token
must return **401**. A green fresh login cannot distinguish "rotated and closed" from "still
accepting the old value", which is precisely the failure this design could otherwise hide.

Three narrower rules keep the widening from being wider than intended:

- **Blank is absent, not a key.** An unset environment variable arrives as the empty string;
  admitting it would make every token signed with `""` valid.
- **A duplicate is dropped.** Ordinal comparison — two secrets differing only in case are
  genuinely different keys and both are kept.
- **The previous key can verify but never mint.** `JwtTokenService` takes the current secret
  alone, so nothing new is ever signed with the outgoing value.

## How it is guarded

The two halves are tested separately because they fail separately:

- `JwtSigningKeysTests` — the key-set rule: blank, duplicate, case, missing-current.
- `CrossServiceTokenTests` — a token minted by the **real** path, validated under the key set
  climate-tracking holds at each stage: accepted during the overlap, refused once closed,
  refused when the key set contains neither the minting secret nor a retired one.
- `TrackingJwtRotationTests` — the same journey over **HTTP through this API's own bearer
  handler**, on a host configured as a mid-rotation deployment.

That third class exists because of a specific gap: a misspelt configuration key in `Program.cs`
would leave the window silently absent in production while every other test stayed green. That
is not hypothetical — it was **demonstrated** by mutating the key to
`TrackingJwtSecretPrevius`, which kept all 10 unit tests and 21 of 22 cross-service tests
passing and was caught only by `A_session_from_before_the_rotation_survives_it`.

## Deploying this

**No migration, no behaviour change until somebody rotates.** With
`TrackingJwtSecretPrevious` unset — the steady state — the key set is exactly what it was
before, so this ships inert.

Infrastructure: `TrackingJwtSecretPreviousArn` is a new optional CloudFormation parameter,
defaulting to empty. When unset the template drops **both** the runtime secret and the IAM grant
via `Fn::If` → `AWS::NoValue`, so no ARN is read that was not supplied. `deploy-prod.yml` passes
it through and it is deliberately **not** in the required-variables check.

The rotation procedure itself is `docs/security/rotation-runbook.md` §A, now two steps a day
apart rather than one.
