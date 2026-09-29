# Decision: the Excel intake is a template we define, parsed deterministically with ClosedXML

Recorded 2026-09-29 against `50844d99`, with the code that implements it.

The client's onboarding today is a CSV whose four columns have to be spelled correctly, uploaded
blind, and re-uploaded whole when one row is wrong (`BulkImportPanel.tsx`). The ask was an intake
that takes a spreadsheet, shows what it understood, lets the administrator correct it, and only
then creates anything. This file records what that is built out of, and what it is deliberately
not built out of **this week**.

## Chosen: a workbook we define, read with ClosedXML, reviewed before anything is written

`IntakeWorkbook` is the column contract, `IntakeTemplateWorkbook` writes the file the client
fills in, `XlsxUserImportParser` reads it back, and the wizard shows every row for correction
before approval.

Three properties earn it:

- **The template is generated per company**, so "Rol" and "Departamento" are dropdowns of that
  company's own values. "Department not found" is the error bulk import produces most, and it is
  produced entirely by somebody typing a department's name slightly differently. A dropdown
  removes the opportunity instead of reporting the consequence.
- **The review step's verdict is the server's own.** `POST /admin/users/bulk-import/rows` with
  `preview: true` runs `BulkImportEndpoints.ProcessRowsAsync`, which is the same body the
  approval runs. The screen the administrator approves is the thing that happens; a second copy
  of the validation rules would eventually disagree with the first.
- **Nothing is created until approval.** The parse route touches no table.

## Rejected for this week: an LLM reading whatever the client sends

This was the original shape of the ask, and it is the right eventual shape. It is not this week's,
for four measured reasons:

1. **There is no LLM integration in this repository at all.** `AIInsightEndpoints` is CRUD over
   *stored* insights — no HttpClient, no model, no prompt. `MicroclimateEndpoints` sets
   `SentimentScore = 0` deliberately for the same reason.
2. **#92, #111 and #119 are all blocked** on AI-provider approval plus a cost ceiling. Neither is
   ours to grant.
3. **A deterministic parser cannot fail live on stage.** The client demo is 2026-10-01.
4. Extraction quality is not the bottleneck a template removes. A template makes the file
   *correct at source*; an extractor makes an arbitrary file *probably correct later*.

**The seam is built, and it is one function wide.** `IntakeParseResult` — rows plus file-level
problems — is the only thing the wizard consumes, and it carries no ClosedXML type. A Bedrock
extraction step becomes a second producer of that record, replacing the body of
`POST /admin/users/bulk-import/parse` and touching neither the review step nor the invitation
creation. Both the C# record and `web/src/features/org-structure/api/intake.ts` say so in place,
so the next person does not have to find this file to know it.

Bedrock is the intended provider: the production AWS account already carries `BedrockAPIKey-*`
IAM users. It still needs a model choice, a cost ceiling and a decision record of its own.

## The dependency

`ClosedXML 0.105.1`, added to `ClimateProject.Application`.

Not a new vendor to this repository: `ClimateTracking.Application` already pins the same package
at the same version for `TrackingSheetExport`. It is still a new `PackageReference` in this
solution, which is why this section exists.

It does not contradict `pdf-rendering.md`, and the distinction is the reason that file gives for
its own choice. The hand-rolled PDF and CSV writers **emit** a format we choose, so hand-rolling
costs a few hundred lines and buys a dropped dependency. An `.xlsx` is a zip of XML parts
**authored by whatever spreadsheet program the client happens to use**, so a hand-rolled reader
is hundreds of lines whose every branch is a place to get somebody else's file wrong. Emitting a
format is a bounded problem; parsing one is not.

MIT licensed, `netstandard2.0`, no `FrameworkReference`.

## What is in scope, and what is not

Shipped: **people**. `Personas` → `ParsedImportRow` → the invitation path that already existed.

Not shipped, and deliberately: the demographics and question-library sheets the original brief
also named. The seam takes them without changing shape — another sheet, another parser, the same
review step — but each needs its own column contract and its own endpoint wiring, and shipping
one domain completely beats three partially in the week of a demo.

Also not done, and deliberately: refactoring survey and microclimate creation into a wizard. That
is 8+ existing pages and they are the exact flows being demonstrated on 2026-10-01. Right
feature, wrong week.

## Superseding this

An extraction step in front of the parser does not supersede this file; it is the paragraph above
coming true. What would supersede it is deciding the template itself is the wrong artefact — that
the client should send whatever they have and never be handed a file to fill in. Record that
here, with what the extractor measured on real client files.
