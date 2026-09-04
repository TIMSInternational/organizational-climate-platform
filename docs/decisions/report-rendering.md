# Decision: a report downloads as a PDF or a CSV, and `excel` is refused

Recorded 2026-09-03 against `835bcee`, with the code that implements it.

`POST /admin/reports/{id}/download` had incremented `download_count` and returned the
`ReportDetail` JSON since #93 shipped. `reports.format` was a free 10-character string
(`ReportConfiguration.cs:22` — `HasMaxLength(10).IsRequired()`, no check constraint) that
nothing branched on; the web offered `pdf | excel | csv` and disclosed the gap in a banner
(`reports.generationStubbed`: *"Report rendering is not built yet … no file is produced"*);
and the stored document carried the apology in its own `generationNote`
(`ReportGeneration.cs:118`). This file records what replaced all four.

## The renderer is the one this solution already has

`ReportRenderer` (in `ClimateProject.Application/Reports/Rendering`) projects the stored
`ReportOutputDocument` into a `PdfDocument` or a `CsvWriter`. Both are existing, tested,
zero-dependency components in `Application/Exports` — 1,299 lines already producing the survey
export (`SurveyExportEndpoints.cs`), the microclimate CSV and the audit CSV.

`docs/decisions/pdf-rendering.md` anticipated this caller by name: *"The class is in
`Application/Exports` beside `CsvWriter` and `CsvStreamWriter` precisely so the next one —
report download (#91), which today returns JSON metadata rather than a file … uses it instead
of making this decision again."* So there is no new dependency, no licence question, and no
headless browser. Everything that decision costs, this one inherits: no images, no charts, no
font embedding, WinAnsi only (which covers Spanish completely), and a buffered document.

Buffering is bounded here by construction, and for a different reason than the survey PDF's:
a report renders the **stored document**, which the aggregation already collapsed. Its size is
the instrument times the org chart times the company's survey count — not the response count.
The unbounded export in this product is a survey's raw CSV, and that one still streams through
`CsvStreamWriter`.

## `excel` was never rendered, and is now refused rather than silently downgraded

`ReportForm.tsx:19` offered `['pdf', 'excel', 'csv']`. Nothing in the API had ever produced a
spreadsheet, and nothing in this solution can: `grep -rn PackageReference src/*/*.csproj`
returns 13 references, all first-party Microsoft plus BCrypt, Google.Apis.Auth and Npgsql.
There is no PDF library, no spreadsheet library, no HTML renderer and no headless browser.

There *is* an xlsx writer in this repository — `services/tracking-api`'s
`TrackingSheetExport.cs`, reached by `TrackingSheetExportEndpoints.cs:64`. It is **a different
solution**: a separate `.slnx`, a separate deployment, a separate database, and (per the
tracking notes) no company column anywhere in its domain. Referencing it from
`ClimateProject.Application` would couple the climate API's build to the tracking service's,
which is the one thing the two-solution split exists to prevent.

So `ReportFormats.Normalise` accepts `pdf` and `csv` and nothing else, and
`ReportEndpoints.CreateAsync` answers **400** with the file's existing error shape
(`{ "message": … }`) naming both acceptable values.

**Why refuse rather than downgrade.** Accepting the word `excel` and handing back a PDF is the
worse half of both options: the row records the administrator's choice, the file contradicts
it, and nothing tells them. They would forward a document to a director believing a
spreadsheet was on its way, and the only way to discover otherwise is to open the file. A 400
at the moment of choosing is a sentence an administrator can act on — pick CSV — and it is the
same call `SurveyExportEndpoints.ExportAsync` already makes for `?format=`: *"A caller asking
for a format that is not csv or pdf gets a 400 naming both, rather than a silent fallback that
hands them a spreadsheet when they asked for a document."*

**Rows created before the validation still download.** `ReportFormats.IsCsv` treats anything
that is not `csv` as PDF, so a legacy row saying `excel` (or `type`, which the integration
suite's own fixtures wrote) renders as a PDF and `DownloadAsync` logs a warning naming the
row. Throwing instead would turn a year-old data defect into an outage on the one screen an
administrator uses to get their report out. The web keeps its `reports.format_excel` label for
the same reason — those rows are still in the list.

## What a suppressed cell renders, and the one place this differs from `SurveyExport`

Every floor is inherited. The document `ReportGeneration` stored was built from
`SurveyAggregation.Compute`'s own output; the renderer computes no floor and has no branch that
could disagree with the results screen.

The one way a renderer of this document *can* leak is by treating an absent number as a
number. A suppressed department arrives as `(IsSuppressed: true, RespondentCount: 0,
ParticipationRate: null)` — the aggregation zeroed it — so a table cell that printed those two
fields would draw `0` and `Not available`. That reads as *"nobody in Dirección answered"*,
which is disengagement, not confidentiality, and it is a claim about those people that nothing
in this product supports. So:

- **A suppressed department is named, with both numeric cells reading `Withheld` / `Reservado`
  and neither reading `0`.** In the CSV the two cells are **empty**, not `0`, so a spreadsheet
  that sums the column cannot report a workforce that answered nothing. `is_suppressed` rides
  in the same rows, so an empty cell is distinguishable from a missing one.
- **A suppressed survey section prints the aggregation's own reason code verbatim**
  (`below_minimum_respondents`) beside the translated sentence. The tables are empty anyway —
  the aggregation emptied them — and a reader of a *file* cannot ask anyone why.
- **The participation counters are still printed for a suppressed section**, which is the
  aggregation's own decision carried through: `ReportSurveySection.Participation` is documented
  *"Always populated, even below the disclosure floor — a count identifies nobody"*, and
  `SurveyExport.BuildPdf` prints them under an identical `IsSuppressed` branch. Withholding
  them would make a low-response survey indistinguishable from one nobody ran.
- **A suppressed demographic group is not printed at all, only counted.**

That last pair is the deliberate divergence, and it is a divergence from `SurveyExport`, which
names no withheld group in any breakdown. The two cases are not the same kind of thing:

| | withheld **department** | withheld **demographic group** |
|---|---|---|
| where the name comes from | the org chart (`departments.name`) | **the value a respondent typed** |
| does the admin already have it | yes — `/admin/departments` lists every department | no |
| already in the stored document | yes, `ReportSurveySections.ToDepartment` carries the row | the *key* is, and that is the problem |
| rendered | named, numbers withheld | omitted; counted |

`SurveyExport` states the demographic case exactly: with a single withheld segment in a
breakdown its exact size becomes a subtraction, and *"a demographic segment's key IS the value
the respondent typed, so the row would print `nationality:Venezolana` for the one person who
wrote it."* `SurveyAggregation.cs:681` confirms it — a suppressed demographic segment keeps
`group.Key` and nulls only the label. Both documents apply both rules off the same flags, in
the same order, and `ReportRendererTests` proves each by mutation.

## Locale: the chrome follows the first section, the labels follow their own

A report is a company document with no `?lang` to honour, and its sections can legitimately
disagree — one English survey and one Spanish one produce two `ResolvedLocale` values. So:

- **Document chrome** (title line, privacy notice, insight and benchmark headings) follows the
  **first** section's locale, which is the newest survey (`ReportGeneration` orders by
  `created_at` descending). A majority vote across sections was rejected: it changes a
  document's language when a survey is added, so two downloads of one report would come back
  in different languages.
- **Each survey section's labels follow that section's own `ResolvedLocale`**, and the section
  header states it (`Printed in: es`). A table of Spanish question text under the header
  "Question" is the silent substitution #195 forbids, in print.
- **Numbers are formatted by `ReportRenderCopy`, not by a culture** — the rule
  `SurveyExportCopy` writes down: `CultureInfo.GetCultureInfo("es-CR")` produces a decimal
  comma on a host with ICU, in the version of ICU that host happens to carry, and a container
  built with invariant globalization would silently give a Spanish report English decimal
  points.
- **The `generationNote` is printed verbatim and untranslated.** It is server-authored English
  naming the sections the generator does not build yet; translating it here would put a second,
  drifting copy of that list in the renderer. `SharedReportPage.tsx` makes the same call for
  the same string.

## What the file still does not contain

- **Charts and images.** `docs/decisions/pdf-rendering.md` names this as the point at which the
  hand-written serialiser should be **revisited, not extended**: a chart needs a raster image
  and an `/XObject`, and a hand-rolled image pipeline is a different and much worse trade.
- **Per-question option distributions and open-text word frequencies in the PDF.** They are in
  the CSV. A distribution table per question, over an instrument of forty questions across a
  company's surveys, is tens of pages nobody reads.
- **Per-respondent rows and verbatim open text, in either format.** Refused for the reason
  `SurveyExport` gives at length: a per-respondent CSV is the joint distribution that
  `SurveyResultsPrivacy` relies on never being exposed, and shipping one would retroactively
  invalidate the argument that lets every singleton bucket appear on the results screen.
- **Period-over-period comparative analysis, report configuration/filters and templates.** Not
  a rendering gap — the document does not carry them. The two `TODO(#88 follow-up)` comments in
  `ReportGeneration.cs` and the `generationNote` still say so; the third, about `format`, is
  gone because it is done.

## Why the download stays a POST

It mutates (`download_count`), so a GET would be a lie about the verb, and
`AuditWritingMiddleware` audits by method — a GET would need an explicit
`[AuditSensitiveRead]` marker to keep the #143 record, which is a coverage claim resting on an
attribute somebody can drop. The cost is that the browser cannot use a plain `<a href>`, which
it could not anyway: the route is authorized and an anchor sends cookies rather than the bearer
header. `web/src/features/reports/api/reports.ts` fetches the blob and hands it to
`downloadBlobFile`, which is the pattern `surveyExport.ts` established for the survey PDF.

**One consequence, recorded because it is visible.** `Content-Disposition` is not a
CORS-safelisted response header and `Program.cs`'s "Frontend" policy does not call
`WithExposedHeaders`, so the browser cannot read the title-derived filename the server sends
(`ReportFormats.FileName` → `clima-q3-2026.pdf`). `downloadBlobFile` sets `link.download`,
which wins regardless, so the web names the file `report-<id>.<ext>` from the id — the one
thing the caller is certain of. Exposing the header is a one-line CORS change in `Program.cs`,
outside this slice.

## How it is proved

- `ReportRendererTests` (unit, 42 facts) builds every survey section by running
  `SurveyAggregation.Compute` over real response and answer rows and then
  `ReportSurveySections.ToSection` — the same two steps `ReportGeneration` runs. Hand-building
  a section with `IsSuppressed: true` and empty questions would prove only that the renderer
  prints an empty table when handed an empty list.
- The PDF is read back as the **literal strings the content stream draws**, decoded from the
  PDF escapes, not as a substring search over the file. That is what makes *"no drawn cell is
  the string `0`"* assertable at all — a PDF's cross-reference table, object numbers and
  coordinates are full of zeros — and it is the assertion that goes red the moment the
  suppression branch is removed.
- `ReportDownloadEndpointTests` (integration) asserts the wire: status, `Content-Type`,
  the `Content-Disposition` filename, the `%PDF-` magic, the `%%EOF` trailer, the UTF-8 BOM
  ahead of the CSV, and the 400 for each refused format. The download's only previous test
  read the response as JSON and asserted a counter, which is exactly why the gap survived a
  year.
