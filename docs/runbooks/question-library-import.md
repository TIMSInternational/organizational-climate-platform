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

> **Status 2026-09-03:** the procedure is now a script — `scripts/import-question-library.mjs`,
> §5 — and it **has been executed end to end against a running local API** (branch build on
> `localhost:5130`, sample instrument, both ownership scopes: first run 18 created, second run
> 0 created, verify clean). It has **never** been run against production, and PROCOMER's
> instrument file does not yet exist in this repository. See §8.

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

```bash
# 1. Put the instrument in the file format below (scripts/fixtures/question-library.sample.json
#    is a complete, validated example). 2. Decide §3. 3. Dry-run, then run, then verify.
export CLIMATE_EMAIL=<admin-email> CLIMATE_PASSWORD=<password>     # never as flags
API=https://bhgrdkd4gt.us-east-1.awsapprunner.com                   # production
# API=http://localhost:5080                                          # local

node scripts/import-question-library.mjs --api "$API" --file instrument.json --company-id <procomer-guid> --dry-run
node scripts/import-question-library.mjs --api "$API" --file instrument.json --company-id <procomer-guid>
node scripts/import-question-library.mjs --api "$API" --file instrument.json --company-id <procomer-guid> --verify-only
```

Use `--global` instead of `--company-id` if §3 was answered "global". The script refuses to run
without one of the two (exit 2, nothing sent).

What the script does, in order, and why each step is there:

1. **Validates the whole file before the first request** and lists every problem at once —
   both languages on every category and item, supported types only (§4), options present and
   unique for `multiple_choice`, every `parent` and `category` reference declared, no parent
   cycles, no duplicate `(category, textEn)`.
2. **Signs in once** (`POST /auth/login` is rate-limited at 20/min; the token is reused).
3. **Reads what already exists** in the chosen ownership scope and matches by natural key —
   a category is `(parent, nameEn)`, an item is `(category, textEn)`. Matched rows are skipped.
   This is what makes the import idempotent and resumable: a second run reports `0 created`;
   a run that died at item 30 re-runs from the same command and creates only the rest.
4. **Creates categories parents-first, then items**, one `POST` each (there is no bulk
   endpoint). Every `2xx` is checked by **body**: an `id` came back and `nameEn`/`textEn`/`type`
   echo the request. A `200` with the wrong body is a failure.
5. **Verifies**: re-reads the server and asserts that every category and item in the file
   resolves to a row; prints the file/server/matched counts. A run that reports 43 of 44 has
   dropped one — the script exits 1 and names it.

### The file format

```jsonc
{
  "instrument": "free text, printed in the log",
  "categories": [
    { "key": "leadership",          "nameEn": "Leadership", "nameEs": "Liderazgo",
      "descriptionEn": null, "descriptionEs": null, "parent": null, "order": 1, "icon": null, "color": null },
    { "key": "leadership.feedback", "nameEn": "Feedback",   "nameEs": "Retroalimentación", "parent": "leadership", "order": 1 }
  ],
  "items": [
    { "category": "leadership.feedback", "type": "likert",
      "textEn": "My manager gives me useful feedback.", "textEs": "Mi jefatura me da retroalimentación útil.",
      "scaleMin": 1, "scaleMax": 5,
      "scaleLabelMinEn": "Strongly disagree", "scaleLabelMinEs": "Muy en desacuerdo",
      "scaleLabelMaxEn": "Strongly agree",    "scaleLabelMaxEs": "Muy de acuerdo",
      "dimension": "Liderazgo", "tags": ["feedback"] },
    { "category": "communication", "type": "multiple_choice",
      "textEn": "…", "textEs": "…",
      "options": [ { "value": "email", "labelEn": "Email", "labelEs": "Correo electrónico" } ] }
  ]
}
```

`key`, `parent` and `category` are local references that wire the file together; they are
never sent to the API. `companyId` is not in the file — it comes from the flag, once, for
every row. Every field the create endpoints accept (`CreateQuestionCategoryRequest`,
`CreateQuestionLibraryItemRequest` in `QuestionRepositoryDtos.cs`) is expressible; omitted
optional fields are sent as `null`.

### If you would rather see the raw requests

`--dry-run` prints the plan. The request shapes are `toCategoryRequest` / `toItemRequest` in
the script, one field per line, and the seven routes are listed in §2. The previous version of
this section — a hand-run `curl` loop — is in git history before 2026-09-03; it was never run.

## 6. Dry-run first — this is not optional

Run the script with the real instrument file against **local or staging** before pointing it
at production: `--dry-run` first, then the run, then `--verify-only`. Read every validation
line; a `ranking` item in the instrument surfaces here (§4) and is a modelling question, not
something to work around.

If a production run does fail partway, the fix is the same command again: rows that landed are
matched by natural key and skipped, the rest are created. Do not delete anything — there is no
delete endpoint; deactivating a bad row (`PUT` with `isActive: false`) is how an item is
retired, and the picker drops inactive rows.

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
| Tool | `scripts/import-question-library.mjs` — 10 `node --test` cases (`node --test 'scripts/*.test.mjs'`), validator / ordering / matcher / request shapes |
| Procedure end to end | **Executed locally 2026-09-03** against a branch build (sample instrument, both scopes, second run `0 created`, verify clean). **Never against production.** |
| Instrument file | **Does not exist in this repository.** PROCOMER's 44–50 items must arrive in the §5 format |
| Global vs company-owned | **Open — §3.** Needs answering before the first import |
| Ranking items in the instrument | **Unknown** until the instrument arrives — §4 |
| #423's admin UI | **Deferred deliberately** to after 16 Nov go-live |
