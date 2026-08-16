import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  duplicateSurvey,
  getSurvey,
  updateSurveyStatus,
  type SurveyDetail,
} from '../api/surveys'
import ContentFallbackNotice from '../components/ContentFallbackNotice'
import SurveyQuestionList from '../components/SurveyQuestionList'
import SurveyStatusActions from '../components/SurveyStatusActions'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  H2,
  LoadingRegion,
  NetworkError,
  SkeletonText,
  Table,
} from '../../../components/ui'
import { languageLabel, statusLabel, typeLabel } from '../surveyVocabulary'
import { calendarDay } from '../../../lib/calendarDay'

/**
 * One survey: structure, targeting, status and participation at a glance.
 *
 * ## Everything on this page that could have been a client-side rule, and is not
 *
 * Three server-computed facts drive the controls, and the reason is the same in each
 * case — the client would have to restate a rule it cannot see change:
 *
 * 1. **`allowedStatusTransitions`** drives the status buttons. The transition matrix
 *    lives in `SurveyStatuses` and its interesting content is its *absences*
 *    (`active -> draft`, `closed -> active`). A TypeScript copy of it drifts, and a
 *    drifted copy offers a button the server refuses.
 * 2. **`isContentEditable`** drives the editability notice. Note the server applies a
 *    strictly stronger rule than the DTO field states: `UpdateAsync` also refuses a
 *    content edit whenever any response exists, so a draft with responses is
 *    protected even though `AllowsContentEdit('draft')` is true. Restating "draft ⇒
 *    editable" here would therefore be restating the *weaker* half.
 * 3. **The publish gate** is not pre-checked at all. It is strict only when a
 *    survey's language is `'both'`, and it inspects every localized column. The page
 *    lets the transition fail and renders the server's own message, which names the
 *    field that is missing a translation — something a client-side guess could not do.
 *
 * ## The fallback notice is the point, not decoration
 *
 * `resolvedLocale` names the language the payload is *actually in*, which for a
 * Spanish-only survey read with `?lang=en` is `'es'`. Fetching that and rendering it
 * silently is precisely the substitution #195's paired columns exist to make
 * impossible. `ContentFallbackNotice` carries the reasoning.
 */
export default function SurveyDetailPage() {
  const { t, locale } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [survey, setSurvey] = useState<SurveyDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Separate from `loadError`: a refused transition must not blank the page that is
  // already on screen. The admin needs to read the refusal *next to* the survey it
  // was about.
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingStatus, setPendingStatus] = useState<string | undefined>(undefined)
  const [duplicating, setDuplicating] = useState(false)

  const reload = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setLoadError(null)
    try {
      // The UI locale is sent explicitly. Letting the server default it would resolve
      // against the survey's own language instead of the reader's, so a Spanish
      // reader would silently get English on a bilingual survey.
      setSurvey(await getSurvey(baseUrl, id, locale))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, id, locale, t])

  useEffect(() => {
    reload()
  }, [reload])

  async function handleTransition(status: string) {
    if (!id) return
    setActionError(null)
    setPendingStatus(status)
    try {
      // The response IS the updated detail, including a freshly computed
      // `allowedStatusTransitions`. Using it directly rather than refetching keeps the
      // buttons and the status from disagreeing for a frame.
      setSurvey(await updateSurveyStatus(baseUrl, id, status, locale))
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setPendingStatus(undefined)
    }
  }

  async function handleDuplicate() {
    if (!id) return
    setActionError(null)
    setDuplicating(true)
    try {
      const copy = await duplicateSurvey(baseUrl, id, locale)
      navigate(`/surveys/${copy.id}`)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setDuplicating(false)
    }
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

  if (loading || !survey) {
    return (
      <LoadingRegion loading label={t('common.loading')}>
        <SkeletonText lines={6} />
      </LoadingRegion>
    )
  }

  // A resolved title is null when the survey has no text in any language: the
  // resolver returns null rather than an empty string or a key path (#195).
  const title = survey.title ?? t('surveys.untitled')

  return (
    <div>
      <PageTopBar
        title={title}
        description={survey.description ?? undefined}
        badge={{ text: statusLabel(t, survey.status), variant: 'secondary' }}
        breadcrumbs={[
          { label: t('navigation.surveys'), href: '/surveys' },
          { label: title },
        ]}
        actions={
          <>
            {/* The primary way into the results (decision 07 of the admin round).
                Gated on responses existing rather than on status: a closed survey
                with 24 responses and an active one mid-run both have something to
                show, while "content is frozen — duplicate it" must not be the
                only forward motion a finished survey offers. A survey nobody has
                answered gets no link; the results page would only explain that
                there is nothing yet, and the reader was told the count here. */}
            {survey.responseCount > 0 && (
              <Button asChild variant="primary">
                <Link to={`/surveys/${id}/results`}>{t('surveyResults.viewResults')}</Link>
              </Button>
            )}
            <Button type="button" variant="outline" disabled={duplicating} onClick={handleDuplicate}>
              {t('surveys.duplicate')}
            </Button>
          </>
        }
      />

      <ContentFallbackNotice
        language={survey.language}
        resolvedLocale={survey.resolvedLocale}
        fallbackFields={survey.fallbackFields}
      />

      {/* `role="alert"` via the destructive Alert: the admin just pressed something
          and this is what the server said back, verbatim. */}
      {actionError && (
        <Alert variant="destructive" role="alert" className="mb-panel-gap">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      <H2>{t('surveys.atAGlance')}</H2>
      <Table>
        <tbody>
          <tr>
            <th scope="row">{t('surveys.surveyType')}</th>
            <td>{typeLabel(t, survey.type)}</td>
          </tr>
          <tr>
            <th scope="row">{t('common.status')}</th>
            <td>
              <Badge variant="secondary">{statusLabel(t, survey.status)}</Badge>
            </td>
          </tr>
          <tr>
            <th scope="row">{t('surveys.contentLanguage')}</th>
            <td>{languageLabel(t, survey.language)}</td>
          </tr>
          <tr>
            <th scope="row">{t('surveys.startDate')}</th>
            <td>{calendarDay(Date.parse(survey.startDate), locale)}</td>
          </tr>
          <tr>
            <th scope="row">{t('surveys.endDate')}</th>
            <td>{calendarDay(Date.parse(survey.endDate), locale)}</td>
          </tr>
          <tr>
            <th scope="row">{t('surveys.responses')}</th>
            <td>
              {survey.targetAudienceCount === null
                ? survey.responseCount
                : t('surveys.responseProgress', {
                    count: survey.responseCount,
                    target: survey.targetAudienceCount,
                  })}
            </td>
          </tr>
          <tr>
            <th scope="row">{t('surveys.targetedDepartments')}</th>
            <td>
              {/* An empty targeting list is not "none": `SurveyDepartmentTarget` rows
                  narrow the audience, so their absence means the whole company. */}
              {survey.departmentIds.length === 0
                ? t('surveys.allDepartments')
                : t('surveys.departmentCount', { count: survey.departmentIds.length })}
            </td>
          </tr>
          <tr>
            <th scope="row">{t('surveys.anonymity')}</th>
            <td>{survey.settings.anonymous ? t('surveys.anonymous') : t('surveys.identified')}</td>
          </tr>
          <tr>
            <th scope="row">{t('surveys.version')}</th>
            <td>{survey.version}</td>
          </tr>
        </tbody>
      </Table>

      <H2>{t('common.status')}</H2>
      <Alert className="mb-panel-gap">
        <AlertDescription>
          {survey.isContentEditable
            ? t('surveys.contentEditable')
            : t('surveys.contentFrozen')}
        </AlertDescription>
      </Alert>
      <SurveyStatusActions
        allowedStatusTransitions={survey.allowedStatusTransitions}
        onTransition={handleTransition}
        pendingStatus={pendingStatus}
      />

      <H2>{t('surveys.questions')}</H2>
      <SurveyQuestionList questions={survey.questions} />
    </div>
  )
}
