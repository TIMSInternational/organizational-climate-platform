import { Lock } from 'lucide-react'
import type { Department } from '../api/departments'
import { departmentRows } from './departmentHierarchy'
import { useTranslation } from '../../../i18n'
import {
  Badge,
  Button,
  Progress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui'
import {
  ProtectedCell,
  formatMetric,
  isSuppressed,
  participationRate,
} from '../../../components/charts'

/**
 * The department table, shared by `DepartmentsPage` (#142) and the departments
 * section still embedded in `CompanyDetailPage`.
 *
 * ## The redesign: a structure, and a reading, and the floor between them
 *
 * The table is the screen, so it carries three things rather than one:
 *
 * 1. **The tree.** The server ships a flat array sorted by name, so a child sat
 *    wherever the alphabet put it. `departmentRows` re-orders it depth-first and
 *    returns a depth per row, which becomes the indent guides in the first cell.
 *    The Parent column stays: the indent shows the shape, the name says whose.
 * 2. **Every reading in mono.** People, responses and the participation figure are
 *    all `font-mono tabular-nums`; the names and the descriptions stay in the sans
 *    face. That one typographic split is what makes the page read as an
 *    instrument rather than a dashboard, and tabular figures are what stop a
 *    column of numbers from jittering as it re-renders.
 * 3. **The floor, twice, for two different reasons.** *Reportable* answers a
 *    structural question from the headcount — a department of four people can
 *    never gather five responses, so it will never be reported on its own, and
 *    that is worth knowing before a survey is sent. *Participation* answers a
 *    measured one from the responses actually in hand. They disagree often and
 *    should: a department of 48 with three responses is reportable in principle
 *    and protected today.
 *
 * ## Why a suppressed reading is a `ProtectedCell` and never a dash
 *
 * An empty cell reads as *missing data* — as if the product failed to collect
 * something. The hatched, padlocked cell with "protected" in its accessible name
 * says the opposite: a guarantee was enforced. The response count behind it is
 * never rendered and never announced; see `charts/ProtectedCell.tsx` for why
 * publishing it would defeat the floor it is enforcing.
 *
 * ## Active/inactive is a word, never a colour alone
 *
 * `secondary` and `outline` are the two Badge variants measured to clear WCAG AA
 * against `tokens.css` in **both** themes (the measured table lives in
 * `reports/components/ReportList.tsx`). The label carries the meaning, so nothing
 * here depends on a hue being distinguishable. The same rule governs the
 * Reportable badge: `success`/`warning` always with the word beside them.
 *
 * The empty case is kept — `CompanyDetailPage` renders this component with no
 * surrounding empty state of its own. `DepartmentsPage` short-circuits to a full
 * `EmptyState` before it gets here, so the two never both appear.
 */

/** What a survey has actually collected from one department. */
export interface DepartmentReading {
  /** Completed responses. Decides suppression; never rendered, never announced. */
  responses: number
  /** People the responses are measured against. */
  members: number
}

export default function DepartmentList({
  departments,
  parentLookup,
  readings,
  threshold = 5,
  onEdit,
}: {
  departments: Department[]
  /** Rows to resolve parent names against. Defaults to `departments`. */
  parentLookup?: Department[]
  /**
   * Per-department response counts, keyed by department id.
   *
   * Omit it and the Participation column is not rendered at all. That is the
   * honest option for a caller with no measurement to show — `CompanyDetailPage`
   * lists departments as part of a company profile and never loads a dashboard —
   * and it is better than a column of placeholders, which would read as "measured,
   * and the answer is nothing".
   *
   * A department **present in the map's owner but missing from the map** is not a
   * gap: it has no completed responses, which is below the floor, which is a
   * `ProtectedCell`. So the lookup falls back to zero rather than to a blank.
   */
  readings?: ReadonlyMap<string, DepartmentReading>
  /** The anonymity floor. Per-company; see `charts/ProtectedCell.tsx`. */
  threshold?: number
  onEdit: (department: Department) => void
}) {
  const { t, locale } = useTranslation()

  if (departments.length === 0) {
    return <p className="text-fg-secondary">{t('departments.noDepartmentsYet')}</p>
  }

  const structure = parentLookup ?? departments
  const byId = new Map(structure.map((d) => [d.id, d]))
  const rows = departmentRows(departments, structure)

  return (
    <div className="overflow-hidden rounded-lg border border-line-light">
      <Table>
        <TableHeader className="bg-surface-icon-box">
          <TableRow>
            <TableHead className="text-2xs uppercase tracking-label text-fg-tertiary">
              {t('departments.name')}
            </TableHead>
            <TableHead className="text-2xs uppercase tracking-label text-fg-tertiary">
              {t('common.parent')}
            </TableHead>
            <TableHead className="text-2xs uppercase tracking-label text-fg-tertiary">
              {t('departments.people')}
            </TableHead>
            <TableHead className="text-2xs uppercase tracking-label text-fg-tertiary">
              {t('departments.reportable')}
            </TableHead>
            {readings && (
              <TableHead className="text-2xs uppercase tracking-label text-fg-tertiary">
                {t('departments.participation')}
              </TableHead>
            )}
            <TableHead className="text-2xs uppercase tracking-label text-fg-tertiary">
              {t('common.actions')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ department, depth }) => {
            // The structural floor: fewer people than the floor means this
            // department can never be reported on its own, whatever it answers.
            const canBeReported = !isSuppressed(department.employeeCount, threshold)
            const reading = readings?.get(department.id)
            const responses = reading?.responses ?? 0
            const rate = participationRate(responses, reading?.members ?? department.employeeCount)

            return (
              <TableRow key={department.id}>
                <TableCell>
                  <span className="flex items-stretch gap-2">
                    {depth > 0 && (
                      // The indent guides. `aria-hidden` because the Parent column
                      // beside them already says, in words, whose child this is —
                      // announcing "level 2" as well would be the same fact twice.
                      <span aria-hidden="true" className="flex shrink-0">
                        {Array.from({ length: depth }, (_, level) => (
                          <span key={level} className="w-4 border-l border-line-default" />
                        ))}
                      </span>
                    )}
                    <span className="grid min-w-0 gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-fg-primary">{department.name}</span>
                        <Badge variant={department.isActive ? 'secondary' : 'outline'}>
                          {department.isActive ? t('common.active') : t('common.inactive')}
                        </Badge>
                      </span>
                      {department.description && (
                        <span className="text-sm text-fg-tertiary">{department.description}</span>
                      )}
                    </span>
                  </span>
                </TableCell>

                <TableCell className="text-fg-secondary">
                  {department.parentDepartmentId
                    ? byId.get(department.parentDepartmentId)?.name ?? '—'
                    : '—'}
                </TableCell>

                <TableCell className="font-mono tabular-nums text-fg-primary">
                  {formatMetric(department.employeeCount, { kind: 'number' }, locale)}
                </TableCell>

                <TableCell>
                  {canBeReported ? (
                    <Badge variant="success">{t('common.yes')}</Badge>
                  ) : (
                    <Badge variant="warning">
                      <Lock aria-hidden="true" />
                      {t('departments.underFloor', { threshold })}
                    </Badge>
                  )}
                </TableCell>

                {readings && (
                  <TableCell>
                    <ProtectedCell
                      responses={responses}
                      threshold={threshold}
                      description={department.name}
                      suppressedClassName="h-5 w-20"
                    >
                      <span className="flex items-center gap-2">
                        {/* `aria-hidden`: the bar and the figure beside it are one
                            reading, and Radix would otherwise announce a second
                            progressbar with the same number. */}
                        <Progress
                          aria-hidden="true"
                          value={rate === null ? 0 : Math.min(100, Math.max(0, rate))}
                          className="w-16"
                        />
                        <span className="font-mono text-sm tabular-nums text-fg-secondary">
                          {/* `rate` is null only when there is no denominator to
                              measure against, which `formatMetric` renders as an
                              em dash rather than as a percentage of nothing.
                              `decimals: 0` because the tenth of a percent is noise
                              at this size and it is the digit that changes most —
                              a column of readings should be readable, not busy. */}
                          {formatMetric(rate ?? Number.NaN, { kind: 'percentage', decimals: 0 }, locale)}
                        </span>
                      </span>
                    </ProtectedCell>
                  </TableCell>
                )}

                <TableCell>
                  <Button variant="outline" size="sm" onClick={() => onEdit(department)}>
                    {t('common.edit')}
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
