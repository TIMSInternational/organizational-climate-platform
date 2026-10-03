import { authFetch } from '../../api/authFetch'
import type { ResultBands } from '../../components/charts'

/** `ResultBandsDto` on the wire: two boundaries and three names, a null name meaning "the default". */
export interface ResultBandsWire {
  opportunityMin: number
  strengthMin: number
  criticalName: string | null
  opportunityName: string | null
  strengthName: string | null
}

export function fromWire(wire: ResultBandsWire): ResultBands {
  return {
    opportunityMin: wire.opportunityMin,
    strengthMin: wire.strengthMin,
    names: { critical: wire.criticalName, opportunity: wire.opportunityName, strength: wire.strengthName },
  }
}

export function toWire(bands: ResultBands): ResultBandsWire {
  return {
    opportunityMin: bands.opportunityMin,
    strengthMin: bands.strengthMin,
    criticalName: bands.names.critical,
    opportunityName: bands.names.opportunity,
    strengthName: bands.names.strength,
  }
}

/** `GET /admin/companies/{id}/result-bands` — readable by every member of the company. */
export async function getResultBands(baseUrl: string, companyId: string): Promise<ResultBands> {
  const response = await authFetch(`${baseUrl}/admin/companies/${companyId}/result-bands`)
  return fromWire((await response.json()) as ResultBandsWire)
}
