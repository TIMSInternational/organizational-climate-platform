# Loading an instrument into the question library

**This is the supported way PROCOMER's instrument enters the product.** Decided 2026-09-02 by
Federico, on #423: the instrument arrives **once, by import** — it is not authored through a
production admin UI, and #423's UI is deferred deliberately rather than by omission.

Written against `main` `9df7b4c`. Every route, field name, validation rule and status code below
was read from `src/ClimateProject.Api/Endpoints/QuestionLibraryEndpoints.cs` and
`src/ClimateProject.Application/Questions/QuestionRepositoryDtos.cs` at that commit, and each
rule cited here is covered by a test in
`tests/ClimateProject.IntegrationTests/Questions/QuestionLibraryEndpointsTests.cs` (10 tests),
which runs inside `dotnet test ClimateProject.slnx` in CI's `build-and-test` job — green on
`9df7b4c`.

> **What has NOT been done:** this procedure has not been executed end to end against a running
> API. It is derived from the endpoint source and its CI-green contract tests, not from a
> performed import. Run §6 (the dry run) against staging or local before pointing it at
> production. See §8.

## 1. Why there is no page to do this in

`web/src/app/router.tsx` contains exactly one question-library route, `/dev/question-library`
(line 180), inside the block guarded by `import.meta.env.DEV`. **It does not exist in a
production build.** The sibling `/admin/question-bank` (line 329) is #114 and reaches a
different table on purpose; it does not cover the library.

The API half is complete and registered (`Program.cs:651`). So the instrument can be loaded —
just not by clicking. That asymmetry is the whole reason this file exists.

**Consequence to know before the instrument arrives:** the picker that consumes the library
(`QuestionLibraryBrowser`, used by both the survey and microclimate create wizards) renders an
**empty list** in production until this procedure has been run. An empty picker is not a defect
report; it is this task, not yet done.

## 2. The seven routes

All are under `.RequireAuthorization()`. There is **no bulk-add and no quick-add endpoint** —
the legacy `question-library/bulk-add` and `/quick-add` were not carried over. An import is a
loop of single `POST`s, which is what §5 does.

| Method | Route |
|---|---|
| `GET` | `/admin/question-categories` |
| `POST` | `/admin/question-categories` |
| `PUT` | `/admin/question-categories/{id:guid}` |
| `GET` | `/admin/question-library` |
| `POST` | `/admin/question-library` |
| `GET` | `/admin/question-library/{id:guid}` |
| `PUT` | `/admin/question-library/{id:guid}` |

## 3. Who may run this, and the one decision it forces

Authorization is `CanWrite(currentUser, rowCompanyId)`
(`QuestionLibraryEndpoints.cs:63`):

- **SuperAdmin** may write any row.
- **CompanyAdmin** may write only rows whose `CompanyId` equals their own company.
- Everyone else is refused. An employee is refused the library entirely.

`CompanyId` is **immutable after creation** on both categories and items — it decides who owns
the row and who may write it. So the choice below is made once, at import time, and changing it
later means re-creating the rows.

> **Decide before importing: is PROCOMER's instrument GLOBAL or COMPANY-OWNED?**
>
> - `CompanyId: null` → a **global** row, visible to every tenant, and **SuperAdmin-only to
>   write**. This is the right answer if the instrument is TIMS's shipped standard instrument.
> - `CompanyId: "<procomer-company-guid>"` → owned by PROCOMER's company, visible only to it.
>   This is the right answer if the instrument is PROCOMER's own.
>
> The platform is multi-tenant here even though the tracking module is not, so this is a real
> choice and not a formality. If unsure, **company-owned is the reversible-by-addition answer**:
> a company row can later be duplicated up to global, whereas a global row is visible to every
> future tenant the moment it is written.

## 4. What the server will refuse

Each of these returns `400` with a `{ "message": ... }` body, except the authorization failures
which return `403`. Import scripts must check the body, not just the status — the repo has been
bitten by that specific gap before.

| Rule | Applies to | Message |
|---|---|---|
| Both languages required | categories | `NameEn and NameEs are both required` |
| Both languages required | items | `TextEn and TextEs are both required` |
| Type must be supported | items | `Type must be one of: ...` |
| Category must exist and be readable | items | `QuestionCategoryId does not reference an existing category` |
| `multiple_choice` needs options | items | `multiple_choice requires at least one option` |
| Option values unique within a question | items | `Option values must be unique within a question` |
| Parent must exist | categories | `ParentCategoryId does not reference an existing category` |
| No cross-tenant parent | categories | `403` — a company category may hang under a global one, never under another tenant's |
| No cycles | categories (`PUT`) | reparenting under one's own descendant, or under oneself, is refused |

### The supported types are narrower than the survey wizard's

`QuestionRepositoryTypes.Supported` is **derived** as the intersection of
`QuestionTypes.ForSurvey` and `QuestionTypes.ForMicroclimate`, so a library item is only
authorable if **both** wizards can instantiate it:

```
likert   multiple_choice   open_ended   rating   yes_no
```

**`ranking` and `emoji_rating` are refused at authoring time** — `ranking` is survey-only,
`emoji_rating` is microclimate-only since #198. If PROCOMER's instrument contains a ranking
item, that is a real modelling question to raise, not a bug to work around: the library exists
to be picked into both surfaces.

## 5. The procedure

### 5.1 Get a token

```bash
API=https://bhgrdkd4gt.us-east-1.awsapprunner.com   # production
# API=http://localhost:5000                          # local

TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"<admin-email>","password":"<password>"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')

test -n "$TOKEN" && echo "token acquired" || { echo "LOGIN FAILED"; exit 1; }
```

The response is `{"token": "..."}` — `TokenResponse` at `AuthEndpoints.cs:455`, read the same
way by `web/src/auth/api.ts` and by the integration tests. There is no `accessToken` field.

`/auth/login` is rate-limited (`RateLimitPolicies.Authentication`). Acquire the token once and
reuse it; do not log in per question.

### 5.2 Create the categories, parents first

A child needs its parent's id, so the tree is created top-down. Both names are mandatory.

```bash
curl -s -X POST "$API/admin/question-categories" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
        "nameEn": "Leadership",
        "nameEs": "Liderazgo",
        "descriptionEn": null, "descriptionEs": null,
        "parentCategoryId": null,
        "companyId": null,
        "order": 1, "icon": null, "color": null
      }'
```

The response is the created category; keep its `id` for the children and for the items.

### 5.3 Create the items

```bash
curl -s -X POST "$API/admin/question-library" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
        "questionCategoryId": "<category-guid>",
        "textEn":  "My manager gives me useful feedback.",
        "textEs":  "Mi jefe me da retroalimentación útil.",
        "type": "likert",
        "companyId": null,
        "scaleMin": 1, "scaleMax": 5,
        "scaleLabelMinEn": "Strongly disagree", "scaleLabelMinEs": "Muy en desacuerdo",
        "scaleLabelMaxEn": "Strongly agree",    "scaleLabelMaxEs": "Muy de acuerdo",
        "dimension": "Liderazgo",
        "tags": ["feedback"],
        "options": null
      }'
```

For `multiple_choice`, supply `options` as `[{ "value": null, "labelEn": "...", "labelEs": "..." }]`.
`value` may be omitted and is then derived; whatever it resolves to must be unique within the
question.

`companyId` must match the §3 decision, and must be identical on the categories and the items —
a company item cannot be filed under another tenant's category.

### 5.4 Verify what landed

```bash
curl -s "$API/admin/question-library" -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin)["items"]; print(len(d), "items")'

curl -s "$API/admin/question-categories" -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import sys,json
c=json.load(sys.stdin)["categories"]
print(len(c), "categories")
print("items filed:", sum(x["itemCount"] for x in c))'
```

`itemCount` is computed server-side from what is actually filed under each category, so the two
numbers disagreeing means items landed under a category you did not intend — not a display bug.

**Assert the count you expected.** The instrument is stated as 44 questions growing to about 50;
a run that reports 43 has silently dropped one to a `400` nobody read.

## 6. Dry-run first — this is not optional

Run the whole thing against **local or staging** with the real instrument file before pointing
it at production. There is no bulk endpoint and therefore no transaction: an import that fails
at question 30 leaves 29 rows behind, and re-running it creates 29 duplicates, because nothing
here is idempotent and the library has no natural key.

If a production run does fail partway:

1. Do **not** re-run it from the top.
2. `GET /admin/question-library` and diff against the source instrument.
3. Resume from the first missing question.

Deactivating a bad row (`PUT` with `isActive: false`) is how an item is retired — the picker
drops inactive rows. There is no delete endpoint.

## 7. What this procedure does not cover

- **The question bank** (`/admin/question-bank`, #114) is a different table with a different
  purpose and has its own admin page. Nothing here applies to it.
- **Survey templates** — `docs/decisions/survey-template-seed.md` records why instrument text is
  deliberately not baked into C#. This runbook is the reviewed admin action that document
  anticipated; the loader it also mentions belonged to #154, which is closed `NOT_PLANNED`.
- **The 200+ question corpus** named in `docs/requirements/TECH_SPEC.md` is a larger content
  dependency than PROCOMER's 44–50 item instrument. Loading the instrument does not discharge
  it. See `docs/decisions/2026-09-01-question-pool-adaptive.md` §3.

## 8. Status

| | |
|---|---|
| Contract | **Verified** by reading the endpoints at `9df7b4c` and by 10 CI-green integration tests |
| Procedure end to end | **Not yet executed.** Do the §6 dry run first |
| Global vs company-owned | **Open — §3.** Needs answering before the first import |
| Ranking items in the instrument | **Unknown** until the instrument arrives — §4 |
| #423's admin UI | **Deferred deliberately** to after 16 Nov go-live |
