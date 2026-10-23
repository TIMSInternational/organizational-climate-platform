import type { TranslateFn } from '../../../i18n'
import type { SurveyQuestion } from '../api/surveys'
import { languageLabel, questionTypeLabel, statusLabel, typeLabel } from '../surveyVocabulary'
import { dimensionLabel } from '../dimensionLabel'
import type { SurveyAuditEntry, SurveyVersionDetail } from './api'

/**
 * Pure rules behind `/surveys/:id/history`: the Spanish (or English) name of every field path
 * `SurveyVersioning.Diff` can emit, the before/after value of each between two versions, and
 * the one-line reading of an audit entry. Nothing here reads a response, a count of responses
 * or anything a respondent wrote — only what an administrator authored.
 */

export const K = 'surveys.next.history'

/** `settings.<name>` paths the diff emits, each with the way its value is printed. */
const SETTINGS: Record<string, 'bool' | 'number' | 'text' | 'days' | 'minutes'> = {
  anonymous: 'bool',
  allowPartialResponses: 'bool',
  randomizeQuestions: 'bool',
  showProgress: 'bool',
  autoSave: 'bool',
  timeLimitMinutes: 'minutes',
  responseLimit: 'number',
  selfDeclaredDemographics: 'bool',
  collectParticipantIdentity: 'bool',
  notificationSendInvitations: 'bool',
  notificationSendReminders: 'bool',
  notificationReminderFrequencyDays: 'days',
  invitationCustomMessage: 'text',
  invitationCustomSubject: 'text',
  invitationIncludeCredentials: 'bool',
  invitationSendImmediately: 'bool',
  invitationBrandingEnabled: 'bool',
  oneSessionOnly: 'bool',
  respondentIntro: 'text',
  closingMessage: 'text',
}

/** `questions[<order>].<part>` parts the diff emits (`SurveyVersioning.DiffQuestions`). */
const QUESTION_PARTS = [
  'added',
  'removed',
  'type',
  'text',
  'scaleMin',
  'scaleMax',
  'scaleLabelMin',
  'scaleLabelMax',
  'required',
  'commentRequired',
  'commentPrompt',
  'category',
  'options',
] as const
type QuestionPart = (typeof QUESTION_PARTS)[number]

const TOP_LEVEL = ['title', 'description', 'type', 'language', 'startDate', 'endDate', 'targetAudienceCount', 'departmentIds'] as const
type TopLevel = (typeof TOP_LEVEL)[number]

export type ParsedPath =
  | { kind: 'field'; field: TopLevel }
  | { kind: 'setting'; name: string }
  | { kind: 'question'; order: number; part: QuestionPart }
  | { kind: 'unknown' }

export function parsePath(path: string): ParsedPath {
  if ((TOP_LEVEL as readonly string[]).includes(path)) return { kind: 'field', field: path as TopLevel }
  if (path.startsWith('settings.') && path.slice('settings.'.length) in SETTINGS) {
    return { kind: 'setting', name: path.slice('settings.'.length) }
  }
  const question = /^questions\[(-?\d+)\]\.([A-Za-z]+)$/.exec(path)
  if (question && (QUESTION_PARTS as readonly string[]).includes(question[2])) {
    return { kind: 'question', order: Number(question[1]), part: question[2] as QuestionPart }
  }
  return { kind: 'unknown' }
}

/**
 * Where a question at `order` sits in a version, counted from 1 — what an administrator calls
 * "pregunta 3". `order` itself is the storage key and may start at 0; a version that does not
 * hold the question gives `null`.
 */
export function positionOf(questions: readonly SurveyQuestion[] | null, order: number): number | null {
  if (!questions) return null
  const sorted = [...questions].sort((a, b) => a.order - b.order)
  const index = sorted.findIndex((question) => question.order === order)
  return index === -1 ? null : index + 1
}

/**
 * The reader's name for one field path. `position` is the question's place (1-based) when the
 * caller can work it out from a version; an audit entry carries only the path, so it falls
 * back to counting from the stored order.
 */
export function fieldLabel(t: TranslateFn, path: string, position?: number | null): string {
  const parsed = parsePath(path)
  switch (parsed.kind) {
    case 'field':
      return t(`${K}.field.${parsed.field}`)
    case 'setting':
      return t(`${K}.setting.${parsed.name}`)
    case 'question':
      return t(`${K}.question.${parsed.part}`, { number: position ?? parsed.order + 1 })
    default:
      return t(`${K}.field.other`)
  }
}

/** Formats an instant on the company's clock, to the minute, with the zone's short name. */
export function formatInstant(iso: string, timeZone: string, locale: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-CR' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(date)
}

export function isKnownTimeZone(zone: string | null | undefined): zone is string {
  if (!zone) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

export interface ValueContext {
  t: TranslateFn
  locale: string
  timeZone: string
}

const EMPTY = '—'

function yesNo(t: TranslateFn, value: unknown): string {
  return value === true ? t(`${K}.value.yes`) : value === false ? t(`${K}.value.no`) : EMPTY
}

function text(value: unknown): string {
  return typeof value === 'string' && value.trim() !== '' ? value : EMPTY
}

function settingValue(ctx: ValueContext, name: string, value: unknown): string {
  if (value === null || value === undefined) return EMPTY
  switch (SETTINGS[name]) {
    case 'bool':
      return yesNo(ctx.t, value)
    case 'minutes':
      return ctx.t(`${K}.value.minutes`, { count: Number(value) })
    case 'days':
      return ctx.t(`${K}.value.days`, { count: Number(value) })
    case 'number':
      return String(value)
    default:
      return text(value)
  }
}

function optionsValue(question: SurveyQuestion): string {
  const options = [...(question.options ?? [])].sort((a, b) => a.order - b.order)
  return options.length === 0 ? EMPTY : options.map((option) => option.label ?? option.value).join(' · ')
}

function questionValue(ctx: ValueContext, question: SurveyQuestion | undefined, part: QuestionPart): string {
  if (!question) return EMPTY
  switch (part) {
    case 'added':
    case 'removed':
    case 'text':
      return text(question.text)
    case 'type':
      return questionTypeLabel(ctx.t, question.type)
    case 'scaleMin':
      return question.scaleMin === null ? EMPTY : String(question.scaleMin)
    case 'scaleMax':
      return question.scaleMax === null ? EMPTY : String(question.scaleMax)
    case 'scaleLabelMin':
      return text(question.scaleLabelMin)
    case 'scaleLabelMax':
      return text(question.scaleLabelMax)
    case 'required':
      return yesNo(ctx.t, question.required)
    case 'commentRequired':
      return yesNo(ctx.t, question.commentRequired)
    case 'commentPrompt':
      return text(question.commentPrompt)
    case 'category':
      return question.category ? dimensionLabel(question.category, ctx.t) : EMPTY
    case 'options':
      return optionsValue(question)
  }
}

function fieldValue(ctx: ValueContext, version: SurveyVersionDetail, field: TopLevel): string {
  switch (field) {
    case 'title':
      return text(version.title)
    case 'description':
      return text(version.description)
    case 'type':
      return typeLabel(ctx.t, version.type)
    case 'language':
      return languageLabel(ctx.t, version.language)
    case 'startDate':
      return formatInstant(version.startDate, ctx.timeZone, ctx.locale)
    case 'endDate':
      return formatInstant(version.endDate, ctx.timeZone, ctx.locale)
    case 'targetAudienceCount':
      return version.targetAudienceCount === null ? EMPTY : String(version.targetAudienceCount)
    case 'departmentIds':
      return version.departmentIds.length === 0
        ? ctx.t(`${K}.value.wholeCompany`)
        : ctx.t(version.departmentIds.length === 1 ? `${K}.value.departmentsOne` : `${K}.value.departments`, {
            count: version.departmentIds.length,
          })
  }
}

export interface ChangeRow {
  path: string
  label: string
  /** `null` when the field did not exist on that side (a question added or removed). */
  before: string | null
  after: string | null
}

/**
 * One row per path the server says differs between `from` and `to`, in the server's order,
 * each with the value on both sides as the reader would see it. A question that was added has
 * no "before"; one that was removed has no "after".
 */
export function changeRows(ctx: ValueContext, from: SurveyVersionDetail, to: SurveyVersionDetail, paths: readonly string[]): ChangeRow[] {
  return paths.map((path) => {
    const parsed = parsePath(path)
    switch (parsed.kind) {
      case 'field':
        return { path, label: fieldLabel(ctx.t, path), before: fieldValue(ctx, from, parsed.field), after: fieldValue(ctx, to, parsed.field) }
      case 'setting': {
        const before = (from.settings as unknown as Record<string, unknown>)[parsed.name]
        const after = (to.settings as unknown as Record<string, unknown>)[parsed.name]
        return { path, label: fieldLabel(ctx.t, path), before: settingValue(ctx, parsed.name, before), after: settingValue(ctx, parsed.name, after) }
      }
      case 'question': {
        const was = from.questions.find((question) => question.order === parsed.order)
        const now = to.questions.find((question) => question.order === parsed.order)
        const position = parsed.part === 'removed' ? positionOf(from.questions, parsed.order) : positionOf(to.questions, parsed.order)
        return {
          path,
          label: fieldLabel(ctx.t, path, position),
          before: parsed.part === 'added' ? null : questionValue(ctx, was, parsed.part),
          after: parsed.part === 'removed' ? null : questionValue(ctx, now, parsed.part),
        }
      }
      default:
        return { path, label: fieldLabel(ctx.t, path), before: null, after: null }
    }
  })
}

/** A role's display name, or the code when the screen ships none for it. */
export function roleName(t: TranslateFn, role: string): string {
  const key = `${K}.role.${role}`
  const name = t(key)
  return name === key ? role : name
}

/** The headline of one audit entry: what happened, in the reader's words. */
export function entryHeadline(t: TranslateFn, entry: SurveyAuditEntry): string {
  const changes = entry.changes
  switch (entry.action) {
    case 'created':
      return t(`${K}.action.created`)
    case 'updated': {
      const count = changes?.fields?.length ?? 0
      return count === 0 ? t(`${K}.action.updatedNoFields`) : t(count === 1 ? `${K}.action.updatedOne` : `${K}.action.updated`, { count })
    }
    case 'status_changed':
      return changes?.from && changes?.to
        ? t(`${K}.action.statusChanged`, { from: statusLabel(t, changes.from), to: statusLabel(t, changes.to) })
        : t(`${K}.action.statusChangedBare`)
    case 'duplicated':
      return t(`${K}.action.duplicated`)
    case 'version_created':
      return typeof changes?.versionNumber === 'number'
        ? t(`${K}.action.versionCreated`, { number: changes.versionNumber })
        : t(`${K}.action.versionCreatedBare`)
    default:
      return t(`${K}.action.other`)
  }
}

/** The reason a version was taken, in the reader's words. */
export function reasonLabel(t: TranslateFn, reason: string): string {
  return reason === 'publish' || reason === 'republish' ? t(`${K}.reason.${reason}`) : t(`${K}.reason.other`)
}
