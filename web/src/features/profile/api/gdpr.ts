import { authFetch } from '../../../api/authFetch'

/**
 * The data-subject rights surface (#137), against the endpoints #144 built.
 *
 * ## Only one of the four routes is reachable from a self-service page, and that is by design
 *
 * `GdprEndpoints` maps four routes. Three of them refuse a subject asking about themselves:
 *
 * - `POST /gdpr/erasure` — administrators only, and an administrator may not erase their own
 *   account through it (`400`). So **no caller can erase themselves**, whatever their role.
 *   `docs/compliance/gdpr-subject-rights.md` states the reason: erasure here is irreversible
 *   and has no undo, so it is a request a controller acts on rather than a statement fired
 *   from a browser. There is no request-intake endpoint either — see
 *   `ErasureRequestPanel.tsx`, which says so plainly instead of offering a button that could
 *   only 403.
 * - `GET /gdpr/compliance-report` — `Roles.Admin` only.
 * - `POST /gdpr/retention-cleanup` — super admins only, and it sweeps every tenant.
 *
 * That leaves `GET /gdpr/access`, whose handler reads: *"Omitting userId means 'about me'.
 * That is the self-service case and needs no role."* It is the whole of this module.
 *
 * ## No function here takes a user id, and that is the security property
 *
 * The same rule `api/profile.ts` states. `/gdpr/access` **does** accept a `userId`, and with
 * it an administrator can export somebody else's data — but that is administrative surface
 * and belongs on an administrative page, not on the one a person opens to read about
 * themselves. Omitting the parameter from this client means there is no id to tamper with
 * and no way for this page to disclose a second person's data by accident.
 */
const PATH = '/gdpr'

/** `SubjectLink` on the wire. */
export const SUBJECT_LINK = {
  none: 0,
  subject: 1,
  actor: 2,
  throughParent: 3,
} as const

/** `ExportTreatment` on the wire. */
export const EXPORT_TREATMENT = {
  none: 0,
  fullRecord: 1,
  reference: 2,
} as const

/**
 * Why `link` and `treatment` are numbers.
 *
 * `ClimateProject.Api` configures no `JsonStringEnumConverter` anywhere — there is no
 * `ConfigureHttpJsonOptions` call in `Program.cs` and no `[JsonConverter]` on either enum —
 * so `System.Text.Json` writes both as their underlying integers, and the declaration order
 * in `Application/Gdpr/SubjectDataMap.cs` is load-bearing.
 * `tests/ClimateProject.IntegrationTests/Gdpr/SubjectAccessWireShapeTests.cs` asserts the
 * exact numbers this file encodes against a real HTTP response, so a converter added later
 * (which would turn them into strings) fails there rather than here, silently, on screen.
 */
export interface SubjectDataSource {
  name: string
  /** False makes the whole response incomplete; `SubjectAccessExport.complete` says so too. */
  included: boolean
  detail: string
}

export interface SubjectIdentity {
  userId: string | null
  email: string | null
  name: string | null
}

/**
 * One classified table's contribution to the export.
 *
 * `records` are dictionaries keyed by **EF property name**, so their keys are PascalCase
 * (`Email`, `PasswordHash`) while every other key in this payload is camelCase.
 * `JsonSerializerDefaults.Web` sets `PropertyNamingPolicy` and not `DictionaryKeyPolicy`, so
 * dictionary keys travel exactly as the exporter wrote them. Owned types are flattened as
 * `Navigation.Property` (`Consent.Analytics`, `Notifications.EmailSurveys`), and every record
 * carries `_link`, naming which of the entity's link properties matched it.
 */
export interface SubjectAccessSection {
  entity: string
  table: string
  link: number
  treatment: number
  lawfulBasis: string
  retention: string
  recordCount: number
  records: Record<string, unknown>[]
}

export interface SubjectAccessExport {
  subject: SubjectIdentity
  generatedAt: string
  /**
   * False when a store holding subject data was not read. **Today the API always returns
   * false**, because `services/tracking-api` keeps its own Postgres and this API has no
   * client for it — but the page renders the warning from this flag rather than
   * unconditionally, so the day that gap closes the page stops warning about it on its own.
   */
  complete: boolean
  sources: SubjectDataSource[]
  limitations: string[]
  sections: SubjectAccessSection[]
}

/**
 * Everything this API holds about the caller (GDPR Art. 15).
 *
 * Takes no user id: see the module comment.
 */
export async function getMyDataExport(baseUrl: string): Promise<SubjectAccessExport> {
  const response = await authFetch(`${baseUrl}${PATH}/access`)
  return response.json() as Promise<SubjectAccessExport>
}

/** Catalogue path for a `SubjectLink`, or null for a value this build has never heard of. */
export function subjectLinkLabelPath(link: number): string | null {
  switch (link) {
    case SUBJECT_LINK.none:
      return 'privacy.linkNone'
    case SUBJECT_LINK.subject:
      return 'privacy.linkSubject'
    case SUBJECT_LINK.actor:
      return 'privacy.linkActor'
    case SUBJECT_LINK.throughParent:
      return 'privacy.linkThroughParent'
    default:
      return null
  }
}

/** Catalogue path for an `ExportTreatment`, or null for an unknown value. */
export function exportTreatmentLabelPath(treatment: number): string | null {
  switch (treatment) {
    case EXPORT_TREATMENT.none:
      return 'privacy.treatmentNone'
    case EXPORT_TREATMENT.fullRecord:
      return 'privacy.treatmentFull'
    case EXPORT_TREATMENT.reference:
      return 'privacy.treatmentReference'
    default:
      return null
  }
}

/** The prefix owned-type columns of `User.Consent` carry once flattened. */
const CONSENT_PREFIX = 'Consent.'

/** One consent column as it is stored on the account. */
export interface ConsentFlag {
  /** The column name without its owned-type prefix, e.g. `Analytics`. */
  name: string
  granted: boolean
}

export interface ConsentRecord {
  flags: ConsentFlag[]
  /** ISO instant, or null when the column has never been stamped. */
  updatedAt: string | null
}

/**
 * The consent columns stored on the caller's account, read out of their own export.
 *
 * **Read from the export rather than from a consent endpoint, because there is no consent
 * endpoint.** `UserConsent` is an owned type of `users` and no route in
 * `ClimateProject.Api` reads or writes it; the one writer anywhere under `src/` is
 * `SubjectErasure.AnonymiseAccount`, which sets every flag to false. The subject access
 * export flattens owned types into the owner's record, so the export is the only place these
 * columns are legible — which makes it the honest source for a page whose claim is "this is
 * what is stored about you".
 *
 * Derived from the payload rather than from a fixed list of six, so a seventh consent column
 * appears here the day it is added instead of being silently withheld.
 *
 * Null when the export carries no `User` section or no record in it — a shape the API does
 * not produce today (the subject's own row always matches), but "assume the record is there"
 * is how a page ends up rendering `undefined` at a reader.
 */
export function readConsentRecord(subjectExport: SubjectAccessExport): ConsentRecord | null {
  const account = subjectExport.sections.find((section) => section.entity === 'User')
  const record = account?.records[0]
  if (!record) return null

  const flags = Object.entries(record)
    .filter(([key]) => key.startsWith(CONSENT_PREFIX))
    .map(([key, value]) => ({ name: key.slice(CONSENT_PREFIX.length), granted: value === true }))

  const updatedAt = record.ConsentUpdatedAt
  return { flags, updatedAt: typeof updatedAt === 'string' ? updatedAt : null }
}
