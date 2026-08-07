import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { getMicroclimate, updateMicroclimate, type MicroclimateDetail } from '../api/microclimates'
import MicroclimateContentNotice from '../components/MicroclimateContentNotice'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  EmptyState,
  H2,
  LoadingRegion,
  NetworkError,
  SkeletonText,
  Table,
} from '../../../components/ui'
import {
  languageLabel,
  questionTypeLabel,
  statusBadgeVariant,
  statusLabel,
} from '../microclimateVocabulary'

/**
 * The transitions this page offers, per status.
 *
 * `MicroclimateValidation.ValidStatuses` is `draft | active | closed` and, unlike
 * surveys, microclimates ship **no** `allowedStatusTransitions` on the DTO — the
 * server accepts any valid status from any other. So this table is a client-side
 * product decision rather than a copy of a server rule, and it is written out so that
 * it is visibly one: reopening a closed session would restart collection on results
 * somebody has already read, and returning an active session to draft would leave
 * responses attached to a session that claims never to have run.
 */
const NEXT_STATUSES: Record<string, readonly string[]> = {
  draft: ['active'],
  active: ['closed'],
  closed: [],
}

/**
 * One microclimate: what it asks, when it runs, and where to watch it.
 *
 * ## What changed here with #128
 *
 * The page used to render a bare `<select>` of raw status strings and embed
 * `LiveResultsPanel` — a `setInterval` with a `catch {}` that swallowed every poll
 * failure, so a dead endpoint looked exactly like a quiet one. The live view is now
 * its own page built on `usePolling`, and this page links to it. `LiveResultsPanel`
 * is deleted rather than left beside its replacement.
 *
 * It also carried the folder's `exhaustive-deps` warning: `useEffect(() => reload(),
 * [id])` with `reload` declared as a plain function. `useCallback` + `[reload]` is
 * both the correct dependency and the shape the rest of the app uses, and it fixes a
 * real bug on the way — switching the UI language left the previous locale's content
 * on screen, because `locale` was not a dependency of anything.
 *
 * ## The publish gate is not pre-checked
 *
 * Launching a bilingual session runs `ContentPublishValidation` server side and can
 * fail with the list of fields that were never translated. The page lets the call
 * fail and renders the server's message, which names them — something a client-side
 * guess could not do. Same decision `SurveyDetailPage` records at length.
 */
export default function MicroclimateDetailPage() {
  const { t, locale } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const [microclimate, setMicroclimate] = useState<MicroclimateDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Separate from `loadError`: a refused transition must not blank the page that is
  // already on screen. The admin needs to read the refusal next to the session it
  // was about.
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingStatus, setPendingStatus] = useState<string | undefined>(undefined)

  const reload = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setLoadError(null)
    try {
      setMicroclimate(await getMicroclimate(baseUrl, id, locale))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, id, locale, t])

  useEffect(() => {
    void reload()
  }, [reload])

  async function handleStatusChange(status: string) {
    if (!id) return
    setActionError(null)
    setPendingStatus(status)
    try {
      // The response IS the updated detail, so using it directly keeps the badge and
      // the buttons from disagreeing for a frame.
      setMicroclimate(await updateMicroclimate(baseUrl, id, { status }))
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setPendingStatus(undefined)
    }
  }

  if (!id) {
    return <p role="alert">{t('errors.notFound')}</p>
  }

  if (loadError) {
    return (
      <NetworkError
        title={t('microclimates.errorLoadingMicroclimate')}
        description={loadError}
        onRetry={reload}
        retryText={t('common.retry')}
      />
    )
  }

  if (loading || !microclimate) {
    return (
      <LoadingRegion loading label={t('common.loading')}>
        <SkeletonText lines={6} />
      </LoadingRegion>
    )
  }

  // A resolved title can be null when the microclimate has no text in any language --
  // the resolver returns null rather than an empty string or a key path, so the caller
  // decides what to show (#195, and #78's raw-key-path bug it exists to avoid).
  const title = microclimate.title ?? t('microclimates.untitled')
  const nextStatuses = NEXT_STATUSES[microclimate.status] ?? []

  return (
    <div>
      <PageTopBar
        title={title}
        description={microclimate.description ?? undefined}
        badge={{
          text: statusLabel(t, microclimate.status),
          variant: statusBadgeVariant(microclimate.status),
        }}
        breadcrumbs={[
          { label: t('navigation.microclimates'), href: '/microclimates' },
          { label: title },
        ]}
        actions={
          <>
            {microclimate.status === 'active' && (
              <Button asChild variant="primary">
                <Link to={`/microclimates/${microclimate.id}/live`}>
                  {t('microclimates.viewLive')}
                </Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link to={`/microclimates/${microclimate.id}/results`}>
                {t('microclimates.results')}
              </Link>
            </Button>
          </>
        }
      />

      <MicroclimateContentNotice
        language={microclimate.language}
        resolvedLocale={microclimate.resolvedLocale}
        fallbackFields={microclimate.fallbackFields}
      />

      {actionError && (
        <Alert variant="destructive" role="alert" className="mb-panel-gap">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      <H2>{t('microclimates.atAGlance')}</H2>
      <Table>
        <tbody>
          <tr>
            <th scope="row">{t('common.status')}</th>
            <td>
              <Badge variant={statusBadgeVariant(microclimate.status)}>
                {statusLabel(t, microclimate.status)}
              </Badge>
            </td>
          </tr>
          <tr>
            <th scope="row">{t('microclimates.contentLanguage')}</th>
            <td>{languageLabel(t, microclimate.language)}</td>
          </tr>
          <tr>
            <th scope="row">{t('microclimates.startTime')}</th>
            <td>{new Date(microclimate.startTime).toLocaleString(locale)}</td>
          </tr>
          <tr>
            <th scope="row">{t('microclimates.endTime')}</th>
            <td>{new Date(microclimate.endTime).toLocaleString(locale)}</td>
          </tr>
          <tr>
            <th scope="row">{t('dashboard.responses')}</th>
            <td>
              {t('surveys.responseProgress', {
                count: microclimate.responseCount,
                target: microclimate.targetParticipantCount,
              })}
            </td>
          </tr>
          <tr>
            <th scope="row">{t('microclimates.anonymousResponses')}</th>
            <td>
              {microclimate.anonymousResponses
                ? t('microclimates.anonymousShort')
                : t('microclimates.identifiedShort')}
            </td>
          </tr>
        </tbody>
      </Table>

      <H2>{t('common.status')}</H2>
      {nextStatuses.length === 0 ? (
        <p className="text-fg-secondary">{t('microclimates.dataCollectionCompleted')}</p>
      ) : (
        <div className="flex flex-wrap gap-inline">
          {nextStatuses.map((status) => (
            <Button
              key={status}
              type="button"
              variant={status === 'active' ? 'primary' : 'outline'}
              disabled={pendingStatus !== undefined}
              onClick={() => void handleStatusChange(status)}
            >
              {status === 'active' ? t('microclimates.launch') : t('microclimates.end')}
            </Button>
          ))}
        </div>
      )}

      <H2>{t('surveys.questions')}</H2>
      {microclimate.questions.length === 0 ? (
        <EmptyState title={t('microclimates.resultsNoQuestions')} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t('common.order')}</th>
              <th>{t('surveys.questionText')}</th>
              <th>{t('common.type')}</th>
              <th>{t('common.required')}</th>
            </tr>
          </thead>
          <tbody>
            {microclimate.questions.map((question) => (
              <tr key={question.id}>
                <td>{question.order}</td>
                <td>{question.text ?? t('microclimates.untitled')}</td>
                <td>{questionTypeLabel(t, question.type)}</td>
                <td>{question.required ? t('common.yes') : t('common.no')}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}
