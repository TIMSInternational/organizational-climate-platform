import { credentialModeOf, type CompanySettingsResponse, type CredentialMode, type UpdateCompanySettingsInput } from '../../api/companySettings'
import type { Department } from '../../api/departments'

/**
 * Pure rules behind the CompanySettings artboard (`/admin/companies/:id` for a company
 * administrator). Everything the screen prints about the tenant is derived here from the
 * payloads `useCompanySettingsModel` reads; nothing is typed as a string.
 */

/**
 * Every company setting a screen edits, as the controls hold it — the same on Configuración
 * de empresa (company administrator) and on the super administrator's company detail, so the
 * two cannot drift into editing different things.
 *
 * Only settings something READS are here. Five more are accepted by
 * `PUT /admin/companies/{id}/settings` and stored, and no screen offers them (audit gap G18,
 * re-measured 2026-10-22 by grep across `src/`, `services/` and `web/src`):
 * `surveyFrequency`, `anonymousSurveys`, `dataRetentionDays` and `microclimateEnabled` have no
 * reader at all — every new survey is created anonymous by `NewSurveyDefaults.Apply`, and
 * `RetentionCleanupJob` applies fixed periods — and `aiInsightsEnabled` is read only by the super
 * administrator's Analítica, which no form here changes. A control for any of them would
 * change nothing, so the form never sends them.
 */
export interface SettingsDraft {
  language: string
  timezone: string
  /** `shared` | `per_survey` — reaches only surveys created after it is saved. */
  credentialMode: CredentialMode
  primaryColor: string
  /**
   * The company logo, as a root-relative path or a `data:` URI. Empty means no logo, and
   * emptying the field is a change the form may send — it is how a logo is removed.
   */
  logoUrl: string
}

/**
 * The branding rules, mirroring `BrandingValidation.cs` on the API.
 *
 * `brandingValidationParity.test.ts` reads that C# file and asserts each of these equals the
 * value the server enforces. Two copies of one rule that drift mean a form that accepts what
 * the API refuses, which reaches the administrator as the save button not working — the
 * failure `productName.test.ts` was written for, with the same cross-stack fix.
 */
export const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/

/** Matches the `branding_logo_url` column width. */
export const LOGO_MAX_LENGTH = 500

export const LOGO_PATH = /^\/[A-Za-z0-9._/-]+(\?[A-Za-z0-9._=-]*)?$/

export const LOGO_DATA_URI = /^data:image\/(svg\+xml|png|jpeg|webp|avif|gif);base64,[A-Za-z0-9+/]+={0,2}$/

export const LOGO_EXTENSIONS: readonly string[] = ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif']

/**
 * Whether the form may send this logo value. Blank is valid and means "clear it".
 *
 * An absolute URL is refused here for the reason the API gives: `vercel.json` sets
 * `img-src 'self' data:`, and an externally hosted logo would report every respondent's
 * address to whoever hosts the file.
 */
export function logoValid(value: string): boolean {
  const logo = value.trim()
  if (logo === '') return true
  if (logo.length > LOGO_MAX_LENGTH) return false
  if (/\s/.test(logo)) return false
  if (logo.startsWith('data:')) return LOGO_DATA_URI.test(logo)
  if (logo.includes('://') || logo.startsWith('//')) return false
  if (logo.includes('..') || logo.includes('\\')) return false
  if (!LOGO_PATH.test(logo)) return false
  const path = logo.split('?', 1)[0].toLowerCase()
  return LOGO_EXTENSIONS.some((ext) => path.endsWith(ext))
}

export function draftOf(response: CompanySettingsResponse): SettingsDraft {
  const { settings, branding } = response
  return {
    language: settings.language,
    timezone: settings.timezone,
    credentialMode: credentialModeOf(settings),
    primaryColor: branding.primaryColor,
    logoUrl: branding.logoUrl ?? '',
  }
}

/**
 * Only what changed. `CompanyEndpoints.UpdateSettingsAsync` assigns a field only when it is
 * present (and, for strings, not blank), so an unchanged field is left off the wire rather than
 * re-sent, and a colour that is not `#rrggbb` is not a change the form may send.
 */
export function changesOf(initial: SettingsDraft, draft: SettingsDraft): UpdateCompanySettingsInput {
  const changes: UpdateCompanySettingsInput = {}
  if (draft.language !== initial.language && draft.language.trim()) changes.language = draft.language
  if (draft.timezone !== initial.timezone && draft.timezone.trim()) changes.timezone = draft.timezone
  if (draft.credentialMode !== initial.credentialMode) changes.credentialMode = draft.credentialMode
  if (draft.primaryColor !== initial.primaryColor && HEX_COLOUR.test(draft.primaryColor)) changes.primaryColor = draft.primaryColor
  // Trimmed, and a blank IS sent: `UpdateSettingsAsync` assigns when the field is non-null
  // rather than non-blank for this one field, so `""` is what clears a stored logo.
  // `NormaliseLogoUrl` on the API turns it into the single null the readers expect.
  if (draft.logoUrl.trim() !== initial.logoUrl.trim() && logoValid(draft.logoUrl)) changes.logoUrl = draft.logoUrl.trim()
  return changes
}

/** The zones a Central American tenant picks from; the stored value is always offered too. */
export const TIMEZONES: readonly string[] = [
  'America/Costa_Rica',
  'America/Guatemala',
  'America/El_Salvador',
  'America/Tegucigalpa',
  'America/Managua',
  'America/Panama',
  'America/Mexico_City',
  'America/Bogota',
  'America/Lima',
  'America/New_York',
  'Europe/Madrid',
  'UTC',
]

export function timezoneOptions(current: string): readonly string[] {
  return current && !TIMEZONES.includes(current) ? [current, ...TIMEZONES] : TIMEZONES
}

/**
 * `America/Costa_Rica` → `UTC−6`, read from the platform's own zone data; `null` if unknown.
 * A zero offset is `UTC` itself: ICU names `UTC` "GMT+0" (Node 22 and Chromium both do), and
 * "UTC (UTC+0)" would print the zone twice.
 */
export function utcOffset(timeZone: string, at: Date): string | null {
  try {
    const name =
      new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
        .formatToParts(at)
        .find((part) => part.type === 'timeZoneName')?.value ?? ''
    const match = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(name)
    if (!match) return null
    const hours = Number(match[2] ?? 0)
    const minutes = Number(match[3] ?? 0)
    if (!match[1] || (hours === 0 && minutes === 0)) return 'UTC'
    return `UTC${match[1] === '-' ? '−' : '+'}${hours}${match[3] ? `:${match[3]}` : ''}`
  } catch {
    return null
  }
}

export interface DepartmentReading {
  active: number
  inactive: number
  /** People in ACTIVE departments — the same reading the Departments screen's tile prints. */
  people: number
}

export function departmentReading(departments: readonly Department[]): DepartmentReading {
  const active = departments.filter((department) => department.isActive)
  return {
    active: active.length,
    inactive: departments.length - active.length,
    people: active.reduce((total, department) => total + department.employeeCount, 0),
  }
}
