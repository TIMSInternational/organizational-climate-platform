import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import {
  getSurveyTemplate,
  instantiateSurveyTemplate,
  type SurveyTemplateDetail,
} from '../api/surveyTemplates'
import ContentFallbackNotice from '../components/ContentFallbackNotice'
import SurveyQuestionList from '../components/SurveyQuestionList'
import { useCompanyScope } from '../../../company-context'
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
import { languageLabel } from '../surveyVocabulary'

/**
 * One template, and the one verb that matters: use it.
 *
 * ## Why the company scope is read *before* the action, not after it fails
 *
 * `POST /survey-templates/{id}/use` needs a target company. It is optional for a
 * company admin -- their own company is the only legal answer, so the server fills it
 * in -- and **required for a super admin**, who has had no implicit tenant since #191
 * made `User.CompanyId` nullable. Firing the request without one would produce a 400
 * that reads like a bug rather than a missing choice, so the page branches on
 * `useCompanyScope()` (#124) and says which company the survey will be created in.
 *
 * This is the one place in this lane that needs company context at all: the two
 * listings and the survey detail page are all scoped by the server from the caller's
 * role, and send no company id.
 *
 * ## The notice covers the questions, not the name
 *
 * `survey_templates.name`/`.description` are single `text` columns -- #195 paired only
 * `template_questions` -- so the heading above is monolingual whatever locale is asked
 * for, while the questions below are resolved and self-report their fallback. Reporting
 * one locale for the whole page would therefore be wrong in a way that is easy to miss,
 * which is why `language` here is documented as describing the questions.
 */
export default function SurveyTemplateDetailPage() {
  const { t, locale } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const scope = useCompanyScope()
  const [template, setTemplate] = useState<SurveyTemplateDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Separate from `loadError`, for the same reason SurveyDetailPage separates them: a
  // refused action must not blank the template the admin was reading.
  const [actionError, setActionError] = useState<string | null>(null)
  const [using, setUsing] = useState(false)

  const reload = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setLoadError(null)
    try {
      setTemplate(await getSurveyTemplate(baseUrl, id, locale))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, id, locale, t])

  useEffect(() => {
    reload()
  }, [reload])

  async function handleUse() {
    if (!id) return
    setActionError(null)
    setUsing(true)
    try {
      // The response is a SurveyDetail, not a template: `/use` instantiates and
      // answers 201 with the new survey, so this navigates to the survey it created.
      const survey = await instantiateSurveyTemplate(baseUrl, id, { companyId: scope.companyId }, locale)
      navigate(`/surveys/${survey.id}`)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setUsing(false)
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

  if (loading || !template) {
    return (
      <LoadingRegion loading label={t('common.loading')}>
        <SkeletonText lines={6} />
      </LoadingRegion>
    )
  }

  // A super admin who has selected no company cannot instantiate anything, because the
  // request has nowhere to put the new survey. Saying so beats a 400.
  const needsCompany = scope.status !== 'ready'

  return (
    <div>
      <PageTopBar
        title={template.name}
        description={template.description}
        badge={{
          text: template.isGlobal ? t('surveys.globalTemplate') : t('surveys.companyTemplate'),
          variant: 'secondary',
        }}
        breadcrumbs={[
          { label: t('navigation.surveyTemplates'), href: '/surveys/templates' },
          { label: template.name },
        ]}
        actions={
          <Button type="button" disabled={using || needsCompany} onClick={handleUse}>
            {t('surveys.useTemplate')}
          </Button>
        }
      />

      <ContentFallbackNotice
        language={template.language}
        resolvedLocale={template.resolvedLocale}
        fallbackFields={template.fallbackFields}
      />

      {needsCompany && (
        <Alert variant="warning" className="mb-panel-gap">
          <AlertDescription>
            {scope.isSuperAdmin
              ? t('surveys.chooseCompanyToUseTemplate')
              : t('surveys.noCompanyToUseTemplate')}
          </AlertDescription>
        </Alert>
      )}

      {actionError && (
        <Alert variant="destructive" role="alert" className="mb-panel-gap">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      <H2>{t('surveys.atAGlance')}</H2>
      <Table>
        <tbody>
          <tr>
            <th scope="row">{t('surveys.templateCategory')}</th>
            <td>{template.category}</td>
          </tr>
          <tr>
            <th scope="row">{t('surveys.templateScope')}</th>
            <td>
              <Badge variant={template.isGlobal ? 'secondary' : 'outline'}>
                {template.isGlobal ? t('surveys.globalTemplate') : t('surveys.companyTemplate')}
              </Badge>
            </td>
          </tr>
          <tr>
            {/* Explicitly "the questions' language": the name and description above
                are single unpaired columns and are not localized at all. */}
            <th scope="row">{t('surveys.questionLanguage')}</th>
            <td>{languageLabel(t, template.language)}</td>
          </tr>
          <tr>
            <th scope="row">{t('surveys.timesUsed')}</th>
            <td>{template.usageCount}</td>
          </tr>
          <tr>
            <th scope="row">{t('surveys.templateTags')}</th>
            <td>
              {template.tags.length === 0 ? (
                t('common.none')
              ) : (
                <span className="flex flex-wrap gap-inline">
                  {template.tags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </span>
              )}
            </td>
          </tr>
        </tbody>
      </Table>

      <H2>{t('surveys.questions')}</H2>
      {/* `SurveyTemplateQuestion` is structurally identical to `SurveyQuestion` --
          same fields, and options carrying the same stable `value` -- which is not a
          coincidence: instantiation copies them across verbatim, values included, so
          surveys built from one template aggregate together. One renderer for both. */}
      {template.questions.length === 0 ? (
        <EmptyState
          title={t('surveys.noQuestions')}
          description={t('surveys.noTemplateQuestionsDescription')}
        />
      ) : (
        <SurveyQuestionList questions={template.questions} />
      )}
    </div>
  )
}
