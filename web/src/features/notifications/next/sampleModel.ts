import type { InboxRow } from './derive'

/**
 * SAMPLE DATA. Not a notification anyone received.
 *
 * `GET /notifications/mine` answers an empty inbox for every Meridiano account today (measured
 * 10 Sep, read-only, as the company administrator: `{"notifications":[]}`), because the local
 * mail sender refuses `.test` addresses and nothing else writes in-app rows for the demo tenant
 * yet (triage row "Notificaciones, ajustes, perfil"). The same endpoint provides these rows once
 * the producers write them: `InvitationReminderJob` (survey reminders, deadline reminders),
 * `SurveyDistributionEndpoints` (reminders), `DeliveringScheduledReportRunner` and `DigestJob`
 * (system notifications).
 *
 * The page shows these ONLY when the real inbox loaded and is empty, under the "Datos de
 * muestra" chip, with their actions inert. They are the artboard's six rows, verbatim, so the
 * screen can be compared with the design; the text is tenant content, not interface copy.
 */
export const SAMPLE_ROWS: readonly InboxRow[] = [
  {
    id: 'sample-plan-overdue',
    kind: 'plans',
    icon: 'alert',
    unread: true,
    name: 'Plan atrasado en Finanzas',
    body: 'Reponer la reunión de handover entre turnos venció el 20 de agosto. Responsable Adriana Marín · 0 % de avance.',
    createdAt: '2026-08-21T14:00:00Z',
    action: { labelKey: 'notifications.next.actionProgress', href: '' },
  },
  {
    id: 'sample-report-q3',
    kind: 'reports',
    icon: 'report',
    unread: true,
    name: 'Informe de la Encuesta de Clima Q3 listo',
    body: 'Se generó con las 24 respuestas. Se puede compartir por enlace o exportar.',
    createdAt: '2026-08-07T14:00:00Z',
    action: { labelKey: 'notifications.next.actionReport', href: '' },
  },
  {
    id: 'sample-q3-closed',
    kind: 'surveys',
    icon: 'survey',
    unread: true,
    name: 'Encuesta de Clima Q3 cerró',
    body: '24 de 24 respuestas · 100 %. Los resultados por grupo ya se pueden ver; Finanzas queda protegido.',
    createdAt: '2026-08-06T14:00:00Z',
    action: { labelKey: 'notifications.next.actionResults', href: '' },
  },
  {
    id: 'sample-q3-reminder',
    kind: 'surveys',
    icon: 'reminder',
    unread: false,
    name: 'Recordatorio enviado · Encuesta de Clima Q3',
    body: 'A las personas que aún no habían respondido. No se registra quiénes son.',
    createdAt: '2026-07-30T14:00:00Z',
    action: null,
  },
  {
    id: 'sample-q2-closed',
    kind: 'surveys',
    icon: 'survey',
    unread: false,
    name: 'Encuesta de Clima Q2 cerró',
    body: '24 respuestas. Los resultados ya se pueden ver.',
    createdAt: '2026-05-13T14:00:00Z',
    action: { labelKey: 'notifications.next.actionResults', href: '' },
  },
  {
    id: 'sample-report-q2',
    kind: 'reports',
    icon: 'report',
    unread: false,
    name: 'Informe de la Encuesta de Clima Q2 listo',
    body: 'Se generó con las 24 respuestas.',
    createdAt: '2026-05-14T14:00:00Z',
    action: null,
  },
]
