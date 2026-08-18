import { useTranslation } from '../../i18n'
import { cn } from '../../lib/cn'
import {
  SURVEY_INVITATION_STATUSES,
  type SurveyAnonymityGuarantee,
  type SurveyInvitationStatus,
  type SurveyInvitationSummary,
} from '../../features/surveys/api/surveyDistribution'

/**
 * The invitation-status filter, as a row of chips that each carry their own count.
 *
 * The `?status=` parameter has existed on `listSurveyInvitations` since the route was
 * written and nothing ever sent it, so a survey with two hundred invitations offered no
 * way to answer "who has not opened it yet" short of reading every row.
 *
 * ## The counts come from the UNFILTERED summary, deliberately
 *
 * `GET /invitations?status=sent` answers a summary describing what it returned, so
 * driving these chips from the same response would collapse every other count to zero
 * the moment a filter was applied — the filter would erase the numbers a reader needs to
 * choose the next filter. The counts therefore come from the distribution detail's own
 * summary, which is never filtered, while the table renders the filtered list.
 *
 * ## Suppressed states get no chip
 *
 * For an anonymous survey `started` and `completed` are never written, so those buckets
 * are structural zeros. A chip reading "Started 0" invites the conclusion that nobody
 * has started, which is a claim about people the survey promised not to make — the same
 * reason `InvitationTable` drops those columns rather than showing empty cells.
 *
 * Selection is a tinted fill plus an accent hairline with the label left at
 * `text-fg-primary`, matching `SurveyStatusChips`, where tinting the text instead was
 * measured at 3.41:1 against the 4.5:1 that 11px type requires. `aria-pressed` states
 * the same thing without any colour at all.
 */
export interface InvitationStatusChipsProps {
  /** The selected status, or `''` for "all". */
  value: string
  /** The unfiltered per-status counts. */
  summary: SurveyInvitationSummary
  anonymity: SurveyAnonymityGuarantee
  onChange: (status: string) => void
  disabled?: boolean
}

export default function InvitationStatusChips({
  value,
  summary,
  anonymity,
  onChange,
  disabled = false,
}: InvitationStatusChipsProps) {
  const { t, locale } = useTranslation()

  const chips = [
    { status: '', label: t('common.all'), count: summary.total },
    ...SURVEY_INVITATION_STATUSES.filter(
      (status) => !anonymity.suppressedStates.includes(status),
    ).map((status: SurveyInvitationStatus) => ({
      status,
      label: t(`surveys.distribution.status.${status}`),
      count: summary[status as keyof SurveyInvitationSummary] ?? 0,
    })),
  ]

  return (
    <div
      role="group"
      aria-label={t('surveys.distribution.filterByStatus')}
      className="flex flex-wrap gap-inline"
    >
      {chips.map((chip) => {
        const selected = chip.status === value
        return (
          <button
            key={chip.status === '' ? 'all' : chip.status}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onChange(chip.status)}
            className={cn(
              'inline-flex h-5 items-center gap-1 rounded-lg border px-2',
              'text-xs font-semibold transition-colors ease-out',
              'disabled:cursor-not-allowed disabled:opacity-60',
              selected
                ? 'border-accent-blue-ring bg-accent-blue-soft text-fg-primary'
                : 'border-line-light bg-surface-icon-box text-fg-secondary hover:border-line-hover hover:text-fg-primary',
            )}
          >
            {chip.label}
            <span className="font-mono tabular-nums">{chip.count.toLocaleString(locale)}</span>
          </button>
        )
      })}
    </div>
  )
}
