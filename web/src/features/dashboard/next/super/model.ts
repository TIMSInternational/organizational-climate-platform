import type { SystemStatusResponse } from '../../../org-structure/api/systemStatus'

/**
 * The typed model behind the super administrator's `/dashboard` with no tenant chosen —
 * the canvas's *Panel de la plataforma*.
 *
 * Every field is read from an existing endpoint; nothing here is a sample, so the page
 * carries no "Datos de muestra" chip. The five reads (`usePlatformDashboardModel.ts`):
 *
 * | Region | Endpoint | If it fails |
 * |---|---|---|
 * | tiles, per-company counts | `GET /dashboard/super-admin` | the page's error state |
 * | sector, country, plan | `GET /admin/companies` | those cells say nothing, "unconfigured" is not judged |
 * | open survey, status mix, drafts | `GET /surveys` (no company: every tenant for this role) | those cells and items are omitted, and the page says so |
 * | Estado del sistema | `GET /admin/system/status` | the card says the read failed |
 * | the mail item | `GET /admin/system-settings` | the item is omitted |
 *
 * Naming: the human-readable fields are `name`, never `title`/`label`, because they carry
 * payload content (a tenant's or a survey's own name), and `noHardcodedStrings.test.ts`
 * reads a `title:` or `label:` property as copy.
 */

export interface StatusMix {
  active: number
  closed: number
  draft: number
  archived: number
  /** Every survey on the list, whatever its status. */
  total: number
}

/** A tenant's open wave, from `GET /surveys`. */
export interface OpenSurvey {
  id: string
  companyId: string
  /** The survey's own title, already resolved for the locale; `null` when it has none. */
  name: string | null
  /** The short code a wave is discussed in ("Q4"), or a stand-in (`waveCode`). */
  code: string
  startDate: string
  endDate: string
  responses: number
  /** `null` when the survey has no invitation list — "no list", not "nobody invited". */
  audience: number | null
}

export interface PlatformCompanyRow {
  id: string
  name: string
  emailDomain: string | null
  industry: string | null
  country: string | null
  size: string | null
  subscriptionTier: string | null
  /** Whether `GET /admin/companies` answered for this tenant; if not, the four above are unknown. */
  profileKnown: boolean
  createdAt: string
  people: number
  completedResponses: number
  activeSurveyCount: number
  /** Surveys of every status. `null` when the survey list could not be read — unknown, not none. */
  surveyCount: number | null
  openSurvey: OpenSurvey | null
}

export type MissingPart = 'sector' | 'country' | 'plan' | 'surveys'

export type PlatformAttention =
  /** An open wave behind its pace: fewer than half the responses its elapsed time implies. */
  | { kind: 'behind-pace'; companyId: string; companyName: string; survey: OpenSurvey; daysLeft: number }
  /** The instance sends no email. `unconfigured`: neither a sender nor a server is set. */
  | { kind: 'mail-off'; unconfigured: boolean }
  /** A tenant's drafts, which nobody has launched. */
  | {
      kind: 'drafts'
      companyId: string
      companyName: string
      count: number
      /** The oldest draft's creation instant. */
      since: string
      names: readonly string[]
      /** Every draft holds exactly one question. */
      singleQuestion: boolean
      languages: readonly string[]
      /** The earliest planned close among them. */
      closesOn: string | null
    }
  /** A tenant created and never completed. */
  | {
      kind: 'unconfigured'
      companyId: string
      companyName: string
      createdAt: string
      people: number
      missing: readonly MissingPart[]
    }

export interface PlatformModel {
  /** ISO date the model was read at; pace and day counts are computed against it. */
  asOf: string
  companyCount: number
  userCount: number
  activeUserCount: number
  /** People whose account belongs to no tenant: the total minus every tenant's count. */
  peopleWithoutCompany: number
  surveyCount: number
  activeSurveyCount: number
  responseCount: number
  completedResponseCount: number
  /** Ordered by activity: open surveys first, then completed responses, then name. */
  rows: readonly PlatformCompanyRow[]
  /** `null` when the survey list could not be read. */
  mix: StatusMix | null
  /** Tenants with an open survey / with a draft, in row order. */
  openCompanies: readonly string[]
  draftCompanies: readonly string[]
  attention: readonly PlatformAttention[]
  system: SystemStatusResponse | null
  /** Which optional reads failed, so each region can say so rather than read as empty. */
  missing: { companies: boolean; surveys: boolean; system: boolean; settings: boolean }
}
