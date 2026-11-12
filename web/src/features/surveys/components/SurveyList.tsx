import { Link } from 'react-router'
import { canDistribute } from '../api/surveyInvitationCopy'
import type { SurveyListItem } from '../api/surveys'
import { useTranslation, type TranslateFn } from '../../../i18n'
import { formatMetric } from '../../../components/charts/formatMetric'
import { cn } from '../../../lib/cn'
import { Button, Chip, EmptyState, Table } from '../../../components/ui'
import { statusLabel, typeLabel } from '../surveyVocabulary'
import { surveyResponseReading } from '../surveyListView'
import { calendarDay } from '../../../lib/calendarDay'
import { byCount } from '../../../i18n/plural'

interface SurveyListProps {
  surveys: readonly SurveyListItem[]
}

/** Header cells share one look: the board's `.tbl th`, 13px semibold in sentence case, on the recessed surface. */
const HEAD = 'bg-surface-icon-box text-sm font-semibold text-fg-tertiary whitespace-nowrap'

/**
 * The status chip: the `Chip` primitive. Only *Active* is tinted, in the blue live tone with its
 * dot; Scheduled, Closed, Draft and Archived are gray facts. Colour does one job.
 */
function StatusChip({ t, status }: { t: TranslateFn; status: string }) {
  // Gray except Activa, which wears the blue live chip (the user's ruling of 11 Nov): green is
  // Fortaleza's and nothing else.
  return <Chip tone={status === 'active' ? 'live' : 'neutral'} label={statusLabel(t, status)} />
}

/**
 * The admin listing, as the redesign's instrument table.
 *
 * ## The typographic rule
 *
 * Every *reading* — the response count, the participation figure, the close date —
 * is `tabular-nums`; the survey's name and its type stay in the sans
 * face. That single split is what makes the table read as a measuring device, and
 * tabular figures keep the columns from shifting as the numbers change.
 *
 * ## Participation is a bar AND a number, never a bar alone
 *
 * The bar is `aria-hidden`: it duplicates the figure beside it, so announcing both
 * would read the same quantity twice. Its width is clamped to 100% because a track
 * cannot show more than full, while the printed figure is not — a survey that beat
 * its expected audience says 112%, which is true, rather than being quietly capped.
 *
 * A survey with no expected audience — none declared, or a declared zero — has no
 * rate at all, and gets an em dash with an explanation rather than a bar at zero.
 * "Nobody responded" and "there is nothing to measure against" must not look alike.
 *
 * Both cells read one `surveyResponseReading`, so the denominator is withheld by the
 * same predicate that withholds the rate. Deciding separately is how the Responses
 * cell came to print "5 of 0" beside that em dash.
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
    // The border and the radius sit on this wrapper rather than on `Table`,
    // because `Table` owns the element that scrolls (`data-slot="table-container"`,
    // `overflow-x-auto`) and a border drawn on a scrolling box travels with its
    // content. `overflow-hidden` is what makes the corners clip the header fill.
    <div className="overflow-hidden rounded-xl border border-line-light">
      {/* `<Table>` rather than a bare `<table>`: it owns `w-full` and the
          `overflow-x-auto` container the base layer stopped carrying in #218. Six
          columns overflow a 320px viewport, and the container is what stops the
          page itself scrolling sideways. */}
      <Table>
        <thead>
          <tr>
            <th className={HEAD}>{t('surveys.surveyName')}</th>
            <th className={HEAD}>{t('common.status')}</th>
            <th className={HEAD}>{t('surveys.responses')}</th>
            <th className={HEAD}>{t('surveys.participation')}</th>
            <th className={HEAD}>{t('surveys.closes')}</th>
            <th className={cn(HEAD, 'text-right')}>
              <span className="sr-only">{t('common.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {surveys.map((survey) => {
            // A resolved title is null when the survey has no text in any language:
            // the resolver returns null rather than an empty string or a key path,
            // so the caller decides what to show (#195).
            const title = survey.title ?? t('surveys.untitled')
            // One reading for both cells: `target` is non-null exactly when
            // `percent` is, so "5 of 0" beside an em dash cannot be rendered.
            const reading = surveyResponseReading(survey.responseCount, survey.targetAudienceCount)
            return (
              <tr key={survey.id}>
                <td>
                  {/* A survey title is free text with no length limit, and one long
                      unbroken word otherwise sets this column's minimum width,
                      widens the table past the panel and pushes the trailing action
                      into horizontal scroll.

                      `wrap-anywhere` (overflow-wrap: anywhere) rather than
                      `break-words` (overflow-wrap: break-word), which is what the
                      template card uses: only `anywhere` reduces the element's
                      min-content contribution, and min-content is exactly what an
                      auto-layout table column is sized from. Measured, not assumed —
                      `break-words` here left the 1024px table clipped at the panel
                      edge with the Open column off-screen. The card gets away with it
                      because it is a flex child with `min-w-0`. */}
                  <span className="block wrap-anywhere font-semibold text-fg-primary">{title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-fg-secondary">
                    <span>{typeLabel(t, survey.type)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{t(byCount(survey.questionCount, 'surveys.reviewQuestionCountOne', 'surveys.reviewQuestionCount'), { count: survey.questionCount })}</span>
                  </span>
                </td>
                <td>
                  <StatusChip t={t} status={survey.status} />
                </td>
                {/* `whitespace-nowrap` for the same reason the Closes cell has it:
                    a reading split across two lines ("175 de" / "208") is exactly
                    what the tabular-figures rule exists to prevent. */}
                <td className="whitespace-nowrap tabular-nums">
                  {/* There is a denominator only when there is a rate — a survey may
                      declare no expected audience at all, or declare zero. Either way
                      "12 of 40" degrades to "12" rather than to a denominator the
                      Participation cell beside it has already refused to divide by. */}
                  {reading.target === null
                    ? reading.count
                    : t('surveys.responseProgress', {
                        count: reading.count,
                        target: reading.target,
                      })}
                </td>
                <td>
                  {reading.percent === null ? (
                    <span
                      className="tabular-nums text-fg-secondary"
                      title={t('surveys.noParticipationTarget')}
                    >
                      —
                    </span>
                  ) : (
                    <span className="flex items-center gap-inline">
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-surface-fill"
                      >
                        <span
                          className="block h-full rounded-full bg-accent-blue"
                          style={{ width: `${Math.min(reading.percent, 100)}%` }}
                        />
                      </span>
                      <span className="tabular-nums text-fg-secondary">
                        {formatMetric(reading.percent, { kind: 'percentage' }, locale)}
                      </span>
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap tabular-nums text-fg-secondary">
                  {calendarDay(Date.parse(survey.endDate), locale)}
                </td>
                <td className="text-right">
                  <span className="inline-flex flex-wrap justify-end gap-inline">
                    {/* The way into the payoff screen (decision 07 of the admin
                        round): until this link the results page was reachable only
                        by typing its URL. Active and closed rows only — a draft or
                        scheduled survey has no responses to show, and a link to an
                        empty results page teaches the reader the link is noise. */}
                    {(survey.status === 'active' || survey.status === 'closed') && (
                      <Button asChild size="sm" variant="outline">
                        <Link
                          to={`/surveys/${survey.id}/results`}
                          aria-label={t('surveyResults.resultsForNamed', { title })}
                        >
                          {t('surveys.results')}
                        </Link>
                      </Button>
                    )}
                    {/* Same gate as the detail page's header action, from the same
                        predicate. A closed or archived survey gets no link, because
                        nothing on that page would act for it. */}
                    {canDistribute(survey.status) && (
                      <Button asChild size="sm" variant="outline">
                        <Link
                          to={`/surveys/${survey.id}/distribution`}
                          aria-label={t('surveys.distribution.distributionForNamed', { title })}
                        >
                          {t('surveys.distribution.title')}
                        </Link>
                      </Button>
                    )}
                    {/* Named for the row it opens: five links all reading "Open" are
                        indistinguishable to anyone listing the page's links. */}
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/surveys/${survey.id}`} aria-label={t('surveys.openNamed', { title })}>
                        {t('surveys.open')}
                      </Link>
                    </Button>
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </Table>
    </div>
  )
}
