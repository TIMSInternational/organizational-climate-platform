import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Bell, Check, CircleAlert, ClipboardList, FileText, Mail, Send, Settings } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { Button, EmptyState, NetworkError, SkeletonText, Switch, chipVariants } from '../../../components/ui'
import { useViewerCapabilities } from '../../../auth/viewerCapabilities'
import { cn } from '../../../lib/cn'
import { CanvasChip, CanvasSelect, Panel } from '../../org-structure/next/super/parts'
import { PERIODS, facetCounts, matchesFacet, oldestShown, rowOf, withinPeriod, type Facet, type InboxRow, type RowIcon } from './derive'
import { useNotificationsModel } from './useNotificationsModel'

const K = 'notifications.next'
const FACETS: readonly Facet[] = ['all', 'unread', 'surveys', 'plans', 'reports', 'other']

const ICONS: Record<RowIcon, { Icon: typeof Bell; tone: string }> = {
  alert: { Icon: CircleAlert, tone: 'text-accent-red' },
  report: { Icon: FileText, tone: 'text-accent-blue' },
  survey: { Icon: ClipboardList, tone: 'text-accent-green-ink' },
  reminder: { Icon: Send, tone: 'text-fg-secondary' },
  other: { Icon: Bell, tone: 'text-fg-secondary' },
}

/**
 * `/notifications` — the Notifications artboard, which replaced `NotificationsInboxPage` on this
 * route (the old page stays in the tree, unrouted, as the wiring reference).
 *
 * What happened that the viewer should know: one row per notification with its unread mark,
 * kind and date and the ONE action it offers; the kinds as facet chips; a period select; and
 * beside it how notices reach them (in the app, by mail, the weekly digest), read from and
 * written to `/notifications/preferences`. Self-service for every role — the only role-shaped
 * thing is the results action, drawn only when `canOpenResults` allows it.
 *
 * Every row, count and date here is one `GET /notifications/mine` returned — the endpoint the
 * shell's bell polls — so the two unread readings on the screen are one reading. An empty
 * inbox is that payload's answer, not missing data: it is drawn as an empty inbox, with no
 * rows, no counts and nothing to mark read.
 */
export default function NotificationsNextPage() {
  const { t, locale } = useTranslation()
  const capabilities = useViewerCapabilities()
  const state = useNotificationsModel()
  const [facet, setFacet] = useState<Facet>('all')
  const [period, setPeriod] = useState(90)
  const [now] = useState(() => new Date())

  const rows = useMemo(
    () => state.notifications.map((notification) => rowOf(notification, capabilities.canOpenResults)),
    [state.notifications, capabilities],
  )
  // Counts, the period and "mark all" exist only once the inbox has answered with rows: while it
  // loads or after its request failed there is no count to print — never a 0 standing in for one.
  const empty = state.status === 'ready' && rows.length === 0
  const hasRows = state.status === 'ready' && rows.length > 0
  const inPeriod = rows.filter((row) => withinPeriod(row, period, now))
  const counts = facetCounts(inPeriod)
  const shown = inPeriod.filter((row) => matchesFacet(row, facet))
  const oldest = oldestShown(inPeriod, state.notifications.length)
  const unread = rows.filter((row) => row.unread).length
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })
  const longDay = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' })
  const localMail = state.email !== null && /\.test$/i.test(state.email.split('@')[1] ?? '')

  return (
    <div>
      <PageTopBar
        eyebrow={t(`${K}.eyebrow`)}
        title={t('notifications.title')}
        description={t(`${K}.description`)}
        actions={
          <>
            {/* Nothing to mark on an empty inbox, or before the inbox has answered, so the action
                is not offered then; with rows it keeps the artboard's weight and is disabled only
                while none is unread. */}
            {hasRows && (
              <Button variant="outline" size="canvas" disabled={unread === 0} onClick={() => void state.markAllRead()}>
                <Check aria-hidden="true" />
                {t(`${K}.markAll`)}
              </Button>
            )}
            <Button asChild variant="outline" size="canvas">
              <Link to="/settings/notifications">
                <Settings aria-hidden="true" />
                {t(`${K}.settings`)}
              </Link>
            </Button>
          </>
        }
      />

      <div className="-mt-1 grid gap-4 xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <section aria-label={t(`${K}.inboxLabel`)} className="min-w-0 overflow-hidden rounded-xl border border-line-default bg-surface-card shadow-sm">
          {state.status === 'error' ? (
            <div className="p-4">
              <NetworkError title={t('notifications.loadFailed')} description={state.error ?? undefined} onRetry={state.reload} retryText={t('common.retry')} />
            </div>
          ) : state.status === 'loading' ? (
            <div className="p-4">
              <SkeletonText lines={6} />
            </div>
          ) : empty ? (
            <div data-slot="inbox-empty" className="px-4 py-6">
              <EmptyState icon={<Bell aria-hidden="true" className="size-6" />} title={t(`${K}.emptyTitle`)} description={t(`${K}.emptyBody`)} />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div role="group" aria-label={t(`${K}.facetsLabel`)} className="flex flex-wrap items-center gap-1.5">
                  {FACETS.filter((value) => value !== 'other' || counts.other > 0).map((value) => {
                    const selected = facet === value
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={selected}
                        data-slot="facet-chip"
                        onClick={() => setFacet(value)}
                        className={cn(
                          chipVariants({ tone: selected ? 'critical' : 'neutral' }),
                          'h-6.5 cursor-pointer px-2.5 text-sm',
                          selected ? 'border-chip-critical-ink/20' : 'bg-surface-card hover:border-line-hover',
                        )}
                      >
                        {t(`${K}.facetCount`, { label: t(`${K}.facet.${value}`), count: counts[value] })}
                      </button>
                    )
                  })}
                </div>
                <CanvasSelect
                  aria-label={t(`${K}.periodLabel`)}
                  className="w-37.5"
                  value={String(period)}
                  onChange={(event) => setPeriod(Number(event.target.value))}
                >
                  {PERIODS.map((days) => (
                    <option key={days} value={days}>
                      {days === 0 ? t(`${K}.periodAll`) : t(`${K}.periodDays`, { days })}
                    </option>
                  ))}
                </CanvasSelect>
              </div>
              <ul className="m-0 list-none p-0">
                {shown.map((row) => (
                  <Row
                    key={row.id}
                    row={row}
                    date={day.format(new Date(row.createdAt)).replace('.', '')}
                    onOpen={() => {
                      if (row.unread) void state.markRead(row.id)
                    }}
                  />
                ))}
                {shown.length === 0 && <li className="border-t border-line-light px-4 py-3 text-xs text-fg-tertiary">{t(`${K}.nothingHere`)}</li>}
              </ul>
              {oldest && (
                <p className="m-0 border-t border-line-light px-4 py-2.5 text-xs text-fg-tertiary">
                  {t(`${K}.nothingBefore`, { date: longDay.format(new Date(oldest)) })}
                </p>
              )}
            </>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel heading={<h2 className="m-0 text-2xl">{t(`${K}.channelsHeading`)}</h2>} className="gap-3 pb-4.5">
            {state.preferences ? (
              <div className="flex flex-col gap-2.5 text-xs">
                <label className="m-0 flex items-center justify-between gap-2 text-xs font-normal text-fg-primary">
                  {t(`${K}.channelApp`)}
                  <Switch checked disabled className="data-[state=checked]:bg-accent-green disabled:opacity-100" aria-describedby="channel-app-note" />
                </label>
                <span id="channel-app-note" className="sr-only">
                  {t(`${K}.channelAppNote`)}
                </span>
                <label className="m-0 flex items-center justify-between gap-2 text-xs font-normal text-fg-primary">
                  {t(`${K}.channelEmail`)}
                  <Switch
                    className="data-[state=checked]:bg-accent-green"
                    checked={
                      state.preferences.emailSurveys ||
                      state.preferences.emailMicroclimates ||
                      state.preferences.emailActionPlans ||
                      state.preferences.emailReminders
                    }
                    onCheckedChange={(checked) =>
                      state.preferences &&
                      void state.savePreferences({
                        ...state.preferences,
                        emailSurveys: checked,
                        emailMicroclimates: checked,
                        emailActionPlans: checked,
                        emailReminders: checked,
                      })
                    }
                  />
                </label>
                <label className="m-0 flex items-center justify-between gap-2 text-xs font-normal text-fg-primary">
                  {t(`${K}.channelDigest`)}
                  <Switch
                    className="data-[state=checked]:bg-accent-green"
                    checked={state.preferences.digestFrequency === 'weekly'}
                    onCheckedChange={(checked) =>
                      state.preferences && void state.savePreferences({ ...state.preferences, digestFrequency: checked ? 'weekly' : 'never' })
                    }
                  />
                </label>
              </div>
            ) : (
              <p className="m-0 text-xs text-fg-tertiary">{t(`${K}.preferencesUnavailable`)}</p>
            )}
            {/* The artboard's link is the secondary ink (`a { color: #4a3d72 }`), not the
                app's blue link colour the base layer gives every anchor. */}
            <Link to="/settings/notifications" data-slot="by-type-link" className="text-xs text-fg-secondary">
              {t(`${K}.byType`)}
            </Link>
          </Panel>
          {localMail && (
            // The local stack's mail sender refuses `.test`, `.invalid` and `example.com`
            // recipients (`EmailNotificationSender.cs:90`), so on it a notice exists only here.
            <p data-slot="local-mail-note" className="m-0 flex items-start gap-2.5 rounded-lg border border-line-light bg-surface-icon-box px-3.5 py-3 text-xs leading-normal text-fg-secondary">
              <Mail aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                <strong className="font-semibold">{t(`${K}.localMailLead`)}</strong> {t(`${K}.localMailBefore`)}{' '}
                <span className="font-mono">{t(`${K}.localMailDomain`)}</span>
                {t(`${K}.localMailAfter`)}
              </span>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ row, date, onOpen }: { row: InboxRow; date: string; onOpen: () => void }) {
  const { t } = useTranslation()
  const { Icon, tone } = ICONS[row.icon]
  return (
    <li
      data-slot="notification-row"
      data-unread={row.unread}
      className={cn('flex flex-wrap items-center gap-3.5 border-t border-line-light px-4 py-3 sm:flex-nowrap', row.unread ? 'bg-surface-card' : 'bg-surface-card-hover')}
    >
      <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', row.unread ? 'bg-accent-red' : 'bg-transparent')} />
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-icon-box">
        <Icon aria-hidden="true" className={cn('size-4', tone)} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn('text-base text-fg-primary', row.unread ? 'font-semibold' : 'font-medium')}>
          {row.title}
          <span className="sr-only"> · {row.unread ? t('notifications.unread') : t('notifications.read')}</span>
        </span>
        <span className="text-sm text-fg-secondary">{row.body}</span>
      </div>
      <span className="inline-flex shrink-0 flex-col items-end gap-1">
        <CanvasChip label={t(`${K}.facet.${row.kind}`)} />
        <time dateTime={row.createdAt} className="font-mono text-2xs text-fg-tertiary">
          {date}
        </time>
      </span>
      <span className="inline-flex w-37.5 shrink-0 justify-end">
        {row.action && (
          <Button asChild variant="outline" size="sm">
            <Link to={row.action.href} onClick={onOpen}>
              {t(row.action.labelKey)}
            </Link>
          </Button>
        )}
      </span>
    </li>
  )
}
