import { authFetch } from '../../api/authFetch'
import { parseResultScale, type ResultBands } from '../../components/charts'

/** `ResultBandsDto` on the wire: two boundaries and three names, a null name meaning "the default". */
export interface ResultBandsWire {
  opportunityMin: number
  strengthMin: number
  criticalName: string | null
  opportunityName: string | null
  strengthName: string | null
  /** `"mean"` or `"percent"`; absent from an API that predates the scale, which means mean. */
  scale?: 'mean' | 'percent'
}

export function fromWire(wire: ResultBandsWire): ResultBands {
  return {
    opportunityMin: wire.opportunityMin,
    strengthMin: wire.strengthMin,
    names: { critical: wire.criticalName, opportunity: wire.opportunityName, strength: wire.strengthName },
    scale: parseResultScale(wire.scale),
  }
}

export function toWire(bands: ResultBands): ResultBandsWire {
  return {
    opportunityMin: bands.opportunityMin,
    strengthMin: bands.strengthMin,
    criticalName: bands.names.critical,
    opportunityName: bands.names.opportunity,
    strengthName: bands.names.strength,
    scale: bands.scale,
  }
}

/** `GET /admin/companies/{id}/result-bands` — readable by every member of the company. */
export async function getResultBands(baseUrl: string, companyId: string): Promise<ResultBands> {
  const response = await authFetch(`${baseUrl}/admin/companies/${companyId}/result-bands`)
  return fromWire((await response.json()) as ResultBandsWire)
}
