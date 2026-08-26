# Decision: PDF is rendered in-process, by hand, with no third-party dependency (#122)

Recorded 2026-08-26 against `3d58ec2`, with the code that implements it.

#122 asks for this explicitly — "the PDF rendering approach should be chosen once for the
whole product, not per domain" — and #91 states the constraint the choice has to satisfy:
"headless-browser rendering in App Runner is a heavier operational commitment than a native
PDF library". #131 declined to make the call and **dropped** the microclimate PDF route
rather than guess, recording in `MicroclimateEndpoints.cs` that the blocker was a dependency
decision "with a licence question attached". This file is that decision.

## The three options

**Chosen: a hand-written PDF 1.4 serialiser in `ClimateProject.Application/Exports`.**
`PdfDocument` plus `PdfStandardFontMetrics`, about 700 lines including the reasoning, no
package reference, no external process. Base-14 Helvetica and Helvetica-Bold with
`WinAnsiEncoding`; text, horizontal rules, filled bands and tables of wrapped cells;
pagination with a repeated table header.

**Rejected: a headless browser.** Chromium in the API image is hundreds of megabytes, a
second process to supervise, a sandbox to configure, and a class of failure that only
reproduces under memory pressure. For a document that is a heading, a summary and four
tables, that is an operational commitment out of all proportion to the artefact — and it is
the specific thing #91 warned about.

**Rejected: a PDF package.** QuestPDF is royalty-free only below a revenue threshold, which
is a licence question a government client's procurement will ask and somebody will have to
answer with a number. PdfSharpCore is permissive but is a fork of an older codebase. Neither
is *wrong*; both add the API's first third-party rendering dependency, and neither buys
anything for a document with no images and no charts.

## What the choice costs, stated

- **No images, no charts, no font embedding.** A chart in a report needs a raster image and
  an `/XObject`. That is the point at which this decision should be **revisited**, not
  extended — a hand-rolled image pipeline is a different and much worse trade.
- **Only what WinAnsiEncoding can name.** That covers Spanish completely — á é í ó ú ü ñ,
  their capitals, ¿ ¡ « » º ª ° and the typographic quotes and dashes a word processor
  substitutes — which is the reason the limitation is acceptable rather than merely cheap. A
  character outside it becomes `?`: visible, not a corrupt file. A product that has to
  publish Greek or Cyrillic has outgrown this.
- **The document is buffered, not streamed.** A cross-reference table is a list of byte
  offsets, so the file cannot be written before the objects it indexes are placed. That is
  bounded here by construction — a survey PDF is bounded by the instrument and the org chart,
  not by the response count — and it is why the *unbounded* export format is CSV, which
  streams through `CsvStreamWriter`. A PDF of a million rows is not a large PDF; it is the
  wrong format.

## How it is proved

`PdfDocumentTests` parses the output back rather than asserting on the calls that produced
it: it walks `startxref` to the cross-reference table and checks that **every offset lands on
the `N 0 obj` it claims**, which is mechanically what "the file opens" means. A serialiser
like this fails in exactly one way — it emits something a reader cannot follow — and a test
that checked "did we append the string we meant to" would go green on every one of those
failures.

Externally validated once during development by rendering a generated document through macOS
CoreGraphics (`qlmanage -t`), which produced a correct thumbnail; that is a manual check, not
a gate, because it is not available in CI.

## Where it applies

`SurveyExport.BuildPdf` is the first caller. The class is in `Application/Exports` beside
`CsvWriter` and `CsvStreamWriter` precisely so the next one — report download (#91), which
today returns JSON metadata rather than a file, and the microclimate PDF route #131 dropped —
uses it instead of making this decision again.
