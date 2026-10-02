import { Building2, CircleAlert, CircleCheck, ListX, MailWarning, TriangleAlert, UserX } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from '../../../../i18n'
import { Button } from '../../../../components/ui'
import { cn } from '../../../../lib/cn'
import { IconBox, type IconBoxTone } from '../../next/super/parts'
import type { IntakeInsight } from '../../api/intake'
import { INSIGHT_CODES, rowList } from './intakeModel'

/** How loud each insight is: a row that cannot be invited is red, a likely mistake amber. */
const TONE: Record<string, IconBoxTone> = {
  email_typo: 'warning',
  invalid_email: 'critical',
  missing_email: 'critical',
  missing_name: 'critical',
  duplicate_in_file: 'warning',
  outside_domain: 'warning',
  no_department: 'neutral',
  new_department: 'neutral',
}

const ICON: Record<string, ReactNode> = {
  email_typo: <MailWarning />,
  invalid_email: <MailWarning />,
  missing_email: <MailWarning />,
  missing_name: <UserX />,
  duplicate_in_file: <CircleAlert />,
  outside_domain: <TriangleAlert />,
  no_department: <Building2 />,
  new_department: <Building2 />,
}

/**
 * "Antes de aprobar": what the server noticed in the rows, one translated line each, with the
 * spreadsheet rows it is about so the admin can find them in their own file. A likely email
 * domain typo can be corrected here in one click; everything else is corrected in the review
 * table, where the server's verdict still has the last word.
 */
export function InsightsCard({
  insights,
  skippedRows,
  fixes,
  disabled,
  onFix,
}: {
  insights: IntakeInsight[]
  /** Rows the server skipped because they describe nobody (totals, notes under the table). */
  skippedRows: number[]
  /** Domain corrections already applied: bad → good. */
  fixes: Readonly<Record<string, string>>
  disabled: boolean
  onFix: (from: string, to: string) => void
}) {
  const { t } = useTranslation()
  const known = insights.filter((insight) => INSIGHT_CODES.has(insight.code))

  const rowsText = (rows: number[]) => {
    const { shown, more } = rowList(rows)
    if (more > 0) return t('users.intake.insight.rowsMore', { rows: shown, more })
    return rows.length === 1
      ? t('users.intake.insight.rowsOne', { rows: shown })
      : t('users.intake.insight.rowsMany', { rows: shown })
  }

  const sentence = (insight: IntakeInsight, fixed: boolean) => {
    const params = {
      rows: rowsText(insight.rows),
      count: insight.rows.length,
      value: insight.value ?? '',
      suggestion: insight.suggestion ?? '',
    }
    if (insight.code === 'email_typo' && fixed) return t('users.intake.insight.email_typoFixed', params)
    if (insight.code === 'new_department') {
      return insight.rows.length === 1
        ? t('users.intake.insight.new_departmentOne', params)
        : t('users.intake.insight.new_departmentMany', params)
    }
    return t(`users.intake.insight.${insight.code}`, params)
  }

  return (
    <section
      aria-labelledby="intake-insights"
      data-slot="intake-insights"
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-line-default bg-surface-card px-5 py-4 shadow-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="intake-insights" className="m-0 text-xl">
          {t('users.intake.insight.title')}
        </h3>
        <span className="text-xs text-fg-tertiary">{t('users.intake.insight.note')}</span>
      </div>
      {known.length === 0 && skippedRows.length === 0 ? (
        <p className="m-0 flex items-center gap-2 text-sm text-fg-secondary">
          <CircleCheck aria-hidden="true" className="size-4 text-accent-green" />
          {t('users.intake.insight.none')}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {known.map((insight) => {
            const fixed =
              insight.code === 'email_typo' &&
              insight.value !== null &&
              fixes[insight.value.toLowerCase()] !== undefined
            const tone = fixed ? 'good' : (TONE[insight.code] ?? 'neutral')
            const fix =
              insight.code === 'email_typo' && !fixed && insight.value && insight.suggestion
                ? { from: insight.value.toLowerCase(), to: insight.suggestion }
                : null
            return (
              <li
                key={`${insight.code}:${insight.value ?? ''}`}
                data-insight={insight.code}
                className={cn(
                  'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-1 py-1',
                  fixed && 'text-fg-secondary',
                )}
              >
                <IconBox size="sm" tone={tone}>
                  {fixed ? <CircleCheck /> : ICON[insight.code]}
                </IconBox>
                <span className="min-w-48 flex-1 text-sm leading-snug text-fg-primary">{sentence(insight, fixed)}</span>
                {fix && (
                  <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onFix(fix.from, fix.to)}>
                    {t('users.intake.insight.fix')}
                  </Button>
                )}
              </li>
            )
          })}
          {skippedRows.length > 0 && (
            <li data-insight="skipped_rows" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-1 py-1">
              <IconBox size="sm" tone="neutral">
                <ListX />
              </IconBox>
              <span className="min-w-0 flex-1 text-sm leading-snug text-fg-primary">
                {skippedRows.length === 1
                  ? t('users.intake.insight.skipped_rowsOne', { rows: rowsText(skippedRows) })
                  : t('users.intake.insight.skipped_rowsMany', { count: skippedRows.length, rows: rowsText(skippedRows) })}
              </span>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}
