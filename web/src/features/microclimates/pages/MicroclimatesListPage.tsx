import { useCallback, useEffect, useState } from 'react'
import { listMicroclimates, createMicroclimate, type Microclimate } from '../api/microclimates'
import { listMicroclimateTemplates, type MicroclimateTemplate } from '../api/microclimateTemplates'
import MicroclimateList from '../components/MicroclimateList'
import MicroclimateFilters, { type MicroclimateFiltersValue } from '../components/MicroclimateFilters'
import MicroclimateForm, { type MicroclimateFormValues } from '../components/MicroclimateForm'
import { useCompanyScope } from '../../../company-context'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { EmptyState } from '../../../components/ui'

// Company scope comes from `useCompanyScope()` (#124), not from the JWT claim
// this page used to read directly. See `company-context/companyContext.ts` for
// the rule, and `ActionPlansListPage` for the same note at length: the block that
// stood here was waiting on a picker, and rested on a premise (#191 made
// `User.CompanyId` nullable, so a global SuperAdmin's claim is `''`, not a real
// company) that has since moved. A SuperAdmin is now asked which company they
// mean rather than blocked -- and never given one by default.
export default function MicroclimatesListPage() {
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const scope = useCompanyScope()
  const companyId = scope.companyId
  const [microclimates, setMicroclimates] = useState<Microclimate[]>([])
  const [templates, setTemplates] = useState<MicroclimateTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<MicroclimateFiltersValue>({ status: '' })
  const [showCreateForm, setShowCreateForm] = useState(false)

  // `useCallback` + `[reload]` rather than the mount-only `[]` this page used to
  // run on: the company can now change while the page is mounted, and stale rows
  // under a switched context is the same lie as silent scoping.
  const reload = useCallback(async () => {
    if (!companyId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [microclimatesResult, templatesResult] = await Promise.all([
        listMicroclimates(baseUrl, companyId),
        listMicroclimateTemplates(baseUrl, companyId),
      ])
      setMicroclimates(microclimatesResult)
      setTemplates(templatesResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, companyId, t])

  useEffect(() => {
    void reload()
  }, [reload])

  const filtered = microclimates.filter((m) => !filters.status || m.status === filters.status)

  async function handleCreate(values: MicroclimateFormValues) {
    if (!companyId) return
    await createMicroclimate(baseUrl, {
      title: values.title,
      companyId,
      startTime: values.startTime,
      endTime: values.endTime,
      targetParticipantCount: values.targetParticipantCount,
      anonymousResponses: values.anonymousResponses,
      templateId: values.templateId,
      questions: values.questions,
    })
    setShowCreateForm(false)
    await reload()
  }

  if (scope.status === 'needs-selection') {
    return (
      <EmptyState
        title={t('companyContext.chooseACompany')}
        description={t('companyContext.chooseACompanyDescription')}
      />
    )
  }

  if (scope.status === 'no-company') {
    return <p role="alert">{t('common.noCompanyAssociated')}</p>
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  return (
    <div>
      <PageTopBar
        title={t('navigation.microclimates')}
        description={t('navigation.microclimatesDesc')}
        actions={
          <button onClick={() => setShowCreateForm((v) => !v)}>
            {showCreateForm ? t('common.cancel') : t('common.newMicroclimate')}
          </button>
        }
      />
      <MicroclimateFilters value={filters} onChange={setFilters} />
      {showCreateForm && <MicroclimateForm templates={templates} onSubmit={handleCreate} />}
      {loading ? <p>{t('common.loading')}</p> : <MicroclimateList microclimates={filtered} />}
    </div>
  )
}
