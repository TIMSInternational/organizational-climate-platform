# Decision: three per-company result bands replace the climate target

**Status: DECIDED 2026-10-01 by Federico Tafur (product owner). Settled — no open question in
this file.** Approved on the design canvas
(https://claude.ai/artifact/UAagNynBJTFnvxk2a7sYPZ) and built in `3a446ea5` on
`feat/result-bands`; every file:line below is read at that commit.

## What it replaces

The screens judged every mean against one number, `CLIMATE_TARGET = 3.7`
(`web/src/features/dashboard/next/compose.ts:78` at `b0dd8b5c`), and printed "bajo / en /
sobre la meta" (`web/src/i18n/es.json:255-257` at `b0dd8b5c`). It was a mockup constant that
no tenant ever chose (`web/src/components/charts/resultBands.ts:5-7`). It is gone:
`git grep CLIMATE_TARGET` at `3a446ea5` finds only that one comment.

## The ruling

**Every mean is read in three areas, and each company sets its own boundaries.** Every
tenant starts on the client's own bands (`Company.cs:36-43`, `resultBands.ts:45-50`):

| Area | Default range | Glyph |
|---|---|---|
| Área de fortaleza | ≥ 4,00 | ▲ |
| Área de oportunidad | 3,00 – 3,99 | ● |
| Área crítica | < 3,00 | ▼ |

A company edits them under Configuración de empresa → **"Escala de resultados"**
(`web/src/i18n/es.json:6808`, `ResultBandsCard` mounted at
`CompanySettingsNextView.tsx:338`).

### Names belong to the company; colours belong to the product

- **Names.** A null name means the product's default name, in the reader's language
  (`bandName`, `resultBands.ts:122-125`; `ResultBands.cs:13-14`). A blank name that is saved
  goes back to null (`ResultBands.cs:100`).
- **Colours.** These are the product palette's green, amber and red chip tokens (`BAND_PAINT`,
  `resultBands.ts:68-90`). The client's hex is never used. The colours are not stored, and a
  comment in the code says they never will be (`ResultBands.cs:16-18`). Green therefore means
  the same thing on every tenant's screen.
- **Colour is never the only signal** (WCAG 1.4.1). Every band also carries its name and a
  glyph: ▲ for strength, ● for opportunity, ▼ for critical (`BandGlyph.tsx:3-15`).

### Storage: two boundaries and three names

The scale always runs from 1,00 to 5,00, and the areas touch at a step of 0,01. Two numbers
therefore describe the whole scale. `ResultBandsDto` has `OpportunityMin`, `StrengthMin` and
three nullable names (`ResultBands.cs:20-33`). They are stored as five columns on
`CompanySettings` (`Company.cs:39-43`). 1,00 and 5,00 are constants, not settings
(`ResultBandsValidation.ScaleMin`/`ScaleMax`, `ResultBands.cs:45-46`).

A gap cannot be stored at all: there is no field that could hold one (`ResultBands.cs:10-13`).
`ResultBandsValidation.Validate` (`ResultBands.cs:56-88`) refuses four things:

- an overlap or an empty area: strength starting at or below opportunity, or opportunity at or
  below 1,00
- a boundary above 5,00
- more than two decimals
- a name longer than 60 characters

The settings PUT validates the scale before it writes anything, so a refused scale saves
nothing (`CompanyEndpoints.cs:230-241`). The integration test
`A_scale_with_a_gap_overlap_or_out_of_range_boundary_is_refused_and_nothing_is_saved` pins
this (`CompanySettingsEndpointTests.cs:167-179`).

Every member of the company can read the scale. Another tenant cannot
(`GET /admin/companies/{id}/result-bands`, `CompanyEndpoints.cs:21`, `:271`).

### A reading is judged at the decimal it is printed at

`bandOf` rounds to the printed precision before it compares (`resultBands.ts:104-112`; the
reasoning is at `:15-20`). A cell that prints "4,0" is in the strength area even when the
unrounded mean is 3,96. A 4,0 painted amber beside a legend that says "4,00 a 5,00" would
contradict itself on the page.

### Bands are applied at read time, like the anonymity floor

Nothing stores a band with a survey. When a share link is opened,
`GET /shared/reports/{token}` (`ReportShareEndpoints.cs:89`) reads the company's settings
**as they are now** (`ReportShareEndpoints.cs:341-358`). It sends only the two boundaries
and the three names, with no company identifier. **Changing the bands therefore recolours
closed surveys and links that were already shared.** That is intended: a link and the
signed-in screens never disagree about a colour.

### No silent default

- **Signed-in screens.** `useResultBands` never falls back to the default when the read
  fails (`web/src/features/result-bands/useResultBands.ts:31-40`). A failed read becomes the
  page's error state, with a retry (`:82`). Otherwise a tenant that had moved its boundaries
  would see the product's 3,00 / 4,00 painted as its own. The one exception is a viewer with no
  company in scope, the super administrator's platform view, which has no company scale to
  read (`:80`).
- **Public shared report.** `parseResultBands` returns `null` for a missing or invalid scale
  (`web/src/features/reports/api/sharedReports.ts:121-133`). With `null`, the page judges
  nothing: rows carry no band (`reports/next/shared/derive.ts:270`), cells keep their figure
  untinted (`parts.tsx:188`, `:277`), and the scale card is not drawn
  (`SharedReportNextPage.tsx:270`).

## What it closes

This closes the open question that was recorded on the leader dashboard. That comment said:
"Known difference, and OPEN … whichever is chosen belongs in `docs/decisions/`"
(`web/src/features/dashboard/next/team/compose.ts:134-140` at `b0dd8b5c`). The LeaderDashboard
artboard drew a 3,5 as below target, while the climate map called the same 3,5 on target. Now
every screen reads one scale, the company's own, and has no rule of its own to disagree with
(`team/compose.ts:119-131`).

On the leader's card, a plan is offered for **any** reading outside the strength area. Only
the critical area tints the card (`LeaderDashboardView.tsx:309-321`).

## Where the build departs from the approved canvas, on purpose

1. **"Dónde mirar primero" keeps the breadth rule.** If all three findings would come from one
   group, the third becomes the lowest cell **outside** that group, and its reason line says
   so (`web/src/features/surveys/next/derive.ts:290-308`).
2. **Clima en el tiempo keeps the "Encuestas cerradas" tile.** The strength and critical tiles
   take the place of the two old target tiles (`trends/ClimateTrendsNextPage.tsx:227-262`).
3. **The whole-company mean shows a glyph, not a chip.** The chip did not fit the 96px column
   beside "Frente a Q2". The band's word still appears in the CLIMA tile, in the title, and in
   the accessible label (`ResultsClimateGrid.tsx:383-389`).

## Deploy order: the API before the web

The web ships on every merge to `main` through Vercel's git integration. The API ships only
when someone dispatches `deploy-prod.yml` by hand (`docs/runbooks/rollback.md:70-74`;
`.github/workflows/deploy-prod.yml:3-4`; `docs/runbooks/alerting.md:570-573`).

The old API has no `/result-bands` endpoint, so it answers 404. `authFetch` turns any status
other than 401 into an `ApiError` (`web/src/api/authFetch.ts:114-124`), and every banded
screen then shows its error state. **Dispatch the API deploy first, and merge the web only
after it.**

## What does not change

PDF and CSV exports do not colour readings. `3a446ea5` touches no file under
`src/ClimateProject.Application/Exports/`, and nothing in that directory refers to a target or
a band.

## Decision

```
Climate target (3,7):  REMOVED
Result bands:          per company; default < 3,00 / 3,00–3,99 / ≥ 4,00
Colours:               product tokens, never the tenant's
Applied:               at read time, on every screen and on shared links
Decided by:            Federico Tafur
Date:                  2026-10-01
```
