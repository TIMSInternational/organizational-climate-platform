# Before merging #280: check for tenants the old /auth/google created

**Status:** operator action, one-off. No data migration is shipped with this branch, and none
should be written before someone has looked at the rows.

## Why

Until this branch, `POST /auth/google` created a `Company` for any email domain it had not
seen before and made the caller its first employee. The fix closes the door: registration via
Google now requires a company that already owns the domain.

It does not clean up after the old behaviour, and **the fix cannot tell the difference.** A
company that was auto-provisioned for `gmail.com` in March is, to the new gate, a perfectly
legitimate tenant that owns `gmail.com` — so every future `@gmail.com` Google sign-in still
self-registers into it, exactly as before. The gate is only as good as the `companies` rows it
reads. Code is fixed; data is not.

## What to look for

Auto-provisioned rows are recognisable: the name was generated as
`$"{char.ToUpperInvariant(domain[0])}{domain[1..]} Organization"` — so `gmail.com` became
`Gmail.com Organization`. That shape is a strong signal but not proof (a human could have
typed it), and a real tenant could have been created this way too.

```sql
-- 1. Name-shaped suspects: '<domain> Organization', where <domain> is the row's own domain.
select c.id, c.name, c.email_domain, c.created_at,
       (select count(*) from users u where u.company_id = c.id) as user_count
from companies c
where c.email_domain is not null
  and c.name = upper(left(c.email_domain, 1)) || substr(c.email_domain, 2) || ' Organization'
order by c.created_at;

-- 2. Consumer domains, whatever they are named -- these should never own a tenant.
select c.id, c.name, c.email_domain, c.created_at,
       (select count(*) from users u where u.company_id = c.id) as user_count
from companies c
where c.email_domain in (
  'gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','msn.com',
  'yahoo.com','yahoo.es','icloud.com','me.com','aol.com','proton.me','protonmail.com'
);
```

Cross-check anything either query returns against the users in it: a tenant whose only members
have `password_hash is null` (Google-only, never invited) and no surveys is almost certainly
one of these, not a customer.

## What to do about it

Decide per row; do not batch-delete. Deleting a `Company` takes its users, and one of those
"junk" tenants may be a real pilot someone signed up through Google on purpose. The minimum
safe action for a confirmed consumer domain is to clear `email_domain` (which alone stops
further self-registration into it, since the gate matches on that column) and then work out
what to do with the members.

Run the queries against production **and** any shared staging database — staging is where a
`gmail.com` tenant is most likely to exist.
