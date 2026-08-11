import { Lock, Tags } from 'lucide-react'
import type { DemographicField } from '../api/demographicFields'
import { useTranslation } from '../../../i18n'
import {
  Badge,
  Button,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui'
import { ProtectedCell, formatMetric, isSuppressed } from '../../../components/charts'
import { peoplePerValue } from './demographicReach'

/**
 * The demographic fields table — the cuts results can be broken down by.
 *
 * ## What the redesign added, and why it is not decoration
 *
 * The old table listed key, label, type, required and active: five facts about
 * the *definition* of a field and none about what it does to a sample. But a
 * demographic field's whole effect is that it **divides the company**, and every
 * division is checked against the anonymity floor before the cut can be offered.
 * So the table now says how many values a field has, how many people that leaves
 * per value, and whether the cut is usable at all.
 *
 * ## The arithmetic, and why it is a proof rather than an estimate
 *
 * `peoplePerValue` is the *mean* group size — `⌊people / values⌋` — not a guess at
 * the smallest one. That matters, because the mean is what makes the verdict
 * sound: if the mean is below the floor then the smallest group is below it too
 * (it cannot exceed the mean), so "too narrow" is proved rather than predicted.
 * The converse is deliberately **not** claimed: a mean above the floor says the
 * cut *can* clear it, not that every value does. See `demographicReach.ts`.
 *
 * ## Three verdicts, each carrying a word
 *
 * - `select` clearing the floor — **usable**.
 * - `select` under it — **too narrow**, padlocked, and the mean itself is
 *   withheld as a `ProtectedCell`. A sub-floor group size is exactly the figure
 *   the floor exists to keep unpublished; printing "2 people per team" beside a
 *   known headcount is the arithmetic an attacker wants. Shown as protected, never
 *   as a blank — a blank would read as missing data instead of as a guarantee.
 * - Anything else — a `text`/`number`/`date` field, or a `select` with no options
 *   yet — has no fixed value list, so its groups cannot be counted ahead of time
 *   at all: **not checkable**, which is a different statement from failing the
 *   check and is not dressed up as one.
 *
 * Colour never does this alone: each verdict is a Badge with the word in it.
 *
 * ## Why the two measured columns disappear together
 *
 * Both need the company headcount, which comes from the dashboard rather than
 * from this endpoint. Without it there is no reading, and a column of dashes would
 * claim there was one and it was empty. The definition columns stand alone.
 */

/** The only field type with a fixed, countable list of values. */
const FIXED_VALUE_TYPE = 'select'

export default function DemographicFieldList({
  fields,
  people,
  threshold = 5,
  onEdit,
}: {
  fields: DemographicField[]
  /**
   * Active people in the company, the numerator every group size is divided out
   * of. Omit it and the two measured columns are not rendered at all.
   */
  people?: number
  /** The anonymity floor. See `charts/ProtectedCell.tsx`. */
  threshold?: number
  onEdit: (field: DemographicField) => void
}) {
  const { t, locale } = useTranslation()

  const typeLabels: Record<string, string> = {
    select: t('demographicFields.typeSelect'),
    text: t('demographicFields.typeText'),
    number: t('demographicFields.typeNumber'),
    date: t('demographicFields.typeDate'),
  }

  if (fields.length === 0) {
    // A designed state rather than one sentence. A bare <p> in an otherwise empty
    // panel reads as a page that failed to load, not as "there is nothing here
    // yet" -- and it gave no clue what a demographic field is for or why anyone
    // would add one. No action is passed: the page's own "New field" button is
    // already in the header directly above this, and a second button would be two
    // controls for one job.
    return (
      <EmptyState
        fill
        icon={<Tags className="size-6" aria-hidden="true" />}
        title={t('users.noDemographicFieldsYet')}
        description={t('users.noDemographicFieldsDescription')}
      />
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line-light">
      <Table>
        <TableHeader className="bg-surface-icon-box">
          <TableRow>
            <TableHead className="text-2xs uppercase tracking-label text-fg-tertiary">
              {t('demographicFields.field')}
            </TableHead>
            <TableHead className="text-2xs uppercase tracking-label text-fg-tertiary">
              {t('common.type')}
            </TableHead>
            <TableHead className="text-2xs uppercase tracking-label text-fg-tertiary">
              {t('demographicFields.values')}
            </TableHead>
            {people !== undefined && (
              <TableHead className="text-2xs uppercase tracking-label text-fg-tertiary">
                {t('demographicFields.peoplePerValue')}
              </TableHead>
            )}
            {people !== undefined && (
              <TableHead className="text-2xs uppercase tracking-label text-fg-tertiary">
                {t('demographicFields.usable')}
              </TableHead>
            )}
            <TableHead className="text-2xs uppercase tracking-label text-fg-tertiary">
              {t('common.actions')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fields.map((field) => {
            const bounded = field.type === FIXED_VALUE_TYPE
            const valueCount = field.options?.length ?? 0
            const perValue = bounded && people !== undefined ? peoplePerValue(people, valueCount) : null
            const tooNarrow = perValue !== null && isSuppressed(perValue, threshold)

            return (
              <TableRow key={field.id}>
                <TableCell>
                  <span className="grid gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      {/* `label` is nullable on the wire; the key is not, and is
                          the name an admin typed. */}
                      <span className="font-medium text-fg-primary">{field.label ?? field.field}</span>
                      {field.required && (
                        <Badge variant="secondary">{t('common.required')}</Badge>
                      )}
                      {!field.isActive && <Badge variant="outline">{t('common.inactive')}</Badge>}
                    </span>
                    {/* The key is shown so an admin can see which keys are already
                        taken — without it, a duplicate-key 409 (POST
                        /admin/demographic-fields) gives no clue which of the fields
                        below is the collision. */}
                    <span className="font-mono text-sm text-fg-tertiary">{field.field}</span>
                  </span>
                </TableCell>

                <TableCell>
                  {/* `type` is a server enum, not copy — `DemographicFieldForm`
                      offers exactly these four. Translated where the catalogue
                      knows the value and echoed verbatim where it does not, so a
                      type added server-side still renders instead of blanking. */}
                  <Badge variant="secondary">{typeLabels[field.type] ?? field.type}</Badge>
                </TableCell>

                <TableCell>
                  {bounded ? (
                    <span className="font-mono tabular-nums text-fg-primary">
                      {formatMetric(valueCount, { kind: 'number' }, locale)}
                    </span>
                  ) : (
                    <span className="text-fg-tertiary">{t('demographicFields.unbounded')}</span>
                  )}
                </TableCell>

                {people !== undefined && (
                  <TableCell>
                    {perValue === null ? (
                      <span className="text-fg-tertiary">{t('demographicFields.notCountable')}</span>
                    ) : (
                      <ProtectedCell
                        // `perValue` is itself the count under test, so passing it
                        // here is what makes the cell protect exactly the figures
                        // the floor covers — and `ProtectedCell` never renders or
                        // announces the number it was given.
                        responses={perValue}
                        threshold={threshold}
                        description={field.label ?? field.field}
                        suppressedClassName="h-5 w-14"
                      >
                        <span className="font-mono tabular-nums text-fg-primary">
                          {formatMetric(perValue, { kind: 'number' }, locale)}
                        </span>
                      </ProtectedCell>
                    )}
                  </TableCell>
                )}

                {people !== undefined && (
                  <TableCell>
                    {perValue === null ? (
                      // Covers both shapes of "no fixed value list": a free-text
                      // type, and a `select` that has not been given options yet.
                      // Neither can be checked against the floor, which is a
                      // different statement from failing the check.
                      <Badge variant="secondary">{t('demographicFields.notCheckable')}</Badge>
                    ) : tooNarrow ? (
                      <Badge variant="warning">
                        <Lock aria-hidden="true" />
                        {t('demographicFields.tooNarrow')}
                      </Badge>
                    ) : (
                      <Badge variant="success">{t('common.yes')}</Badge>
                    )}
                  </TableCell>
                )}

                <TableCell>
                  <Button variant="outline" size="sm" onClick={() => onEdit(field)}>
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
