import type { Department } from '../api/departments'
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

/**
 * The department table, shared by `DepartmentsPage` (#142) and the departments
 * section still embedded in `CompanyDetailPage`.
 *
 * ## Why the parent column resolves a name rather than printing an id
 *
 * `DepartmentListItem` carries `parentDepartmentId` and nothing else about the
 * parent — the server ships one flat array per company, not a tree. Falling back
 * to an em dash rather than the raw GUID matters because a GUID in a table cell
 * reads as data to a viewer and is not.
 *
 * `parentLookup` exists because `departments` may be a *filtered* view: a search
 * or an active-only toggle can hide the parent while its child is still on
 * screen, and resolving against the visible rows alone would blank a parent name
 * that is perfectly well known. Callers that show the whole list omit it.
 *
 * ## Active/inactive is a word, never a colour alone
 *
 * `secondary` and `outline` are the two Badge variants measured to clear WCAG AA
 * against `tokens.css` in **both** themes (the measured table lives in
 * `reports/components/ReportList.tsx`). The label carries the meaning, so nothing
 * here depends on a hue being distinguishable.
 *
 * The empty case is kept — `CompanyDetailPage` renders this component with no
 * surrounding empty state of its own. `DepartmentsPage` short-circuits to a full
 * `EmptyState` before it gets here, so the two never both appear.
 */
export default function DepartmentList({
  departments,
  parentLookup,
  onEdit,
}: {
  departments: Department[]
  /** Rows to resolve parent names against. Defaults to `departments`. */
  parentLookup?: Department[]
  onEdit: (department: Department) => void
}) {
  const { t } = useTranslation()

  if (departments.length === 0) {
    return <p className="text-fg-secondary">{t('departments.noDepartmentsYet')}</p>
  }

  const byId = new Map((parentLookup ?? departments).map((d) => [d.id, d]))

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('departments.name')}</TableHead>
          <TableHead>{t('common.parent')}</TableHead>
          <TableHead>{t('common.status')}</TableHead>
          <TableHead>{t('dashboard.employees')}</TableHead>
          <TableHead>{t('common.actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {departments.map((department) => (
          <TableRow key={department.id}>
            <TableCell>
              <span className="grid gap-1">
                <span className="font-medium text-fg-primary">{department.name}</span>
                {department.description && (
                  <span className="text-sm text-fg-secondary">{department.description}</span>
                )}
              </span>
            </TableCell>
            <TableCell className="text-fg-secondary">
              {department.parentDepartmentId
                ? byId.get(department.parentDepartmentId)?.name ?? '—'
                : '—'}
            </TableCell>
            <TableCell>
              <Badge variant={department.isActive ? 'secondary' : 'outline'}>
                {department.isActive ? t('common.active') : t('common.inactive')}
              </Badge>
            </TableCell>
            <TableCell>{department.employeeCount}</TableCell>
            <TableCell>
              <Button variant="outline" size="sm" onClick={() => onEdit(department)}>
                {t('common.edit')}
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
