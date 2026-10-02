# Decision: the AI intake reads a masked profile, never the people

Recorded 2026-09-29, with the code that implements it. Owner: Federico Tafur. It is the
paragraph `excel-intake.md` said would come true — "a second producer of the same record" — and
it does not supersede that file: our own template is still read without a model.

## What it does

A company administrator uploads **whatever spreadsheet they already have** — an HR export with a
title row, surnames first, their own area names, identity numbers and phones — as `.xlsx` or
`.csv`. `POST /admin/users/bulk-import/understand` reads it, asks Claude how it maps onto this
platform, applies that mapping to every row on this server, and returns a proposal: column
mapping, job title → role, area → department (existing, or new to create), demographic answers,
and data-quality findings. The admin corrects any of it; nothing is written until the same
review-and-approve step every import already goes through (`ProcessRowsAsync`).

## The privacy boundary is one record

`IntakeProfile` is serialised whole into the model request, and nothing else about the file is.
It carries headers, the **distinct values of category columns** (areas, job titles, sites — facts
about the organisation) with counts, and for every other column three **masked** samples
(`"Ro*** Pé***, An***"`, `"a***@meridiano.cr"`, `"1984-**-**"`, `"#########"`). A column is
masked when its header names personal data (whole words, so "Nombre del puesto" is still a job
title) or its values do not repeat like a category. `IntakeProfilerTests` pins this against the
serialised bytes, including the case only the header rule catches — a surname column whose
values repeat.

Per-person checks (email typos, duplicates, footers) run in code, on this server
(`IntakeInsights`). The model is asked one question per file, so cost does not grow with the
workforce, and an identical re-upload within 30 minutes reuses the answer.

The model's answer is **input, not instruction**: `IntakeMappingSanitizer` drops any role outside
employee/leader/supervisor (never an admin), any department claimed to exist that does not, any
demographic value outside the field's options, and any column or sheet that is not in the file.

## The dependency

`Anthropic` (the official C# SDK) and `Anthropic.Bedrock` (its Bedrock client), both in
`ClimateProject.Infrastructure`. Written against the SDK rather than raw HTTP because it owns
retries, typed errors, structured output and the refusal-fallback parameter, which hand-rolled
code would have to re-derive and keep current. Everything else sees only `IIntakeMappingModel`,
so the provider is replaceable and every test uses a fake.

## Configuration, and where it runs

| Key | Default | |
|---|---|---|
| `Intake:Ai:Enabled` | `true` | Off in every test host (`AuthWebApplicationFactory`). |
| `Intake:Ai:Provider` | `anthropic` | `anthropic` (Claude API) or `bedrock` (Mantle endpoint, SigV4). |
| `Anthropic:ApiKey` | — | User-secrets locally; `ANTHROPIC_API_KEY` as fallback. |
| `Intake:Ai:BedrockApiKey` | — | Bedrock API key (bearer); falls back to `AWS_BEARER_TOKEN_BEDROCK`. Preferred over a profile. |
| `Intake:Ai:AwsProfile` / `AwsRegion` | — / `us-east-1` | Bedrock without an API key: SigV4 with this profile. |
| `Intake:Ai:Model` | `claude-opus-5-5` | `anthropic.` prefix added on Bedrock. |
| `Intake:Ai:Effort` | `medium` | |

Unconfigured is a normal state, not an error: the endpoint maps by header words
(`IntakeHeuristicMapping`), says so on screen, and the admin corrects the mapping by hand.

**Production has no key and must not get one until the client approves an AI provider and a
cost ceiling** — #92, #111 and #119 are blocked on exactly that, and neither is ours to grant.
The feature ships dark there by construction.

**Bedrock, measured 2026-09-29:** both AWS accounts list Claude Opus 5.5 and Sonnet 5.5 as
`AUTHORIZED`/`AVAILABLE` but every call returns `AccessDeniedException: … is not available for
this account` (`bedrock-runtime converse`, profiles `default` and `claude`). Enabling it needs the
Anthropic use-case form and agreement accepted in the Bedrock console — a company decision. Until
then the local demo uses the Claude API. Bedrock also has no server-side refusal fallback; there a
declined request falls through to header words.

## What is deliberately not done

- No row is ever sent to the model, even to "clean" it. Re-casing names, fixing email domains and
  reordering "Apellidos, Nombre" happen in code, from rules the mapping switches on.
- The question-library sheet from the original brief is still not built.
