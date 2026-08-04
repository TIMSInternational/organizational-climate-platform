# Content i18n schema design (#195)

**Status: DRAFT — recommendation. One question must go to the client before the migration is
written.** The representation below is implementable as-is; the *third-language* question in
[Question for the client](#question-for-the-client) changes it, and only the client can answer.

**Blocks:** #58 (question repositories), #108 (survey builder wizard), #154(F) (ETL's bilingual
collections), and every survey/microclimate page in Batch 3.

**Scope note.** This document decides how *authored content* is stored in two or more languages.
It does not revisit UI-string i18n (#78/#176), which is settled and correct.

---

## Premise verification

Per the house habit of checking an issue's premise before acting on it, every claim in #195 was
re-derived from the code rather than accepted. Three results: the core premise **holds and is
understated**, one supporting claim **does not hold**, and four consequences #195 does not
mention are **load-bearing**.

### Holds — the target schema has no content-i18n of any kind

Verified by sweeping every `string` property across all 50 entities in
`src/ClimateProject.Domain/Entities/`:

- `Question.Text`, `Options`, `ScaleLabelMin/Max`, `CommentPrompt`; `MicroclimateQuestion.Text`,
  `Options`; `TemplateQuestion.*`; `MicroclimateTemplateQuestion.*`; `QuestionEmojiOption.Label`;
  `Survey.Title/Description`; `Microclimate.Title/Description` — all single `string`.
- A repo-wide grep for `Language|Locale|_es|_en` across `Entities/` returns **exactly two hits**:
  `Company.Language` and `UserPreferences.Language`, both display preferences with default `"en"`.
  There is no content-language column anywhere.

Two details sharpen it:

- **`Question.CommentPrompt` ships an English string as a database default.**
  `QuestionConfiguration.cs` sets
  `.HasDefaultValue("Please explain your answer:")`, mirrored on `TemplateQuestion`. A Spanish-only
  survey today gets an English prompt from the schema itself. This is the premise made concrete at
  the DDL layer, and it is the one part of #195 that is already a live defect rather than a gap.
- **`SystemSettings.MaintenanceMessage`** is monolingual and shown to every user regardless of
  locale. #195 does not list it.

### Does not hold — "the legacy system was fully bilingual"

#195 states this is "existing functionality with real production data that currently has nowhere
to land." That is true of **two** collections and false of the rest. Measured against
`climate-project/src/models/`:

| Legacy model | Bilingual? | Convention | Live? |
|---|---|---|---|
| `QuestionLibrary` | **yes** | `text_es`/`text_en`, `options_es`/`options_en`, `scale.labels_es`/`labels_en` | **yes** — 18 files reference it |
| `QuestionCategory` | **yes** | nested `{ en, es }` on `name`, `description` | **yes** — 4 files |
| `LibraryQuestion` | **yes, richest of all** — also `description`, `keywords`, `binary_comment_config.label/placeholder`, `emoji_options[].label_en/label_es` | nested `{ en, es }` | **no — dead** |
| `QuestionBank` | no (`text: string`) | — | yes — 24 files |
| `Survey.questions[]` | **no** | — | yes |
| `Microclimate.questions[]` | **no** (`text: string`) | — | yes |
| `MicroclimateTemplate.questions[]` | **no** (`text: string`, maxlength 300) | — | yes |
| `Survey` / `Microclimate` (title, description) | **no**, and **no `language` field on either model** | — | yes |
| `NotificationTemplate` | **no** | — | yes |
| `DemographicField.label` | **no** | — | yes |

So legacy is bilingual in the **authoring/library layer** and monolingual **everywhere content is
actually served to a respondent**. The boundary is lossy, and the loss is written down in one line
of `climate-project/src/app/surveys/create/page.tsx:221`:

```ts
text: question.text || question.question_text_en || 'Question text',
```

A bilingual library question, added to a survey, is collapsed to **one** string, **English
preferred**, with a literal English `'Question text'` as the last resort. The Spanish is
discarded at that point in legacy, today, in production.

Three corollaries:

1. **`MICROCLIMATE_REQUIREMENTS_VERIFICATION_REPORT.md` is wrong** where it says (line 123)
   *"Database schema supports both languages"* under "Multilingual Content (ES/EN) ✅", and
   (line 423) *"Bilingual survey content"*. The `MultilingualQuestionEditor.tsx` component is
   real and does validate both languages (`'Both languages are required'`), but nothing downstream
   persists both. The report verified the UI, not the schema.
2. **The `Language: Spanish | English | Both` field the report marks implemented (line 72) is not
   persisted either.** `MicroclimateWizard.tsx` holds `step1Data.language: 'es' | 'en' | 'both'`
   and renders the RadioGroup, but no legacy model has a `language` field. It survives only inside
   the `SurveyDraft` blob and is dropped on publish. `Survey.Language` is therefore **new schema
   with no legacy data to migrate**, not a port.
3. **This is a parity gap against the requirement, not against the legacy app.** Under the
   full-parity rule, porting legacy faithfully would still leave CLIMA-011 unmet. Half of #195 is
   a port; half is work the legacy app never did. Federico should know which half he is buying.

`LibraryQuestion` being dead was also re-checked rather than assumed: its single apparent
reference in `src/components/surveys/QuestionLibraryBrowser.tsx` is a **locally declared
`interface LibraryQuestion`**, not an import of the model. The ETL doc's exclusion stands, and
`QuestionLibrary` + `QuestionCategory` are the live pair.

### Not in #195, and each changes the work

**1. Bilingual options silently fragment every aggregation.**
`MicroclimateEndpoints.SubmitResponseAsync` validates and stores a submitted answer by **exact
string comparison against the question's own option text**:

```csharp
QuestionTypes.MultipleChoice => question.Options is { Length: > 0 } && question.Options.Contains(answer)
```

If `Options` becomes bilingual, two respondents choosing the same option in different languages
store **different strings** in `question_responses.response_value`. Counts, charts, benchmarks and
exports all split in two, with no error and reconciling row counts — the same failure shape as the
`password_hash` finding on #154. **Option values must become locale-independent** as part of this
work. `QuestionTypes.YesNo` already does the right thing (compares to the codes `"yes"`/`"no"`),
so the precedent exists in the same `switch`.

**2. The live word cloud mixes languages.** The same handler counts raw word frequencies from
open-text answers into one map, so `"trabajo"` and `"work"` become separate entries. Nothing on
`Response` or `QuestionResponse` records which language a respondent answered in.

**3. Legacy monolingual content carries no language tag, so the ETL cannot know what it is.**
`Microclimate.questions[].text` is one string and no legacy field says whether it is Spanish or
English. The only signal available is `Company.language` (default `"en"`). This is an ETL
*attribution* decision, and it means the ETL doc's **"26 mappable"** is optimistic: `Survey`,
`SurveyTemplate`, `SurveyVersion`, `Microclimate` and `MicroclimateTemplate` — 5 of the 26 — are
mappable only once language attribution is decided. See
[What this unblocks — #154(F)](#what-this-unblocks--154f).

**4. The blast radius is small right now and will not stay that way.** `src/ClimateProject.Api/Endpoints/`
contains **no `SurveyEndpoints`, no `QuestionEndpoints`, no `SurveyTemplateEndpoints`**. The only
API surface over translatable content is `MicroclimateEndpoints` + `MicroclimateTemplateEndpoints`
and their two DTO files. Changing the schema today costs 2 endpoint files and 2 DTO files.
Batch 3's 13 page issues and #108 have not started. This is the cheapest this decision will ever
be, and it is the strongest argument for deciding it now — stated as a count rather than an
assertion.

---

## What the requirement actually asks for

Binding under `docs/requirements/README.md`. Quoted verbatim; emphasis added.

`notes/functional-req.md:94-97` — **"11. ES/EN Multilanguage (P1)"**:

> Recommendation: UI i18n; **question content with ES/EN fields; missing-content validation;
> defined fallback.**
> Acceptance Criteria: **Side-by-side editable view; preview in both languages.**
> Test Cases: **Export/show the survey in ES and EN without "untranslated" strings.**

`ORGANIZATIONAL_CLIMATE_PLATFORM_PRD.md:557-565` — **CLIMA-011: Multilingual Support**:

> **Requirement**: Complete ES/EN localization for **all platform content**
> - **Content translation management system**
> - **Side-by-side editing interface for questions and content**
> - **Missing content validation and fallback mechanisms**
> - Language switching without losing context
> - **Export capabilities in both languages**

`notes/microclimate-req.md:40`, `:72`, `:152`:

> Language: **Spanish | English | Both** (multilingual setup)
> Multilingual content (ES/EN) with **side-by-side editing**.
> Localization: **ES/EN fully supported in UI and survey content.**

`notes/functional-req.md:32` and `:116` (CLIMA-002), `:134` (CLIMA-011) repeat it for the question
library. It is a **P1** in the client's own backlog (`functional-req.md:109`).

Two things follow from the exact wording and are easy to miss:

- **"question content with ES/EN fields"** names *fields*, not a translation service. The client's
  own phrasing points at per-field storage. "Content translation management system" in the PRD is
  the *stack* half of a PRD sentence and is superseded under the README's rule; the requirement it
  expresses — that content is translatable and manageable — is not.
- **"without 'untranslated' strings"** is a *test case*, meaning it must be deterministically
  true, not usually true. A read-time fallback alone cannot guarantee it. Only a **write-time
  gate** can. This drives the validation design below.

---

## The framework: translatable is not one thing

The single most common way this goes wrong is treating every human-readable string as needing two
columns. Three different mechanisms are needed, and picking the wrong one is where the cost is:

| Mechanism | For | Why |
|---|---|---|
| **A. Paired language columns** | Content a human **authors** and is expected to supply in each language | Both values exist by definition; both must be validated |
| **B. A captured `Language` column** | Content the system **generates** or a respondent **submits** | Produced in exactly one language. You cannot author the other — you record which one it was, and regenerate if you need another |
| **C. Nothing** | Codes, enums, tokens, PII, proper nouns, URLs, colours, telemetry, machine payloads | Translating these is a bug |

`Tags[]` belongs in C, and legacy agrees: `LibraryQuestion` keeps `tags` monolingual while giving
`keywords` a bilingual `{ en, es }` shape. Tags are search tokens; keywords are search *content*.
A bilingual search needs bilingual keywords, not bilingual tags.

---

## Full enumeration

Every human-readable field in the 50 target entities, triaged. Field names are as they appear in
`src/ClimateProject.Domain/Entities/`.

### Tier 1 — Respondent-facing authored content · **mechanism A** · in scope for #195

33 fields across 11 entities. These are what "a survey in ES and EN with no untranslated strings"
means.

| Entity | Fields | Legacy source of both languages |
|---|---|---|
| `Survey` | `Title`, `Description` | none — monolingual in legacy |
| `Survey.Settings` | `InvitationCustomSubject`, `InvitationCustomMessage` | none — but these are **emailed to respondents** |
| `Question` | `Text`, `Options[]`, `ScaleLabelMin`, `ScaleLabelMax`, `CommentPrompt`, `BinaryCommentConfig` (jsonb: `label`, `placeholder`) | `QuestionLibrary.text_*`, `options_*`, `scale.labels_*`; `LibraryQuestion.binary_comment_config.{label,placeholder}` |
| `QuestionEmojiOption` | `Label` | `LibraryQuestion.emoji_options[].label_en/label_es` |
| `TemplateQuestion` | `Text`, `Options[]`, `ScaleLabelMin`, `ScaleLabelMax`, `CommentPrompt`, `BinaryCommentConfig` | none — becomes respondent-facing on instantiation |
| `Microclimate` | `Title`, `Description` | none |
| `MicroclimateQuestion` | `Text`, `Options[]` | none |
| `MicroclimateTemplateQuestion` | `Text`, `Options[]` | none in the *model* — but `climate-project/src/app/api/microclimate-templates/route.ts` hardcodes ~40 seed questions as `text_es`/`text_en` pairs, so the seed data **is** bilingual and the schema it is written into is not |
| `SurveyVersion` | `Title`, `Description`, `QuestionsSnapshot` (jsonb) | must carry whatever `Survey`/`Question` carry, or version history desynchronises from live content |
| `DemographicField` | `Label`, `Options[]` | none (`label: string`) — but `req.md` §2.2 requires all demographics filterable in dashboards **and exports**, which a bilingual dashboard cannot do with one label |
| `SystemSettings` | `MaintenanceMessage` | none — shown to every user in every locale |
| `NotificationTemplate` | `Subject`, `Title`, `Content`, `HtmlContent` | none — but these are the **emails a bilingual workforce receives**. See the scope question below |

### Tier 2 — Author-facing authored content · **mechanism A** · scope decision required

27 fields. A bilingual *administrator* wants these; a respondent never sees them. Deferring is
defensible; deferring **silently** is not.

`SurveyTemplate.Name/Description/Category` · `MicroclimateTemplate.Name/Description/Category` ·
`Question.Category`, `TemplateQuestion.Category`, `MicroclimateTemplateQuestion.Category` (free
strings today; legacy `QuestionCategory.name` **is** bilingual `{en,es}`, and these become a FK
under #58) · `ActionPlan.Title/Description` · `ActionPlanObjective.Description/SuccessCriteria` ·
`ActionPlanKpi.Name/Unit` · `ActionPlanTemplate.Name/Description/Category` ·
`ActionPlanTemplateObjective.Description/SuccessCriteria` · `ActionPlanTemplateKpi.Name/Unit` ·
`Benchmark.Name/Description` · `Report.Title/Description` ·
`NotificationTemplateVariable.Description`

**`Department.Name` and `Department.Description` are deliberately excluded.** A department has one
real name in the organisation; translating it invents an entity that does not exist. Same reasoning
excludes `Company.Name` and `User.Name`. Flagging this rather than leaving it implicit, because
`Department.Name` is the field most likely to be argued about.

### Tier 3 — Generated content · **mechanism B** · needs a `Language` column, not two columns

15 fields. You cannot "author the Spanish" of a machine-generated insight; you generate it in a
language and record which.

`AIInsight.Title/Description/RecommendedActions[]/AffectedSegments[]` ·
`MicroclimateAiInsight.Message` · `ActionPlan.AiRecommendations[]` ·
`ActionPlanTemplate.AiRecommendationTemplates[]` ·
`Microclimate.LiveResults.TopThemes[]/WordCloudData` · `Notification.Title/Message` (rendered from
a template — the *template* is Tier 1, the rendered instance is Tier 3) · `Report.ReportOutput` ·
`AnalyticsInsight.MetricName/MetricDescription` · `AnalyticsMetricData.Label`

This interacts with #67: whichever AI provider is chosen must be prompted with a target locale, and
insights must be regenerable per locale rather than translated after the fact. Worth adding to #67
rather than discovering later.

### Tier 4 — Collected content · **mechanism B** · needs a `Language` column

10 fields. `QuestionResponse.ResponseValue/ResponseText` · `ResponseDemographic.Value` ·
`ActionPlanObjective.CurrentStatus` · `ActionPlanKpiUpdate.Notes` ·
`ActionPlanObjectiveUpdate.StatusUpdate/Notes` · `ActionPlanProgressUpdate.OverallNotes` ·
`DemographicSnapshot.Reason` · `DemographicSnapshotChange.Reason`

**`Response` gains a `Language` column.** Required by three separate things: per-language word
clouds and sentiment; correct display of a stored answer; and "export in both languages" for
open-text answers, which can only ever mean *labelled with the language they were written in*.

### Tier 5 — Never translated · **mechanism C**

Everything else. Enumerated so it is on the record that it was considered, not skipped:

- **Codes and enums** (all validated strings, per the house pattern of not using C# enums):
  `Type`, `Status`, `Priority`, `Channel`, `Role`, `Action`, `Format`, `AccessType`,
  `ValidationStatus`, `EngagementLevel`, `MeasurementFrequency`, `SuggestedFrequency`,
  `SurveyFrequency`, `MicroclimateFrequency`, `AggregationType`, `MetricType`, `Resource`,
  `EntityType`, `InvitationType`, `DifficultyLevel`, `Timezone`, `Theme`, `DashboardLayout`,
  and both existing `Language` preference fields.
- **Identifiers, tokens, PII**: `InvitationToken`, `SessionId`, `Email`, `PasswordHash`, `NodoId`,
  `PersonaExternalId`, `LegacyExternalId`, `EntityId`, `ResourceId`, `TemplateId`, `Field`.
- **Branding, URLs, colours**: `LogoUrl`, `PrimaryColor`, `SecondaryColor`, `FontFamily`,
  `CustomCss`, `QrCode*Url`, `PublicUrl`, `ForegroundColor`, `BackgroundColor`, `FilePath`.
- **Telemetry and machine payloads**: `IpAddress`, `UserAgent`, `EmailClient`, `DeviceType`,
  `ErrorMessage`, `GenerationError`, `FailureReason`, `Details`, `Changes`, `Metadata`, `Config`,
  `Filters`, `*Snapshot` (settings/demographics), `SupportingData`, `CustomAttributes`,
  `ResponseDistribution`, `DraftData`, `LastEditedField`.
- **Proper nouns**: `Company.Name`, `User.Name`, `Department.Name`, `Benchmark.Source`,
  `Industry`, `Region`, `CompanySize`, `Country`.
- **Search tokens**: every `Tags[]`. Bilingual search belongs in a `keywords` field, per the
  legacy precedent above — filed as a follow-up, not part of #195.

---

## The representation decision

### Recommendation

> **Paired language columns — `<field>_en` / `<field>_es` — as the storage contract for Tier 1
> (and Tier 2 if it is in scope), with three structural changes that come with it:**
>
> 1. **`Survey.Language` and `Microclimate.Language`**, validated `'es' | 'en' | 'both'`, default
>    `'both'`. Per `microclimate-req.md:40`. This is the field the validation gate reads.
> 2. **Options move from `text[]` to a child table** with a locale-independent value and one
>    label column per language.
> 3. **`Response.Language`**, recording the locale the respondent was served.
>
> **And one non-negotiable constraint on the API surface: no DTO ever exposes `En`/`Es`-shaped
> fields on a read path.** Reads return resolved text plus the locale it resolved to; writes take
> a locale-keyed map. This is what makes a third language a migration instead of a rewrite, and it
> costs nothing today.

### Why paired columns

Evaluated against the three alternatives in #195 plus one it does not list.

**Option 2 — a polymorphic `Translation(entity_type, entity_id, field, locale, value)` table.**
Rejected. Not primarily for the join cost, but because **it cannot have a foreign key.** A
polymorphic parent reference is un-constrainable in Postgres, and this repo's whole posture is the
opposite: #150 exists because the legacy app had string pseudo-references and no integrity, and
the ETL design's central finding is that dangling legacy refs become *insert failures* here by
design. Introducing the one table in the schema that cannot be constrained, to hold the content
that matters most, contradicts the position the rest of the schema takes. It also erases
`required`-ness at the type level, which this codebase spends effort to preserve — `DialogContent`
makes an unlabelled close button a *compile* error rather than a runtime one.

*If* the client's answer to the third-language question is "yes, and existing content must be
retro-translated", this becomes the right answer anyway — but as **one child table per parent
entity with a real FK** (`question_translations`, `survey_translations`, …), not one polymorphic
table. That variant also carries per-field workflow state (`untranslated` / `machine` /
`human_reviewed`) that columns cannot express, which is exactly what a retro-translation project
needs.

**Option 3 — `jsonb` per field, `{"en": "...", "es": "..."}`.** Rejected for Tier 1, though it is
the closest call. It loses `HasMaxLength` (currently enforced on every one of these columns:
`text` 500, `title` 200, `description` 1000, `scale_label_*` 200), loses NOT NULL per language,
and makes the commonest query in the app — order/filter surveys by title in the user's locale — an
expression over jsonb rather than an indexable column. Its real advantage is language-count
agnosticism, and the locale-resolved DTO constraint above buys most of that without the costs.

**Option 4, not in #195 — a shared `LocalizedText` value object mapped to the same two columns.**
This is where the interesting failure is, and it is why the recommendation is plain paired columns
rather than a tidy abstraction.

The idea: one CLR type `LocalizedText { string? En; string? Es; }` as an EF owned type, so
validation lives in one place and a third language is one type change. Attractive, and **it
collides with a documented house rule**:

> "Owned 1:1 shapes that are **nullable / optional-per-row** are NOT modeled as EF owned types —
> owned types in this codebase are reserved for always-present shapes."
> — `docs/superpowers/plans/2026-07-31-surveys-schema.md:18`, the rule that produced
> `QuestionConditionalLogic` as a shared-PK child table instead

Of the 33 Tier 1 fields, roughly half are optional (`Description`, `ScaleLabelMin/Max`,
`InvitationCustomMessage`, `HtmlContent`, …). Applying the owned type only to the required ones
splits the representation in two, which is worse than either alone. Applying it to optional ones
breaks the convention and walks into EF's optional-dependent-with-all-optional-properties problem.
**Plain paired columns, uniformly, with a static `LocalizedContent` validator operating on the
pair, gets the single-place validation without the model-building risk.**

EF 10 complex types (`ComplexProperty`) may remove this constraint, since they are value-typed and
map inline. Whether EF 10 supports *nullable* complex types was **not verified** and must not be
assumed — see [Not verified](#not-verified). This is a code-ergonomics question that blocks
nothing: the storage contract is identical either way, so it can be settled by a spike after the
migration lands.

**A correction, because it would otherwise mislead whoever implements this.** #192's body states
"owned types must not use `HasDefaultValue`". That is **backwards.** The actual rule, from
`docs/superpowers/plans/2026-07-31-reports-analytics-schema.md:19` and confirmed against
`SurveyConfiguration.cs` and `MicroclimateConfiguration.cs` (which use `.HasDefaultValue` inside
`OwnsOne` throughout):

> "every `NOT NULL` property with a non-CLR-default intended value — **whether on the aggregate
> root directly or inside an owned type** — **must** have `.HasDefaultValue(...)`"

…because otherwise a row inserted outside EF backfills with the raw CLR default. The plans also
insist the proof be a **raw-SQL-insert-then-EF-read** test, since an EF-insert-then-read passes
even when the DB default is wrong. That applies directly here: `comment_prompt` has a DB default
today, and whatever replaces it needs the same treatment and the same style of test.

### Why options must become a child table

`Question.Options` is `text[]`. Naively pairing it gives `options_en text[]` and `options_es
text[]` with an **index-alignment invariant Postgres cannot enforce** — nothing stops the arrays
having different lengths, and if they drift, option 3 in Spanish silently means option 4 in
English.

More importantly it does not fix
[finding 1](#not-in-195-and-each-changes-the-work): the answer is stored as the option *text*, so
bilingual options fragment every aggregation.

A child table solves both, and the house pattern for it **already exists two entities away** —
`QuestionEmojiOption(QuestionId, Order, Emoji, Label, Value)`:

```
question_options
  question_id  uuid   FK -> questions(id)
  order        int
  value        text            -- locale-independent, stored in question_responses
  label_en     text
  label_es     text
  PK (question_id, order)
```

`value` is what `response_value` holds and what `Options.Contains(answer)` validates against; the
labels are display only. This also matches legacy's own richest shape,
`LibraryQuestion.emoji_options[] { value, emoji, label_en, label_es }` — the model that carried a
stable `value` alongside per-language labels was the one written last.

Five collections of options move this way: `Question`, `TemplateQuestion`, `MicroclimateQuestion`,
`MicroclimateTemplateQuestion`, `DemographicField`.

**This is a scope increase over #195 as written**, and it touches the response path rather than
only authoring. Stated plainly so it is chosen, not absorbed: doing #195 without it produces a
bilingual survey whose results are wrong, which is worse than a monolingual survey whose results
are right.

### Migration shape

| Change | Count |
|---|---|
| Existing column renamed `<field>` → `<field>_en` | 25 |
| New `<field>_es` column | 25 |
| `text[]`/`List<string>` options → child table | 5 |
| New language columns (`surveys`, `microclimates`, `responses`) | 3 |
| jsonb payload shape changes (`binary_comment_config`, `questions_snapshot`, `report_output`) | 3 |
| Endpoint files to update | 2 (`MicroclimateEndpoints`, `MicroclimateTemplateEndpoints`) |
| DTO files to update | 2 |

Rename-then-add is deliberate: renaming to `_en` first means existing rows keep their values under
the correct name if English is the attributed language, and the `_es` column starts NULL, which is
exactly the state the validation gate is designed to catch. `dotnet ef migrations add` against the
Supabase **direct** connection (5432), never the pooler — per the house patterns on #154.

---

## Missing-content validation and fallback

The requirement asks for both, and they are different mechanisms. What satisfies the exact wording:

### Write-time gate — this is what makes the test case pass

> Test Cases: **Export/show the survey in ES and EN without "untranslated" strings.**
> — `notes/functional-req.md:98`

A read-time fallback can only ever make this *usually* true. So:

**A survey or microclimate cannot leave `draft` unless every Tier 1 field required by its own
`Language` value is non-empty.**

| `Language` | Required to publish |
|---|---|
| `both` | every Tier 1 field in **both** `_en` and `_es` |
| `es` | `_es` only; `_en` optional |
| `en` | `_en` only; `_es` optional |

Enforced on the `draft → scheduled|active` transition, returning **400 with the specific list of
missing field/language pairs** so the wizard's `ValidationPanel` can render them. Not enforced on
save: `microclimate-req.md` requires autosave every 5–10 seconds, and a blocking validator would
fight it. Draft-time behaviour is a **warning**, publish-time is a **gate** — which is also what
"side-by-side editable view" implies, since you must be able to save a half-translated question in
order to translate the other half.

This mirrors the existing precedent that publishing is the irreversible checkpoint: #104 freezes
structure once responses exist, and #108's AC already says validation must "be honest about what
publishing does".

### Read-time fallback — for the rows the gate cannot cover

Migrated legacy rows predate the gate, and Tier 2/3/4 content is never gated. Resolution order for
a request in locale `L`:

1. `<field>_L` if non-empty → return it, `resolvedLocale = L`.
2. Else, if the survey's own `Language` is a single language `S`, `<field>_S` if non-empty →
   return it, `resolvedLocale = S`, **`isFallback = true`**.
3. Else `<field>_en` (matching `web/src/i18n/locale.ts`'s `FALLBACK_LOCALE = 'en'`) →
   `resolvedLocale = 'en'`, `isFallback = true`.
4. Else the field is genuinely absent → **return null and let the caller decide**. Never an empty
   string, and never a key path. #78 fixed a real bug where 8 missing `surveys.*` keys rendered raw
   key paths to Spanish users; the same failure at content level must not be reintroduced.

**Every fallback is surfaced, never silent.** The DTO carries `resolvedLocale` and `isFallback`
per localised field so an admin sees a badge and an export can label it. Silently substituting
English into a Spanish survey is precisely the "untranslated strings" the test case forbids —
the difference between a fallback and a defect is whether the system admits it happened.

Note the deliberate divergence: **UI strings fall back to English; content does not, by default.**
`FALLBACK_LOCALE = 'en'` is right for chrome and wrong as a silent default for a question put to a
Spanish-speaking employee.

### Tests this needs

- Publish gate: `both` with a missing `text_es` → 400 naming the field; `es` with a missing
  `text_es` → 400; `es` with a missing `text_en` → 200.
- Resolution: all four branches above, including the null branch.
- The DB-default check, in the house style: raw-SQL insert then EF read, proving `comment_prompt_en`
  / `comment_prompt_es` defaults land at the DB layer (an EF-insert-then-read would pass regardless).
- Option-value stability: the same logical answer submitted from an ES session and an EN session
  produces the **same** `response_value`.
- Response language: an ES submission and an EN submission to the same open-text question land in
  separate word-cloud buckets.

### One frontend consequence, already anticipated in the repo

`web/src/i18n/README.md:47-49` notes that the only route an anonymous visitor reaches is
`/microclimates/:id/respond`, and says: *"If that becomes a requirement, add a `?lang=` query
parameter read by `detectLocale`, rather than restructuring the router."* Under #195 it **does**
become a requirement — an invited respondent must be served the survey in their language before
they have any preference stored. The README already contains the answer; it just needs doing, and
`Response.Language` records what they got.

---

## Question for the client

**Do not answer this internally.** The recommendation above is correct under one answer and wrong
under another, and the difference is a schema migration over ~30 columns after Batch 3 has built
against them.

### What the requirements actually say about it

Verified, because "the client never asked" and "the client asked and we advise otherwise" are
different conversations:

- A case-insensitive grep for `portug|french|german|italian|catalan|third language|additional
  language|other languages` across all 8 documents in `docs/requirements/` returns **zero hits**.
  Every one of the ~14 language mentions says ES/EN.
- **But** the PRD's Phase 4 roadmap (Months 10–12) lists **"Global deployment and localization"**
  as a milestone, separate from CLIMA-011's ES/EN work. That is the only forward-looking signal and
  it is ambiguous.
- **And** PRD Appendix E, *"Internationalization Guide"*, is an unfilled stub:
  `[Language support and localization requirements]`. The document that would have settled this was
  never written.

So the honest position is: the client has specified two languages and gestured at "global
localization" without defining it. That is a question, not an assumption.

### Put to the client as three questions

> 1. **Is Spanish + English the permanent language set for authored survey content, or should we
>    design for a third language?** The PRD's Phase 4 milestone lists "Global deployment and
>    localization" — is that the same ES/EN work, or additional languages? A rough horizon is
>    enough: "not in the next two years" and "possibly next year" lead to different designs.
> 2. **If a third language were added, would existing surveys and library questions need to be
>    translated into it, or would it apply only to newly authored content?** Retro-translating
>    existing content needs per-field translation workflow tracking; new-content-only does not.
> 3. **Can one company operate in two languages simultaneously** — some employees answering in
>    Spanish, others in English, in the *same* survey — **or is language a company-level setting?**
>    We are adding a per-survey `Spanish | English | Both` field per your specification; we need to
>    know whether "Both" is the normal case or the exception.

Question 3 is not in #195 and is the cheapest of the three to ask. `Company.Language` is a single
value, `UserPreferences.Language` is per user, and `Survey.Language` allows `both`. Which of those
is authoritative determines the default for every new survey and how strict the publish gate feels
in daily use. Guessing it is expensive; asking is one sentence.

### What changes under each answer

| Answer to Q1/Q2 | Design |
|---|---|
| **ES/EN permanent** | Exactly as recommended. Nothing changes. |
| **Third language likely, new content only** | Still paired columns. The third arrives as one generated migration adding `<field>_pt` columns and one `label_pt`. **Zero DTO or frontend change, because of the locale-resolved API constraint.** This is why that constraint is non-negotiable rather than a nicety. |
| **Third language likely, existing content retro-translated** | Paired columns become wrong. Switch to **one translation child table per content entity, with a real FK** — `question_translations(question_id, locale, field, value, status)` — because retro-translation needs per-field workflow state (untranslated / machine / human-reviewed) that columns cannot carry. Costs a join on every content read and an application-layer `required` check. |
| **Many/unspecified languages** | `jsonb` per field, GIN-indexed, accepting the loss of `HasMaxLength` and per-language NOT NULL, with the publish gate carrying the whole validation burden. |
| **Q3 = company-level** | `Survey.Language` defaults to `Company.Language`; `both` is the exception; the publish gate is rarely strict. |
| **Q3 = per-user** | `Survey.Language` defaults to `both`; the gate is strict by default; `Response.Language` becomes essential rather than merely useful. |

**The hedge that is correct under all six rows, and should be adopted now regardless of the
answer:** never expose `En`/`Es`-shaped fields on a read DTO. Reads return
`{ text, resolvedLocale, isFallback }`; writes take `{ "en": "...", "es": "..." }`. Every row
above then costs a migration rather than a rewrite of Batch 3.

---

## What this unblocks — #58

With the representation settled, #58's schema is designable. The two systems stay separate, per the
analysis already on that issue:

**`QuestionBank` — monolingual.** Legacy `QuestionBank.text` is a plain `string` (verified). Target:
`BankQuestion` with a single `Text`, free-string `Category`, `Metrics` owned type
(`UsageCount`/`ResponseRate`/`InsightScore`/`LastUsed`), and `ParentQuestionId` for variations. **No
bilingual columns** — adding them would be inventing scope. `InsightScore` is AI-generated → #67.

**`QuestionLibrary` + `QuestionCategory` — bilingual.** Target:

- `QuestionCategory`: `NameEn`/`NameEs`, `DescriptionEn`/`DescriptionEs`, `ParentCategoryId` (real
  self-FK), `Order`, `Icon`, `Color`, `CompanyId?` (null = global), `IsActive`.
  `Level`/`Path`/`QuestionCount`/`SubcategoryCount` are **derived — recompute, do not migrate**
  (same call as `Department.hierarchy`).
- `LibraryQuestion`: `CategoryId` FK, `TextEn`/`TextEs`, `Type` (from the #196 vocabulary),
  `ScaleMin`/`ScaleMax`, `ScaleLabel*En`/`*Es`, a `LibraryQuestionOption` child table
  (`value`/`label_en`/`label_es`), `Dimension`, `Tags[]`, `ReverseCoded`, `Version`,
  `PreviousVersionId`, `UsageCount`, `LastUsed`, `CompanyId?`, `IsActive`.

The shared question-picker component (#58's second AC) resolves labels through the same
locale-resolution rule as everything else, so it needs no bilingual-specific logic.

**Still open on #58, unchanged by this document:** whether `reverse_coded` is dead. It is declared
and never read anywhere in legacy. One row count settles it; no issue should be filed on a guess.

## What this unblocks — #154(F)

**The four schema-blocked collections become mappable** once #58's entities exist:
`QuestionCategory` → `QuestionCategory` (bilingual, direct), `QuestionLibrary` → `LibraryQuestion`
(bilingual, direct — `text_es`→`TextEs`, `options_*`→child rows, `scale.labels_*`→`ScaleLabel*`),
`QuestionBank` → `BankQuestion` (monolingual, direct). `LibraryQuestion` (legacy) **stays excluded
as dead** — independently re-verified above.

**And a new ETL rule the ETL design doc does not yet carry.** Legacy `Survey`, `SurveyTemplate`,
`SurveyVersion`, `Microclimate`, `MicroclimateTemplate` hold **one** string per content field and
**no language field**, so the ETL cannot know whether a given title or question is Spanish or
English. Required:

1. **Attribute by `Company.language`** (the only signal that exists), writing the value into
   `<field>_<attributed>` and leaving the other language NULL.
2. **Set `Survey.Language` / `Microclimate.Language` to that same single language**, not `both` —
   so the publish gate does not immediately fail every migrated survey for missing translations
   that never existed.
3. **Report every attribution in the data-quality report**, per collection and per company. This
   is a guess the ETL is making about production content and it must be visible, not buried.
4. **Add to the "one query each" list** already in the ETL doc: the distribution of
   `Company.language` values in production. If every company is `"en"` by default while the content
   is in fact Spanish, rule 1 mislabels the entire corpus — and a bilingual survey whose Spanish
   text sits in the English column is exactly the count-reconciling, content-mangled failure #154's
   AC calls out.

**This means the ETL doc's "26 mappable" is optimistic.** Five of those 26 depend on this
attribution decision. The corrected shape: **21 straightforwardly mappable · 5 mappable with a
recorded language attribution · 1 excluded · 1 decision-blocked · 4 schema-blocked.** An addendum
has been added to the ETL design doc pointing here.

`Response`/`QuestionResponse` gain `Language`, attributed the same way and reported the same way.

---

## Decisions needed, in order

1. **The three client questions above.** Everything else is downstream. Q3 is answerable in a
   sentence and should not wait on Q1/Q2.
2. **Is Tier 2 (author-facing content) in scope for #195, or a follow-up issue?** 27 fields.
   Recommendation: **follow-up.** Tier 1 satisfies "a survey in ES and EN with no untranslated
   strings"; Tier 2 makes the *admin console* bilingual, which no requirement states. It must be a
   filed issue, not a silent omission.
3. **Are bilingual `NotificationTemplate`s in scope?** These are the emails respondents receive, so
   they are arguably Tier 1, but legacy is monolingual and #97 is about to define the notification
   surface. Recommendation: **in scope for the schema, deferred for the UI**, and coordinate with
   #97 the same way #192 must.
4. **Accept the options-to-child-table scope increase?** Recommendation: **yes** — without it,
   bilingual surveys produce fragmented results.
5. **Are bilingual `DemographicField.Label`s in scope?** Interacts with #193, which is deciding the
   demographics shape right now. Whichever way #193 goes, the label needs two languages if the
   dashboard is bilingual. **Decide #193 first**, then this follows.

---

## Acceptance criteria for #195

- [x] Representation decided and recorded, with the third-language question **explicitly asked**
- [x] Every translatable field enumerated (Tiers 1–5, all 50 entities)
- [x] Missing-content validation + fallback specified, traced to the requirement's wording
- [ ] Client answers the three questions
- [ ] Migration added
- [ ] Validation + fallback implemented and tested
- [ ] A survey authored and rendered in both ES and EN with no untranslated strings
- [ ] #58 unblocked (design above), #154(F) unblocked (rules above)

---

## Not verified

Recorded so no one mistakes these for established facts.

- **Production Mongo was not accessed**, deliberately and consistently with the ETL design's
  reasoning: it is customer PII and the credential in `climate-project/.env.local` was readable by
  the `tailwind.config.js` malware while #70's rotation is outstanding. So every claim about legacy
  *data* here is schema- and code-derived. Specifically unverified: the distribution of
  `Company.language`, whether any `QuestionLibrary` row has one language blank, and the
  `LibraryQuestion` row count.
- **Whether EF 10 supports nullable complex types** (`ComplexProperty`), which is the only thing
  standing between plain paired columns and the tidier `LocalizedText` value object. Needs a spike,
  blocks nothing.
- **`web/` was not built or tested for this document** — it changes no `web/` file. Another agent
  owns the authoritative full baseline including the .NET and Docker suites.
- **One stale number found in passing:** `web/src/i18n/README.md` says the catalogues hold 896 keys
  and the migration tracker says 953. Both are wrong — `en.json` and `es.json` each hold **964**
  leaf keys, still at exact parity. Not fixed here to avoid churn in another agent's lane.
