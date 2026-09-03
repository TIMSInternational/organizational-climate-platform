# The five seeded production accounts — rotate, or disable and re-create

**Status: UNDECIDED.** The tool exists (`scripts/rotate-seeded-accounts.mjs`, this PR). The
decision and the run are Federico's.

## The finding

`docs/runbooks/cutover.md` precondition **P14**: five role accounts — `superadmin@`,
`companyadmin@`, `leader@`, `supervisor@`, `employee@` at `nexadev.ai` — exist on the live
production system and share one password that is written down outside this repository.
Verified 2026-09-02: all five authenticate against `/auth/login` on the production API.
`docs/runbooks/uat-script.md` §8.4 already rules that they must not be used for anything the
client will see. P14's own plan — *"rotate them, or disable them and re-create for UAT with
per-account passwords"* — has had no owner, no date and no tool since it was written.

Why it matters more than a housekeeping row: `super_admin` reaches every tenant, and the
password is shared across five accounts and at least two documents. Before real employee data
arrives (#161 UAT is the first moment it does), one of the two options below has to have run.

## The two options

| | Option A — rotate | Option B — disable, re-create for UAT |
|---|---|---|
| What happens | Each account gets a fresh 12-character temporary password; every open session of that account ends immediately (the security stamp rotates — `AuthEndpoints.cs`, #284). The accounts keep working. | Each account is set `isActive: false` (`PUT /admin/users/{id}`). Login is refused. UAT accounts are created afresh by invitation, with per-person passwords. |
| Command | `CLIMATE_ADMIN_EMAIL=superadmin@nexadev.ai CLIMATE_ADMIN_PASSWORD=… node scripts/rotate-seeded-accounts.mjs --api https://bhgrdkd4gt.us-east-1.awsapprunner.com --rotate --i-am-rotating-production` | same, with `--disable` — **and the acting account is never disabled by the script**; disable `superadmin@` by hand afterwards if that is the intent, from a different super_admin |
| Output | Five `email  temporaryPassword` lines, printed once, stored nowhere. Paste into the password manager before the terminal scrolls. | Five `disabled email` lines. |
| Reversible? | Yes — run it again, or reset one account from the admin UI. | Yes — `isActive: true` through the users page. |
| Leaves for UAT | Five working accounts with known-to-one-person passwords. Still shared-role, still `nexadev.ai`, still not for the client's eyes (§8.4). | Nothing until the UAT roster is invited (§6.1 of the UAT script exercises exactly that loop). |
| Fits P14's wording | "rotate them" | "disable them and re-create for UAT with per-account passwords" |

Rotate first is the cheaper of the two and is compatible with disabling later. Option B is the
one that makes §8.4 unbreakable rather than a rule.

The temporary password format is `Guid.NewGuid().ToString("N")[..12]` — twelve hex characters,
minted server-side. It satisfies the default policy (minimum length only). If the production
`SystemSettings.PasswordPolicy` has complexity rules enabled, this format has no uppercase and
no special character, so the account would be holding a password the policy would refuse on
the next change. Check the policy on the day; if the rules are on, change each password once
by hand after signing in. (Making the generator honour the policy is a separate backend fix.)

## Preconditions

- Run it against **local** first, with `--emails` naming a throwaway account, exactly as this
  PR did (see its body): dry run → rotate → old password refused, new accepted → disable →
  refused. Ten seconds.
- `--dry-run` against production (it still needs `--i-am-rotating-production` — the guard
  applies to dry runs too, because a dry run signs in) resolves every email and prints the
  plan without changing anything. Do that before the real run: an `UNRESOLVED` line means the account is a
  company-less super_admin that is not listable — sign in as it to rotate it.
- Rotating `superadmin@` while signed in as `superadmin@` is supported (it goes last, and its
  token dies with it). Have the new password ready to sign back in.

## What must happen with the output

The five temporary passwords exist only in the terminal that ran the command. They go into the
password manager, one entry per account, and nowhere else — not into a chat, not into this
repository, not into an email. `PICKUP.md`, the memory notes and every other place the old
shared password was written must be updated to say *rotated on <date>, see the password
manager*.

> **DECISION:** option `____`  date `____`  by `____`
>
> Ran against production at `____` UTC; output filed in `____`.
