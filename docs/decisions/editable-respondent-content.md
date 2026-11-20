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
  default. The employee's Home carries the same pair per pending survey
  (`DashboardPendingSurvey.Content` / `ResolvedLocale`), so the anonymity promise beside a survey
  is the one its respond page makes.
- **Cards drawn from a refusal** — `RespondentCardRefusal` (`message`, `reason`,
  `resolvedLocale`, `content`) is the body of the respond GET's 400 on a closed survey
  (`closedTitle`, `closedBody`; reached only by a respondent the route already admitted) and of
  `GET /survey-invitations/{token}`'s 409 `already_completed` (`alreadyCompletedTitle`,
  `alreadyCompletedBody`). The web keeps both on `SurveyRespondError` / `SurveyLinkError`. The
  **unavailable** card is not in the registry: it is drawn only from the respond GET's 401, which
  stays fail-closed (an id with no live link learns nothing, not even whose survey it is).
- **Reading it on a screen** — `effectiveText(source, locale, key, params) ?? t(key, params)`,
  where `source` is the view, the landing, a refusal or a Home survey and `locale` is
  `useTranslation().locale`; `textAlignOf(view.content)`. Both in
  `web/src/features/surveys/api/respondentContent.ts`. `effectiveText` returns `null` (the
  default, in the reader's language) whenever the reader's language is not the payload's
  `resolvedLocale` — an es-only survey read by somebody who picked English gets English
  defaults, never the client's Spanish sentence in English chrome. There is no form that takes
  the bare map.
- **One answer per text** — `SurveyRespondView.RespondentIntro` / `ClosingMessage` are the same
  values as `Content["anonymousBody"]` / `Content["thankYouTitle"]` (same chain, `resolvedLocale`
  only, never in `fallbackFields`). They are superseded: new code reads `content` through
  `effectiveText` and never chains `?? view.respondentIntro` after it.
- **The respond view, built once** — `SurveyResponseEndpoints.BuildRespondViewAsync(db, survey,
  lang, RespondReader, inProgress, ct)` (`SurveyResponseEndpoints.RespondView.cs`): no
  respondent, session, status check or write. The respond GET calls it after its gates; a preview
  calls it with `RespondReader.LinkVisitor` and `inProgress: null`.
- **Routes** — `GET/PUT /admin/companies/{companyId}/respondent-content`,
  `GET/PUT /surveys/{surveyId}/respondent-content` (`RespondentContentEndpoints.cs`). A survey PUT
  on a key with a legacy column writes the column. A survey PUT may SET a text only in a locale
  the survey offers (`requiredLocales`; else 400 `respondent_content_locale_not_offered`) and may
  clear one in any. Refusals carry a `respondent_content_*` code and name `key`, `locale`,
  `placeholder`, `maxLength`, `allowed`.
- **Two locale rules, said on the entry** — the four legacy keys (`requiresEveryLocale: true` on
  the registry DTO) are publish-gate fields at the survey level, as they were before the registry:
  set in one of the survey's languages, they must be set in all of them before it leaves draft
  («faltan traducciones», `SurveyContent.GateFields`). Every other key, and every company-level
  value, is per locale with the product default where a locale has none. An editor says which.
- **Emails** — `RespondentContentPlaceholders.Fill(text, values)` is THE server filler for
  `{survey}` / `{company}` (the web twin is `interpolateContent`): fill first, then let
  `EmailBranding` escape. The personal-link email already uses it and already reads the chain:
  `SurveyPersonalLinks.MailFor(survey, company, RespondentContentStore.LoadAsync(...))` at both
  send sites, so a company's `email.personalLink.*` reaches a survey that wrote none. The
  credentials and reminder emails (lane L2) use the same filler and `RespondentContentResolver`,
  not a second one.
- **«Duplicar»** copies the survey's own rows on both paths (with and without the audience),
  as `CopySettings` copies the legacy texts: they are words, not people. The client's
  authorized list is not copied by the foundation.
- **Schema** — migration `EditableRespondentContent`: `respondent_content_overrides`,
  `survey_authorized_people` (entity only; the guard is a lane's), `reports.notes_*` (columns
  only). Company deletion removes the company's rows explicitly; survey rows and authorized
  people cascade with their survey.

## For the lanes that build on it (2026-11-19)

So that lanes working in parallel do not edit the same lines:

- **`Program.cs` is not edited by a lane.** `RespondPreviewEndpoints` (L4),
  `SurveyAuthorizedPeopleEndpoints` (L5) and `PaperResponseEndpoints` (L6, paper responses and
  wording corrections) are mapped already and empty; each lane fills its own file.
- **Refusal codes go after the lane's anchor, never at the end of a list.** In
  `AdminRefusals.cs`, `describeApiError.ts`'s `CODE_KEYS` and `errors.api.codes` in both
  catalogues, insert immediately after: L4 `respondent_content_locked`; L5
  `personal_link_not_in_audience` (in `AdminRefusals.cs`, after `SurveyNotCollecting`); L6
  `company_people_referenced`; L7 `report_schedule_start_past`. Additive, never reordered.
- **`SurveyRespondForm.tsx`** — L1 changes render-time copy (`t(...)` → `effectiveText(...) ??
  t(...)`); L4's preview seam touches the props and the effects (session, load, autosave,
  submit, receipt). Measured 2026-11-19: none of the eight side-effect call sites has a `t('…')`
  within three lines, so the two edit disjoint hunks. L4 owns the seam's semantics (shuffle seed
  without a session, the thank-you without a submission result, the respond lock).
- **Survey-targeted sends** — L2 (text from the chain) and L5 (the authorized-list guard) both
  touch the send handlers. Merge L2 first; L5 places its guard before each handler's first write
  (credentials and tokens are minted before the mail goes) and rebases on L2.
