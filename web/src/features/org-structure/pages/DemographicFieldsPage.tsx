import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { listDemographicFields, createDemographicField, updateDemographicField, type DemographicField, type DemographicFieldOptionInput } from '../api/demographicFields'
import { getCompanyAdminDashboard } from '../../dashboard/api/dashboard'
import DemographicFieldList from '../components/DemographicFieldList'
import DemographicFieldForm, { type DemographicFieldFormValues } from '../components/DemographicFieldForm'
import { peoplePerValue } from '../components/demographicReach'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { KpiTile, isSuppressed } from '../../../components/charts'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  LoadingRegion,
  NetworkError,
  SkeletonText,
} from '../../../components/ui'

/**
 * Demographic fields — the cuts results can be broken down by.
 *
 * ## Why this screen shows the anonymity floor at all
 *
 * Every field on this page narrows the sample. Adding one with fourteen values to
 * a company of thirty-one people creates fourteen groups that average two people
 * each, and not one of them can ever be reported. That is knowable *before* the
 * field is created, from two numbers the app already has, and it is the single
 * most useful thing this screen can tell an administrator. So the table states it,
 * per field, in words — and where the figure itself falls under the floor it is
 * withheld rather than printed. See `components/demographicReach.ts` for why the
 * mean is a proof in one direction and not in the other.
 *
 * ## Two calls, one of them optional
 *
 * The field list is the page. The company headcount comes from
 * `GET /dashboard/company-admin`, which reports it as a number — the alternative,
 * `GET /admin/users`, would ship every user row for this page to count. It is an
 * enrichment either way: without it the two measured columns and the two measured
 * tiles are simply absent. `Promise.allSettled` rather than `Promise.all`, so the
 * optional half cannot take the page down with it.
 *
 * ## Loading, empty and error are kept apart
 *
 * A failed request is `NetworkError` with a retry; an empty list is the
 * `EmptyState` inside `DemographicFieldList`. Collapsing the first into the second
 * would tell an admin their company has no demographic fields when in fact the
 * request never succeeded.
 */

/**
 * The anonymity floor this screen states and enforces. Same value and same
 * reasoning as `DepartmentsPage`: `charts/ProtectedCell.tsx` defaults to 5, and
 * `api/companySettings.ts` has no threshold field for a company to override it
 * with yet, so it is a constant rather than a fetched value.
 */
const FLOOR = 5

export default function DemographicFieldsPage() {
  const { t, locale } = useTranslation()
  const { companyId } = useParams<{ companyId: string }>()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [fields, setFields] = useState<DemographicField[]>([])
  const [people, setPeople] = useState<number | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingField, setEditingField] = useState<DemographicField | null>(null)
  const [creating, setCreating] = useState(false)

  async function reload() {
    if (!companyId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const [list, dashboard] = await Promise.allSettled([
      listDemographicFields(baseUrl, companyId),
      // No `lang`: the only thing read off this response is `activeUserCount`, and
      // a headcount has no language. Asking for one would make the effect's
      // dependency list wrong the moment the reader switched locale.
      getCompanyAdminDashboard(baseUrl, { companyId }),
    ])

    // `activeUserCount`, not `userCount`: a deactivated account answers no survey,
    // so counting it would inflate every group size and could call a cut usable
    // that is not.
    setPeople(dashboard.status === 'fulfilled' ? dashboard.value.activeUserCount : undefined)

    if (list.status === 'fulfilled') {
      setFields(list.value)
    } else {
      const reason: unknown = list.reason
      setError(reason instanceof Error ? reason.message : t('errors.generic'))
    }
    setLoading(false)
  }

  useEffect(() => {
    reload()
  }, [companyId])

  // Each entry becomes an option whose stable value is derived server-side from the
  // label. A single-language admin never sees the value; it exists so the same choice
  // stays one value once the labels are translated (#195).
  function parseOptions(optionsText: string): DemographicFieldOptionInput[] | undefined {
    const trimmed = optionsText.split(',').map((o) => o.trim()).filter(Boolean)
    return trimmed.length > 0 ? trimmed.map((label) => ({ label })) : undefined
  }

  async function handleCreate(values: DemographicFieldFormValues) {
    if (!companyId) return
    await createDemographicField(baseUrl, {
      companyId,
      field: values.field,
      label: values.label,
      type: values.type,
      options: parseOptions(values.optionsText),
      required: values.required,
      order: values.order,
    })
    setCreating(false)
    await reload()
  }

  async function handleUpdate(values: DemographicFieldFormValues) {
    if (!editingField) return
    await updateDemographicField(baseUrl, editingField.id, {
      label: values.label,
      options: parseOptions(values.optionsText),
      required: values.required,
      order: values.order,
      isActive: values.isActive,
    })
    setEditingField(null)
    await reload()
  }

  const activeCount = fields.filter((field) => field.isActive).length
  // A cut is counted usable only where it is countable at all *and* actually on
  // offer: an **active** `select` whose mean group size clears the floor.
  // Everything else is deactivated, unbounded or proved too narrow, and none of
  // the three belongs in a "usable" total — a deactivated field is never offered
  // as a cut, so counting it would overstate the reading and contradict both the
  // Fields tile beside it, which reports the inactive count, and the row's own
  // "not offered" verdict.
  const usableCount = fields.filter((field) => {
    if (!field.isActive) return false
    if (field.type !== 'select' || people === undefined) return false
    const perValue = peoplePerValue(people, field.options?.length ?? 0)
    return perValue !== null && !isSuppressed(perValue, FLOOR)
  }).length

  return (
    <div>
      <PageTopBar
        title={t('navigation.demographicFields')}
        description={t('demographicFields.pageDescription', { threshold: FLOOR })}
        breadcrumbs={[
          { label: t('navigation.companySettings'), href: `/admin/companies/${companyId}` },
          { label: t('navigation.demographicFields') },
        ]}
        actions={
          <Button variant="primary" onClick={() => setCreating((v) => !v)}>
            {creating ? t('common.cancel') : t('common.newField')}
          </Button>
        }
      />

      {creating && (
        <Card className="mb-panel-gap">
          <CardHeader>
            <CardTitle>{t('common.newField')}</CardTitle>
          </CardHeader>
          <CardContent>
            <DemographicFieldForm submitLabel={t('common.createField')} onSubmit={handleCreate} />
          </CardContent>
        </Card>
      )}

      {editingField && (
        <Card className="mb-panel-gap">
          <CardHeader>
            <CardTitle>{t('common.edit')}</CardTitle>
          </CardHeader>
          <CardContent>
            <DemographicFieldForm
              key={editingField.id}
              initialValues={editingField}
              submitLabel={t('common.saveField')}
              onSubmit={handleUpdate}
            />
          </CardContent>
        </Card>
      )}

      {error ? (
        <NetworkError
          title={t('demographicFields.failedLoad')}
          description={error}
          onRetry={() => void reload()}
          retryText={t('common.retry')}
        />
      ) : (
        // Loading is its own state, not a silent empty one. Without this the
        // designed "no demographic fields defined yet" panel flashes on every load
        // and tells an admin their company has none while the request is still in
        // flight -- the same failure the error/empty split above exists to prevent.
        <LoadingRegion loading={loading} label={t('demographicFields.loading')}>
          {loading ? (
            <SkeletonText lines={4} />
          ) : (
            <>
          {fields.length > 0 && (
            // `KpiTile`, the redesign's flat strip: the readings are context for
            // the table below, not the content of the page. Every value is
            // `font-mono tabular-nums`, the instrument face the table follows.
            <div className="mb-panel-gap grid grid-cols-2 gap-inline lg:grid-cols-3">
              <KpiTile
                label={t('demographicFields.kpiFields')}
                value={fields.length}
                locale={locale}
                sub={t('demographicFields.kpiFieldsSub', { count: fields.length - activeCount })}
              />
              {people !== undefined && (
                <KpiTile
                  label={t('demographicFields.kpiPeople')}
                  value={people}
                  locale={locale}
                  sub={t('demographicFields.kpiPeopleSub')}
                />
              )}
              {people !== undefined && (
                <KpiTile
                  label={t('demographicFields.kpiUsable')}
                  value={usableCount}
                  locale={locale}
                  sub={t('demographicFields.kpiUsableSub', { threshold: FLOOR })}
                />
              )}
            </div>
          )}

          <DemographicFieldList
            fields={fields}
            people={people}
            threshold={FLOOR}
            onEdit={setEditingField}
          />
            </>
          )}
        </LoadingRegion>
      )}
    </div>
  )
}
