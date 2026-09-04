# How PROCOMER's instrument reaches the question library

**Status: ANSWERED for the mechanism, OPEN for the ownership ruling.**
Owner of the open half: Federico. Raised by #423's third acceptance criterion, which asks
for "a stated answer to whether PROCOMER's instrument is loaded through this UI or by a
one-off import".

## The answer: both, and they are not alternatives

#423 framed these as competing paths and warned that if the instrument "arrives once, by
import", then building a page in the week before go-live is the wrong resolution. That
framing is right about the *load* and incomplete about everything after it.

| | Loading ~50 questions once | Maintaining them afterwards |
|---|---|---|
| **Tool** | `scripts/import-question-library.mjs` (#428) | `/admin/question-library` (#423) |
| **Why that one** | Idempotent, resumable, asserts the expected count, and checks response bodies rather than status codes. Typing fifty bilingual questions into a form is slow and silently error-prone. | Fixing one translation, retiring one question, adding one. Re-running a bulk importer to change a typo is not a maintenance story. |

Before this round, **neither existed**. The library's endpoints had accepted `POST` and
`PUT` since #112, and the only route that reached them was `/dev/question-library`, inside
`router.tsx`'s `import.meta.env.DEV` guard — so it ships in no production build. The
library could be read in the product and written only by `curl` or by SQL against
production.

So the honest resolution was not "importer *or* page". It was: the importer is how the
instrument lands, and the page is why the client is not locked out of their own question
set the first time a word is wrong. #423 is closed by the page; the instrument's arrival
is not blocked on it.

## The open half: global, or owned by one company?

**This is a ruling, not an implementation detail, and it is permanent.**

`CompanyId` is absent from both update DTOs (`QuestionRepositoryDtos.cs`) because it is
immutable after creation — it decides who may write the row. Whichever path runs first
settles it:

- `scripts/import-question-library.mjs` **refuses to run without an explicit answer** (#428).
- `/admin/question-library` asks a super_admin outright on the create form, and states the
  answer rather than inferring it from the header switcher.

The two options:

**Global** (`CompanyId = null`) — one instrument, visible to every tenant, editable only by
a super_admin. Correct if PROCOMER's instrument is the platform's standard climate
instrument that other clients will also answer. A company_admin can use it and cannot
change it, which is the right protection for a shared instrument and the wrong one if the
client expects to edit their own questions.

**Company-owned** (`CompanyId = PROCOMER's id`) — theirs, editable by their own admins,
invisible to every other tenant. Correct if the instrument is this client's and its
wording is theirs to change. It cannot later be shared with another tenant without
re-creating it.

Nothing in the repository decides this, and it should not be decided by whoever runs the
importer first. It is a question about what TIMS is selling.

## What is true regardless

- A category must exist before a question can join it; the importer creates categories
  parents-first, and the page refuses a question with no category.
- Both languages are mandatory on this surface — `QuestionLibraryEndpoints.cs:109` refuses
  a blank `NameEn`/`NameEs`, and the item create refuses the same for `TextEn`/`TextEs`. A
  half-translated tree renders blank for one audience.
- The library is **not** the question bank. They reach different tables and #58 settles
  that they must not be merged.

## Decision

```
Ownership of PROCOMER's instrument:  ____  (global | company-owned)
Decided by: ____
Date: ____
```
