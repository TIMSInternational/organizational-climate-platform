import { getToken } from '../../../auth/token'
import { decodeJwtPayload } from '../../../auth/jwt'
import { readTrackingClaims } from '../trackingAccess'
import type { Viewer } from './derive'

/**
 * Who is looking, for naming purposes only: the `sub` claim (the tracking service's
 * `PersonaExternalId`, through `trackingAccess.readTrackingClaims`) and the `name` claim.
 *
 * A leader cannot call the personas directory (`TrackingPickerEndpoints.cs:19-21`), so
 * the one person they can always name is themselves — which is what this is for. It
 * decides nothing about access; the seam (`auth/viewerCapabilities.ts`) does that.
 */
export function readViewer(): Viewer {
  const token = getToken()
  const payload = token ? decodeJwtPayload(token) : null
  const name = typeof payload?.name === 'string' && payload.name.trim() !== '' ? payload.name : null
  return { personaExternalId: readTrackingClaims()?.personaExternalId ?? '', name }
}
