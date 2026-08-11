import type { User } from '../api/users'
import { useTranslation } from '../../../i18n'
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui'
import { roleLabelKey } from '../labels'

/**
 * The roster: who can see what.
 *
 * ## The typographic rule
 *
 * Every *reading* is set in `font-mono tabular-nums` and everything that is prose
 * stays in the sans face. Here that is the email address and the last-activity
 * date. Neither is a measurement, but both are scanned down a column rather than
 * read across a line, and tabular figures are what keep a column of dates from
 * shivering as its widths change. The person's name, the role and the department
 * are prose and stay sans, which is what makes the mono columns read as data.
 *
 * ## Colour never carries state alone
 *
 * `Active` and `Inactive` differ in badge tone *and* in the word inside the
 * badge, so the state survives a monochrome print and a red/green
 * indistinguishable reader (WCAG 1.4.1). The role badge is deliberately neutral:
 * a role is an identity, not a state, and giving it a hue would put a second,
 * meaningless colour system next to the one that means something.
 */
interface UserListProps {
  users: User[]
  /** Every department in the company, for turning `departmentId` into a name. */
  departments: { id: string; name: string }[]
  onEdit: (user: User) => void
}

/**
 * Up to two initials, from the first and last whitespace-separated parts.
 *
 * `Array.from` rather than `charAt`: a name can begin with an astral-plane
 * character, and `charAt` would hand back half a surrogate pair.
 */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = Array.from(parts[0])[0] ?? ''
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? '') : ''
  return (first + last).toUpperCase()
}

export default function UserList({ users, departments, onEdit }: UserListProps) {
  const { t, locale } = useTranslation()

  const departmentNames = new Map(departments.map((d) => [d.id, d.name]))

  return (
    // The rule and radius live on a wrapper, not on the table: `Table` already
    // owns a horizontal scroll container, and a border painted on the table
    // itself would scroll away with the columns.
    <div className="overflow-hidden rounded-lg border border-line-light">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {/* `text-fg-secondary`, not tertiary: at `text-2xs` these are the
                smallest words on the page, and #818181 on the recessed surface
                measures under the 4.5:1 AA floor in light mode. Same finding, and
                the same fix, as `PageTopBar`'s description line. */}
            <TableHead className="bg-surface-icon-box text-2xs uppercase tracking-label text-fg-secondary">
              {t('users.name')}
            </TableHead>
            <TableHead className="bg-surface-icon-box text-2xs uppercase tracking-label text-fg-secondary">
              {t('users.email')}
            </TableHead>
            <TableHead className="bg-surface-icon-box text-2xs uppercase tracking-label text-fg-secondary">
              {t('users.role')}
            </TableHead>
            <TableHead className="bg-surface-icon-box text-2xs uppercase tracking-label text-fg-secondary">
              {t('users.department')}
            </TableHead>
            <TableHead className="bg-surface-icon-box text-2xs uppercase tracking-label text-fg-secondary">
              {t('common.status')}
            </TableHead>
            <TableHead className="bg-surface-icon-box text-2xs uppercase tracking-label text-fg-secondary">
              {t('users.lastActivity')}
            </TableHead>
            <TableHead className="bg-surface-icon-box text-right text-2xs uppercase tracking-label text-fg-secondary">
              {t('common.actions')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.length === 0 ? (
            <TableEmpty colSpan={7}>{t('users.noUsersFound')}</TableEmpty>
          ) : (
            users.map((user) => {
              const key = roleLabelKey(user.role)
              const department = user.departmentId
                ? departmentNames.get(user.departmentId)
                : undefined
              return (
                <TableRow key={user.id}>
                  <TableCell>
                    <span className="flex items-center gap-inline">
                      <Avatar className="size-icon-box rounded-md">
                        <AvatarFallback aria-hidden="true" className="rounded-md">
                          {initialsOf(user.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-semibold text-fg-primary">{user.name}</span>
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-sm tabular-nums text-fg-secondary">
                    {user.email}
                  </TableCell>
                  <TableCell>
                    {/* An unrecognised role prints the server's own token rather
                        than an invented English word — see `../labels.ts`. */}
                    <Badge variant="secondary">{key ? t(key) : user.role}</Badge>
                  </TableCell>
                  <TableCell className="text-fg-secondary">
                    {department ?? t('users.unassigned')}
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.isActive ? 'success' : 'secondary'}>
                      {user.isActive ? t('common.active') : t('common.inactive')}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm tabular-nums text-fg-secondary">
                    {user.lastLoginAt
                      ? new Date(user.lastLoginAt).toLocaleDateString(locale)
                      : t('users.neverSignedIn')}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" onClick={() => onEdit(user)}>
                      {t('common.edit')}
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>
    </div>
  )
}
