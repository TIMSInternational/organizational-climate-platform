# Author-facing content i18n — Tier 2 of #195 (#210)

**Status: BUILT for 24 of the 27 fields — 21 paired, 3 re-scoped as keys with the reason
below. The remaining 3 stay gated on #58, as the issue itself orders.** Two rules differ
from Tier 1 and are stated here so either can be overruled.
Written 2026-09-07 against `main` at `42a60436`.

#210 files the fields only an administrator ever reads — template names, action-plan
titles, KPI units, benchmark descriptions, report titles — for the same paired
`<field>_en` / `<field>_es` treatment #195 gave respondent-facing content. PRD CLIMA-011
("Complete ES/EN localization for **all platform content**") is the requirement; #195's
closure on 2026-08-05 settled the representation (paired columns; a third language is new
content only), which is why this work could start.

## What shipped

| Entity | Fields paired | Table / columns |
|---|---|---|
| `SurveyTemplate` | Name, Description | `survey_templates.name_en/_es`, `description_en/_es` |
| `MicroclimateTemplate` | Name, Description | `microclimate_templates.…` |
| `ActionPlanTemplate` | Name, Description | `action_plan_templates.…` |
| `ActionPlan` | Title, Description | `action_plans.title_en/_es`, `description_en/_es` |
| `ActionPlanObjective` | Description, SuccessCriteria | `action_plan_objectives.…`, `success_criteria_en/_es` |
| `ActionPlanKpi` | Name, Unit | `action_plan_kpis.…`, `unit_en/_es` |
| `ActionPlanTemplateObjective` | Description, SuccessCriteria | `action_plan_template_objectives.…` |
| `ActionPlanTemplateKpi` | Name, Unit | `action_plan_template_kpis.…` |
| `Benchmark` | Name, Description | `benchmarks.…` |
| `Report` | Title, Description | `reports.…` |
| `NotificationTemplateVariable` | Description | `notification_template_variables.description_en/_es` |

Twenty-one fields, one migration (`AddAuthorContentI18n`), the same shape as
`AddContentI18n`: rename the existing column to its `_en` half, drop its NOT NULL, add the
`_es` half beside it. Every read goes through `AuthoredContent.Resolve`; every write through
`AuthoredContent.TryApply`; no read DTO carries an `En`/`Es`-shaped field (criterion 6).
The detail DTOs gained `fallbackFields`, so a reader is told when the heading — not only the
questions — reached for the other language.

The `search_vector` generated columns on `action_plans` and `reports` are rebuilt over both
halves, as the survey ones already were. Their previous expression referenced `title`, and a
rename alone would have left the index blind to the Spanish column.

## Rule 1 — the content language is read off the pair, not declared

Tier 1 resolves against a language the content *declares*: `Survey.Language`, which a
publish gate reads. None of these rows declares a language and none has a gate. The only
honest statement about a template's language is what its two columns hold — the argument
`SurveyTemplateLanguage.Infer` already makes for template questions — so
`AuthoredContent.LanguageOf(en, es)` is the content language everywhere here.

The consequence worth knowing: a Spanish-only template read from an English session comes
back **in Spanish, flagged as a fallback**, never as a blank. Under Tier 1's rule with no
declared language it would have resolved to nothing.

## Rule 2 — a bare string is never refused

Tier 1 refuses a bare string for content authored in `both`, because filing one language's
text into the wrong column of a bilingual survey is served to a respondent as a lie. That
refusal cannot be inherited here:

- these fields reach no respondent;
- every existing admin form sends them as bare strings (`name: string` on the wire);
- the local reference tenant, and plausibly the production one, is set to `both`
  (`companies.settings_language`).

So the refusal would have broken every create form for every bilingual tenant on the day the
columns landed, and bought nothing. A bare string is **attributed** instead, to the signal
that knows most about its author, in order:

1. the language the request declares (`CreateSurveyTemplateRequest.Language`), or on an
   update the language the row is already authored in;
2. the owning company's language, when it is a single language;
3. the author's own display language (`User.Preferences.Language`);
4. English.

That is `AuthoredContent.AttributionLocale`, fetched by `AuthoredWrites` in the API. A caller
who wants both languages sends `{ "en": …, "es": … }`, the same wire shape as everywhere
else, and an unsupported locale key is the one thing still refused.

One behaviour changed as a result, deliberately. Instantiating a survey or microclimate from
a template without a title used to attribute the template's single name string to the new
survey's language; the name is a pair now, and the pair **crosses over verbatim**, both
halves. A survey authored in `both` still needs a name in both, and is refused with the same
"authored in both languages" message when the template is named in one — nothing is filed
under a language it was not written in.

## Re-scoped with a reason: the three template `Category` fields

`SurveyTemplate.Category`, `MicroclimateTemplate.Category` and `ActionPlanTemplate.Category`
are in the issue's 27 and are **not** paired. They are facet keys, not content:

- `SurveyTemplateEndpoints.ListAsync` filters on `t.Category == trimmedCategory` — an
  equality over a stored value, which a locale-dependent value would split in two;
- the web builds its category dropdown from the distinct stored values
  (`SurveyTemplatesPage.tsx`);
- instantiation copies it straight into `Survey.Type`
  (`SurveyTemplateEndpoints.UseAsync`: `type = template.Category`), a key every survey filter
  and report reads.

This is the same distinction the issue's own author drew in leaving `Benchmark.Category` —
the prior-period linkage key — out of the 27. Criterion 2 allows a field to be "explicitly
re-scoped with a reason"; this is that. If the product later wants a translated *label* for a
category, the shape is the one #58 takes for question categories — a lookup row with a
bilingual name and a stable key — not a pair on the template row.

## Still gated on #58: the three question `Category` fields

`Question.Category`, `TemplateQuestion.Category` and `MicroclimateTemplateQuestion.Category`
are untouched, exactly as #210 orders ("do not add `category_en`/`category_es` to the
question tables — wait for #58 or the work is thrown away"). `QuestionCategory` exists on
`main` for the *library* and is bilingual by construction, but no survey question table
carries a foreign key to it yet. Note for whoever wires that key: `scripts/seed-surveys.mjs`
records that `Question.Category` **is the dimension** results aggregate by, so it is a key
today in the same sense the template categories are.

## Confirmed excluded: `Department`, `Company`, `User` names

Re-checked on `main`: `Department.Name`/`Description`, `Company.Name` and `User.Name` remain
single columns. A department has one real name in the organisation; translating it invents an
entity that does not exist (criterion 5).

## The migration, and the one thing it does that Tier 1's did not

`AddContentI18n` renamed every existing column to `_en` and stopped. It ran against a
production database that had nothing in it. This one runs against a populated one, so after
the rename it **moves the text of rows owned by a company whose language is `es` into the
`_es` half** — the exact rule the write side would have applied had the columns existed, and
the rule the ETL was told to apply to legacy rows. Rows owned by an `en` or `both` company,
and global rows, stay in `_en`, which is what Tier 1 did and what the write side would do for
them today. `Down` moves them back. Both directions are exercised by
`AuthorContentI18nMigrationTests`, which migrates the shared test database to the previous
migration, inserts by raw SQL, migrates forward, and reads through EF.

No new column carries a database default, so there is no `HasDefaultValue` to prove; the
raw-SQL-insert-then-EF-read tests in that class prove the columns exist with the right
nullability and that a row written by hand in one language reads back resolved (criterion 3).

## What the web does about it

Nothing on the wire changes for the forms that exist: a bare string is still valid. The
detail types gained `fallbackFields`, and the comments that said these fields were
monolingual (`surveyTemplates.ts`, `SurveyTemplatesPage.tsx`, `SurveyTemplateDetailPage.tsx`,
UAT step 5c) now say the opposite, because a stale claim repeated is worse than none.

**Not built, by #210's own scope:** a side-by-side editor for these fields. An administrator
who wants both languages on a template today sends the object form through the API. That is
a product question — which of these admin screens are worth a bilingual editor before
16 November — rather than a task, and it is left here for Federico rather than filed quietly.

## Decision

```
Template Category fields stay keys (not paired):  RECOMMENDED — overrule if a translated label is wanted
Bare strings attributed, never refused, on Tier 2:  RECOMMENDED — overrule to inherit Tier 1's refusal
Migration attributes 'es' companies' rows to _es:   RECOMMENDED — overrule to mirror Tier 1's rename-only
Decided by: ____
Date: ____
```
