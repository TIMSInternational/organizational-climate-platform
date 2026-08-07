import { authFetch } from '../../../api/authFetch'
import { NOTIFICATION_CHANNELS, type NotificationChannel, type NotificationType } from './notifications'

/**
 * Typed client for `/notification-templates` (NotificationTemplateEndpoints.cs, #96).
 *
 * Re-exported rather than re-listed: a template may target **every** channel the schema
 * recognises, including `push`, which dispatch cannot deliver on yet. That difference is
 * the point — authoring is allowed to get ahead of delivery — so a template form reads
 * this list and a dispatch form reads `DISPATCHABLE_NOTIFICATION_CHANNELS`.
 */
export { NOTIFICATION_CHANNELS }
export type { NotificationChannel }

/**
 * The write shape of a paired-column field (#195).
 *
 * A bare string is attributed to the template's own content language; a locale map is
 * explicit. There is no `subjectEn`/`subjectEs` anywhere in this module, on either side
 * of the wire — that constraint is what keeps a third language a migration rather than a
 * frontend rewrite.
 */
export type LocalizedInput = string | Partial<Record<'en' | 'es', string>>

/**
 * A variable a template declares.
 *
 * `defaultValue` is stored in a `jsonb` column, so it is a JSON **document** serialised
 * to a string (`'"Acme"'`, `'42'`), not a bare display value. The server rejects anything
 * unparseable rather than letting Postgres raise a 22P02 and surface as a 500.
 */
export interface NotificationTemplateVariable {
  id: string
  name: string
  type: string
  required: boolean
  description: string
  defaultValue: string | null
}

/**
 * A personalization rule as stored.
 *
 * `condition` is a single comparison from a whitelist grammar, validated on write and
 * re-parsed at evaluation time. It is never executed as code — the legacy implementation
 * handed it to the JavaScript `Function` constructor, and nothing in this stack does that
 * any more, so a client must not evaluate one either. `modifications` is opaque JSON.
 */
export interface NotificationPersonalizationRule {
  id: string
  condition: string
  modifications: string | null
}

/**
 * A row of `GET /notification-templates` — seven columns, no body fields.
 *
 * Deliberately a separate type from `NotificationTemplateDetail`: the list projection
 * carries no `subject`/`content` and no localisation reporting, and typing it as the
 * detail would promise a page fields that arrive `undefined` with a clean typecheck.
 *
 * `companyId` is `null` for a global template, which every tenant can read and only a
 * SuperAdmin can write.
 */
export interface NotificationTemplateListItem {
  id: string
  name: string
  type: string
  channel: string
  companyId: string | null
  isActive: boolean
  isDefault: boolean
}

/**
 * The full record. Every authored field is **already resolved** for the requested locale.
 */
export interface NotificationTemplateDetail {
  id: string
  name: string
  type: string
  channel: string
  /** Email is the only channel with a subject line. */
  subject: string | null
  title: string | null
  content: string | null
  htmlContent: string | null
  companyId: string | null
  isActive: boolean
  isDefault: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
  variables: NotificationTemplateVariable[]
  rules: NotificationPersonalizationRule[]
  /**
   * The language the template is authored in: `'en' | 'es' | 'both'`. Derived, not
   * stored — a company template inherits its company's language, and a global template
   * is `'both'` because it is served to every tenant regardless of theirs.
   */
  contentLanguage: string
  /** The locale the fields above were actually resolved to. */
  resolvedLocale: string
  /**
   * Fields that had to reach for another language to produce a value, e.g. `subject`.
   * Every fallback self-reports rather than silently substituting English into a Spanish
   * email, so an editor can be shown which translations are still missing.
   */
  fallbackFields: string[]
}

export interface NotificationTemplateVariableInput {
  name: string
  type: string
  required: boolean
  description?: string
  /** A JSON document, not a bare value — see `NotificationTemplateVariable.defaultValue`. */
  defaultValue?: string
}

export interface NotificationPersonalizationRuleInput {
  condition: string
  modifications?: string
}

export interface CreateNotificationTemplateInput {
  name: string
  /**
   * The server validates `channel` against a vocabulary but leaves `type` an
   * unconstrained column, because legacy rows predate the enum. Constraining it here is
   * a client-side choice: a new template authored against a typo would be created, look
   * fine, and never match the dispatch that was supposed to use it.
   */
  type: NotificationType
  channel: NotificationChannel
  subject?: LocalizedInput
  title?: LocalizedInput
  content?: LocalizedInput
  htmlContent?: LocalizedInput
  /** Omit for a global template. Only a SuperAdmin may do that. */
  companyId?: string
  /**
   * Templates are created active. Send `false` while a translation is still being
   * drafted: an active template must carry every language its content language claims,
   * and the server rejects the create otherwise.
   */
  isActive?: boolean
  isDefault?: boolean
  variables?: NotificationTemplateVariableInput[]
  rules?: NotificationPersonalizationRuleInput[]
}

/**
 * A partial update.
 *
 * An omitted localised field means "the caller did not send this locale — leave it
 * alone"; an explicit empty string blanks it. That distinction is what lets an editor
 * save a Spanish translation without wiping the English one.
 *
 * `variables` and `rules` are different: when present they **fully replace** the child
 * rows rather than being merged, so `[]` clears them and omitting them leaves them
 * untouched. Ordering-free lists cannot be diffed unambiguously.
 */
export interface UpdateNotificationTemplateInput {
  name?: string
  subject?: LocalizedInput
  title?: LocalizedInput
  content?: LocalizedInput
  htmlContent?: LocalizedInput
  isActive?: boolean
  variables?: NotificationTemplateVariableInput[]
  rules?: NotificationPersonalizationRuleInput[]
}

export interface ListNotificationTemplatesOptions {
  /**
   * SuperAdmin-only filter. A CompanyAdmin is already scoped to their own company plus
   * the global templates, and passing this does not widen that — it is ignored, not
   * honoured, so it must never be used as the tenant boundary.
   */
  companyId?: string
}

/** Read options shared by every endpoint that returns resolved content. */
export interface NotificationTemplateLocaleOptions {
  /** `'en' | 'es'`. Defaults server-side to the template's own content language. */
  lang?: string
}

function localeQuery(options: NotificationTemplateLocaleOptions): string {
  return options.lang ? `?${new URLSearchParams({ lang: options.lang }).toString()}` : ''
}

/**
 * Every template the caller may read, ordered by name.
 *
 * The optional bag goes last: a prior bug in this repo put an optional `baseUrl` before
 * the required arguments and broke five exports.
 */
export async function listNotificationTemplates(
  baseUrl: string,
  options: ListNotificationTemplatesOptions = {},
): Promise<NotificationTemplateListItem[]> {
  const query = options.companyId
    ? `?${new URLSearchParams({ companyId: options.companyId }).toString()}`
    : ''
  const response = await authFetch(`${baseUrl}/notification-templates${query}`)
  const body = (await response.json()) as { templates?: NotificationTemplateListItem[] } | null
  // The endpoint wraps the list in `{ templates: [...] }`. Defaulting rather than
  // trusting the shape keeps a malformed 200 out of a `.map` on an undefined.
  return body?.templates ?? []
}

export async function getNotificationTemplate(
  baseUrl: string,
  id: string,
  options: NotificationTemplateLocaleOptions = {},
): Promise<NotificationTemplateDetail> {
  const response = await authFetch(`${baseUrl}/notification-templates/${id}${localeQuery(options)}`)
  return (await response.json()) as NotificationTemplateDetail
}

export async function createNotificationTemplate(
  baseUrl: string,
  input: CreateNotificationTemplateInput,
  options: NotificationTemplateLocaleOptions = {},
): Promise<NotificationTemplateDetail> {
  const response = await authFetch(`${baseUrl}/notification-templates${localeQuery(options)}`, {
    method: 'POST',
    // Passed through rather than rebuilt field by field: `JSON.stringify` drops
    // `undefined` properties, so an omitted locale stays omitted and keeps its
    // "leave as stored" meaning. Naming each field would send an explicit `null`
    // instead, which on update is the request that wipes a translation.
    body: JSON.stringify(input),
  })
  return (await response.json()) as NotificationTemplateDetail
}

export async function updateNotificationTemplate(
  baseUrl: string,
  id: string,
  input: UpdateNotificationTemplateInput,
  options: NotificationTemplateLocaleOptions = {},
): Promise<NotificationTemplateDetail> {
  const response = await authFetch(
    `${baseUrl}/notification-templates/${id}${localeQuery(options)}`,
    { method: 'PUT', body: JSON.stringify(input) },
  )
  return (await response.json()) as NotificationTemplateDetail
}

/**
 * What a rendered template looks like for a given set of variable values.
 *
 * `missingRequiredVariables` is reported rather than thrown: a preview of an
 * under-specified template is still useful, and the editor needs to see which values it
 * still owes. `matchedRuleIds` names the personalization rules whose condition evaluated
 * true — an unparseable condition is false, never executed.
 */
export interface NotificationTemplatePreview {
  subject: string | null
  title: string | null
  content: string | null
  htmlContent: string | null
  matchedRuleIds: string[]
  missingRequiredVariables: string[]
  resolvedLocale: string
  fallbackFields: string[]
}

export interface PreviewNotificationTemplateOptions extends NotificationTemplateLocaleOptions {
  /** Values to substitute, keyed by declared variable name. */
  variables?: Record<string, string | null>
}

/**
 * `lang` travels in the body here, not the query string — this is the one endpoint whose
 * locale is part of the POST payload, because the preview *is* the render.
 */
export async function previewNotificationTemplate(
  baseUrl: string,
  id: string,
  options: PreviewNotificationTemplateOptions = {},
): Promise<NotificationTemplatePreview> {
  const response = await authFetch(`${baseUrl}/notification-templates/${id}/preview`, {
    method: 'POST',
    body: JSON.stringify({ variables: options.variables, lang: options.lang }),
  })
  return (await response.json()) as NotificationTemplatePreview
}
