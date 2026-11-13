import type { BulkImportIssue, BulkImportRowResult } from '../../api/bulkImport'

/**
 * The reasons the server names by code, each with a sentence in both catalogues
 * (`users.intake.reason.*`). A code outside this set is one no screen was written for; it falls
 * back to the server's English rather than to nothing, because an unexplained red row is worse
 * than an untranslated one.
 *
 * Shared rather than copied: the review step and "Agregar una persona" both read the same
 * verdicts from the same route, and a set that existed twice would be a set that drifted once.
 */
export const INTAKE_REASON_CODES: ReadonlySet<string> = new Set([
  'name_required',
  'invalid_email',
  'invalid_role',
  'department_not_found',
  'department_inactive',
  'invalid_demographic',
  'already_user',
  'already_invited',
  'repeated_in_file',
])

/**
 * One refused row's reasons as sentences a reader can act on.
 *
 * `issues` carries stable codes and `errors` the server's English, in the same order, so a
 * code this screen knows is translated and anything else keeps the English. A row with no
 * `issues` at all comes from an API older than them, and its `errors` are all there is.
 */
export function intakeReasons(
  row: BulkImportRowResult,
  t: (key: string, vars?: Record<string, string | number>) => string,
  missingRoleLabel: string,
): string[] {
  if (!row.issues || row.issues.length === 0) return row.errors
  return row.issues.map((issue: BulkImportIssue, index: number) =>
    INTAKE_REASON_CODES.has(issue.code)
      ? t(`users.intake.reason.${issue.code}`, { value: issue.value || missingRoleLabel })
      : (row.errors[index] ?? issue.code),
  )
}
