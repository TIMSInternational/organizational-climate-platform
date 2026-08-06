import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { getMicroclimate, updateMicroclimate, type MicroclimateDetail } from '../api/microclimates'
import LiveResultsPanel from '../components/LiveResultsPanel'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'

const STATUSES = ['draft', 'active', 'closed']

export default function MicroclimateDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [microclimate, setMicroclimate] = useState<MicroclimateDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    if (!id) return
    setError(null)
    try {
      const result = await getMicroclimate(baseUrl, id)
      setMicroclimate(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    }
  }

  useEffect(() => {
    reload()
  }, [id])

  async function handleStatusChange(status: string) {
    if (!id) return
    setError(null)
    try {
      await updateMicroclimate(baseUrl, id, { status })
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    }
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  if (!microclimate) {
    return <p>{t('common.loading')}</p>
  }

  // A resolved title can be null when the microclimate has no text in any language --
  // the resolver returns null rather than an empty string or a key path, so the caller
  // decides what to show (#195, and #78's raw-key-path bug it exists to avoid).
  const title = microclimate.title ?? t('microclimates.untitled')

  return (
    <div>
      <PageTopBar
        title={title}
        breadcrumbs={[
          { label: t('navigation.microclimates'), href: '/microclimates' },
          { label: title },
        ]}
      />
      <label>
        {t('common.status')}
        <select value={microclimate.status} onChange={(e) => handleStatusChange(e.target.value)}>
          {STATUSES.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
      </label>

      <h2>{t('microclimates.liveResults')}</h2>
      <LiveResultsPanel baseUrl={baseUrl} microclimateId={microclimate.id} isActive={microclimate.status === 'active'} />
    </div>
  )
}
