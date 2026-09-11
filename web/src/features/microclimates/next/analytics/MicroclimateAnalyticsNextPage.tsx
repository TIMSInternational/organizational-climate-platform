import { Link } from 'react-router'
import { useTranslation, type TranslateFn } from '../../../../i18n'
import { PageTopBar } from '../../../../components/layout'
import { CanvasCard, CanvasSectionHead, HatchField, HatchTag, NoteBand } from '../../../../components/canvas'
import { Button, Chip, EmptyState, LoadingRegion, NetworkError, SkeletonText, Table } from '../../../../components/ui'
import { useViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { cn } from '../../../../lib/cn'
import { nameHead, percentReading } from '../../../dashboard/next/derive'
import { participationPercent } from '../../microclimatePrivacy'
import { MicroclimateGate } from '../MicroclimateGate'
import { FLOOR, barPosition, belowFloor, countTicks } from '../derive'
import { dayRange, shortDay } from '../format'
import { sessionStatusLabel, sessionStatusTone } from '../vocabulary'
import { useMicroclimateAnalyticsModel, type SessionRow } from './useMicroclimateAnalyticsModel'

/**
 * `/microclimates/analytics` — the redesigned Analítica de microclimas, drawn as the
 * MicroclimateAnalytics board of 10 Sep ("participation as bars, floor-of-5 hatching; pulse
 * over time as a line per series"). It replaced `MicroclimateAnalyticsPage` on this route;
 * that page stays in the tree, unrouted, as the wiring reference.
 *
 * The pulse line is the one part no endpoint can feed — a microclimate keeps no 1–5 average
 * (`useMicroclimateAnalyticsModel.ts`) — so each session is a point that says why it carries
 * no figure, under the board's "Propuesta" chip, and no line is drawn from invented values.
 */
export default function MicroclimateAnalyticsNextPage() {
  return (
    <MicroclimateGate needsCompany>
      <AnalyticsScreen />
    </MicroclimateGate>
  )
}

/** Sessions drawn in the participation card; the table below lists every one. */
const CHARTED_SESSIONS = 6

function AnalyticsScreen() {
  const { t } = useTranslation()
  const capabilities = useViewerCapabilities()
  const state = useMicroclimateAnalyticsModel()

  const header = (
    <PageTopBar
      compact
      title={t('microclimates.next.analytics.title')}
      eyebrow={t('microclimates.next.analytics.eyebrow')}
      description={t('microclimates.next.analytics.description', { floor: FLOOR })}
      breadcrumbs={[
        { label: t('navigation.microclimates'), href: '/microclimates' },
        { label: t('microclimates.analytics') },
      ]}
    />
  )

  if (state.status === 'error') {
    return (
      <div>
        {header}
        <NetworkError title={t('errors.generic')} description={state.error ?? undefined} onRetry={state.reload} retryText={t('common.retry')} />
      </div>
    )
  }
  if (state.status === 'loading') {
    return (
      <div>
        {header}
        <LoadingRegion loading label={t('common.loading')}>
          <SkeletonText lines={6} />
        </LoadingRegion>
      </div>
    )
  }
  if (state.rows.length === 0) {
    return (
      <div>
        {header}
        <EmptyState
          title={t('microclimates.noAnalyticsDataAvailable')}
          description={t('microclimates.createMicroclimatesToSeeData')}
          action={
            capabilities.canLaunchMicroclimate ? (
              <Button asChild variant="primary">
                <Link to="/microclimates/new">{t('microclimates.next.create.title')}</Link>
              </Button>
            ) : undefined
          }
        />
      </div>
    )
  }

  const charted = state.rows.slice(0, CHARTED_SESSIONS)
  return (
    <div>
      {header}
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          <CanvasCard title={t('microclimates.next.analytics.participationTitle')} aside={t('microclimates.next.analytics.participationAside')}>
            <div className="flex flex-col gap-5">
              {charted.map((row) => (
                <ParticipationBar key={row.session.id} row={row} />
              ))}
            </div>
            <span className="text-sm text-fg-tertiary">{t('microclimates.next.analytics.participationNote')}</span>
          </CanvasCard>

          <CanvasCard
            title={t('microclimates.next.analytics.pulseTitle')}
            adornment={<Chip label={t('microclimates.next.proposed')} tone="warning" title={t('microclimates.next.analytics.pulseProposedHint')} />}
            aside={t('microclimates.next.analytics.pulseAside')}
          >
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {charted.map((row) => (
                <PulsePoint key={row.session.id} row={row} />
              ))}
            </ul>
            <span className="text-sm text-fg-tertiary">
              {state.rows.length === 1 ? t('microclimates.next.analytics.pulseOne', { floor: FLOOR }) : t('microclimates.next.analytics.pulseMany', { floor: FLOOR })}
            </span>
          </CanvasCard>
        </div>

        <section className="flex flex-col gap-3" aria-labelledby="microclimate-sessions-heading">
          <CanvasSectionHead
            id="microclimate-sessions-heading"
            title={t('microclimates.next.analytics.sessionsTitle')}
            count={state.rows.length}
            aside={t('microclimates.next.analytics.sessionsAside')}
          />
          <SessionsTable rows={state.rows} />
        </section>

        <NoteBand>{t('microclimates.next.analytics.note', { floor: FLOOR })}</NoteBand>
      </div>
    </div>
  )
}

function sessionMeta(t: TranslateFn, row: SessionRow, locale: string): string {
  const parts: string[] = []
  if (row.detail.status === 'ready') {
    parts.push(dayRange(row.detail.value.startTime, row.detail.value.endTime, locale))
    parts.push(row.detail.value.anonymousResponses ? t('microclimates.next.analytics.anonymous') : t('microclimates.next.analytics.identified'))
  } else {
    parts.push(shortDay(row.session.createdAt, locale))
  }
  parts.push(sessionStatusLabel(t, row.session.status).toLocaleLowerCase(locale))
  return parts.join(' · ')
}

function ParticipationBar({ row }: { row: SessionRow }) {
  const { t, locale } = useTranslation()
  const { session } = row
  const title = session.title ?? t('microclimates.untitled')
  const responses = session.responseCount
  const target = session.targetParticipantCount
  const max = Math.max(target, responses, FLOOR)
  const fill = barPosition(responses, max) ?? 0
  const floorAt = barPosition(FLOOR, max) ?? 0
  const under = belowFloor(responses)
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-base font-medium text-fg-primary">{title}</span>
      <span className="text-xs text-fg-tertiary">{sessionMeta(t, row, locale)}</span>
      <figure
        role="img"
        aria-label={t(under ? 'microclimates.next.analytics.barAriaUnder' : 'microclimates.next.analytics.barAria', {
          name: title,
          count: responses,
          target,
          floor: FLOOR,
        })}
        className="m-0 flex flex-col gap-1.5 pt-1"
      >
        <div className="relative h-4 text-2xs text-fg-tertiary">
          <span className="absolute top-0 whitespace-nowrap pl-1.5" style={{ left: `${floorAt}%` }}>
            {t('microclimates.next.analytics.floorMark', { floor: FLOOR })}
          </span>
        </div>
        <div className="relative h-4 rounded-sm bg-line-light">
          <div className="absolute inset-y-0 left-0 rounded-sm bg-accent-blue" style={{ width: `${fill}%` }} />
          <div aria-hidden="true" className="absolute -top-3 -bottom-3 border-l-2 border-dashed border-line-hover" style={{ left: `${floorAt}%` }} />
        </div>
        <div className="pt-2 text-sm">
          <span className="font-mono tabular-nums text-fg-primary">{responses}</span>{' '}
          <span className="text-fg-tertiary">
            {target > 0 ? t('microclimates.next.analytics.ofTarget', { target }) : t('microclimates.next.analytics.noTarget')}
          </span>
          {under && (
            <>
              <span className="text-fg-tertiary">{' · '}</span>
              <span className="text-accent-red-ink">{t('microclimates.next.analytics.underFloor', { floor: FLOOR })}</span>
            </>
          )}
        </div>
        <div aria-hidden="true" className="relative mt-1 h-4 font-mono text-2xs tabular-nums text-fg-tertiary">
          {countTicks(max).map((tick) => (
            <span key={tick} className="absolute -translate-x-1/2" style={{ left: `${(tick / max) * 100}%` }}>
              {tick}
            </span>
          ))}
        </div>
      </figure>
    </div>
  )
}

function PulsePoint({ row }: { row: SessionRow }) {
  const { t, locale } = useTranslation()
  const { session } = row
  const under = belowFloor(session.responseCount)
  const day = row.detail.status === 'ready' ? shortDay(row.detail.value.startTime, locale) : shortDay(session.createdAt, locale)
  const name = nameHead(session.title ?? t('microclimates.untitled'))
  return (
    <li className="flex items-center gap-3 rounded-xl border border-dashed border-line-default px-3.5 py-3">
      {under ? (
        <HatchField className="size-4 shrink-0 rounded-full border border-line-default" />
      ) : (
        <span aria-hidden="true" className="size-4 shrink-0 rounded-full border border-line-default bg-surface-icon-box" />
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-base text-fg-primary">
          <span className="font-mono tabular-nums">{day}</span>
          {' · '}
          {t(under ? 'microclimates.next.analytics.pointProtected' : 'microclimates.next.analytics.pointNotKept', { name })}
        </span>
        <span className="text-sm text-fg-tertiary">
          {under
            ? t('microclimates.next.analytics.pointProtectedWhy', { floor: FLOOR })
            : t('microclimates.next.analytics.pointNotKeptWhy', { count: session.responseCount })}
        </span>
      </div>
    </li>
  )
}

const HEAD = 'px-3 pt-2 pb-2 text-left align-bottom text-2xs font-bold uppercase leading-normal tracking-label text-fg-label whitespace-nowrap border-b border-line-default'
const CELL = 'px-3 py-3 align-middle border-b border-line-light'

function SessionsTable({ rows }: { rows: readonly SessionRow[] }) {
  const { t, locale } = useTranslation()
  return (
    // `Table`, not a bare `<table>`: the primitive is the scroll container, so at 1024 the
    // eight columns scroll inside the card instead of pushing the page wide (#218).
    <div className="rounded-xl border border-line-default bg-surface-card pt-2 shadow-xs">
      {/* `relative`: the sr-only "Acciones" header and caption are absolutely positioned, and
          with no positioned ancestor inside the scroll container they escaped its clip — at
          1024 the page measured 1051px wide (document scrollWidth), 27px past the viewport. */}
      <Table className="relative min-w-[56rem]">
        <caption className="sr-only">{t('microclimates.next.analytics.sessionsTitle')}</caption>
        <thead>
          <tr>
            <th scope="col" className={HEAD}>{t('microclimates.next.analytics.colSession')}</th>
            <th scope="col" className={cn(HEAD, 'w-[90px]')}>{t('microclimates.next.analytics.colStatus')}</th>
            <th scope="col" className={cn(HEAD, 'w-[100px]')}>{t('microclimates.next.analytics.colResponses')}</th>
            <th scope="col" className={cn(HEAD, 'w-[150px]')}>{t('microclimates.next.analytics.colParticipation')}</th>
            <th scope="col" className={cn(HEAD, 'w-[110px]')}>{t('microclimates.next.analytics.colPulse')}</th>
            <th scope="col" className={cn(HEAD, 'w-[110px]')}>{t('microclimates.next.analytics.colWords')}</th>
            <th scope="col" className={cn(HEAD, 'w-[80px]')}>{t('microclimates.next.analytics.colOpened')}</th>
            <th scope="col" className={cn(HEAD, 'w-[110px]')}>
              <span className="sr-only">{t('microclimates.next.analytics.colActions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const { session } = row
            const under = belowFloor(session.responseCount)
            const share = participationPercent(session.responseCount, session.targetParticipantCount)
            const last = index === rows.length - 1
            const cell = cn(CELL, last && 'border-b-0')
            return (
              <tr key={session.id}>
                <td className={cn(cell, 'max-w-0')}>
                  <div className="flex min-w-0 flex-col">
                    <Link to={`/microclimates/${session.id}`} className="truncate text-base font-semibold text-fg-primary">
                      {session.title ?? t('microclimates.untitled')}
                    </Link>
                    {row.detail.status === 'ready' && (
                      <span className="text-xs text-fg-tertiary">
                        {t('microclimates.next.analytics.rowMeta', {
                          count: row.detail.value.questions.length,
                          mode: row.detail.value.anonymousResponses
                            ? t('microclimates.next.analytics.anonymous')
                            : t('microclimates.next.analytics.identified'),
                        })}
                      </span>
                    )}
                  </div>
                </td>
                <td className={cell}>
                  <Chip label={sessionStatusLabel(t, session.status)} tone={sessionStatusTone(session.status)} />
                </td>
                <td className={cell}>
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <span className="font-mono text-lg tabular-nums text-fg-primary">{session.responseCount}</span>
                    <span className="text-sm text-fg-secondary">
                      {session.targetParticipantCount > 0
                        ? t('microclimates.next.analytics.ofTarget', { target: session.targetParticipantCount })
                        : t('microclimates.next.analytics.noTarget')}
                    </span>
                  </span>
                </td>
                <td className={cell}>
                  {share === null ? (
                    <span className="text-fg-tertiary">{t('microclimates.next.analytics.noRate')}</span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-flex h-1.5 w-17.5 shrink-0 overflow-hidden rounded-sm bg-line-light">
                        <span className="h-full rounded-sm bg-accent-blue" style={{ width: `${Math.min(100, share)}%` }} />
                      </span>
                      <span className="font-mono text-sm tabular-nums text-fg-secondary">{percentReading(share, locale)}</span>
                    </span>
                  )}
                </td>
                <td className={cell}>
                  {under ? (
                    <HatchTag label={t('microclimates.next.analytics.protectedOne')} />
                  ) : (
                    <span className="text-fg-tertiary" title={t('microclimates.next.analytics.pulseNotKept')}>
                      {t('microclimates.next.analytics.noFigure')}
                    </span>
                  )}
                </td>
                <td className={cell}>
                  {row.words.status === 'protected' ? (
                    <HatchTag label={t('microclimates.next.analytics.protectedMany')} />
                  ) : row.words.status === 'ready' ? (
                    <span className="text-sm text-fg-secondary">{t('microclimates.next.analytics.wordCount', { count: row.words.value })}</span>
                  ) : (
                    <span className="text-fg-tertiary">{t('microclimates.next.analytics.noFigure')}</span>
                  )}
                </td>
                <td className={cn(cell, 'whitespace-nowrap font-mono text-sm tabular-nums text-fg-secondary')}>
                  {row.detail.status === 'ready' ? shortDay(row.detail.value.startTime, locale) : shortDay(session.createdAt, locale)}
                </td>
                <td className={cn(cell, 'text-right')}>
                  <Button asChild variant="outline">
                    <Link to={`/microclimates/${session.id}/results`}>{t('microclimates.results')}</Link>
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </Table>
    </div>
  )
}
