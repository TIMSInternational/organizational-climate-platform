import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router'
import {
  getActionPlan,
  updateActionPlan,
  recordProgress,
  type ActionPlanDetail,
} from '../api/actionPlans'
import ProgressUpdateForm, { type ProgressUpdateFormValues } from '../components/ProgressUpdateForm'
import {
  ACTION_PLAN_PRIORITIES,
  ACTION_PLAN_STATUSES,
  frequencyLabel,
  kpiProgressPercent,
  priorityLabel,
  statusLabel,
} from '../actionPlanVocabulary'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import {
  Alert,
  AlertDescription,
  Badge,
  EmptyState,
  H2,
  LoadingRegion,
  NetworkError,
  Progress,
  SelectField,
  SkeletonText,
  Table,
} from '../../../components/ui'

/**
 * One action plan: its terms, its measures, and the form that moves them.
 *
 * ## There is no progress history on this page, and that is a backend gap
 *
 * `POST /action-plans/{id}/progress` writes an `ActionPlanProgressUpdate` row plus a
 * child row per KPI and objective it touched, and returns only the single
 * `ProgressUpdateDetail` it just created. **Nothing reads those rows back.**
 * `ActionPlanDetail` carries `Kpis` and `Objectives` and no updates collection, and
 * `ProgressUpdate` appears nowhere else in `src/ClimateProject.Api/Endpoints/`. So a
 * "Progress updates" table on this page could only be fabricated, or could only show
 * the entries made since the tab was opened — which is worse, because it looks like
 * a history and is not one.
 *
 * What this page shows instead is the state those writes actually mutate: each KPI's
 * `currentValue` against its target, and each objective's `currentStatus` and
 * `completionPercentage`, refetched after every submission. That is real, and it is
 * the whole of what the server will tell us. A `GET /action-plans/{id}/progress`
 * endpoint is worth its own issue; this lane is frontend-only.
 *
 * ## Status and priority use the PUT response rather than refetching
 *
 * `UpdateAsync` returns the full recomputed `ActionPlanDetail`, so using it directly
 * keeps the badge, the controls and the tables from disagreeing for a frame. The
 * progress form *does* refetch, because `RecordProgressAsync` returns only the
 * update it wrote and says nothing about the new KPI and objective values.
 *
 * ## Load errors blank the page; action errors never do
 *
 * A refused status change or a rejected progress update has to be readable *next to*
 * the plan it was about — `SurveyDetailPage` (#252) established the split and this
 * follows it. `RecordProgressAsync` and `UpdateAsync` both require `Roles.Admin`, so
 * "403 for a non-admin viewer who can still GET the plan" is a real and reachable
 * case here, not a theoretical one.
 */
export default function ActionPlanDetailPage() {
  const { t, locale } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [plan, setPlan] = useState<ActionPlanDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [recordedAt, setRecordedAt] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // `useCallback` + `[reload]`, not the `[id]` deps array this page shipped with.
  // That array omitted `reload`, which is what made this file one of the eight
  // `react-hooks(exhaustive-deps)` warnings in a budget of ten -- and the omission
  // was real, not cosmetic: the closure captured `baseUrl` and `t` from first
  // render, so a locale switch left the error message in the previous language.
  const reload = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setLoadError(null)
    try {
      setPlan(await getActionPlan(baseUrl, id))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, id, t])

  useEffect(() => {
    void reload()
  }, [reload])

  async function handleFieldChange(patch: { status?: string; priority?: string }) {
    if (!id) return
    setActionError(null)
    setRecordedAt(null)
    setSaving(true)
    try {
      setPlan(await updateActionPlan(baseUrl, id, patch))
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSaving(false)
    }
  }

  async function handleProgress(values: ProgressUpdateFormValues) {
    if (!id) return
    setActionError(null)
    setRecordedAt(null)
    // Not caught here: `ProgressUpdateForm` awaits this and renders the rejection
    // inside itself, beside the fields that produced it.
    const update = await recordProgress(baseUrl, id, values)
    setRecordedAt(update.updateDate)
    // The POST response describes only the update row. The new KPI and objective
    // values have to come from a GET.
    await reload()
  }

  if (loadError) {
    return (
      <NetworkError
        title={t('errors.generic')}
        description={loadError}
        onRetry={reload}
        retryText={t('common.retry')}
      />
    )
  }

  if (loading || !plan) {
    return (
      <LoadingRegion loading label={t('common.loading')}>
        <SkeletonText lines={6} />
      </LoadingRegion>
    )
  }

  const dueDate = new Date(plan.dueDate).toLocaleDateString(locale, { timeZone: 'UTC' })

  return (
    <div>
      <PageTopBar
        title={plan.title}
        description={plan.description}
        badge={{ text: statusLabel(t, plan.status), variant: 'secondary' }}
        breadcrumbs={[
          { label: t('navigation.actionPlans'), href: '/action-plans' },
          { label: plan.title },
        ]}
      />

      {actionError && (
        <Alert variant="destructive" role="alert" className="mb-panel-gap">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {recordedAt && (
        <Alert role="status" className="mb-panel-gap">
          <AlertDescription>
            {t('actionPlans.progressRecordedAt', {
              date: new Date(recordedAt).toLocaleString(locale),
            })}
          </AlertDescription>
        </Alert>
      )}

      <H2>{t('actionPlans.atAGlance')}</H2>
      <Table>
        <tbody>
          <tr>
            <th scope="row">{t('common.status')}</th>
            <td>
              <Badge variant="secondary">{statusLabel(t, plan.status)}</Badge>
            </td>
          </tr>
          <tr>
            <th scope="row">{t('actionPlans.priority')}</th>
            <td>
              <Badge variant="outline">{priorityLabel(t, plan.priority)}</Badge>
            </td>
          </tr>
          <tr>
            <th scope="row">{t('actionPlans.dueDate')}</th>
            <td>{dueDate}</td>
          </tr>
          <tr>
            <th scope="row">{t('actionPlans.tags')}</th>
            <td>
              {/* `departmentId`, `createdBy` and `templateId` are all on the DTO and
                  are all deliberately absent from this table: each is a bare GUID,
                  and there is no endpoint on this page's path that resolves any of
                  them to a name. A GUID shown to a user is noise, not information. */}
              {plan.tags.length === 0 ? (
                t('common.none')
              ) : (
                <div className="flex flex-wrap gap-inline">
                  {plan.tags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </td>
          </tr>
        </tbody>
      </Table>

      <H2>{t('actionPlans.updatePlan')}</H2>
      <div className="mb-section grid gap-inline md:grid-cols-2">
        {/* Both vocabularies are closed and neither has an empty member, so the
            `SelectField` primitive is usable here -- unlike the filters bar, whose
            "all statuses" option is an empty value that Radix's Select.Item throws
            on. `UpdateAsync` revalidates both against `ActionPlanValidation`. */}
        <SelectField
          label={t('common.status')}
          value={plan.status}
          disabled={saving}
          onChange={(status) => void handleFieldChange({ status })}
          options={ACTION_PLAN_STATUSES.map((value) => ({ value, label: statusLabel(t, value) }))}
        />
        <SelectField
          label={t('actionPlans.priority')}
          value={plan.priority}
          disabled={saving}
          onChange={(priority) => void handleFieldChange({ priority })}
          options={ACTION_PLAN_PRIORITIES.map((value) => ({
            value,
            label: priorityLabel(t, value),
          }))}
        />
      </div>

      <H2>{t('actionPlans.kpis')}</H2>
      {plan.kpis.length === 0 ? (
        <EmptyState title={t('actionPlans.noKpis')} description={t('actionPlans.noKpisDescription')} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t('actionPlans.metric')}</th>
              <th>{t('actionPlans.currentValue')}</th>
              <th>{t('actionPlans.targetValue')}</th>
              <th>{t('actionPlans.measurementFrequency')}</th>
              <th>{t('actionPlans.progress')}</th>
            </tr>
          </thead>
          <tbody>
            {plan.kpis.map((kpi) => {
              const percent = kpiProgressPercent(kpi.currentValue, kpi.targetValue)
              return (
                <tr key={kpi.id}>
                  <td>{kpi.name}</td>
                  <td>
                    {kpi.currentValue} {kpi.unit}
                  </td>
                  <td>
                    {kpi.targetValue} {kpi.unit}
                  </td>
                  <td>{frequencyLabel(t, kpi.measurementFrequency)}</td>
                  <td>
                    {/* A target of 0 makes the ratio meaningless rather than zero --
                        see `kpiProgressPercent`. The dash says "not applicable"; a
                        bar sitting empty would say "no progress", which is a
                        different and false claim. */}
                    {percent === null ? (
                      <span className="text-fg-secondary">{t('actionPlans.notApplicable')}</span>
                    ) : (
                      <div className="flex items-center gap-inline">
                        <Progress
                          value={percent}
                          className="min-w-16 flex-1"
                          aria-label={t('actionPlans.progress')}
                        />
                        <span className="text-sm text-fg-secondary">
                          {t('actionPlans.percentValue', { percent: Math.round(percent) })}
                        </span>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}

      <H2>{t('actionPlans.objectives')}</H2>
      {plan.objectives.length === 0 ? (
        <EmptyState
          title={t('actionPlans.noObjectives')}
          description={t('actionPlans.noObjectivesDescription')}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t('actionPlans.description')}</th>
              <th>{t('actionPlans.successCriteria')}</th>
              <th>{t('common.status')}</th>
              <th>{t('actionPlans.completionPercentage')}</th>
            </tr>
          </thead>
          <tbody>
            {plan.objectives.map((objective) => (
              <tr key={objective.id}>
                <td>{objective.description}</td>
                <td>{objective.successCriteria}</td>
                <td>
                  {/* An objective's status is free text on the wire --
                      `RecordProgressAsync` assigns whatever it is sent, with no
                      validation -- so `statusLabel` translates the values we know
                      and prints the server's own string for anything else. */}
                  <Badge variant="secondary">{statusLabel(t, objective.currentStatus)}</Badge>
                </td>
                <td>
                  <div className="flex items-center gap-inline">
                    <Progress
                      value={Math.max(0, Math.min(100, objective.completionPercentage))}
                      className="min-w-16 flex-1"
                      aria-label={t('actionPlans.completionPercentage')}
                    />
                    <span className="text-sm text-fg-secondary">
                      {t('actionPlans.percentValue', { percent: objective.completionPercentage })}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <H2>{t('actionPlans.recordProgress')}</H2>
      <ProgressUpdateForm
        kpis={plan.kpis}
        objectives={plan.objectives}
        onSubmit={handleProgress}
        disabled={saving}
      />
    </div>
  )
}
