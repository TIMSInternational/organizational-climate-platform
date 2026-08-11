import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui'
import { useTranslation } from '../../../i18n'
import { formatNotificationTimestamp } from '../../notifications/formatTimestamp'
import type { ProfileActivityEntry } from '../api/profile'

/**
 * Catalogue paths for the actions the profile routes record.
 *
 * A lookup keyed by the API's own vocabulary, so an action with no copy renders as the raw
 * wire value rather than as a blank cell. That fallback is deliberate and not laziness:
 * `audit_logs` is a shared table, and the day something else starts writing to it this list
 * should show the new events legibly-if-untranslated rather than hide them.
 */
const ACTION_LABEL_PATH: Record<string, string> = {
  'profile.update': 'profile.activityProfileUpdate',
  'profile.password_change': 'profile.activityPasswordChange',
  'profile.preferences_update': 'profile.activityPreferencesUpdate',
}

export interface ProfileActivityListProps {
  entries: ProfileActivityEntry[]
}

/**
 * The caller's own audit trail.
 *
 * Failed events are shown, not filtered out — a run of failed password attempts on one's
 * own account is precisely what an activity list is for, and hiding them would make it a
 * list of things that went fine.
 */
export default function ProfileActivityList({ entries }: ProfileActivityListProps) {
  const { t, locale } = useTranslation()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('profile.activityTitle')}</CardTitle>
        <CardDescription>{t('profile.activityDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('profile.activityWhen')}</TableHead>
              <TableHead>{t('profile.activityWhat')}</TableHead>
              <TableHead>{t('profile.activityResult')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableEmpty colSpan={3}>{t('profile.activityEmpty')}</TableEmpty>
            ) : (
              entries.map((entry) => {
                const labelPath = ACTION_LABEL_PATH[entry.action]
                return (
                  <TableRow key={entry.id}>
                    {/* A reading, so the mono face with tabular figures — which is also
                        what keeps a column of timestamps aligned rather than ragged. */}
                    <TableCell className="whitespace-nowrap font-mono tabular-nums">
                      {formatNotificationTimestamp(entry.timestamp, locale)}
                    </TableCell>
                    <TableCell>{labelPath ? t(labelPath) : entry.action}</TableCell>
                    <TableCell>
                      <Badge variant={entry.success ? 'success' : 'destructive'}>
                        {entry.success ? t('profile.activitySucceeded') : t('profile.activityFailed')}
                      </Badge>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
