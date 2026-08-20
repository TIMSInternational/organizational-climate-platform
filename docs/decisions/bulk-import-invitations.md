# Decision: a bulk import invites people, it does not create their accounts

Taken 2026-08-20, alongside #372. Recorded here because the change alters what a CSV upload
does to the database, and because it leaves behind rows that a future reader will find
puzzling.

## What it did before

`BulkImportEndpoints` wrote a `User` per valid row, with

```csharp
PasswordHash = passwordHasher.Hash(Guid.NewGuid().ToString("N")),
IsActive = true,
```

The Guid was hashed and discarded. It was never displayed, never mailed, never stored. Every
account created this way was active, counted in the company's size, addressable by an
administrator — and impossible to sign in to, by anybody, including the person it named.
Nothing in the product reported this; the import returned `"created"` and the users screen
listed a normal-looking row.

## What it does now

Each valid row becomes a `UserInvitation` of type `employee_direct`, minted and mailed through
the same path as every other invitation and expiring on the same seven-day clock.
`InvitationEndpoints.RecordDeliveryAsync` decides when it is `sent`, so #368's rule — `sent`
means a provider took the message — applies here without a second copy of it. A row whose mail
failed stays `pending`, which is what `POST /invitations/{id}/resend` is for.

The account is created when the person accepts, with a name and a password they choose.

## The rows already written

**They cannot be identified with certainty.** A user created by the old import is
indistinguishable in the schema from any other user: same table, same columns, no import
marker, no provenance. There is no migration that can single them out.

The usable proxy is `users.last_login_at IS NULL`. Anyone who has never logged in either was
created by this path or has simply not signed in yet, and the remedy is the same for both: an
invitation to set a password. That is a deliberate, reversible action for an administrator to
take per company, not a migration to run blind across the platform — sending a credential
email to every never-logged-in account on a live tenant is a support incident of its own.

**Decision: no automatic remediation.** The proxy query is recorded here so it can be run
deliberately:

```sql
SELECT id, email, company_id, created_at
FROM users
WHERE last_login_at IS NULL
ORDER BY company_id, created_at;
```

Production has never run a bulk import against real users, so the expected result today is
the seeded demo accounts only. If that stops being true, the query is how you find them.

## What this does not fix

The invitation mail lands on `/accept-invitation/:token`, which works. The *survey* invitation
mail is a different path and still points at an auth-gated route — see #60. Fixing this half
does not by itself let an invited employee answer a survey.
