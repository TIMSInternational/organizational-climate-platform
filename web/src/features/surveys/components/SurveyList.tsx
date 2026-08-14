import { Link } from 'react-router'
import type { SurveyListItem } from '../api/surveys'
import { useTranslation, type TranslateFn } from '../../../i18n'
import { formatMetric } from '../../../components/charts/formatMetric'
import { cn } from '../../../lib/cn'
import { Button, EmptyState, Table } from '../../../components/ui'
import { statusLabel, typeLabel } from '../surveyVocabulary'
import { surveyResponseReading } from '../surveyListView'
import { calendarDay } from '../../../lib/calendarDay'

interface SurveyListProps {
  surveys: readonly SurveyListItem[]
}

/** Header cells share one look: small caps, tracked, on the recessed surface. */
const HEAD =
  'bg-surface-icon-box text-2xs font-semibold uppercase tracking-label text-fg-secondary whitespace-nowrap'

/**
 * The status chip.
 *
 * ## One status is a state, the other four are facts
 *
 * The design tints only *Active* and leaves Scheduled, Closed, Draft and Archived
 * neutral, and that is the third principle rather than a shortcut: colour does one
 * job. "Running right now" is the state a reader scans for; "archived" is not a
 * worse "active", it is a different fact, and giving each status its own hue would
 * enrol four more colours into a vocabulary that means nothing.
 *
 * The tint is on the fill and the dot; the word is `text-fg-primary`. Tinting the
 * *text* is the obvious reading and it is measured to fail WCAG AA 1.4.3 in the
 * light theme — `--admin-accent-green` over `--admin-accent-bg-green` composited on
 * the panel measures **3.49:1**, against 4.5:1 for 11px type. That is the `success`
 * badge variant's row in the table `reports/components/ReportList.tsx` records, and
 * it is why this listing has never used that variant. So the hue marks the row and
 * the word carries the meaning, which is what WCAG 1.4.1 asks for.
 */
function StatusChip({ t, status }: { t: TranslateFn; status: string }) {
  const running = status === 'active'
  return (
    <span
      className={cn(
        'inline-flex h-5 w-fit items-center gap-1 rounded-lg border px-2 text-xs font-semibold',
        running
          ? 'border-accent-green-ring bg-accent-green-soft text-fg-primary'
          : 'border-line-light bg-surface-icon-box text-fg-secondary',
      )}
    >
      {running && (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-accent-green" />
      )}
      {statusLabel(t, status)}
    </span>
  )
}

/**
 * The admin listing, as the redesign's instrument table.
 *
 * ## The typographic rule
 *
 * Every *reading* — the response count, the participation figure, the close date —
 * is `font-mono tabular-nums`; the survey's name and its type stay in the sans
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
                    <span>{t('surveys.reviewQuestionCount', { count: survey.questionCount })}</span>
                  </span>
                </td>
                <td>
                  <StatusChip t={t} status={survey.status} />
                </td>
                {/* `whitespace-nowrap` for the same reason the Closes cell has it:
                    a reading split across two lines ("175 de" / "208") is exactly
                    what the tabular-figures rule exists to prevent. */}
                <td className="whitespace-nowrap font-mono tabular-nums">
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
                      className="font-mono tabular-nums text-fg-secondary"
                      title={t('surveys.noParticipationTarget')}
                    >
                      —
                    </span>
                  ) : (
                    <span className="flex items-center gap-inline">
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-line-light"
                      >
                        <span
                          className="block h-full rounded-full bg-accent-blue"
                          style={{ width: `${Math.min(reading.percent, 100)}%` }}
                        />
                      </span>
                      <span className="font-mono tabular-nums text-fg-secondary">
                        {formatMetric(reading.percent, { kind: 'percentage' }, locale)}
                      </span>
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap font-mono tabular-nums text-fg-secondary">
                  {calendarDay(Date.parse(survey.endDate), locale)}
                </td>
                <td className="text-right">
                  {/* Named for the row it opens: five links all reading "Open" are
                      indistinguishable to anyone listing the page's links. */}
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/surveys/${survey.id}`} aria-label={t('surveys.openNamed', { title })}>
                      {t('surveys.open')}
                    </Link>
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </Table>
    </div>
  )
}
