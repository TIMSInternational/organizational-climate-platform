# What a client reads is edited, not coded

**Ruled 2026-11-19 by Federico (owner).** Source: `docs/audits/2026-11-19-what-still-needs-a-developer.md`.

> "What we want to do is that it's not global, and it's not coded and hard-coded, but it's
> editable per survey, per company. If one company wants, in one survey, this and then wants,
> in another one, this, it could be editable. Although it's already published, it can still be
> edited by the super admin."

Three further rulings, the same day (AskUserQuestion):

1. **Paper questionnaires — operator entry.** A super admin records a paper response from a
   roster row and types the answers. It is stored exactly as that person's own submission would
   be (anonymous if the survey is), the person shows as completed, their account and email are
   never touched, and the audit log records that TIMS entered a paper response.
2. **Wording corrections after answers — wording only.** A super admin may change a question's
   text, comment prompt and the scale / option WORDS on a survey that already has answers, while
   the type, scale range, required flag, category and the number, order and values of options
   stay identical. It is saved as a new version and audited. Anything that changes meaning stays
   refused.
3. **Client's authorized list — refuse.** A survey may carry «Lista autorizada del cliente».
   While it is set, a send, resend or reminder to anyone not on it is refused, naming them. To
   include someone they are added to the list first, which records who added them and when.
   No list = today's behaviour.

## Why

In the month to 2026-11-19, client wording requests became code eight times (the anonymity
paragraph three times, each reaching every client). A text was either **global** (the i18n
catalogue or a C# copy class) or **per survey** (re-typed on every survey). There was no client
level, three respondent texts had no editor at all, and two of three survey emails were fixed.

## The model

**One fallback chain, everywhere a respondent or a recipient reads our words:**

    survey override  →  company override  →  product default (catalogue / C# copy)

Empty at a level means "inherit". Overrides are per locale (`es`, `en`); a reader in a locale
with no override gets the product default **in that locale** — an override written in Spanish
is never shown to an English reader (`docs/decisions/author-content-i18n.md`).

**What can be overridden is a fixed registry, not "any catalogue key".** Each entry names its
key, kind (`screen` | `email` | `display`), maximum length, the placeholders it may contain
(`{date}`, `{minutes}`, `{count}`, `{survey}`, `{company}` — exactly those its default uses; an
override may omit one but never introduce an unknown one) and, for `display`, its allowed values.
The registry lives once on the server; the web reads the effective values from the payloads.

**Storage.** One table, `respondent_content_overrides` (company id required, survey id null for
a company row, key, locale — `*` for locale-independent `display` keys — value, who, when), unique
per (company, survey, key, locale). The survey-level columns that already exist stay the survey
storage for their keys and are not duplicated in the table:
`SurveySettings.RespondentIntro*` (anonymity paragraph), `ClosingMessage*` (thank-you),
`InvitationCustomSubject*` / `InvitationCustomMessage*` (personal-link email). Survey rows are
deleted with their survey and copied by «Duplicar»; company rows are deleted with their company.

**Who edits.** Company level: a super admin for any company, a company admin for their own.
Survey level: a company admin of the survey's company while it is draft, scheduled or active;
**a super admin in any status but archived** — that is the ruling's "although it's already
published". Every write is audited and attributed to the company.

**What stays code, deliberately.** The privacy floor, what is stored anonymously, who may read
verbatim text, and the default duration rule. They are guarantees, not preferences
(`privacy-floor-is-three.md`, `who-may-see-an-individual-answer.md`); they change by ruling.

## Also ruled in, from the same audit

- «Textos y correo» reachable while creating a survey, not only from Distribución.
- «Ver como quien responde»: the real respond screens in served order, saving nothing.
- The credentials email and the reminder take survey / company text like the personal-link email.
- A single-language survey sets the respondent interface language.
- «Notas de TIMS» (introduction, conclusions, recommendations) on a report.
- Text alignment of the respondent screens (`display.textAlign`: `justify` | `start`) is a
  registry entry, default `justify` (PROCOMER, 2026-11-19).

## Where it lives (foundation, 2026-11-19)

The contract every lane builds on. Grep the symbols; this list is a map, not the source.

- **Registry** — `src/ClimateProject.Application/RespondentContent/RespondentContentRegistry.cs`.
  A screen key is its catalogue path inside `useTranslation('surveyRespond')`, without the
  namespace (`demographics.intro`); email keys are `email.<mail>.<part>`, display keys
  `display.<name>`. `RespondentContentRegistryTests` reads `web/src/i18n/{es,en}.json` and fails
  on a screen key missing from either or a placeholder its defaults do not use. Deliberately
  absent: the identified wording and the device notes that state what is recorded.
- **Chain** — `RespondentContentResolver.Resolve` (Application, pure): survey row → survey
  legacy column → company row; per locale, never another locale's words; display keys from `*`.
  `RespondentContentStore` (Infrastructure) loads and resolves:
  `RespondentContentStore.ResolveAsync(db, survey, locale, kinds, ct)`, or `LoadAsync` once and
  `Resolve` per locale for a two-language email.
- **Payloads** — `SurveyRespondView.Content` and `SurveyInvitationTokenDetail.Content`: the
  effective screen + display overrides in the payload's `resolvedLocale`; absent key = product
  default. Web: `effectiveText(view.content, key, params) ?? t(key, params)` and
  `textAlignOf(view.content)` from `web/src/features/surveys/api/respondentContent.ts`.
- **Routes** — `GET/PUT /admin/companies/{companyId}/respondent-content`,
  `GET/PUT /surveys/{surveyId}/respondent-content` (`RespondentContentEndpoints.cs`). A survey PUT
  on a key with a legacy column writes the column. Refusals carry a `respondent_content_*` code
  and name `key`, `locale`, `placeholder`, `maxLength`, `allowed`.
- **«Duplicar»** copies the survey's own rows on both paths (with and without the audience),
  as `CopySettings` copies the legacy texts: they are words, not people. The client's
  authorized list is not copied by the foundation.
- **Schema** — migration `EditableRespondentContent`: `respondent_content_overrides`,
  `survey_authorized_people` (entity only; the guard is a lane's), `reports.notes_*` (columns
  only). Company deletion removes the company's rows explicitly; survey rows and authorized
  people cascade with their survey.
