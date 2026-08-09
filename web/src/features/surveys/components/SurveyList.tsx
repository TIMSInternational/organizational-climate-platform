import { Link } from 'react-router'
import type { SurveyListItem } from '../api/surveys'
import { useTranslation } from '../../../i18n'
import { Badge, EmptyState, Table } from '../../../components/ui'
import { statusLabel, typeLabel } from '../surveyVocabulary'

interface SurveyListProps {
  surveys: readonly SurveyListItem[]
}

/**
 * The admin listing.
 *
 * ## Badges are always `secondary`, deliberately
 *
 * The obvious mapping is `success` for active, `warning` for draft, `destructive`
 * for archived. Every one of those variants fails WCAG AA 1.4.3 in at least one
 * theme against `styles/tokens.css` — measured in `reports/components/ReportList.tsx`,
 * which records the full table. Badge text is `text-xs`, so 4.5:1 applies, and only
 * `secondary` (8.15:1 light / 6.85:1 dark) and `outline` clear it in both. The status
 * *word* carries the meaning, which is what WCAG 1.4.1 asks for regardless of hue.
 * Fixing `badgeVariants.ts` is a design-system change and not this page's to make;
 * what this file does is decline to add another instance of the defect.
 */
export default function SurveyList({ surveys }: SurveyListProps) {
  const { t, locale } = useTranslation()

  if (surveys.length === 0) {
    return (
      <EmptyState
        fill
        title={t('surveys.noSurveysFound')}
        description={t('surveys.tryAdjustingFilters')}
      />
    )
  }

  return (
    // `<Table>` rather than a bare `<table>`: it owns `w-full` and the
    // `overflow-x-auto` container the base layer stopped carrying in #218. Seven
    // columns overflow a 320px viewport, and the container is what stops the page
    // itself scrolling sideways.
    <Table>
      <thead>
        <tr>
          <th>{t('surveys.surveyName')}</th>
          <th>{t('surveys.surveyType')}</th>
          <th>{t('common.status')}</th>
          <th>{t('surveys.questions')}</th>
          <th>{t('surveys.responses')}</th>
          <th>{t('surveys.endDate')}</th>
          <th>{t('common.actions')}</th>
        </tr>
      </thead>
      <tbody>
        {surveys.map((survey) => (
          <tr key={survey.id}>
            {/* A resolved title is null when the survey has no text in any language:
                the resolver returns null rather than an empty string or a key path,
                so the caller decides what to show (#195). */}
            <td>{survey.title ?? t('surveys.untitled')}</td>
            <td>{typeLabel(t, survey.type)}</td>
            <td>
              <Badge variant="secondary">{statusLabel(t, survey.status)}</Badge>
            </td>
            <td>{survey.questionCount}</td>
            <td>
              {/* `targetAudienceCount` is genuinely nullable -- a survey may not
                  declare one -- so "12 / 40" degrades to "12" rather than to
                  "12 / null" or a fabricated denominator. */}
              {survey.targetAudienceCount === null
                ? survey.responseCount
                : t('surveys.responseProgress', {
                    count: survey.responseCount,
                    target: survey.targetAudienceCount,
                  })}
            </td>
            <td>{new Date(survey.endDate).toLocaleDateString(locale)}</td>
            <td>
              <Link to={`/surveys/${survey.id}`}>{t('common.viewDetails')}</Link>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
