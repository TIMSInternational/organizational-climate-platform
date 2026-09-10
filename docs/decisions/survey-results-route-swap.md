# The redesigned survey results replaced `/surveys/:id/results` — what the swap kept, and what it did not

**Status: the swap is RULED (Federico, 10 Sep 2026 10:55: "redesigned screens replace
their current route, not a `/next` sibling"). What the artboard did not draw is NOT ruled
— this record says what the routed screen does with each such part, and the two open
questions are Federico's.** Written 10 Sep 2026 on `ui/results` (PR #468), against
`main` at `ceeb06ef`.

## The two screens

| | `pages/SurveyResultsPage.tsx` (unrouted since this PR) | `next/SurveyResultsNextView.tsx` (the route) |
|---|---|---|
| Source of truth | one `GET /surveys/{id}/analytics` | the same request, plus `GET /action-plans?companyId=` |
| Design | none — "the best screen in the product and it has no design brief" (`screen-triage.html`, row `/surveys/:id/results`) | the approved `SurveyResults` artboard |

The artboard was drawn for one survey: Grupo Meridiano's Q3, **one scale question per
dimension, authored in Spanish for a Spanish reader, no open-text question**. It is a
faithful design for that survey and silent about every shape it does not have. The page
it replaced rendered for every shape the API can return. The refuter of PR #468 measured
the difference and was right that nothing recorded it — this is the record.

## What the old page rendered that the artboard does not draw

| # | On the old page (file:line at `0b54867d`) | Why it exists | On the routed screen after this PR |
|---|---|---|---|
| 1 | The content-language notice, `SurveyResultsPage.tsx:425-429` (`ResultsContentLanguageNotice`) | `resolvedLocale` and `fallbackFields` ship on every read so a client can tell the reader the text is not in the language they asked for (#195). A Spanish administrator opening an English-only survey would otherwise quote questions they could not read, unwarned. | **RESTORED**, first thing under the header. Renders nothing when the content is in the requested language. Test: `SurveyResultsNextPage.test.tsx › says so when the content came back in a language the reader did not ask for` and `› stays silent when the content is in the language that was asked for`. |
| 2 | The open-text themes, `SurveyResultsPage.tsx:715-734` (`WordCloud` over `openTextThemes`, plus the withheld-word count) | The one on-screen surface an open-ended question has. The product never returns verbatim text — word frequencies per language only (`SurveyWordFrequency`) — and the artboard's own drill-in note says exactly that ("solo frecuencias de palabras, y nunca bajo 5 respuestas"). | **RESTORED**, after the opened cell, gated on the survey *having* an open-ended question (not on the words being non-empty: every word under the floor keeps the section and says so). Tests: `› gathers open text into one themes cloud, per language, and says what it withheld`, `› keeps the themes section when every word fell under the word floor, and says so`, `› renders no themes section for a survey with no open-text question`. |
| 3 | The per-question list with its category and type filters, `SurveyResultsPage.tsx:788-868` (`QuestionDistributionRow` / `QuestionResultCard`) | The map holds scale questions only — the server computes a mean for numeric scales and nothing else (`surveyResultsMap.ts`, "why only scale questions enter the map"). A multiple-choice, ranking or yes/no question has **no other on-screen surface**; a dimension with several questions shows them all only here. The triage's own principle: "every table keeps its accessible form under the chart". | **RESTORED**, last, as `next/SurveyResultsQuestions.tsx` — the old page's row components unchanged, the filters client-side over the payload the page holds. The header's questions CSV still writes every question, never the filtered list. Test: `› lists every question under the map, and narrows the list by type without a request`. |
| 4 | The breakdown table with its dimension selector and per-segment comparison, `SurveyResultsPage.tsx:736-786` (`SegmentBreakdownPanel`) | The demographic breakdowns (`tenure`, …) and each segment's participation with its denominator. | **NOT on the screen.** The artboard's map is the department breakdown, by design. The other dimensions reach the reader through the breakdown CSV, which this PR widened back to every dimension the server returned (`› writes every dimension to the breakdown CSV, not only the one the map is drawn from`). Open question A below. |
| 5 | The whole-survey dimension standings table, `SurveyResultsPage.tsx:657-705` | One row per dimension: question count, score, standing against the survey mean. | **Absorbed**: the artboard's "Toda la empresa" row prints the same per-dimension means, and the "Bajo la meta" tile names the ones under the reference. Nothing lost but the question count per dimension. |
| 6 | The participation strip's invited / outstanding / participation-rate tiles, `SurveyResultsPage.tsx:901-964` | Whether to keep chasing responses. | **Absorbed into one tile**: "Participación" prints responses, % completed and the invited count (or "sin lista de invitados"). The outstanding count is not printed. |

Everything else the old page did — the map, the findings, the drill-in, the whole-survey
suppression notice, the four-layer privacy rule, the three exports — the routed screen
does through the same functions (`buildClimateMap`, `climateFindings`, `climateDetail`,
`buildQuestionResultsCsv`, `buildBreakdownCsv`), so the two cannot disagree on a number
or on which rows are withheld.

## Why restore rather than rule

Rows 1–3 were restored, not deferred, for one reason each:

- Row 1 is a correctness guarantee the API was built to make possible; dropping it on the
  live route is the silent substitution #195 exists to prevent.
- Row 2 is the only surface a whole question type has, and the artboard *describes* it
  in words without drawing it.
- Row 3 is the only surface for every non-scale question, and the loss is invisible on
  the artboard's survey precisely because that survey has none.

None of the three contradicts anything the artboard draws; each sits below it. If the
design absorbs or drops any of them, that is a later swap with its own record, not a
default this PR gets to take.

## Open for Federico

**A. The demographic breakdowns (row 4).** Today: CSV only. The map is by department;
the artboard has no dimension selector. Options: (i) a selector on the map, as the old
page had, so `tenure` and the others draw the same grid; (ii) a second, smaller map per
demographic under the department map; (iii) CSV only, as now. The privacy rule is the
same whichever way: a withheld segment stays hatched and never yields a number.

**B. The per-question list (row 3).** Today: restored under the drill-in in the current
page's own components, which do not share the artboard's strip style. Options: (i) keep
it as the accessible form under the chart, restyled to the artboard's grammar when the
design catches up; (ii) fold it into the drill-in (a cell opens every question of its
dimension, which it already does) and accept that non-scale questions are CSV-only —
which needs the design to say so.

Both are product rulings. Until they land, the routed screen keeps rows 1–3 and the
breakdown CSV carries row 4.

*Update, 10 Sep (results-fidelity, fix round 3).* The kept list no longer speaks a second
language on the one colour scale. Its chips measured each question against the mean of
the question means ("Por encima / En la media / Por debajo", `surveyQuestionStandings`)
while the grid above measures cells against the target 3,7 ("sobre / en / bajo la
meta"). The list now reads the target too (`questionBand` in
`web/src/features/surveys/next/derive.ts`), in the grid's words and tints. Its heading is
the page's serif h2, and its two filters are compact controls on the page's line. Keep,
fold or restyle further is still open question B.
