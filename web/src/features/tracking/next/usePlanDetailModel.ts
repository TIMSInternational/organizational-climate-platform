import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from '../../../i18n'
import { useCompanyScope } from '../../../company-context'
import { useViewerCapabilities } from '../../../auth/viewerCapabilities'
import { getProfile } from '../../profile/api/profile'
import {
  agregarInvolucrado,
  getPlanAccion,
  marcarCumplido,
  registrarAvance,
  type PlanAccion,
  type RegistrarAvanceInput,
} from '../api/trackingApi'
import { getNodoNames, listPersonaOptions, type PersonaPickerItem } from '../api/trackingPickers'
import { todayIso } from '../planDates'
import { isNotFound, resolvePersona } from './derive'
import type { PlanDetailModel } from './model'
import { SAMPLE_AVANCES_BY_CODE, SAMPLE_CREATOR_BY_CODE } from './sampleModel'
import { readViewer } from './viewer'

export interface PlanDetailState {
  /** `not-found` is the plan's own 404 — "this plan is gone", never "an error occurred". */
  status: 'loading' | 'ready' | 'not-found' | 'error'
  model: PlanDetailModel | null
  error: string | null
  /** The directory for the involucrados picker — empty unless the seam allows the picker. */
  directory: readonly PersonaPickerItem[]
  reload: () => void
  recordAvance: (input: RegistrarAvanceInput) => Promise<void>
  markCumplido: () => Promise<void>
  /**
   * `POST …/involucrados` once per person, in sequence — each call loads, mutates and saves
   * the same row, so firing them together would race it (the reasoning in
   * `pages/PlanDeAccionDetailPage.tsx`). The plan is re-read afterwards either way, so a
   * partial success shows what landed.
   */
  addInvolucrados: (personaIds: readonly string[]) => Promise<void>
}

/**
 * The model behind `/tracking/planes/:id` — THE wiring seam of the redesigned plan detail.
 *
 * `GET /api/planes-accion/{id}` is the plan; its failure is the screen's state (a 404 is
 * its own, see `status`). The names are decorative and silent on failure, and asked only
 * of who may answer: an administrator reads the directories (`getNodoNames`,
 * `listPersonaOptions`); anyone else is refused by both (`TrackingPickerEndpoints.cs:19-21`)
 * and is not sent — they name themselves from their token and their own nodo from
 * `GET /profile` when their department is the plan's nodo.
 *
 * The bitácora is SAMPLE (`sampleModel.ts`): `PlanResponse` does not carry it.
 */
export function usePlanDetailModel(id: string | undefined): PlanDetailState {
  const { t } = useTranslation()
  const capabilities = useViewerCapabilities()
  const scope = useCompanyScope()
  const companyId = scope.companyId
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const withDirectory = capabilities.canUseDirectoryPickers && companyId !== undefined
  const viewer = useMemo(() => readViewer(), [])

  const [plan, setPlan] = useState<PlanAccion | null>(null)
  const [status, setStatus] = useState<PlanDetailState['status']>('loading')
  const [error, setError] = useState<string | null>(null)
  const [nodoNames, setNodoNames] = useState<ReadonlyMap<string, string>>(new Map())
  const [directory, setDirectory] = useState<PersonaPickerItem[]>([])
  const [ownDepartment, setOwnDepartment] = useState<{ id: string | null; name: string | null } | null>(null)

  const reload = useCallback(async () => {
    if (!id) return
    setStatus('loading')
    setError(null)
    try {
      setPlan(await getPlanAccion(id))
      setStatus('ready')
    } catch (err) {
      setPlan(null)
      if (isNotFound(err)) {
        setStatus('not-found')
        return
      }
      setError(err instanceof Error ? err.message : t('errors.generic'))
      setStatus('error')
    }
  }, [id, t])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    let cancelled = false
    if (withDirectory && companyId) {
      void getNodoNames(companyId)
        .then((names) => {
          if (!cancelled) setNodoNames(names)
        })
        .catch(() => undefined)
      void listPersonaOptions(companyId)
        .then((items) => {
          if (!cancelled) setDirectory(items)
        })
        .catch(() => undefined)
    } else {
      void getProfile(baseUrl)
        .then((profile) => {
          if (!cancelled) setOwnDepartment({ id: profile.departmentId, name: profile.departmentName })
        })
        .catch(() => undefined)
    }
    return () => {
      cancelled = true
    }
  }, [baseUrl, companyId, withDirectory])

  const model = useMemo<PlanDetailModel | null>(() => {
    if (!plan) return null
    const byId = new Map(directory.map((persona) => [persona.id, persona]))
    const nodoName =
      nodoNames.get(plan.nodoExternalId) ??
      (ownDepartment && ownDepartment.id === plan.nodoExternalId ? ownDepartment.name : null)
    return {
      asOf: todayIso(),
      plan,
      nodoName,
      responsable: resolvePersona(plan.responsableEjecucionExternalId, byId, viewer),
      lider: plan.liderExternalId.trim() === '' ? null : resolvePersona(plan.liderExternalId, byId, viewer),
      involucrados: plan.involucradosExternalIds.map((personaId) => resolvePersona(personaId, byId, viewer)),
      bitacora: {
        creatorName: SAMPLE_CREATOR_BY_CODE[plan.planCode] ?? null,
        avances: [...(SAMPLE_AVANCES_BY_CODE[plan.planCode] ?? [])],
      },
      bitacoraIsSample: true,
    }
  }, [directory, nodoNames, ownDepartment, plan, viewer])

  const recordAvance = useCallback(
    async (input: RegistrarAvanceInput) => {
      if (!id) return
      setPlan(await registrarAvance(id, input))
    },
    [id],
  )

  const markCumplido = useCallback(async () => {
    if (!id) return
    setPlan(await marcarCumplido(id, { fecha: todayIso() }))
  }, [id])

  const addInvolucrados = useCallback(
    async (personaIds: readonly string[]) => {
      if (!id) return
      try {
        for (const personaExternalId of personaIds) {
          setPlan(await agregarInvolucrado(id, { personaExternalId }))
        }
      } finally {
        await reload()
      }
    },
    [id, reload],
  )

  return {
    status,
    model,
    error,
    directory: withDirectory ? directory : [],
    reload: () => {
      void reload()
    },
    recordAvance,
    markCumplido,
    addInvolucrados,
  }
}
