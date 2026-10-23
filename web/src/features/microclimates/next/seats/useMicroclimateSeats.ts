import { useEffect, useState } from 'react'
import { getMicroclimateSeats, type MicroclimateSeats } from '../../api/microclimates'

export type SeatsState = { status: 'loading' } | { status: 'ready'; value: MicroclimateSeats } | { status: 'failed' }

/** `GET /microclimates/seats` for one company, settled on its own so a failed read costs this note and never the page. */
export function useMicroclimateSeats(companyId: string | null | undefined): SeatsState {
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [state, setState] = useState<SeatsState>({ status: 'loading' })
  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    setState({ status: 'loading' })
    getMicroclimateSeats(baseUrl, companyId)
      .then((value) => {
        if (!cancelled) setState({ status: 'ready', value })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'failed' })
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, companyId])
  return state
}

/** Which sentence the seats deserve. Exported for the tests: it is the whole rule. */
export function seatsCase(seats: MicroclimateSeats): 'unmetered' | 'suspended' | 'exhausted' | 'available' {
  if (!seats.licensed) return 'unmetered'
  if (seats.status === 'suspended') return 'suspended'
  return seats.seatsRemaining <= 0 ? 'exhausted' : 'available'
}
