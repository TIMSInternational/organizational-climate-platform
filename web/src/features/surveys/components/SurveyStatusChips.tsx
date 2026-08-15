import { useTranslation } from '../../../i18n'
import { cn } from '../../../lib/cn'
import { statusLabel } from '../surveyVocabulary'
import type { SurveyStatusFacet } from '../surveyListView'

interface SurveyStatusChipsProps {
  /** The selected status, or `''` for "all". */
  value: string
  /** Every status with its count, in lifecycle order — see `surveyStatusFacets`. */
  facets: readonly SurveyStatusFacet[]
  /** How many surveys the "all" chip stands for. */
  total: number
  onChange: (status: string) => void
}

/**
 * The status filter, as a row of chips that each carry their own count.
 *
 * ## Why the count is set in mono and the word is not
 *
 * The redesign's one typographic rule: every *reading* is `font-mono tabular-nums`
 * and prose stays in the sans face. A chip is both — a word and a measurement — so
 * the two faces sit side by side inside it. Tabular figures also stop the chips
 * reflowing as counts change width between loads.
 *
 * ## Colour, and why the state word is never carried by hue alone
 *
 * Selection is a tinted fill plus a hairline in the accent, and the label stays
 * `text-fg-primary`. Tinting the *text* instead is the obvious reading of the
 * design and it is measured to fail WCAG AA 1.4.3 here: `--admin-accent-blue`
 * (#0d9488) over `--admin-accent-bg-blue` composited on the light panel is
 * **3.41:1** against a 4.5:1 requirement for 11px type. `--admin-font-primary` on
 * the same fill is 16.77:1 light and 13.01:1 dark. The hue therefore does one job — it
 * marks which chip is on — while the reading stays legible, and `aria-pressed`
 * states the same thing without any colour at all.
 */
export default function SurveyStatusChips({
  value,
  facets,
  total,
  onChange,
}: SurveyStatusChipsProps) {
  const { t, locale } = useTranslation()

  const chips = [
    { status: '', label: t('common.all'), count: total },
    ...facets.map((facet) => ({
      status: facet.status,
      label: statusLabel(t, facet.status),
      count: facet.count,
    })),
  ]

  return (
    <div
      role="group"
      aria-label={t('surveys.filterByStatus')}
      className="mb-panel-gap flex flex-wrap gap-inline"
    >
      {chips.map((chip) => {
        const selected = chip.status === value
        return (
          <button
            key={chip.status === '' ? 'all' : chip.status}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(chip.status)}
            className={cn(
              'inline-flex h-5 items-center gap-1 rounded-lg border px-2',
              'text-xs font-semibold transition-colors ease-out',
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
