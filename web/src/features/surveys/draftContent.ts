import type { LocalizedInput } from './api/surveyCreate'
import type { ContentLanguage, SurveyQuestionValues, SurveyWizardValues } from './wizardValues'
import { CONTENT_LANGUAGES, emptyWizardValues } from './wizardValues'

/**
 * The survey wizard's state as it is written to and read back from
 * `SurveyDraft.content` (#266).
 *
 * ## Why this is not just `JSON.stringify(values)`
 *
 * `content` is arbitrary JSON the server stores verbatim and never interprets, which
 * makes it the one part of the draft that no server-side validation protects. Three
 * consequences shape everything below.
 *
 * **1. The wire shape is written out by hand.** Persisting `SurveyWizardValues`
 * directly would make every rename in the wizard a silent change to a format already
 * sitting in the database — drafts live for the whole retention window, so the parser
 * will meet last week's shape. `version` is here so a future change can be detected
 * rather than guessed at.
 *
 * **2. Parsing never throws and never half-succeeds.** Whatever is in that column
 * arrives as `unknown`. A draft written by an older wizard, hand-edited, or truncated
 * must produce "nothing to recover" — a white screen on the create page would be a
 * worse outcome than the lost draft this feature exists to prevent.
 *
 * **3. Keys are not persisted.** `SurveyQuestionValues.key` is client-side React
 * identity minted from `useId()`, meaningless in another session, and actively
 * dangerous to restore: the page mints its own as `${prefix}-${n}`, so a stored key
 * from a previous mount with the same `useId` prefix could collide with a freshly
 * minted one and make React reconcile two different questions onto one node. Restored
 * keys are regenerated in a shape (`${prefix}-q0-o1`) that the page's counter can never
 * produce.
 *
 * ## What is deliberately NOT restored from Tier 1
 *
 * `SurveyDraftDetail.title` and `.description` come back resolved to a single locale,
 * so a `'both'` draft's other language is not in them. They exist to give the recovery
 * banner something to name the draft with. The lossless copy is here, in `content`, and
 * this module is the only thing that reads it.
 */

export const SURVEY_DRAFT_CONTENT_VERSION = 1

interface DraftOption {
  labelEn: string
  labelEs: string
}

interface DraftQuestion {
  textEn: string
  textEs: string
  type: string
  required: boolean
  options: DraftOption[]
  /**
   * These five joined the wire shape with the dimension picker and the scale-ends
   * fields, WITHOUT a `version` bump, deliberately: they are additive, and the
   * parser below is forgiving about absent fields ("losing one field is
   * recoverable by retyping it"). An old draft restores with blanks — exactly what
   * its author had — while a bump would make every existing draft in the retention
   * window unrecoverable for the sake of fields it never held.
   */
  category: string
  scaleLabelMinEn: string
  scaleLabelMinEs: string
  scaleLabelMaxEn: string
  scaleLabelMaxEs: string
}

/** The wire shape. Changing a member here changes what is already in the database. */
export interface SurveyDraftContent {
  version: number
  /** '' for a blank survey. Restoring this wrong turns a template survey into a blank one. */
  templateId: string
  language: ContentLanguage
  titleEn: string
  titleEs: string
  descriptionEn: string
  descriptionEs: string
  type: string
  startDate: string
  endDate: string
  departmentIds: string[]
  targetAudienceCount: string
  anonymous: boolean
  allowPartialResponses: boolean
  showProgress: boolean
  questions: DraftQuestion[]
}

/** The wizard's current state, ready to be sent as `content`. Keys are dropped. */
export function toDraftContent(values: SurveyWizardValues): SurveyDraftContent {
  return {
    version: SURVEY_DRAFT_CONTENT_VERSION,
    templateId: values.templateId,
    language: values.language,
    titleEn: values.titleEn,
    titleEs: values.titleEs,
    descriptionEn: values.descriptionEn,
    descriptionEs: values.descriptionEs,
    type: values.type,
    startDate: values.startDate,
    endDate: values.endDate,
    departmentIds: [...values.departmentIds],
    targetAudienceCount: values.targetAudienceCount,
    anonymous: values.anonymous,
    allowPartialResponses: values.allowPartialResponses,
    showProgress: values.showProgress,
    questions: values.questions.map((question) => ({
      textEn: question.textEn,
      textEs: question.textEs,
      type: question.type,
      required: question.required,
      options: question.options.map((option) => ({
        labelEn: option.labelEn,
        labelEs: option.labelEs,
      })),
      category: question.category,
      scaleLabelMinEn: question.scaleLabelMinEn,
      scaleLabelMinEs: question.scaleLabelMinEs,
      scaleLabelMaxEn: question.scaleLabelMaxEn,
      scaleLabelMaxEs: question.scaleLabelMaxEs,
    })),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A stored string, or the fallback. Anything non-string is treated as absent. */
function str(source: Record<string, unknown>, key: string, fallback = ''): string {
  const value = source[key]
  return typeof value === 'string' ? value : fallback
}

function bool(source: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = source[key]
  return typeof value === 'boolean' ? value : fallback
}

function stringArray(source: Record<string, unknown>, key: string): string[] {
  const value = source[key]
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function language(source: Record<string, unknown>, fallback: ContentLanguage): ContentLanguage {
  const value = source.language
  return CONTENT_LANGUAGES.includes(value as ContentLanguage) ? (value as ContentLanguage) : fallback
}

function questionsFrom(source: Record<string, unknown>, keyPrefix: string): SurveyQuestionValues[] {
  const raw = source.questions
  if (!Array.isArray(raw)) return []

  // Index-based keys off the *surviving* rows, not the raw ones: filtering a malformed
  // entry out after keying would leave a gap, and two mounts disagreeing about which
  // index a question has is the reconciliation bug this file's header warns about.
  return raw.filter(isRecord).map((question, index) => {
    const options = Array.isArray(question.options) ? question.options.filter(isRecord) : []
    return {
      key: `${keyPrefix}-q${index}`,
      textEn: str(question, 'textEn'),
      textEs: str(question, 'textEs'),
      // No vocabulary check: an unknown type is preserved and refused by the server on
      // create, with its own message. Silently rewriting it to the default would change
      // the author's question without telling them.
      type: str(question, 'type'),
      required: bool(question, 'required', true),
      options: options.map((option, optionIndex) => ({
        key: `${keyPrefix}-q${index}-o${optionIndex}`,
        labelEn: str(option, 'labelEn'),
        labelEs: str(option, 'labelEs'),
      })),
      // Absent in drafts written before the dimension picker and the scale-ends
      // fields existed; blank is what their author had.
      category: str(question, 'category'),
      scaleLabelMinEn: str(question, 'scaleLabelMinEn'),
      scaleLabelMinEs: str(question, 'scaleLabelMinEs'),
      scaleLabelMaxEn: str(question, 'scaleLabelMaxEn'),
      scaleLabelMaxEs: str(question, 'scaleLabelMaxEs'),
    }
  })
}

/**
 * The wizard state stored in a draft, or `null` when there is nothing usable there.
 *
 * `null` — not a partially filled form — is the answer for anything this cannot read:
 * a missing or newer `version`, a non-object payload, `null` because the draft was
 * created before its first edit. The caller treats that as "nothing to recover".
 *
 * Individual *fields* are forgiving where the shape is right: a question row missing
 * `textEs` restores with an empty Spanish column rather than discarding the draft.
 * Losing one field is recoverable by retyping it; losing the draft is what this feature
 * exists to prevent.
 */
export function draftValuesFrom(
  content: unknown,
  keyPrefix: string,
  fallbackLanguage: ContentLanguage,
): SurveyWizardValues | null {
  if (!isRecord(content)) return null
  if (content.version !== SURVEY_DRAFT_CONTENT_VERSION) return null

  const defaults = emptyWizardValues(fallbackLanguage)

  return {
    templateId: str(content, 'templateId'),
    language: language(content, fallbackLanguage),
    titleEn: str(content, 'titleEn'),
    titleEs: str(content, 'titleEs'),
    descriptionEn: str(content, 'descriptionEn'),
    descriptionEs: str(content, 'descriptionEs'),
    type: str(content, 'type', defaults.type),
    startDate: str(content, 'startDate'),
    endDate: str(content, 'endDate'),
    departmentIds: stringArray(content, 'departmentIds'),
    targetAudienceCount: str(content, 'targetAudienceCount'),
    anonymous: bool(content, 'anonymous', defaults.anonymous),
    allowPartialResponses: bool(content, 'allowPartialResponses', defaults.allowPartialResponses),
    showProgress: bool(content, 'showProgress', defaults.showProgress),
    questions: questionsFrom(content, keyPrefix),
  }
}

/**
 * The Tier 1 `title`/`description` a draft save sends alongside `content`.
 *
 * Close to `localizedFor` but deliberately not it, in the one way that matters: it never
 * returns `undefined`. `SurveyDraftEndpoints.BuildEnvelope` merges an omitted field into
 * the stored one, so clearing the title in a single-language draft would leave the old
 * text on the row and the recovery banner would keep offering a draft under a name it no
 * longer has. An empty string clears it.
 *
 * The object form for `'both'` is not optional either: `TryResolve` rejects a bare string
 * against a bilingual draft with a 400, which would stop autosave dead.
 */
export function draftLocalized(
  language: ContentLanguage,
  en: string,
  es: string,
): LocalizedInput {
  if (language === 'both') return { en: en.trim(), es: es.trim() }
  return (language === 'es' ? es : en).trim()
}

/**
 * Whether these values are worth saving or offering back.
 *
 * Opening the wizard and walking away must not leave a draft, and must not raise a
 * recovery banner on the next visit offering an empty form back — a prompt that
 * restores nothing teaches people to dismiss the prompt.
 *
 * `language` and `type` are excluded on purpose: both are seeded rather than typed, so
 * counting them would make every untouched form look edited. The three booleans are
 * excluded for the same reason — they arrive pre-checked.
 */
export function hasDraftableContent(values: SurveyWizardValues): boolean {
  if (
    values.titleEn.trim().length > 0 ||
    values.titleEs.trim().length > 0 ||
    values.descriptionEn.trim().length > 0 ||
    values.descriptionEs.trim().length > 0 ||
    values.startDate.length > 0 ||
    values.endDate.length > 0 ||
    values.targetAudienceCount.trim().length > 0 ||
    values.departmentIds.length > 0 ||
    // Choosing a template IS the survey in template mode -- there are no questions of
    // one's own to count, so leaving this out would mean a template survey with no title
    // yet was never saved and never offered back.
    values.templateId.length > 0
  ) {
    return true
  }
  return values.questions.length > 0
}
