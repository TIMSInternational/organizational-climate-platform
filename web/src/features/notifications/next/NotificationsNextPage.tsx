import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Bell, Check, CircleAlert, ClipboardList, FileText, ListFilter, Lock, Mail, Send, Settings } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import { PageHeader } from '../../../components/layout'
import { Button, Chip, EmptyState, LoadingState, NetworkError, Switch, chipVariants } from '../../../components/ui'
import { useViewerCapabilities } from '../../../auth/viewerCapabilities'
import { cn } from '../../../lib/cn'
import { CanvasChip, CanvasSelect, Panel } from '../../org-structure/next/super/parts'
import { PERIODS, facetCounts, matchesFacet, oldestShown, rowOf, withinPeriod, type Facet, type InboxRow, type RowIcon } from './derive'
import { useNotificationsModel } from './useNotificationsModel'
import { useRespondentShell } from '../../../navigation/useRespondentShell'

const K = 'notifications.next'
const FACETS: readonly Facet[] = ['all', 'unread', 'surveys', 'plans', 'reports', 'other']

// The kind is told by the glyph and the chip's word, in the secondary ink: green, amber and red
// are the three result areas, and blue is action, selection and the unread mark.
const ICONS: Record<RowIcon, { Icon: typeof Bell; tone: string }> = {
  alert: { Icon: CircleAlert, tone: 'text-fg-secondary' },
  report: { Icon: FileText, tone: 'text-fg-secondary' },
  survey: { Icon: ClipboardList, tone: 'text-fg-secondary' },
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
  const respondent = useRespondentShell()
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
  // What the period hides: the bell counts every unread notice the inbox returned, so when
  // all of them are older than the period the list says how many and where they are, rather
  // than an empty list beside a bell that reads 2.
  const olderCount = rows.length - inPeriod.length
  const olderUnread = unread - inPeriod.filter((row) => row.unread).length
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })
  const longDay = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' })
  const localMail = state.email !== null && /\.test$/i.test(state.email.split('@')[1] ?? '')

  return (
    <div>
      <PageHeader
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
            {/* Not for a respondent. `/settings/notifications` offers four email toggles,
                three of which govern mail they are never sent — including "Correos de
                planes de acción", the "sistema de seguimiento" ESPH's reviewer could not
                place — and the fourth can switch off the survey invitation this launch
                depends on. It also carries `AccountTabs`, which was the way back to their
                own Nombre and Departamento. The bell is still in their strip, so this
                button was the first link in that chain. */}
            {respondent ? null : (
              <Button asChild variant="outline" size="canvas">
                <Link to="/settings/notifications">
                  <Settings aria-hidden="true" />
                  {t(`${K}.settings`)}
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="-mt-1 grid gap-4 xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <section aria-label={t(`${K}.inboxLabel`)} className="min-w-0 overflow-hidden rounded-xl border border-line-panel bg-surface-card">
          {state.status === 'error' ? (
            <div className="p-4">
              <NetworkError title={t('notifications.loadFailed')} description={state.error ?? undefined} onRetry={state.reload} retryText={t('common.retry')} />
            </div>
          ) : state.status === 'loading' ? (
            <div className="p-4">
              <LoadingState rows={6} />
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
                        // The chosen facet is selection, so it is blue (`chipVariants` accent), never
                        // Crítica's red. 28px drawn, 44px under a finger.
                        className={cn(
                          chipVariants({ tone: selected ? 'accent' : 'neutral' }),
                          'h-7 cursor-pointer px-2.5 text-sm tabular-nums pointer-coarse:h-11',
                          selected ? 'border-chip-accent-ink/20' : 'bg-surface-card hover:border-line-hover',
                        )}
                      >
                        {t(`${K}.facetCount`, { label: t(`${K}.facet.${value}`), count: counts[value] })}
                      </button>
                    )
                  })}
                </div>
                <CanvasSelect
                  aria-label={t(`${K}.periodLabel`)}
                  className="w-44"
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
              </ul>
              {shown.length === 0 && (
                // The shared empty block, centred in the card as every other screen draws it.
                // Two different empties: nothing in the period at all (with the way to the
                // older notices when there are some), or nothing of this kind in it.
                <div data-slot="filter-empty" className="border-t border-line-default">
                  {inPeriod.length === 0 ? (
                    <EmptyState
                      icon={<Bell aria-hidden="true" className="size-6" />}
                      title={period === 0 ? t(`${K}.emptyTitle`) : t(`${K}.noneInPeriod`, { days: period })}
                      description={
                        olderCount > 0
                          ? olderUnread > 0
                            ? t(`${K}.olderWithUnread`, { count: olderCount, unread: olderUnread })
                            : t(`${K}.older`, { count: olderCount })
                          : t(`${K}.emptyBody`)
                      }
                      action={
                        olderCount > 0 ? (
                          <Button type="button" variant="outline" onClick={() => setPeriod(0)}>
                            {t(`${K}.showAll`)}
                          </Button>
                        ) : undefined
                      }
                    />
                  ) : (
                    <EmptyState
                      icon={<ListFilter aria-hidden="true" className="size-6" />}
                      title={t(`${K}.nothingHere`)}
                      description={t(`${K}.nothingHereHint`)}
                    />
                  )}
                </div>
              )}
              {oldest && (
                <p className="m-0 border-t border-line-default px-4 py-2.5 text-sm text-fg-tertiary">
                  {t(`${K}.nothingBefore`, { date: longDay.format(new Date(oldest)) })}
                </p>
              )}
            </>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel heading={<h2 className="m-0 text-2xl">{t(`${K}.channelsHeading`)}</h2>} className="gap-3 border-line-panel py-4.5 shadow-none">
            {state.preferences ? (
              <div className="flex flex-col gap-1 text-ui">
                {/* Not a switch: the in-app inbox cannot be turned off (the preferences page
                    says so), so it is a fact with a padlock, as «Siempre se envía» is there. */}
                <div data-slot="channel-app" className="flex min-h-11 items-center justify-between gap-2 text-ui text-fg-primary">
                  <span>{t(`${K}.channelApp`)}</span>
                  <Chip tone="neutral" icon={<Lock />} label={t(`${K}.channelAppAlways`)} />
                </div>
                <span id="channel-app-note" className="sr-only">
                  {t(`${K}.channelAppNote`)}
                </span>
                <label className="m-0 flex min-h-11 items-center justify-between gap-2 text-ui font-normal text-fg-primary">
                  {t(`${K}.channelEmail`)}
                  <Switch
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
                <label className="m-0 flex min-h-11 items-center justify-between gap-2 text-ui font-normal text-fg-primary">
                  {t(`${K}.channelDigest`)}
                  <Switch
                    checked={state.preferences.digestFrequency === 'weekly'}
                    onCheckedChange={(checked) =>
                      state.preferences && void state.savePreferences({ ...state.preferences, digestFrequency: checked ? 'weekly' : 'never' })
                    }
                  />
                </label>
              </div>
            ) : (
              <p className="m-0 text-sm text-fg-tertiary">{t(`${K}.preferencesUnavailable`)}</p>
            )}
            {/* Blue, the action colour, with a 44px target: the same treatment as the
                Privacy page's link to this destination, so a link reads as a link on both
                screens (the user's ruling: blue = action). */}
            {respondent ? null : (
              <Link
                to="/settings/notifications"
                data-slot="by-type-link"
                className="inline-flex min-h-11 items-center self-start text-sm text-accent-blue-ink"
              >
                {t(`${K}.byType`)}
              </Link>
            )}
          </Panel>
          {localMail && (
            // The local stack's mail sender refuses `.test`, `.invalid` and `example.com`
            // recipients (`EmailNotificationSender.cs:90`), so on it a notice exists only here.
            <p data-slot="local-mail-note" className="m-0 flex items-start gap-3 rounded-xl bg-surface-fill-subtle px-4 py-3.5 text-sm leading-normal text-fg-secondary">
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
      className={cn('flex flex-wrap items-center gap-3.5 border-t border-line-default px-4 py-3 sm:flex-nowrap', row.unread ? 'bg-surface-card' : 'bg-surface-zebra')}
    >
      {/* The unread mark is blue, as Mail draws it; red is the OCC mark and Crítica. */}
      <span aria-hidden="true" data-slot="unread-dot" className={cn('size-2 shrink-0 rounded-full', row.unread ? 'bg-accent-blue' : 'bg-transparent')} />
      <span className="hidden size-8 shrink-0 items-center justify-center rounded-lg bg-surface-fill-subtle sm:inline-flex">
        <Icon aria-hidden="true" className={cn('size-4', tone)} />
      </span>
      {/* Below sm the text takes the whole line after the unread dot (8px + the 14px gap);
          the kind, the date and the action wrap to a second line under it. */}
      <div className="flex min-w-0 flex-1 basis-[calc(100%-1.375rem)] flex-col gap-0.5 sm:basis-auto">
        <span className={cn('text-base text-fg-primary', row.unread ? 'font-semibold' : 'font-medium')}>
          {row.title}
          <span className="sr-only"> · {row.unread ? t('notifications.unread') : t('notifications.read')}</span>
        </span>
        <span className="text-sm text-fg-secondary">{row.body}</span>
      </div>
      <span className="inline-flex shrink-0 items-center gap-2 pl-5.5 sm:flex-col sm:items-end sm:gap-1 sm:pl-0">
        <CanvasChip label={t(`${K}.facet.${row.kind}`)} />
        <time dateTime={row.createdAt} className="text-sm tabular-nums text-fg-tertiary">
          {date}
        </time>
      </span>
      <span className="ml-auto inline-flex shrink-0 justify-end sm:ml-0 sm:w-37.5">
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
