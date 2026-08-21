import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useCompanyScope } from '../../../company-context'
import { PageTopBar } from '../../../components/layout'
import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  EmptyState,
} from '../../../components/ui'
import { useTranslation } from '../../../i18n'
import { createPlanAccion, type CreatePlanAccionInput } from '../api/trackingApi'
import {
  listNodoOptions,
  listPersonaOptions,
  type NodoPickerItem,
  type PersonaPickerItem,
} from '../api/trackingPickers'
import PlanDeAccionForm from '../components/PlanDeAccionForm'
import { canCreatePlan, readTrackingClaims } from '../trackingAccess'

/**
 * The standalone create screen — `PlanDeAccionCreatePage`, the fourth page the
 * issue names.
 *
 * ## It has no route yet, and that is reported rather than worked around
 *
 * The router is owned by a sibling slice and registers three tracking paths:
 * `/tracking/planes`, `/tracking/planes/:id` and `/tracking/mis-tareas`. There is
 * no `/tracking/planes/nuevo` among them, and this slice does not edit
 * `app/router.tsx`. So this component exists, is tested, and is one line away from
 * being reachable:
 *
 * ```tsx
 * { path: '/tracking/planes/nuevo', element: <PlanDeAccionCreatePage /> },
 * ```
 *
 * Creation is **not** blocked in the meantime: `PlanesAccionListPage` hosts the
 * same `PlanDeAccionForm` behind its "Nuevo plan" button, so the flow works today
 * on a route that does exist. The two share the form rather than duplicating it,
 * which is what stops them drifting while this one waits for its route.
 *
 * On success it navigates to the new plan's detail page — the standalone screen's
 * one behavioural difference from the inline form, which stays on the listing.
 */
export default function PlanDeAccionCreatePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const scope = useCompanyScope()
  const companyId = scope.companyId
  const claims = useMemo(() => readTrackingClaims(), [])

  const [nodos, setNodos] = useState<NodoPickerItem[]>([])
  const [personas, setPersonas] = useState<PersonaPickerItem[]>([])
  const [directoryUnavailable, setDirectoryUnavailable] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDirectory = useCallback(async () => {
    if (!companyId) return
    try {
      const [nodoItems, personaItems] = await Promise.all([
        listNodoOptions(companyId),
        listPersonaOptions(companyId),
      ])
      setNodos(nodoItems)
      setPersonas(personaItems)
      setDirectoryUnavailable(false)
    } catch {
      setNodos([])
      setPersonas([])
      setDirectoryUnavailable(true)
    }
  }, [companyId])

  useEffect(() => {
    void loadDirectory()
  }, [loadDirectory])

  async function handleSubmit(input: CreatePlanAccionInput) {
    setSubmitting(true)
    setError(null)
    try {
      const plan = await createPlanAccion(input)
      void navigate(`/tracking/planes/${plan.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  if (!canCreatePlan(claims)) {
    return (
      <div className="flex flex-col gap-6">
        <PageTopBar title={t('tracking.create.title')} />
        <EmptyState
          title={t('tracking.create.notAllowedTitle')}
          description={t('tracking.create.notAllowed')}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTopBar
        title={t('tracking.create.title')}
        description={t('tracking.create.description')}
        breadcrumbs={[
          { label: t('tracking.planes.title'), href: '/tracking/planes' },
          { label: t('tracking.create.title') },
        ]}
      />

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent>
          <PlanDeAccionForm
            claims={claims}
            nodos={nodos}
            personas={personas}
            directoryUnavailable={directoryUnavailable}
            submitting={submitting}
            onSubmit={(input) => void handleSubmit(input)}
            onCancel={() => void navigate('/tracking/planes')}
          />
        </CardContent>
      </Card>
    </div>
  )
}
