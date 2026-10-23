import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useTranslation } from '../../../../i18n'
import { deleteMicroclimate, getMicroclimate, updateMicroclimate, type MicroclimateDetail } from '../../api/microclimates'
import {
  createMicroclimateInvitations,
  listAllMicroclimateInvitations,
  type CreateMicroclimateInvitationsInput,
  type MicroclimateInvitationBatchResult,
  type MicroclimateInvitationList,
} from '../../api/microclimateInvitations'
import { describeApiError } from '../../../../api/describeApiError'

export type Settled<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'failed' }

export interface MicroclimateDetailState {
  status: 'loading' | 'ready' | 'error'
  error: string | null
  detail: MicroclimateDetail | null
  invitations: Settled<MicroclimateInvitationList>
  reload: () => void
  /** A launch or a close is in flight. */
  pending: 'launch' | 'close' | null
  /** The server's refusal of the last transition, beside the session it was about. */
  actionError: string | null
  /** Handed over by Crear when its create succeeded and its launch did not. */
  launchError: string | null
  launch: () => void
  close: () => Promise<void>
  invite: (input: CreateMicroclimateInvitationsInput) => Promise<MicroclimateInvitationBatchResult>
  /** Discards a draft (`DELETE /microclimates/{id}`, G23) and returns to the list. */
  discard: () => Promise<void>
}

/**
 * THE wiring seam of `/microclimates/:id`. The session is `MicroclimateDetailPage`'s read
 * and its transitions are that page's writes, unchanged — `updateMicroclimate(id, { status })`
 * for launching a draft and for closing a live session, the response being the new detail.
 *
 * Added for the board's "Invitaciones por correo": the two admin routes that existed with no
 * caller (`microclimateInvitations.ts`). Settled on their own, so a failed list costs that
 * card and never the page.
 */
export function useMicroclimateDetailModel(id: string | undefined): MicroclimateDetailState {
  const { t, locale } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [detail, setDetail] = useState<MicroclimateDetail | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [invitations, setInvitations] = useState<Settled<MicroclimateInvitationList>>({ status: 'loading' })
  const [generation, setGeneration] = useState(0)
  const [invitationsGeneration, setInvitationsGeneration] = useState(0)
  const [pending, setPending] = useState<'launch' | 'close' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const handed = (location.state as { launchError?: unknown } | null)?.launchError
  const [launchError, setLaunchError] = useState<string | null>(typeof handed === 'string' ? handed : null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setStatus('loading')
    setError(null)
    getMicroclimate(baseUrl, id, locale)
      .then((loaded) => {
        if (cancelled) return
        setDetail(loaded)
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(describeApiError(err, t))
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, generation, id, locale, t])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setInvitations({ status: 'loading' })
    // Every page, not the first 500 (G23): the card lists the whole set.
    listAllMicroclimateInvitations(baseUrl, id)
      .then((list) => {
        if (!cancelled) setInvitations({ status: 'ready', value: list })
      })
      .catch(() => {
        if (!cancelled) setInvitations({ status: 'failed' })
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, id, invitationsGeneration])

  const transition = useCallback(
    async (next: 'active' | 'closed') => {
      if (!id) return
      setActionError(null)
      setLaunchError(null)
      setPending(next === 'active' ? 'launch' : 'close')
      try {
        setDetail(await updateMicroclimate(baseUrl, id, { status: next }))
      } catch (err) {
        // The server's own sentence: a bilingual session names the untranslated fields.
        setActionError(describeApiError(err, t))
      } finally {
        setPending(null)
      }
    },
    [baseUrl, id, t],
  )

  const invite = useCallback(
    async (input: CreateMicroclimateInvitationsInput) => {
      if (!id) throw new Error(t('errors.notFound'))
      const result = await createMicroclimateInvitations(baseUrl, id, input)
      setInvitationsGeneration((value) => value + 1)
      return result
    },
    [baseUrl, id, t],
  )

  const discard = useCallback(async () => {
    if (!id) return
    setActionError(null)
    try {
      await deleteMicroclimate(baseUrl, id)
      navigate('/microclimates')
    } catch (err) {
      setActionError(describeApiError(err, t))
    }
  }, [baseUrl, id, navigate, t])

  return {
    status,
    error,
    detail,
    invitations,
    reload: () => {
      setGeneration((value) => value + 1)
      setInvitationsGeneration((value) => value + 1)
    },
    pending,
    actionError,
    launchError,
    launch: () => void transition('active'),
    close: () => transition('closed'),
    invite,
    discard,
  }
}
