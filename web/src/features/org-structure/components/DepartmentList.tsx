import { Lock } from 'lucide-react'
import type { Department } from '../api/departments'
import { departmentRows } from './departmentHierarchy'
import { useTranslation } from '../../../i18n'
import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui'
import { ProtectedCell, formatMetric, isSuppressed } from '../../../components/charts'

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
 * 2. **Every reading in mono.** People and the response count are both
 *    `font-mono tabular-nums`; the names and the descriptions stay in the sans
 *    face. That one typographic split is what makes the page read as an
 *    instrument rather than a dashboard, and tabular figures are what stop a
 *    column of numbers from jittering as it re-renders.
 * 3. **The floor, twice, for two different reasons.** *Reportable* answers a
 *    structural question from the headcount — a department of four people can
 *    never gather five responses, so it will never be reported on its own, and
 *    that is worth knowing before a survey is sent. *Responses* answers a
 *    measured one from what is actually in hand. They disagree often and
 *    should: a department of 48 with three responses is reportable in principle
 *    and protected today.
 *
 * ## Why the measured column is a count and not a rate
 *
 * The only per-department measurement this client can reach for every department
 * at once is `completedResponseCount` on `GET /dashboard/company-admin`. In
 * `DashboardQueries.DepartmentSummaries` that field is
 * `responses.Count(r => r.DepartmentId == d.Id && r.CompanyId == companyId && r.IsComplete)`
 * — **no survey predicate**. It is therefore every completed response the
 * department has ever submitted, across every survey it has ever been sent, and
 * it accumulates for as long as the company keeps running surveys.
 *
 * Dividing that by the current headcount does not produce a participation rate.
 * It produces a number that passes 100% the moment a company runs its second
 * survey and keeps climbing — a dial reading 270% with its needle pinned at full
 * scale. On a screen whose whole thesis is *an instrument, not a dashboard*, a
 * mis-calibrated dial is worse than no dial, so the column reports the count it
 * actually has and labels its units in the header. A true rate needs a
 * per-survey denominator that no endpoint on this client offers.
 *
 * ## Why a suppressed reading is a `ProtectedCell` and never a dash
 *
 * An empty cell reads as *missing data* — as if the product failed to collect
 * something. The hatched, padlocked cell with "protected" in its accessible name
 * says the opposite: a guarantee was enforced. The response count behind it is
 * never rendered and never announced; see `charts/ProtectedCell.tsx` for why
 * publishing it would defeat the floor it is enforcing.
 *
 * ## …and why a department with no reading at all is neither
 *
 * `DashboardEndpoints.cs` holds `private const int DepartmentRowLimit = 12` and
 * passes it to `DashboardQueries.DepartmentSummaries`, which is
 * `.OrderBy(d => d.Name).ThenBy(d => d.Id).Take(limit)`. Nothing on the summary
 * row says it was the last one the limit allowed — the payload's only clue is
 * that its company-wide `departmentCount` can exceed `departments.length`, which
 * says *that* rows were dropped and never *which*. So a company with more than
 * twelve departments gets readings for twelve of them and silence for the rest,
 * and per row that silence is indistinguishable from a department that answered
 * nothing.
 *
 * Reading that silence as zero would put a padlock on every department past the
 * twelfth and announce "protected" over data the app never asked for — the
 * anonymity principle running backwards, dressing a gap up as a guarantee. So a
 * department missing from the map is rendered as **not measured**, in words:
 * neither a reading, nor a suppression, nor a bare dash.
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

/** What has actually been collected from one department. */
export interface DepartmentReading {
  /**
   * Completed responses to date, across every survey — see the units note above.
   * Decides suppression, and below the floor is never rendered and never
   * announced.
   */
  responses: number
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
   * Omit it and the Responses column is not rendered at all. That is the honest
   * option for a caller with no measurement to show — `CompanyDetailPage` lists
   * departments as part of a company profile and never loads a dashboard — and it
   * is better than a column of placeholders, which would read as "measured, and
   * the answer is nothing".
   *
   * A department **missing from the map** is a department the source did not
   * report on, which is not the same claim as "it reported nothing". The lookup
   * therefore does not fall back to zero; see the truncation note above.
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
                {/* An instrument labels its units. The second line is what keeps
                    the column from being read as a rate: the figure below it is a
                    running total across every survey the department has been
                    sent, not a share of anything.

                    It is set apart by case and tracking, NOT by a dimmer ink. The
                    obvious `text-fg-light` measures 1.93:1 against
                    `--admin-bg-icon-box` in the dark theme and 2.5:1 in the light
                    one — below any legibility bar there is, at 2xs. Inheriting the
                    header's own `text-fg-tertiary` keeps the units exactly as
                    readable as the label they qualify. */}
                <span className="grid gap-0.5">
                  <span>{t('departments.responses')}</span>
                  <span className="font-normal normal-case tracking-normal">
                    {t('departments.responsesUnit')}
                  </span>
                </span>
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
            // Deliberately NOT `?? 0`: absent is "not reported on", which is a
            // different statement from "reported as zero" and must not be turned
            // into a suppression. See the truncation note above.
            const reading = readings?.get(department.id)

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
                    {reading === undefined ? (
                      // A word, not a dash and not a padlock: the source did not
                      // report on this department, so there is nothing to read and
                      // nothing to protect.
                      <span className="text-sm text-fg-tertiary">
                        {t('departments.notMeasured')}
                      </span>
                    ) : (
                      <ProtectedCell
                        responses={reading.responses}
                        threshold={threshold}
                        description={department.name}
                        suppressedClassName="h-5 w-14"
                      >
                        <span className="font-mono tabular-nums text-fg-primary">
                          {formatMetric(reading.responses, { kind: 'number' }, locale)}
                        </span>
                      </ProtectedCell>
                    )}
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
