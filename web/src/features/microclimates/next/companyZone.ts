import type { TranslateFn } from '../../../i18n'
import { getCompanySettings } from '../../org-structure/api/companySettings'
import { isKnownTimeZone, zoneLabel } from '../../surveys/next/authoring/zonedWindow'
import { sessionZone } from '../wizardValues'

/**
 * The company's clock for the administrator's microclimate pages -- the rule #630 gave Nueva
 * encuesta and #635 gave Crear, then #640 the list (`/microclimates`) and the detail
 * (`/microclimates/:id`), and now the live session (`/:id/live`), the results (`/:id/results`)
 * and the analytics (`/microclimates/analytics`), so the close an administrator reads is the
 * one the company's people read wherever the administrator sits.
 *
 * The respondent's pages (the invitation, answering) do not read it: they stay on the
 * reader's own zone.
 */

/**
 * The company's IANA zone from its settings (`GET /admin/companies/{id}/settings`, the read
 * Nueva encuesta makes for the same purpose), or `null` when it cannot be read or is not a zone
 * this platform knows. Never throws: a page works on the browser's zone without it.
 */
export async function companyZone(baseUrl: string, companyId: string): Promise<string | null> {
  try {
    const zone = (await getCompanySettings(baseUrl, companyId))?.settings?.timezone
    return isKnownTimeZone(zone) ? zone : null
  } catch {
    return null
  }
}

/** The zone a page prints on: the company's, or -- when it could not be read -- the browser's. */
export function displayZone(company: string | null): string {
  return sessionZone(company)
}

/**
 * The sentence that names that zone beside the times: "Fechas y horas en la zona de la
 * empresa: America/Costa_Rica (GMT-6)." or, when the company's could not be read, that the
 * browser's is used and which it is. The same two sentences Crear prints.
 */
export function zoneNote(t: TranslateFn, company: string | null): string {
  return t(company === null ? 'microclimates.next.create.timezoneBrowser' : 'microclimates.next.create.timezoneCompany', {
    zone: zoneLabel(displayZone(company)),
  })
}
