import type { TranslateFn } from '../../i18n'
import type {
  CreateSurveyInput,
  CreateSurveyQuestionInput,
  LocalizedInput,
} from './api/surveyCreate'
import type { InstantiateSurveyTemplateInput } from './api/surveyTemplates'
import { DEFAULT_SURVEY_QUESTION_TYPE, needsOptions, needsScaleLabels } from './surveyVocabulary'

/**
 * The survey creation wizard's state, and the rules that decide when a step is done.
 *
 * The sibling of `features/microclimates/wizardValues.ts`, deliberately: the two
 * flows share `components/wizard/WizardStepper`, whose own docstring calls this one
 * out by name ("#127 is the first wizard, #108 is the second"). Where the shapes can
 * be the same they are the same, so the two wizards do not disagree about what
 * "Continue" means.
 *
 * Kept out of the page for the reasons the microclimate module gives: it is the half
 * worth testing directly — every rule below is a message an admin will read — and it
 * is the half that has to agree with `SurveyEndpoints.CreateAsync`.
 *
 * ## The steps are the DTO, not a workflow somebody imagined
 *
 * `CreateSurveyRequest` is: title, companyId, type, startDate, endDate, description,
 * departmentIds, questions, settings, targetAudienceCount, language. Every field
 * appears here and nothing else does.
 *
 * ## Three ways this differs from the microclimate wizard, all because the DTO does
 *
 * - **Departments are real here.** `CreateSurveyRequest.DepartmentIds` is written by
 *   `CreateAsync`. The microclimate wizard deliberately has no picker because its
 *   request record has no such field and one would collect a choice and drop it.
 * - **There is a survey `type`.** Seven of them, and it is required.
 * - **Drafts exist.** `SurveyDraftEndpoints` (#105) is a whole autosave-and-recover
 *   surface for surveys and nothing else, which is why this wizard can be left and
 *   come back to and the microclimate one cannot.
 *
 * ## Two ways to create, and the template one is not a pre-fill (#267)
 *
 * With `templateId === ''` the wizard builds a `CreateSurveyRequest` and posts
 * `/surveys`. With a template chosen it collects the same fields but posts
 * `/survey-templates/{id}/use`, and **the server copies the questions**.
 *
 * That is not an implementation preference, it is the only correct option. Loading a
 * template's questions into this module's `SurveyQuestionValues` and re-creating them
 * through `POST /surveys` would silently lose most of what a template is:
 *
 * - **Every option's `value`.** `SurveyAggregation` calls it "THE group key: the
 *   stable, locale-independent option value that `question_responses.response_value`
 *   holds", and `buildCreateInput` deliberately omits `value` so the server derives one
 *   from the label. Two surveys from one template would then agree only for as long as
 *   nobody edited a label.
 * - **`Category`, `ScaleMin`/`Max`, the scale labels, `CommentRequired`, the comment
 *   prompt and the binary comment config.** `TemplateQuestion` carries all of these and
 *   `SurveyQuestionValues` below has fields for none of them, so a round trip through
 *   this editor flattens a rich instrument into text, type and options. The loss would
 *   be invisible: the created survey looks plausible and is simply less than the
 *   template.
 *
 * So in template mode the questions step is a **read-only preview**. The honest cost is
 * that a template's questions cannot be tweaked on the way through — and, today, not
 * afterwards either: `PUT /surveys/{id}` can replace them, but nothing in the frontend
 * calls it and there is no survey question editor. That is a real gap, and a smaller
 * one than a template that quietly stops aggregating.
 *
 * ## What this wizard cannot do, and does not pretend to
 *
 * **Launch.** `CreateSurveyRequest` has no status field and `CreateAsync` writes
 * `draft`. Publishing is `PUT /surveys/{id}/status`, guarded by the content-i18n gate
 * — deliberately a separate, irreversible checkpoint (`SurveyDtos.cs` says so at
 * length). `POST /survey-templates/{id}/use` writes `draft` too, so both paths land in
 * the same place. The review step states that it is about to create a draft.
 *
 * ## Which validations are mirrored, and which are left to the server
 *
 * Mirrored, because the message is better attached to the field than to a failed
 * request: title present (in both languages when the survey is bilingual), end after
 * start, a positive audience target when one is given, question text present, an
 * option-based question having at least two options, and duplicate option labels.
 *
 * **Not** mirrored: the publish translation gate (it applies to a transition this
 * flow never performs), department scoping and template scoping — the server checks
 * those against rows the client cannot see, and a client copy would drift.
 */

export type ContentLanguage = 'en' | 'es' | 'both'

export const CONTENT_LANGUAGES: readonly ContentLanguage[] = ['en', 'es', 'both']

export interface SurveyOptionValues {
  /** Client-side identity, so removing the second of three options does not remount the third. */
  key: string
  labelEn: string
  labelEs: string
}

export interface SurveyQuestionValues {
  key: string
  textEn: string
  textEs: string
  type: string
  required: boolean
  options: SurveyOptionValues[]
  /**
   * The climate dimension this question's answers feed — `Question.Category`, the
   * RAW stored key the respond page and the results pages group on.
   *
   * Raw means raw: the picker offers the shipped vocabulary (`psychological_safety`,
   * `workload`…) rendered through `dimensionLabel`, but what is stored and sent is
   * the key itself, never the display name. Storing "Psychological safety" would
   * mint a second dimension beside every survey that stored the key — the exact
   * cross-survey comparison failure the picker exists to prevent. Free text is the
   * escape hatch (`Category` is a free string server-side) and is stored as typed.
   *
   * `''` is a legal state, not an error: an uncategorised question lands on the
   * results page as the Uncategorised row. The builder names that consequence
   * (questions step, review step) and never gates on it.
   */
  category: string
  /**
   * The words at the two ends of a likert/rating scale, per language — the same
   * paired-column shape as `textEn`/`textEs`, collected only for the survey's
   * content language(s). `CreateSurveyQuestionInput.ScaleLabelMin/Max` have accepted
   * these since the DTO existed; the wizard simply never asked, so respondents saw a
   * bare 1–5 and the results axes had no words.
   */
  scaleLabelMinEn: string
  scaleLabelMinEs: string
  scaleLabelMaxEn: string
  scaleLabelMaxEs: string
}

export interface SurveyWizardValues {
  /**
   * The template this survey is being started from, or `''` for a blank one (#267).
   *
   * Not merely a pre-fill flag: it changes which endpoint creates the survey. See
   * `startsFromTemplate` and the note on the questions step below.
   */
  templateId: string
  language: ContentLanguage
  titleEn: string
  titleEs: string
  descriptionEn: string
  descriptionEs: string
  type: string
  /** `<input type="datetime-local">` text, e.g. `2026-08-07T10:30`. Local wall clock. */
  startDate: string
  endDate: string
  /** Empty means "every department", which is what omitting the field asks the server for. */
  departmentIds: string[]
  /** Text, not a number: an empty box is a real state and `NaN` is not a value. */
  targetAudienceCount: string
  anonymous: boolean
  allowPartialResponses: boolean
  showProgress: boolean
  questions: SurveyQuestionValues[]
}

/**
 * The same order as the microclimate wizard's, so an admin who has made one already
 * knows where they are in this one.
 */
export const SURVEY_WIZARD_STEPS = [
  'basics',
  'schedule',
  'audience',
  'questions',
  'review',
] as const

export type SurveyWizardStepId = (typeof SURVEY_WIZARD_STEPS)[number]

export function emptyOption(key: string): SurveyOptionValues {
  return { key, labelEn: '', labelEs: '' }
}

export function emptyQuestion(key: string): SurveyQuestionValues {
  return {
    key,
    textEn: '',
    textEs: '',
    type: DEFAULT_SURVEY_QUESTION_TYPE,
    required: true,
    options: [],
    category: '',
    scaleLabelMinEn: '',
    scaleLabelMinEs: '',
    scaleLabelMaxEn: '',
    scaleLabelMaxEs: '',
  }
}

/**
 * `language` is seeded from the company rather than defaulted to English, for the
 * reason the microclimate module records: the server's own default is
 * `company.Settings.Language`, and guessing differently in the form would silently
 * disagree with a request that omitted the field.
 */
export function emptyWizardValues(language: ContentLanguage): SurveyWizardValues {
  return {
    templateId: '',
    language,
    titleEn: '',
    titleEs: '',
    descriptionEn: '',
    descriptionEs: '',
    type: 'periodic',
    startDate: '',
    endDate: '',
    departmentIds: [],
    targetAudienceCount: '',
    anonymous: true,
    allowPartialResponses: true,
    showProgress: true,
    questions: [],
  }
}

/** True when both language columns have to be filled in. */
export function needsBothLanguages(language: ContentLanguage): boolean {
  return language === 'both'
}

/**
 * True when this survey will be created by instantiating a template rather than by
 * posting a `CreateSurveyRequest`.
 *
 * A predicate rather than a bare `!== ''` at each call site: it is checked in the
 * validation, in both build functions and in four places in the page, and "which
 * endpoint is about to be called" is worth naming.
 */
export function startsFromTemplate(values: SurveyWizardValues): boolean {
  return values.templateId !== ''
}

/**
 * The `LocalizedInput` for a pair of language columns, or `undefined` when the survey
 * is single-language and that column is empty.
 *
 * Identical to the microclimate module's, and it must stay identical: both feed the
 * same `LocalizedInput` converter server-side, which reads a bare string as "the
 * survey's own language" and an object as an explicit per-locale map.
 */
export function localizedFor(
  language: ContentLanguage,
  en: string,
  es: string,
): LocalizedInput | undefined {
  if (language === 'both') {
    return { en: en.trim(), es: es.trim() }
  }
  const single = (language === 'es' ? es : en).trim()
  return single.length === 0 ? undefined : single
}

/**
 * The stable value the server will derive for an option: the English label, or the
 * Spanish one when there is no English.
 *
 * Reproduced rather than approximated because the duplicate check below has to
 * compare the same strings the server will, or it flags pairs the server accepts and
 * misses pairs it rejects.
 */
export function derivedOptionValue(option: SurveyOptionValues): string | null {
  const en = option.labelEn.trim()
  if (en.length > 0) return en
  const es = option.labelEs.trim()
  return es.length > 0 ? es : null
}

function isBlank(value: string): boolean {
  return value.trim().length === 0
}

function basicsErrors(values: SurveyWizardValues, t: TranslateFn): string[] {
  const errors: string[] = []
  if (needsBothLanguages(values.language)) {
    if (isBlank(values.titleEn) || isBlank(values.titleEs)) {
      errors.push(t('surveys.validationTitleBoth'))
    }
  } else if (isBlank(values.language === 'es' ? values.titleEs : values.titleEn)) {
    errors.push(t('surveys.validationTitleRequired'))
  }
  if (isBlank(values.type)) errors.push(t('surveys.validationTypeRequired'))
  return errors
}

function scheduleErrors(values: SurveyWizardValues, t: TranslateFn): string[] {
  if (isBlank(values.startDate) || isBlank(values.endDate)) {
    return [t('surveys.validationDatesRequired')]
  }
  const start = new Date(values.startDate).getTime()
  const end = new Date(values.endDate).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return [t('surveys.validationDatesRequired')]
  }
  return end <= start ? [t('surveys.validationEndAfterStart')] : []
}

/**
 * The audience step is optional in the DTO and therefore optional here: no
 * departments means every department, and no target means the server does not record
 * one. Only a target that was *typed* and is not a positive whole number is an error
 * — refusing to continue because a field the admin deliberately left blank is blank
 * is the most common way a wizard becomes a maze.
 */
function audienceErrors(values: SurveyWizardValues, t: TranslateFn): string[] {
  if (isBlank(values.targetAudienceCount)) return []
  const parsed = Number(values.targetAudienceCount)
  return Number.isInteger(parsed) && parsed > 0 ? [] : [t('surveys.validationTargetPositive')]
}

/**
 * In template mode the questions are the template's and this step validates the
 * template rather than the form.
 *
 * `null` means the template detail has not arrived yet, which is not an error — the
 * step is simply not yet known to be complete, and blocking it with a message about a
 * request in flight would be a wizard telling the author off for its own latency. It
 * blocks anyway, because `WizardStepper` only advances past an error-free step and this
 * returns an error while the count is unknown.
 */
function templateQuestionErrors(count: number | null, t: TranslateFn): string[] {
  if (count === null) return [t('surveys.validationTemplateLoading')]
  return count === 0 ? [t('surveys.validationTemplateNoQuestions')] : []
}

function questionErrors(values: SurveyWizardValues, t: TranslateFn): string[] {
  if (values.questions.length === 0) return [t('surveys.validationQuestionsRequired')]

  const errors: string[] = []
  const both = needsBothLanguages(values.language)

  values.questions.forEach((question, index) => {
    const position = index + 1
    const textMissing = both
      ? isBlank(question.textEn) || isBlank(question.textEs)
      : isBlank(values.language === 'es' ? question.textEs : question.textEn)
    if (textMissing) {
      errors.push(t('surveys.validationQuestionText', { position }))
    }

    if (!needsOptions(question.type)) return

    const values_ = question.options.map(derivedOptionValue)
    if (values_.filter((value) => value !== null).length < 2) {
      errors.push(t('surveys.validationQuestionOptions', { position }))
    }
    const seen = new Set<string>()
    for (const value of values_) {
      if (value === null) continue
      if (seen.has(value)) {
        errors.push(t('surveys.validationQuestionDuplicateOption', { position }))
        break
      }
      seen.add(value)
    }
  })

  return errors
}

/**
 * Each step's *current* blocking problems.
 *
 * Derived rather than stored, so correcting a field clears its message with no extra
 * wiring — `WizardStepper` keeps no copy of these either.
 *
 * The review step carries the union of the others. It is unreachable while any of
 * them fails, so in practice it is always empty there; it exists as a backstop so
 * `onSubmit` cannot fire on invalid values if the step list ever gains a shortcut.
 */
export function wizardStepErrors(
  values: SurveyWizardValues,
  t: TranslateFn,
  templateQuestionCount: number | null = null,
): Record<SurveyWizardStepId, string[]> {
  const basics = basicsErrors(values, t)
  const schedule = scheduleErrors(values, t)
  const audience = audienceErrors(values, t)
  const questions = startsFromTemplate(values)
    ? templateQuestionErrors(templateQuestionCount, t)
    : questionErrors(values, t)

  return {
    basics,
    schedule,
    audience,
    questions,
    review: [...basics, ...schedule, ...audience, ...questions],
  }
}

/**
 * How many questions the survey being built will actually have.
 *
 * Two sources, and which one applies is decided by `startsFromTemplate`, not by which
 * of the two happens to be non-empty: in template mode the wizard's own `questions`
 * array stays empty and the count is the template's, and a template that has not
 * arrived yet counts as zero rather than as the form's own length. Reading
 * `values.questions.length` directly at a call site gets template mode wrong and
 * silently reports 0, which is the number this exists to stop being shown.
 */
export function surveyQuestionCount(
  values: SurveyWizardValues,
  templateQuestionCount: number | null,
): number {
  if (startsFromTemplate(values)) return templateQuestionCount ?? 0
  return values.questions.length
}

/**
 * The distinct dimensions chosen so far, raw keys, in order of first use.
 *
 * Trimmed before comparing so `'trust'` and `'trust '` do not read as two
 * dimensions here while aggregating as one there — `dimensionKeyOf` on the results
 * side trims the same way.
 */
export function chosenDimensions(values: SurveyWizardValues): string[] {
  const seen = new Set<string>()
  const chosen: string[] = []
  for (const question of values.questions) {
    const category = question.category.trim()
    if (category === '' || seen.has(category)) continue
    seen.add(category)
    chosen.push(category)
  }
  return chosen
}

/**
 * The 1-based positions of questions still without a dimension.
 *
 * Positions, not a bare count, because the warning names the question — "Question 2
 * has no dimension" is actionable where "a question" is a hunt.
 */
export function positionsWithoutDimension(values: SurveyWizardValues): number[] {
  return values.questions
    .map((question, index) => ({ blank: question.category.trim() === '', position: index + 1 }))
    .filter((entry) => entry.blank)
    .map((entry) => entry.position)
}

/**
 * A `LocalizedInput` for an *optional* pair of language columns, or `undefined`
 * when nothing was typed.
 *
 * Not `localizedFor`, deliberately: that one serves required fields and returns
 * `{ en: '', es: '' }` for an untouched bilingual pair, which is right for a title
 * (validation has already refused the blank) and wrong here — it would file empty
 * strings into both scale-label columns of every bilingual likert question. This
 * sends only the members that hold text, and nothing when neither does.
 */
export function optionalLocalizedFor(
  language: ContentLanguage,
  en: string,
  es: string,
): LocalizedInput | undefined {
  if (language !== 'both') return localizedFor(language, en, es)
  const trimmedEn = en.trim()
  const trimmedEs = es.trim()
  if (trimmedEn === '' && trimmedEs === '') return undefined
  const pair: Partial<Record<'en' | 'es', string>> = {}
  if (trimmedEn !== '') pair.en = trimmedEn
  if (trimmedEs !== '') pair.es = trimmedEs
  return pair
}

/** Whole days the survey is open for, or null when either end is missing or invalid. */
export function scheduledDays(values: SurveyWizardValues): number | null {
  if (isBlank(values.startDate) || isBlank(values.endDate)) return null
  const start = new Date(values.startDate).getTime()
  const end = new Date(values.endDate).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return Math.max(1, Math.round((end - start) / 86_400_000))
}

/**
 * The request body.
 *
 * Only the fields the wizard actually asked about are sent. `SurveySettingsInput`'s
 * fifteen members are all "leave this alone when omitted", so sending the whole
 * record with invented defaults would overwrite twelve settings this flow never
 * showed anyone.
 *
 * Call it only when `wizardStepErrors(...).review` is empty — it assumes a title and
 * both dates are present, which is exactly what that guarantees.
 */
export function buildCreateInput(
  values: SurveyWizardValues,
  companyId: string,
): CreateSurveyInput {
  const title = localizedFor(values.language, values.titleEn, values.titleEs)
  const description = localizedFor(values.language, values.descriptionEn, values.descriptionEs)
  const target = Number(values.targetAudienceCount)

  const questions: CreateSurveyQuestionInput[] = values.questions.map((question, index) => {
    const built: CreateSurveyQuestionInput = {
      // Non-null by the guard above: `questionErrors` rejects a blank text.
      text: localizedFor(values.language, question.textEn, question.textEs) as LocalizedInput,
      type: question.type,
      required: question.required,
      order: index,
    }
    // The raw key, exactly as the picker stored it — this string is what the respond
    // page and the results pages group on, so any transformation here (a display
    // name, a re-slug) would split this survey's dimension away from every other
    // survey's. Omitted when blank: an uncategorised question is legal and the
    // server's own null is the honest value for it.
    const category = question.category.trim()
    if (category !== '') built.category = category
    if (needsScaleLabels(question.type)) {
      const scaleLabelMin = optionalLocalizedFor(
        values.language,
        question.scaleLabelMinEn,
        question.scaleLabelMinEs,
      )
      const scaleLabelMax = optionalLocalizedFor(
        values.language,
        question.scaleLabelMaxEn,
        question.scaleLabelMaxEs,
      )
      if (scaleLabelMin !== undefined) built.scaleLabelMin = scaleLabelMin
      if (scaleLabelMax !== undefined) built.scaleLabelMax = scaleLabelMax
    }
    if (needsOptions(question.type)) {
      built.options = question.options
        // An option with no label in either language is a row the author started and
        // abandoned; dropping it is what the duplicate check already assumes.
        .filter((option) => derivedOptionValue(option) !== null)
        .map((option) => ({
          // `value` deliberately omitted — the server derives it, and that is what
          // keeps two surveys built from one template aggregating together.
          label: localizedFor(values.language, option.labelEn, option.labelEs) as LocalizedInput,
        }))
    }
    return built
  })

  const input: CreateSurveyInput = {
    title: title as LocalizedInput,
    companyId,
    type: values.type,
    startDate: new Date(values.startDate).toISOString(),
    endDate: new Date(values.endDate).toISOString(),
    language: values.language,
    questions,
    settings: {
      anonymous: values.anonymous,
      allowPartialResponses: values.allowPartialResponses,
      showProgress: values.showProgress,
    },
  }

  if (description !== undefined) input.description = description
  if (values.departmentIds.length > 0) input.departmentIds = values.departmentIds
  if (!isBlank(values.targetAudienceCount) && Number.isInteger(target) && target > 0) {
    input.targetAudienceCount = target
  }

  return input
}

/**
 * The body of `POST /survey-templates/{id}/use` — the template path's counterpart to
 * `buildCreateInput`.
 *
 * Everything the wizard asked about, and **not one question**: the questions are the
 * template's and the server copies them, values and all. See the module header for why
 * sending them back would be a downgrade rather than a convenience.
 *
 * `title` is always sent even though the server would fall back to the template's name.
 * Two reasons: the fallback is a bare string, which a `'both'` survey rejects with a 400
 * — so the case where the fallback is least wanted is also the case where it fails — and
 * an author who has typed a title in the wizard should get the title they typed.
 *
 * `language` is *not* sent, deliberately. The server infers it from the template's own
 * questions, and that is the only value that cannot produce a survey declaring a
 * language it holds no text for. The wizard reflects that language rather than offering
 * a choice, which is why `values.language` is read here only through `localizedFor`.
 */
export function buildInstantiateInput(
  values: SurveyWizardValues,
  companyId: string,
): InstantiateSurveyTemplateInput {
  const description = localizedFor(values.language, values.descriptionEn, values.descriptionEs)
  const target = Number(values.targetAudienceCount)

  const input: InstantiateSurveyTemplateInput = {
    companyId,
    title: localizedFor(values.language, values.titleEn, values.titleEs) as LocalizedInput,
    type: values.type,
    startDate: new Date(values.startDate).toISOString(),
    endDate: new Date(values.endDate).toISOString(),
  }

  if (description !== undefined) input.description = description
  if (values.departmentIds.length > 0) input.departmentIds = values.departmentIds
  if (!isBlank(values.targetAudienceCount) && Number.isInteger(target) && target > 0) {
    input.targetAudienceCount = target
  }

  return input
}
