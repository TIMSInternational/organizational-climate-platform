# Operational pages — the logs viewer and the maintenance page (#141)

**Status: maintenance page DONE. Logs viewer RECOMMENDED DROP, awaiting Federico's sign-off.**

#141 carries two legacy pages with no equivalent — `src/app/logs/page.tsx` and
`src/app/maintenance/page.tsx` — and asks for a keep/drop decision on each rather than a
reflexive port. This is that decision.

## Maintenance page — KEPT, and shipped

`web/public/maintenance.html`, merged as #430. Static, 4.3 KB, no JavaScript, no API call,
served by Vercel from `public/` — which is the point. A maintenance page that needs the
application to be up cannot do its job, and the legacy one was a Next.js route inside the
app it was meant to cover for.

Verified on the Vercel preview: `GET /maintenance.html` → **200**.

This closes #141's third and fourth criteria ("servable while the app is down", "usable by
the cutover plan"), and cutover **C8** now has a page to point at.

## Logs viewer — RECOMMEND DROP

**#141's own scope says so**, and the reasoning holds up:

> With CloudWatch available via App Runner, an in-app log viewer is probably redundant and
> is a real security surface if it can surface PII or secrets. Recommend dropping in favour
> of CloudWatch unless there is a specific need.

Three things measured before agreeing with it:

1. **CloudWatch already has the logs.** The production service ships both streams:
   `/aws/apprunner/climate-project-api-prod/<id>/application` and `.../service`
   (`aws logs describe-log-groups`, PROD account). Nothing needs building for an operator
   with console access to read them.
2. **An in-app viewer is a live PII surface.** This repository's hardest privacy rule is
   that verbatim open-text response content is never returned, and the suppression floor of
   5 is applied at read time. Application logs obey neither: they carry request paths, ids,
   exception messages and whatever a stack trace picked up. A screen that renders them to a
   browser is a way around both rules that no endpoint would be allowed to be.
3. **It would be new attack surface a week before go-live**, on a system whose secrets have
   not yet been rotated (#70, `docs/security/rotation-inventory.md:3` — "NOT STARTED").

Against that, the specific need the scope asks about — *is there one?* — has not been
stated by anyone. No runbook step calls for an in-app log viewer; `alerting.md` and
`cutover.md` both direct an operator to CloudWatch.

**So: drop it.** If a need appears later, the constraints #141 already set are the right
ones and should be re-read then: SuperAdmin-only, and no secrets or PII rendered.

## One thing this decision surfaces and does not fix

The App Runner log groups have **no retention set** — `retentionInDays` is `None`, meaning
never expire. The synthetic probe's group is the only one with a policy (30 days). For a
government client's employee-survey platform, "application logs kept forever, with no
stated retention" is a data-protection question rather than a cost one, and it is not
#141's to answer. Raised here so it is written down somewhere; it belongs with the GDPR
and retention work, not with a page that is being dropped.

## Decision

```
Logs viewer:  ____  (drop | build, with the #141 constraints)
Decided by: ____
Date: ____
```

Maintenance page: **kept and shipped** (#430). No signature needed.
