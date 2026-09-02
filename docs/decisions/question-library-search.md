# Question-library search runs on the client, and there is no `question-library/search` route

**Decided 2026-09-02 by Federico, closing #112.** The shipped client-side filter satisfies
*"search responsive enough for type-ahead at realistic volume"*. The legacy
`question-library/search` endpoint is **deliberately not carried over**.

This record exists because the absence looks like an omission. A future reader auditing the
legacy surface will find `question-library/search` unported, and a future contributor will reach
for a server route the first time the library feels large. Both should land here first.

## The decision

**No server-side text-search route.** Search stays in
`web/src/components/questions/questionLibraryFilter.ts`, which the shared picker
(`QuestionLibraryBrowser`, used by both the survey and the microclimate wizard) already uses.

The list endpoint `GET /admin/question-library` keeps its structured filters — `categoryId`,
`type`, `dimension`, `tag`, `companyId` — and gains no text parameter.

## Why: a naive server route would be a regression, not an improvement

This is the part that is easy to get backwards. The client filter is not a placeholder; it does
**three things a `WHERE text ILIKE '%q%'` would lose**:

1. **Accent folding.** `foldForSearch` (line 21) is
   `text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase()`, so an admin typing
   `comunicacion` finds `Comunicación`. Postgres `ILIKE` does not fold diacritics. Tested at
   `questionLibraryFilter.test.ts:68` and `:176`.
2. **Both languages at once, plus tags and dimension.** The haystack is
   `textEn + textEs + dimension + tags`. The library is bilingual by construction — the server
   requires *both* `TextEn` and `TextEs` — so an admin should not have to know which language a
   question was filed under. Tags are the only place a synonym lives.
3. **Multi-word AND matching.** The query is split on whitespace and every needle must match,
   rather than one substring.

Getting that parity on the server means `unaccent` or `pg_trgm`. That is the same class of
decision this repository has already met once and deliberately did **not** take:
`SearchIndexConfiguration.cs:76` records that accent folding in the global search index
*"needs the `unaccent` extension plus an IMMUTABLE wrapper around it before it can appear in a
generated column, and adding an extension to production for 'gestion' to find 'Gestión' is a
bigger decision than this issue should make on its own."*

That is a deferral rather than a refusal — the extension has never been ruled out, it has been
left to a decision bigger than any one issue. This document does not take it either, and for a
sharper reason: here the extension would be adopted **to make a fast thing slower**, replacing an
in-memory filter over an already-fetched list with one network round trip per keystroke.

### An asymmetry worth knowing about

The picker's search **is** accent-folded; the platform's **global** search (the command palette,
`SearchIndexConfiguration`, `to_tsvector('simple', …)`) **is not**. So `comunicacion` finds
`Comunicación` inside the question picker and does not find it from the global search bar.

That is not a defect introduced by this decision — it predates it and is recorded at the source —
but it is a real inconsistency a user can hit, and whoever eventually rules on `unaccent` should
know both surfaces are waiting on that one call.

## Why it is safe at this size, and the exact condition that changes it

The picker fetches the list once and filters in memory, so typing costs nothing. That trade is
sound for a corpus of the size actually in play: PROCOMER's instrument is **44 questions growing
to about 50**, and the requirement's wider ambition is **200+**.

**The condition to revisit:** the library growing past **a few thousand rows**, where the single
fetch — not the filtering — becomes the cost.

The seam is deliberate and named in the source: `filterLibraryItems` is the function to replace,
not the component. `questionLibraryFilter.ts` exists as a separate file precisely so these rules
can be tested without a DOM and so the component cannot grow a second copy of any of them.

Note what the seam must preserve if it is ever moved server-side: **all three properties above**,
not just substring matching. A server route that loses accent folding is a regression an admin
will feel on the first Spanish query.

## Ruling on #112's five acceptance criteria

Closed against the criteria, not against code.

| # | Criterion | Ruling | Evidence |
|---|---|---|---|
| 1 | Endpoints implemented and registered | **MET** | 7 routes in `QuestionLibraryEndpoints.cs:39-48`; `app.MapQuestionLibraryEndpoints()` at `Program.cs:651` |
| 2 | Search responsive enough for type-ahead at realistic volume | **MET — accepted 2026-09-02** | Client-side filter over a single fetch; this document is the reasoning |
| 3 | Category hierarchy preserved | **MET** | `ParentCategoryId` on the entity (`QuestionRepositories.cs:27`) and on all three category DTOs; server refuses a non-existent parent, a cross-tenant parent, self-parenting and reparenting under a descendant |
| 4 | Question text available in both languages | **MET** | `TextEn`/`TextEs` both required server-side — `400 TextEn and TextEs are both required`; likewise `NameEn`/`NameEs` on categories |
| 5 | No `LibraryQuestion` entity or endpoint created | **MET** | `grep -rn "LibraryQuestion" src/ tests/` excluding `QuestionLibrary` → **0 hits** |

Criteria 1, 3, 4 and 5 are additionally covered by the 10 tests in
`tests/ClimateProject.IntegrationTests/Questions/QuestionLibraryEndpointsTests.cs`, which run in
`dotnet test ClimateProject.slnx` in CI's `build-and-test` job — green on `main` `9df7b4c`.

## What this does not settle

**#112's criteria are API-only, and they are met.** The library still has **no production admin
UI** — the only route is `/dev/question-library`, behind `import.meta.env.DEV`. That is #423,
where it was filed deliberately rather than left to ride on this issue, and it is resolved for
go-live by `docs/runbooks/question-library-import.md` rather than by a page.

So: an admin can *search* the library from inside the picker, and cannot *author* it from
anywhere in a production build. Those are two different findings and only the first one is #112's.
