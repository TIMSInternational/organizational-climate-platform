import { useState, type ReactNode } from 'react'
import { Check, ChevronDown, CircleAlert, Clock } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../../i18n'
import { PageTopBar } from '../../../../components/layout'
import { Button, Chip, NetworkError, SkeletonText, Table, type ChipTone } from '../../../../components/ui'
import { useHeaderSwitcherStandDown } from '../../../../company-context/useHeaderSwitcherStandDown'
import { cn } from '../../../../lib/cn'
import type { SystemJobStatus, SystemStatusResponse } from '../../api/systemStatus'
import type { SystemEmailSettings } from '../../api/systemSettings'
import {
  aggregateTone,
  clockTime,
  componentTone,
  dayKey,
  localDay,
  mailTone,
  minutesSince,
  tallyJobs,
  utcOffsetLabel,
  warningCount,
  type HealthTone,
} from './healthDerive'
import { useSystemHealthModel } from './useSystemHealthModel'

/**
 * Status words, one per token the API can emit (`SystemStatuses`, `SystemComponentStatuses`).
 * An explicit map, not a template key: `t()` returns the key on a miss, so a new token would
 * print a key path on an operator's screen. Unknown tokens print raw instead.
 */
const STATUS_KEYS: Record<string, string> = {
  ok: 'systemHealth.statusOk',
  slow: 'systemHealth.statusSlow',
  timeout: 'systemHealth.statusTimeout',
  unreachable: 'systemHealth.statusUnreachable',
  backlog: 'systemHealth.statusBacklog',
  'never-run': 'systemHealth.statusNeverRun',
  stale: 'systemHealth.statusStale',
  failing: 'systemHealth.statusFailing',
  unknown: 'systemHealth.statusUnknown',
  degraded: 'systemHealth.statusDegraded',
  unhealthy: 'systemHealth.statusUnhealthy',
}

function statusWord(t: TranslateFn, token: string): string {
  const key = STATUS_KEYS[token]
  return key ? t(key) : token
}

/** The chip for a tone, with the canvas's glyph: a tick when good, a warning mark otherwise. */
function StatusChip({ tone, label, glyph }: { tone: HealthTone; label: string; glyph?: 'clock' }) {
  const chipTone: ChipTone = tone
  const icon =
    tone === 'good' ? (
      <Check className="size-3" />
    ) : tone === 'neutral' ? undefined : glyph === 'clock' ? (
      <Clock className="size-3" />
    ) : (
      <CircleAlert className="size-3" />
    )
  return <Chip tone={chipTone} icon={icon} label={label} />
}

/** "Cada 15 min" — the cadence as the existing catalogue says it. */
function intervalText(t: TranslateFn, seconds: number): string {
  if (seconds <= 0) return '—'
  if (seconds % 3600 === 0) return t('systemHealth.everyHours', { count: seconds / 3600 })
  if (seconds % 60 === 0) return t('systemHealth.everyMinutes', { count: seconds / 60 })
  return t('systemHealth.everySeconds', { count: seconds })
}

function agoText(t: TranslateFn, fromIso: string, toIso: string): string {
  const minutes = minutesSince(fromIso, toIso)
  if (minutes === 1) return t('systemHealth.next.agoMinute')
  if (minutes < 60) return t('systemHealth.next.agoMinutes', { count: minutes })
  return t('systemHealth.next.agoHours', { count: Math.round(minutes / 60) })
}

/**
 * `/admin/system` — the redesigned Estado del sistema, which replaced `SystemHealthPage` on
 * this route (the old page stays in the tree, unrouted, as the wiring reference), drawn as
 * the SystemHealth artboard of the per-role canvas (10 Sep).
 *
 * Four tiles with honest states — the API that answered, the database probe, the stored mail
 * switch and the scheduled jobs — then the queue and its dispatcher, the build and the
 * connection policy, and the jobs themselves in a disclosure, open by default because this
 * page prints job internals by design (`docs/runbooks/demo-script.md:47`). Every chip carries
 * its word; the colour is never the only signal.
 *
 * `super_admin` only on the server; the page is a platform page no company scopes, so the
 * header's company switcher stands down while it is mounted (`useHeaderSwitcherStandDown`).
 */
export default function SystemHealthNextPage() {
  const { t, locale } = useTranslation()
  const model = useSystemHealthModel()
  useHeaderSwitcherStandDown()
  const status = model.status
  const warnings = status ? warningCount(status, model.email) : 0
  const verdict = status
    ? warnings === 0
      ? statusWord(t, status.status)
      : t(warnings === 1 ? 'systemHealth.next.verdictWithWarning' : 'systemHealth.next.verdictWithWarnings', {
          verdict: statusWord(t, status.status),
          count: warnings,
        })
    : null

  return (
    <div>
      <PageTopBar
        eyebrow={t('navigation.systemAdministration')}
        title={t('systemHealth.title')}
        description={
          status
            ? t('systemHealth.next.description', {
                date: localDay(status.checkedAt, locale),
                time: clockTime(status.checkedAt, locale),
              })
            : t('systemHealth.description')
        }
        actions={
          <div className="flex items-center gap-2">
            {status && verdict && (
              <span data-slot="system-verdict">
                <StatusChip tone={aggregateTone(status.status)} label={verdict} />
              </span>
            )}
            <Button type="button" variant="outline" onClick={model.reload} disabled={model.loading}>
              <Clock aria-hidden="true" />
              {t('systemHealth.next.recheck')}
            </Button>
          </div>
        }
      />

      {model.loading && status === null && <SkeletonText lines={6} />}

      {model.failed && !model.loading && (
        <NetworkError
          title={t('systemHealth.loadFailed')}
          description={t('systemHealth.loadFailedDescription')}
          onRetry={model.reload}
          retryText={t('common.retry')}
        />
      )}

      {status && !model.failed && <HealthBody status={status} email={model.email} />}
    </div>
  )
}

function HealthBody({ status, email }: { status: SystemStatusResponse; email: SystemEmailSettings | null }) {
  const { t, locale } = useTranslation()
  // An API built before #355 answers with no `jobs` at all; the page must still render.
  const jobs = status.jobs ?? []
  const tally = tallyJobs(jobs)
  const db = status.database
  const dispatchJob = jobs.find((job) => job.jobName === 'notification-dispatch')

  return (
    <div className="flex flex-col gap-6">
      <div data-slot="health-tiles" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          eyebrow={t('systemHealth.next.tileApi')}
          chip={<StatusChip tone="good" label={statusWord(t, 'ok')} />}
          title={status.service}
          sub={t('systemHealth.next.apiAnswered', {
            environment: status.environment,
            runtime: status.build.runtime,
            time: clockTime(status.checkedAt, locale),
          })}
        />
        <Tile
          eyebrow={t('systemHealth.next.tileDatabase')}
          chip={<StatusChip tone={componentTone(db.status)} label={statusWord(t, db.status)} />}
          title={t('systemHealth.next.dbLatency', { ms: db.latencyMs })}
          sub={[
            t(db.usesTransactionPoolerPort ? 'systemHealth.next.dbSubTransaction' : 'systemHealth.next.dbSubSession', {
              port: db.port,
              size: db.maxPoolSize,
            }),
            db.maxPoolSizeDefaulted ? t('systemHealth.defaulted') : '',
          ]
            .filter(Boolean)
            .join(' ')}
        />
        <MailTile email={email} />
        <Tile
          eyebrow={t('systemHealth.next.tileJobs')}
          chip={
            tally.total === 0 ? (
              <StatusChip tone="warning" label={statusWord(t, 'unknown')} />
            ) : (
              <StatusChip
                tone={tally.worst === null ? 'good' : componentTone(tally.worst)}
                label={statusWord(t, tally.worst ?? 'ok')}
              />
            )
          }
          title={
            tally.total === 0
              ? t('systemHealth.next.jobsNone')
              : t('systemHealth.next.jobsCorrect', { ok: tally.ok, total: tally.total })
          }
          sub={
            tally.total === 0
              ? t('systemHealth.next.jobsNoneSub')
              : t('systemHealth.next.jobsSub', {
                  failures: tally.failures,
                  ago: tally.lastAttemptAt ? agoText(t, tally.lastAttemptAt, status.checkedAt) : t('systemHealth.next.agoNever'),
                })
          }
        />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel heading={t('systemHealth.next.queueHeading')} meta={t('systemHealth.next.queueMeta')} id="health-queue">
          <div className="grid grid-cols-3 gap-3">
            <Stat label={t('systemHealth.next.pending')} value={status.notificationQueue.pending} />
            <Stat label={t('systemHealth.next.due')} value={status.notificationQueue.due} />
            <Stat
              label={t('systemHealth.next.deadLettered')}
              value={status.notificationQueue.deadLettered}
              sub={t('systemHealth.next.deadLetteredSub')}
            />
          </div>
          <div className="flex items-start justify-between gap-3 border-t border-line-light pt-2.5">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-base font-semibold text-fg-primary">{t('systemHealth.next.dispatcher')}</span>
              <span data-slot="dispatcher-note" className="text-sm text-fg-tertiary">
                {dispatcherSentence(t, locale, status, dispatchJob)}
              </span>
            </div>
            <StatusChip
              tone={componentTone(status.dispatcher.status)}
              glyph="clock"
              label={
                status.dispatcher.status === 'never-run'
                  ? t('systemHealth.next.dispatcherNoDeliveries')
                  : statusWord(t, status.dispatcher.status)
              }
            />
          </div>
        </Panel>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel heading={t('systemHealth.next.buildHeading')} id="health-build">
            <Facts labelWidth="build">
              <Fact label={t('systemHealth.commit')}>
                {status.build.commit === 'unknown' ? (
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 xl:flex-nowrap">
                    <span className="shrink-0 font-mono text-sm text-fg-label">{t('systemHealth.next.unknown')}</span>
                    <span className="min-w-0 text-xs text-fg-label">{t('systemHealth.next.commitUnknownNote')}</span>
                  </span>
                ) : (
                  // The running commit appears nowhere else in the shell (#69).
                  <span className="font-mono text-sm tabular-nums text-fg-primary">{status.build.commit.slice(0, 12)}</span>
                )}
              </Fact>
              <Fact label={t('systemHealth.builtAt')}>
                {status.build.builtAt === 'unknown' || Number.isNaN(Date.parse(status.build.builtAt)) ? (
                  <span className="text-sm text-fg-label">{t('systemHealth.next.unknown')}</span>
                ) : (
                  <span className="font-mono text-sm tabular-nums text-fg-primary">
                    {`${localDay(status.build.builtAt, locale)} · ${clockTime(status.build.builtAt, locale)}`}
                  </span>
                )}
              </Fact>
              <Fact label={t('systemHealth.runtime')}>
                <span className="font-mono text-sm text-fg-primary">{`.NET ${status.build.runtime}`}</span>
              </Fact>
              <Fact label={t('systemHealth.environment')}>
                <Chip tone="neutral" label={status.environment} />
              </Fact>
            </Facts>
          </Panel>

          <Panel heading={t('systemHealth.next.databaseHeading')} id="health-database">
            <Facts labelWidth="database">
              <Fact label={t('systemHealth.next.status')}>
                <StatusChip tone={componentTone(db.status)} label={statusWord(t, db.status)} />
              </Fact>
              <Fact label={t('systemHealth.next.latency')}>
                <span className="font-mono text-sm tabular-nums text-fg-primary">
                  {t('systemHealth.next.latencyValue', { ms: db.latencyMs })}
                </span>
              </Fact>
              <Fact label={t('systemHealth.next.poolerLabel')}>
                {/* #220: the port is a fact on a page rather than a coin flip. */}
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 xl:flex-nowrap">
                  <Chip
                    tone={db.usesTransactionPoolerPort ? 'critical' : 'good'}
                    label={t(
                      db.usesTransactionPoolerPort ? 'systemHealth.next.poolerTransaction' : 'systemHealth.next.poolerSession',
                      { port: db.port },
                    )}
                  />
                  <span className="min-w-0 text-xs text-fg-label">{t('systemHealth.next.poolerNote')}</span>
                </span>
              </Fact>
              <Fact label={t('systemHealth.next.maxPool')}>
                <span className="flex items-center gap-1.5">
                  <span className="font-mono text-sm tabular-nums text-fg-primary">{db.maxPoolSize}</span>
                  {db.maxPoolSizeDefaulted && <span className="text-xs text-fg-label">{t('systemHealth.next.defaultedWord')}</span>}
                </span>
              </Fact>
            </Facts>
          </Panel>
        </div>
      </div>

      <JobsDisclosure jobs={jobs} checkedAt={status.checkedAt} />
    </div>
  )
}

/**
 * The cadence inside a sentence — "corre cada minuto", "cada 5 minutos", "cada hora" — where the
 * table's "Cada 1 min" lower-cased read "corre cada 1 min" (the fidelity refuter, 10 Sep).
 */
export function intervalSentence(t: TranslateFn, seconds: number): string {
  if (seconds <= 0) return '—'
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600
    return hours === 1 ? t('systemHealth.next.everyHourSentence') : t('systemHealth.next.everyHoursSentence', { count: hours })
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60
    return minutes === 1 ? t('systemHealth.next.everyMinuteSentence') : t('systemHealth.next.everyMinutesSentence', { count: minutes })
  }
  return t('systemHealth.next.everySecondsSentence', { count: seconds })
}

function dispatcherSentence(
  t: TranslateFn,
  locale: string,
  status: SystemStatusResponse,
  dispatchJob: SystemJobStatus | undefined,
): string {
  const { dispatcher, notificationQueue } = status
  const first =
    dispatcher.lastDispatchAt === null
      ? t('systemHealth.next.dispatcherNeverRun')
      : t('systemHealth.next.dispatcherLast', {
          date: localDay(dispatcher.lastDispatchAt, locale),
          time: clockTime(dispatcher.lastDispatchAt, locale),
        })
  const cadence = dispatchJob
    ? t('systemHealth.next.dispatcherJob', {
        job: dispatchJob.jobName,
        interval: intervalSentence(t, dispatchJob.intervalSeconds),
      })
    : null
  const queue =
    notificationQueue.due === 0
      ? t('systemHealth.next.dispatcherQueueEmpty')
      : t('systemHealth.next.dispatcherQueueDue', { count: notificationQueue.due })
  return [first, cadence ? `${cadence}; ${queue}` : queue].join(' ')
}

function MailTile({ email }: { email: SystemEmailSettings | null }) {
  const { t } = useTranslation()
  if (email === null) {
    return (
      <Tile
        eyebrow={t('systemHealth.next.tileMail')}
        chip={<StatusChip tone="neutral" label={t('systemHealth.next.mailUnknown')} />}
        title={t('systemHealth.next.mailUnknownTitle')}
        sub={t('systemHealth.next.mailUnknownSub')}
      />
    )
  }
  const configured = Boolean(email.fromEmail || email.smtpHost)
  return (
    <Tile
      eyebrow={t('systemHealth.next.tileMail')}
      chip={
        <StatusChip
          tone={mailTone(email)}
          label={email.smtpEnabled ? t('systemHealth.next.mailOn') : t('systemHealth.next.mailOff')}
        />
      }
      title={email.smtpEnabled ? t('systemHealth.next.mailTitleOn') : t('systemHealth.next.mailTitleOff')}
      sub={
        configured
          ? t('systemHealth.next.mailSubSet', {
              from: email.fromEmail ?? '—',
              host: email.smtpHost ?? '—',
            })
          : t('systemHealth.next.mailSubEmpty')
      }
    />
  )
}

function Tile({ eyebrow, chip, title, sub }: { eyebrow: string; chip: ReactNode; title: string; sub: string }) {
  return (
    <div
      data-slot="health-tile"
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-line-default bg-surface-card px-4 py-3.5 shadow-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs font-bold uppercase tracking-tile text-fg-label">{eyebrow}</span>
        {chip}
      </div>
      <span className="text-lg font-semibold text-fg-primary">{title}</span>
      <span className="text-sm text-fg-tertiary">{sub}</span>
    </div>
  )
}

function Panel({ heading, meta, id, children }: { heading: string; meta?: string; id: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby={id}
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-line-default bg-surface-card px-5 py-4 shadow-xs"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id={id} className="m-0 text-2xl">
          {heading}
        </h2>
        {meta && <span className="text-sm text-fg-tertiary">{meta}</span>}
      </div>
      {children}
    </section>
  )
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-2xs font-bold uppercase tracking-label text-fg-label">{label}</span>
      <span className="font-mono text-2xl tabular-nums text-fg-primary">{value}</span>
      {sub && <span className="text-xs text-fg-label">{sub}</span>}
    </div>
  )
}

function Facts({ labelWidth, children }: { labelWidth: 'build' | 'database'; children: ReactNode }) {
  return (
    <dl
      className={cn(
        'm-0 grid items-center gap-x-4 gap-y-2 text-sm',
        labelWidth === 'build' ? 'grid-cols-[150px_minmax(0,1fr)]' : 'grid-cols-[170px_minmax(0,1fr)]',
      )}
    >
      {children}
    </dl>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-fg-tertiary">{label}</dt>
      <dd className="m-0 min-w-0">{children}</dd>
    </>
  )
}

// The canvas's `.label` head over a hairline, as the survey list draws its tables.
const HEAD = 'px-3 pt-2 pb-2 text-left text-2xs font-bold uppercase leading-normal tracking-label text-fg-label whitespace-nowrap border-b border-line-default'

function JobsDisclosure({ jobs, checkedAt }: { jobs: readonly SystemJobStatus[]; checkedAt: string }) {
  const { t, locale } = useTranslation()
  const [open, setOpen] = useState(true)
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const offset = utcOffsetLabel(zone, new Date(checkedAt))
  const checkedDay = dayKey(checkedAt)
  const instant = (iso: string | null) => {
    if (iso === null) return '—'
    const time = clockTime(iso, locale)
    return dayKey(iso) === checkedDay ? time : `${localDay(iso, locale)} · ${time}`
  }

  return (
    <section aria-labelledby="health-jobs" className="overflow-hidden rounded-lg border border-line-default bg-surface-card shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-light px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls="health-jobs-table"
          onClick={() => setOpen((value) => !value)}
          className="-ml-2 gap-2.5 text-base font-semibold text-fg-primary"
        >
          <ChevronDown aria-hidden="true" className={cn('size-4 transition-transform', !open && '-rotate-90')} />
          <span id="health-jobs">{t('systemHealth.next.tileJobs')}</span>
          <span className="font-mono text-sm font-normal tabular-nums text-fg-tertiary">{jobs.length}</span>
        </Button>
        <span className="text-sm text-fg-tertiary">
          {offset
            ? t('systemHealth.next.jobsTimezone', { zone, offset })
            : t('systemHealth.next.jobsTimezoneBare', { zone })}
        </span>
      </div>
      {open && (
        <div id="health-jobs-table">
          {jobs.length === 0 ? (
            // An empty registry is the #275 failure itself, never "all healthy".
            <p className="m-0 p-4 text-sm text-fg-secondary" role="status">
              {t('systemHealth.noJobsObserved')}
            </p>
          ) : (
            <div className="relative overflow-x-auto pt-2">
              <Table className="w-full min-w-233 table-fixed border-collapse">
                <colgroup>
                  <col />
                  <col className="w-33" />
                  <col className="w-40.5" />
                  <col className="w-40.5" />
                  <col className="w-38" />
                  <col className="w-30.5" />
                </colgroup>
                <thead>
                  <tr>
                    <th className={HEAD}>{t('systemHealth.next.colJob')}</th>
                    <th className={HEAD}>{t('systemHealth.next.colInterval')}</th>
                    <th className={HEAD}>{t('systemHealth.next.colLastAttempt')}</th>
                    <th className={HEAD}>{t('systemHealth.next.colLastSuccess')}</th>
                    <th className={cn(HEAD, 'text-right')}>{t('systemHealth.next.colFailures')}</th>
                    <th className={cn(HEAD, 'text-right')}>{t('systemHealth.next.colStatus')}</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.jobName} data-job={job.jobName} className="border-b border-line-light">
                      <td className="px-3 py-2 font-mono text-sm text-fg-primary">{job.jobName}</td>
                      <td className="px-3 py-2 text-sm text-fg-secondary">{intervalText(t, job.intervalSeconds)}</td>
                      <td className="px-3 py-2 font-mono text-sm tabular-nums text-fg-primary">{instant(job.lastAttemptAt)}</td>
                      <td className="px-3 py-2 font-mono text-sm tabular-nums text-fg-primary">{instant(job.lastSuccessAt)}</td>
                      <td className="px-3 py-2 text-right font-mono text-sm tabular-nums text-fg-tertiary">
                        {job.consecutiveFailures}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <StatusChip tone={componentTone(job.status)} label={statusWord(t, job.status)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
          <p className="m-0 px-4 py-2.5 text-sm text-fg-tertiary">{t('systemHealth.next.jobsFootnote')}</p>
        </div>
      )}
    </section>
  )
}
