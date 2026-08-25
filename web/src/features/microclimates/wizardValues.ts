import type { TranslateFn } from '../../i18n'
import type {
  CreateMicroclimateInput,
  CreateQuestionInput,
  LocalizedInput,
} from './api/microclimates'
import type { QuestionLibraryItemDetail } from '../questions/api/questionLibrary'
import { DEFAULT_QUESTION_TYPE } from './questionTypes'

/**
 * The creation wizard's state, and the rules that decide when a step is finished.
 *
 * Kept out of the page for two reasons. It is the half worth testing directly — every
 * rule below is a message an admin will read — and it is the half that has to agree
 * with `MicroclimateEndpoints.CreateAsync`, which is easier to check against when it
 * is one file rather than scattered through JSX.
 *
 * ## The steps are the DTO, not a workflow somebody imagined
 *
 * `CreateMicroclimateRequest` is: title, description, companyId, startTime, endTime,
 * targetParticipantCount, anonymousResponses, templateId, questions, timezone,
 * language. Every field appears here and nothing else does. In particular:
 *
 * - **No department targeting.** `MicroclimateDepartmentTarget` exists as an entity,
 *   but the request record has no department field and `CreateAsync` never writes
 *   one. A picker here would collect a choice and silently drop it.
 * - **No autosave or draft recovery.** There is no pre-create draft endpoint for
 *   microclimates (`SurveyDraftEndpoints` is surveys only, #105). `Status` is forced
 *   to `"draft"` *after* the row exists, which is a different thing entirely.
 * - **No "launch now".** `CreateAsync` hardcodes `Status = "draft"`, so the wizard
 *   cannot publish and does not pretend to. The page says so on the review step.
 * - **No `showLiveResults`.** It is on the read DTO and absent from the write one.
 *
 * ## Which validations are mirrored, and which are left to the server
 *
 * Mirrored, because the message is better attached to the field than to a failed
 * request: title present, end after start, a positive participant target, question
 * text present, `multiple_choice` with at least two options, duplicate option values,
 * and — since #198 — `emoji_rating` with at least two faces, each carrying a glyph and
 * a label. Each of these is also enforced server-side and the wizard is not the
 * authority — the server's own message is rendered verbatim if one gets through.
 *
 * **Not** mirrored: the publish translation gate (it applies to `draft -> active`,
 * which this flow never performs) and template scoping (the server checks the
 * template belongs to this company and is active, and a client copy of that rule
 * would drift the moment templates gain a visibility setting).
 *
 * One rule here is stricter than the server's, deliberately: **at least one
 * question.** `CreateAsync` accepts an empty `questions` array, and the resulting
 * session renders a respond page with nothing on it and can never collect anything.
 * That is a product rule rather than a restatement of a server rule, and it is called
 * out here rather than buried so it can be lifted if the backend ever grows template
 * question copying.
 */

export type ContentLanguage = 'en' | 'es' | 'both'

export const CONTENT_LANGUAGES: readonly ContentLanguage[] = ['en', 'es', 'both']

export interface WizardOptionValues {
  /** Client-side identity, so removing the second of three options does not remount the third. */
  key: string
  labelEn: string
  labelEs: string
}

/**
 * One point on an emoji scale, as the author edits it (#198).
 *
 * The glyph and the label are two fields because they are two things: the glyph is
 * what a respondent sees and the label is what a screen reader says, and the server
 * refuses a face that has only the first. Deliberately NOT `WizardOptionValues` with
 * the emoji stuffed into `labelEn`, which is the shape #198 rejected.
 *
 * There is no `value` field. The server numbers the scale by position (1..n) when the
 * author does not say, and exposing the number here would invite two faces that differ
 * only in a value nobody can see — the same argument the plain option editor makes for
 * hiding its derived value.
 */
export interface WizardEmojiOptionValues {
  key: string
  emoji: string
  labelEn: string
  labelEs: string
}

export interface WizardQuestionValues {
  key: string
  textEn: string
  textEs: string
  type: string
  required: boolean
  options: WizardOptionValues[]
  /** Only meaningful on `emoji_rating`; the server rejects it on any other type. */
  emojiOptions: WizardEmojiOptionValues[]
}

export interface MicroclimateWizardValues {
  language: ContentLanguage
  titleEn: string
  titleEs: string
  descriptionEn: string
  descriptionEs: string
  /** `<input type="datetime-local">` text, e.g. `2026-08-07T10:30`. Local wall clock. */
  startTime: string
  endTime: string
  targetParticipantCount: string
  anonymousResponses: boolean
  templateId: string
  questions: WizardQuestionValues[]
}

export const WIZARD_STEPS = ['basics', 'schedule', 'audience', 'questions', 'review'] as const

export type WizardStepId = (typeof WIZARD_STEPS)[number]

export function emptyOption(key: string): WizardOptionValues {
  return { key, labelEn: '', labelEs: '' }
}

export function emptyEmojiOption(key: string): WizardEmojiOptionValues {
  return { key, emoji: '', labelEn: '', labelEs: '' }
}

/**
 * A four-point scale, prefilled, for an author who has just picked `emoji_rating`.
 *
 * The glyphs are seeded and the labels are NOT: a default label would be English copy
 * living in a `.ts` module (which the #217 guard rejects, correctly), and — more to the
 * point — a prefilled name is a name nobody chose, on the one field whose whole job is
 * to say what this face means in this question. The author fills it in or the server
 * refuses the question.
 */
export function defaultEmojiScale(nextKey: () => string): WizardEmojiOptionValues[] {
  return ['\u{1F622}', '\u{1F610}', '\u{1F642}', '\u{1F929}'].map((emoji) => ({
    ...emptyEmojiOption(nextKey()),
    emoji,
  }))
}

export function emptyQuestion(key: string): WizardQuestionValues {
  return {
    key,
    textEn: '',
    textEs: '',
    type: DEFAULT_QUESTION_TYPE,
    required: true,
    options: [],
    emojiOptions: [],
  }
}

/**
 * One picked library item (#115), as a question this wizard can edit.
 *
 * The sibling of `features/surveys/wizardValues.ts`'s function of the same name, and
 * deliberately not shared with it: the two question shapes differ, and the whole
 * point of #115 is that the PICKER is one component, not that the two wizards become
 * one. That file carries the full argument.
 *
 * ## Two things a microclimate cannot carry, stated rather than silently dropped
 *
 * - **The dimension.** `MicroclimateQuestion` has no `Category` column, so
 *   `item.dimension` has nowhere to go. A library item's dimension is shown in the
 *   picker and lost on the way in here; the picker is honest about it because the
 *   chip is visibly a property of the LIBRARY item, not of the question being built.
 * - **The scale-end labels.** `CreateQuestionInput` has no `scaleLabelMin`/`Max` —
 *   the microclimate write DTO never had them — so a likert item's words arrive
 *   nowhere. Faking them into the text would change the question.
 *
 * Both are backend gaps rather than choices made here, and both are reported rather
 * than worked around.
 */
export function questionFromLibrary(
  item: QuestionLibraryItemDetail,
  key: string,
): WizardQuestionValues {
  return {
    key,
    textEn: item.textEn,
    textEs: item.textEs,
    type: item.type,
    required: true,
    options: item.options.map((option, index) => ({
      key: `${key}-o${index}`,
      labelEn: option.labelEn ?? option.value,
      labelEs: option.labelEs ?? '',
    })),
    // A library item can never be `emoji_rating`: `QuestionRepositoryTypes.Supported` is
    // the INTERSECTION of both wizards' vocabularies, and surveys do not accept the type,
    // so the picker cannot offer one. Empty rather than mapped from a field that does not
    // exist on `QuestionLibraryItemDetail`.
    emojiOptions: [],
  }
}

/**
 * `language` is seeded from the company rather than defaulted to English here — the
 * page passes it in, because the server's own default is `company.Settings.Language`
 * and guessing differently in the form would silently disagree with a request that
 * omitted the field.
 */
export function emptyWizardValues(language: ContentLanguage): MicroclimateWizardValues {
  return {
    language,
    titleEn: '',
    titleEs: '',
    descriptionEn: '',
    descriptionEs: '',
    startTime: '',
    endTime: '',
    targetParticipantCount: '10',
    anonymousResponses: true,
    templateId: '',
    questions: [],
  }
}

/** True when both language columns have to be filled in. */
export function needsBothLanguages(language: ContentLanguage): boolean {
  return language === 'both'
}

/**
 * Builds the wire shape for one localized field.
 *
 * A single-language microclimate sends a **bare string**, which `LocalizedInput`
 * attributes to the content's own language. A bilingual one must send the map:
 * `TryResolve` rejects a bare string when the content is authored in `both`, on the
 * grounds that filing Spanish text in the English column is worse than a 400.
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
 * Mirrors `MicroclimateContent.DeriveOptionValue`: the stable value is the English
 * label, or the Spanish one when there is no English. Reproduced rather than
 * approximated because the duplicate check below has to compare the same strings the
 * server will, or it flags pairs the server accepts and misses pairs it rejects.
 */
export function derivedOptionValue(option: WizardOptionValues): string | null {
  const en = option.labelEn.trim()
  if (en.length > 0) return en
  const es = option.labelEs.trim()
  return es.length > 0 ? es : null
}

function isBlank(value: string): boolean {
  return value.trim().length === 0
}

function titleErrors(values: MicroclimateWizardValues, t: TranslateFn): string[] {
  if (needsBothLanguages(values.language)) {
    return isBlank(values.titleEn) || isBlank(values.titleEs)
      ? [t('microclimates.validationTitleBoth')]
      : []
  }
  const single = values.language === 'es' ? values.titleEs : values.titleEn
  return isBlank(single) ? [t('microclimates.validationTitleRequired')] : []
}

function scheduleErrors(values: MicroclimateWizardValues, t: TranslateFn): string[] {
  const errors: string[] = []
  if (isBlank(values.startTime)) errors.push(t('microclimates.validationStartRequired'))
  if (isBlank(values.endTime)) errors.push(t('microclimates.validationEndRequired'))
  if (errors.length > 0) return errors

  // Compared as parsed dates rather than as strings: `datetime-local` text sorts
  // correctly only while both values have the same shape, and a browser that emits
  // seconds ("10:30:00") for one field and not the other breaks a string compare.
  const start = new Date(values.startTime).getTime()
  const end = new Date(values.endTime).getTime()
  if (Number.isFinite(start) && Number.isFinite(end) && end <= start) {
    errors.push(t('microclimates.validationEndAfterStart'))
  }
  return errors
}

function audienceErrors(values: MicroclimateWizardValues, t: TranslateFn): string[] {
  const target = Number(values.targetParticipantCount)
  return Number.isInteger(target) && target >= 1
    ? []
    : [t('microclimates.validationTargetPositive')]
}

function questionErrors(values: MicroclimateWizardValues, t: TranslateFn): string[] {
  if (values.questions.length === 0) {
    return [t('microclimates.validationQuestionsRequired')]
  }

  const errors: string[] = []
  values.questions.forEach((question, index) => {
    // 1-based, matching the `order` the server puts in its own messages, so an admin
    // who gets through to a 400 reads the same number in both places.
    const order = index + 1

    if (needsBothLanguages(values.language)) {
      if (isBlank(question.textEn) || isBlank(question.textEs)) {
        errors.push(t('microclimates.validationQuestionTextBoth', { order }))
      }
    } else {
      const single = values.language === 'es' ? question.textEs : question.textEn
      if (isBlank(single)) {
        errors.push(t('microclimates.validationQuestionText', { order }))
      }
    }

    if (question.type === 'emoji_rating') {
      // Mirrors the server's three refusals, in the order it applies them, so the author
      // reads the message beside the field instead of after a failed request: a scale
      // needs at least two faces, every face needs a glyph, and every face needs a
      // label -- the label being the option's accessible name is the reason the type
      // has its own table at all (#198).
      const faces = question.emojiOptions
      if (faces.filter((face) => face.emoji.trim().length > 0).length < 2) {
        errors.push(t('microclimates.validationEmojiOptionsMin2', { order }))
        return
      }

      faces.forEach((face, faceIndex) => {
        const number = faceIndex + 1
        if (isBlank(face.emoji)) {
          errors.push(t('microclimates.validationEmojiRequired', { order, number }))
          return
        }

        if (needsBothLanguages(values.language)) {
          if (isBlank(face.labelEn) || isBlank(face.labelEs)) {
            errors.push(t('microclimates.validationEmojiLabelBoth', { order, number }))
          }
          return
        }

        const single = values.language === 'es' ? face.labelEs : face.labelEn
        if (isBlank(single)) {
          errors.push(t('microclimates.validationEmojiLabel', { order, number }))
        }
      })
      return
    }

    if (question.type !== 'multiple_choice') return

    const optionValues = question.options
      .map(derivedOptionValue)
      .filter((value): value is string => value !== null)
    if (optionValues.length < 2) {
      errors.push(t('microclimates.validationOptionsMin2', { order }))
      return
    }

    // Ordinal comparison, matching the server's `StringComparison.Ordinal`.
    const seen = new Set<string>()
    for (const value of optionValues) {
      if (seen.has(value)) {
        errors.push(t('microclimates.validationOptionsDuplicate', { order, option: value }))
        break
      }
      seen.add(value)
    }
  })

  return errors
}

/**
 * Every step's blocking problems, recomputed from the current values.
 *
 * Derived rather than stored, so correcting a field clears its message with no extra
 * wiring — see `WizardStepper`, which keeps no copy of these either.
 *
 * The review step carries the union of the others. It is unreachable while any of
 * them fails, so in practice it is always empty there; it exists as a backstop so
 * `onSubmit` cannot fire on invalid values if the step list ever gains a shortcut.
 */
export function wizardStepErrors(
  values: MicroclimateWizardValues,
  t: TranslateFn,
): Record<WizardStepId, string[]> {
  const basics = titleErrors(values, t)
  const schedule = scheduleErrors(values, t)
  const audience = audienceErrors(values, t)
  const questions = questionErrors(values, t)

  return {
    basics,
    schedule,
    audience,
    questions,
    review: [...basics, ...schedule, ...audience, ...questions],
  }
}

/** Minutes the session runs for, or null when either end is missing or unparseable. */
export function scheduledMinutes(values: MicroclimateWizardValues): number | null {
  if (isBlank(values.startTime) || isBlank(values.endTime)) return null
  const start = new Date(values.startTime).getTime()
  const end = new Date(values.endTime).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return Math.round((end - start) / 60000)
}

function toCreateQuestion(
  question: WizardQuestionValues,
  language: ContentLanguage,
  order: number,
): CreateQuestionInput {
  const text = localizedFor(language, question.textEn, question.textEs)
  const options =
    question.type === 'multiple_choice'
      ? question.options
          .filter((option) => derivedOptionValue(option) !== null)
          .map((option) => ({ label: localizedFor(language, option.labelEn, option.labelEs) ?? '' }))
      : undefined

  // Sent only for `emoji_rating`. The server REJECTS an emoji scale on any other type
  // rather than ignoring it, so a question that changed type after its faces were typed
  // must not carry them along -- and rejecting rather than dropping is what makes that
  // rule worth having on the server.
  const emojiOptions =
    question.type === 'emoji_rating'
      ? question.emojiOptions
          .filter((face) => face.emoji.trim().length > 0)
          .map((face) => ({
            emoji: face.emoji.trim(),
            // No `value`: the server numbers the scale by position. See
            // WizardEmojiOptionValues for why the number is not an authored field.
            label: localizedFor(language, face.labelEn, face.labelEs) ?? '',
          }))
      : undefined

  return {
    // `text` is non-null by the time this runs: `wizardStepErrors` gates the submit.
    // The `?? ''` is the type-level acknowledgement, not a fallback anyone should hit
    // -- an empty string is rejected by the server rather than stored.
    text: text ?? '',
    type: question.type,
    options,
    required: question.required,
    order,
    emojiOptions,
  }
}

/**
 * The POST body.
 *
 * `timezone` is left off on purpose: `createMicroclimate` fills it from
 * `Intl.DateTimeFormat().resolvedOptions().timeZone`, and it also converts the two
 * `datetime-local` strings to UTC there. Doing either here would be a second place
 * that has to know about the offset problem, which is exactly how the wall-clock bug
 * that comment describes comes back.
 */
export function buildCreateInput(
  values: MicroclimateWizardValues,
  companyId: string,
): CreateMicroclimateInput {
  const description = localizedFor(values.language, values.descriptionEn, values.descriptionEs)
  const hasDescription =
    typeof description === 'string'
      ? description.length > 0
      : Boolean(description && (description.en || description.es))

  return {
    title: localizedFor(values.language, values.titleEn, values.titleEs) ?? '',
    description: hasDescription ? description : undefined,
    companyId,
    startTime: values.startTime,
    endTime: values.endTime,
    targetParticipantCount: Number(values.targetParticipantCount),
    anonymousResponses: values.anonymousResponses,
    templateId: values.templateId === '' ? undefined : values.templateId,
    questions: values.questions.map((question, index) =>
      toCreateQuestion(question, values.language, index + 1),
    ),
    language: values.language,
  }
}
