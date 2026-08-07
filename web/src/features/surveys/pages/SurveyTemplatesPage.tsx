import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { listSurveyTemplates, type SurveyTemplateListItem } from '../api/surveyTemplates'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import {
  Badge,
  Button,
  EmptyState,
  LoadingRegion,
  NetworkError,
  SkeletonText,
  Table,
} from '../../../components/ui'

/**
 * The template catalogue.
 *
 * ## Scoping is the server's, and it is not the same rule as the survey listing's
 *
 * `GET /survey-templates` is admin-only and scopes by role: a super admin sees every
 * tenant's templates plus the global ones, a company admin sees the global ones plus
 * their own (`t.CompanyId == null || t.CompanyId == ownCompanyId`). So, as with
 * `SurveysListPage`, no company id is sent and both roles get a correct answer.
 *
 * The `isGlobal` column is not decoration. A global template is visible to every
 * tenant and writable only by a super admin, and the server ships the flag precisely so
 * a client does not infer that security-relevant property from `companyId === null`.
 *
 * ## Category and search are pushed to the server
 *
 * Both are real query parameters. Filtering the fetched array instead would be a second
 * implementation of a rule the server owns, and would break the moment the catalogue is
 * paginated.
 *
 * ## No name/description language notice here, deliberately
 *
 * `survey_templates.name` and `.description` are single `text` columns -- #195 paired
 * only `template_questions` -- so catalogue metadata is monolingual and there is no
 * per-row locale to report. The detail page carries the notice, because that is where
 * the localized content (the questions) actually appears.
 */
export default function SurveyTemplatesPage() {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [templates, setTemplates] = useState<SurveyTemplateListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Draft vs applied, so typing in the search box does not issue a request per keystroke.
  const [draftCategory, setDraftCategory] = useState('')
  const [draftQuery, setDraftQuery] = useState('')
  const [applied, setApplied] = useState<{ category: string; q: string }>({ category: '', q: '' })

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setTemplates(await listSurveyTemplates(baseUrl, applied, locale))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, applied, locale, t])

  useEffect(() => {
    reload()
  }, [reload])

  // Derived from the rows on screen: `category` is validated only as non-empty on the
  // wire, so there is no closed vocabulary to enumerate and an invented list would
  // offer filters matching nothing.
  const categories = useMemo(
    () => [...new Set(templates.map((template) => template.category))].sort(),
    [templates],
  )

  return (
    <div>
      <PageTopBar
        title={t('navigation.surveyTemplates')}
        description={t('navigation.surveyTemplatesDesc')}
      />

      <form
        className="mb-panel-gap grid items-end gap-inline md:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault()
          setApplied({ category: draftCategory, q: draftQuery })
        }}
      >
        <label>
          {t('surveys.templateCategory')}
          <select
            value={draftCategory}
            disabled={loading}
            onChange={(event) => setDraftCategory(event.target.value)}
          >
            <option value="">{t('surveys.allCategories')}</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>

        <label>
          {t('common.search')}
          <input
            type="search"
            value={draftQuery}
            disabled={loading}
            placeholder={t('surveys.searchTemplates')}
            onChange={(event) => setDraftQuery(event.target.value)}
          />
        </label>

        <Button type="submit" disabled={loading}>
          {t('common.filter')}
        </Button>
      </form>

      {error ? (
        <NetworkError
          title={t('errors.generic')}
          description={error}
          onRetry={reload}
          retryText={t('common.retry')}
        />
      ) : (
        <LoadingRegion loading={loading} label={t('common.loading')}>
          {loading ? (
            <SkeletonText lines={4} />
          ) : templates.length === 0 ? (
            <EmptyState
              title={t('surveys.noTemplatesFound')}
              description={t('surveys.tryAdjustingFilters')}
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>{t('surveys.templateName')}</th>
                  <th>{t('surveys.templateCategory')}</th>
                  <th>{t('surveys.templateScope')}</th>
                  <th>{t('surveys.questions')}</th>
                  <th>{t('surveys.timesUsed')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((template) => (
                  <tr key={template.id}>
                    <td>
                      <span className="grid gap-1">
                        <span>{template.name}</span>
                        <span className="text-sm text-fg-secondary">{template.description}</span>
                      </span>
                    </td>
                    <td>{template.category}</td>
                    <td>
                      {/* Only `secondary` and `outline` clear WCAG AA in BOTH themes
                          against tokens.css -- the measured table lives in
                          reports/components/ReportList.tsx. The word carries the
                          meaning, so no hue is load-bearing. */}
                      <Badge variant={template.isGlobal ? 'secondary' : 'outline'}>
                        {template.isGlobal ? t('surveys.globalTemplate') : t('surveys.companyTemplate')}
                      </Badge>
                    </td>
                    <td>{template.questionCount}</td>
                    <td>{template.usageCount}</td>
                    <td>
                      <Link to={`/surveys/templates/${template.id}`}>{t('common.viewDetails')}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </LoadingRegion>
      )}
    </div>
  )
}
