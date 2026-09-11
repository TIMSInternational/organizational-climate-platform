import type { TranslateFn } from '../../../i18n'
import type { InboxRow } from './derive'

/**
 * SAMPLE DATA. Not a notification anyone received.
 *
 * `GET /notifications/mine` answers an empty inbox for every Meridiano account today (measured
 * 10 and 11 Sep, read-only, as the company administrator: `{"notifications":[]}`), because the
 * local mail sender refuses `.test` addresses and nothing else writes in-app rows for the demo
 * tenant yet (triage row "Notificaciones, ajustes, perfil"). The same endpoint provides these
 * rows once the producers write them: `InvitationReminderJob` (survey reminders, deadline
 * reminders), `SurveyDistributionEndpoints` (reminders), `DeliveringScheduledReportRunner` and
 * `DigestJob` (system notifications).
 *
 * The page shows these ONLY when the real inbox loaded and is empty, under the "Datos de
 * muestra" chip, with their actions inert. They are the artboard's six rows. Their words are
 * catalogue copy (`notifications.next.sample.<copyKey>.title` / `.body`, in both locales), so an
 * English viewer reads the stand-ins in English; this module holds only their shape.
 */
interface SampleRow extends Omit<InboxRow, 'title' | 'body'> {
  /** The row's entry under `notifications.next.sample`. */
  copyKey: string
}

const SAMPLE_SHAPES: readonly SampleRow[] = [
  {
    id: 'sample-plan-overdue',
    copyKey: 'planOverdue',
    kind: 'plans',
    icon: 'alert',
    unread: true,
    createdAt: '2026-08-21T14:00:00Z',
    action: { labelKey: 'notifications.next.actionProgress', href: '' },
  },
  {
    id: 'sample-report-q3',
    copyKey: 'reportQ3',
    kind: 'reports',
    icon: 'report',
    unread: true,
    createdAt: '2026-08-07T14:00:00Z',
    action: { labelKey: 'notifications.next.actionReport', href: '' },
  },
  {
    id: 'sample-q3-closed',
    copyKey: 'q3Closed',
    kind: 'surveys',
    icon: 'survey',
    unread: true,
    createdAt: '2026-08-06T14:00:00Z',
    action: { labelKey: 'notifications.next.actionResults', href: '' },
  },
  {
    id: 'sample-q3-reminder',
    copyKey: 'q3Reminder',
    kind: 'surveys',
    icon: 'reminder',
    unread: false,
    createdAt: '2026-07-30T14:00:00Z',
    action: null,
  },
  {
    id: 'sample-q2-closed',
    copyKey: 'q2Closed',
    kind: 'surveys',
    icon: 'survey',
    unread: false,
    createdAt: '2026-05-13T14:00:00Z',
    action: { labelKey: 'notifications.next.actionResults', href: '' },
  },
  {
    id: 'sample-report-q2',
    copyKey: 'reportQ2',
    kind: 'reports',
    icon: 'report',
    unread: false,
    createdAt: '2026-05-14T14:00:00Z',
    action: null,
  },
]

/** The six stand-in rows in the viewer's language. */
export function sampleRows(t: TranslateFn): InboxRow[] {
  return SAMPLE_SHAPES.map(({ copyKey, ...row }) => ({
    ...row,
    title: t(`notifications.next.sample.${copyKey}.title`),
    body: t(`notifications.next.sample.${copyKey}.body`),
  }))
}
