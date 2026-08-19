import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { Chip, H2, NetworkError, SkeletonText, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui'
import { KpiTile } from '../../../components/charts'
import {
  getSystemStatus,
  type SystemComponentStatus,
  type SystemStatusResponse,
} from '../api/systemStatus'
import type { ChipTone } from '../../../components/ui/chipVariants'

/**
 * `/admin/system` — why the platform is in the state it is in (#147, #275).
 *
 * ## What this screen is for
 *
 * The three unauthenticated probes each answer a narrower question: `/health` is a static
 * literal, `/ready` is one `SELECT 1`, `/version` is provenance. This is the fourth
 * question — *why* — and it is the only surface in the product that can answer it, because
 * it is the only one authenticated enough to be allowed to say the pooler port, the pool
 * bound, the queue depth and when each job last ran.
 *
 * ## The jobs table is the point
 *
 * Until #275 the scheduler's liveness was inferred from `max(notifications.sent_at)`, which
 * cannot tell "nothing is running" from "nothing needed sending". Six jobs had never run in
 * production and nothing anywhere said so. Each row here is a job's own heartbeat, so a
 * gap means that job stopped — not that the platform was quiet.
 *
 * ## No colour-only signals
 *
 * Every status is a `Chip` carrying a translated word, and the tone is redundant with it.
 * An operator reading this on a projector, colour-blind, or in a screenshot pasted into a
 * ticket gets the same information.
 */
export default function SystemHealthPage() {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const [status, setStatus] = useState<SystemStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      setStatus(await getSystemStatus(baseUrl))
    } catch {
      // The endpoint answers 503 with a body for `unhealthy`, and the client opts that in.
      // Reaching here means the request itself failed -- no network, or not authorised --
      // which is a different thing from an unhealthy platform and must not be drawn as one.
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [baseUrl])

  useEffect(() => {
    void load()
  }, [load])

  /** Component tokens to chip tones. Never the only carrier of meaning -- see the remarks. */
  function toneFor(componentStatus: SystemComponentStatus): ChipTone {
    switch (componentStatus) {
      case 'ok':
        return 'good'
      case 'slow':
      case 'backlog':
      case 'failing':
      case 'never-run':
        return 'warning'
      case 'timeout':
      case 'unreachable':
      case 'stale':
        return 'critical'
      default:
        return 'neutral'
    }
  }

  function aggregateTone(aggregate: SystemStatusResponse['status']): ChipTone {
    if (aggregate === 'ok') return 'good'
    return aggregate === 'degraded' ? 'warning' : 'critical'
  }

  /**
   * Translated status word.
   *
   * An explicit map rather than a template key, because `translate` returns the key itself
   * on a miss -- so a token with no catalogue entry would render the literal string
   * "systemHealth.status.backlog" on an operator's screen. Every token the API can emit is
   * listed here, and `catalogues.test.ts` keeps both locales in step.
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

  function statusWord(componentStatus: string): string {
    const key = STATUS_KEYS[componentStatus]
    // An unrecognised token is shown raw rather than hidden: the API added something this
    // screen has not learned yet, and printing it is more useful than printing nothing.
    return key ? t(key) : componentStatus
  }

  function formatInstant(value: string | null): string {
    if (!value) return '—'
    return new Date(value).toLocaleString(locale)
  }

  /** Seconds as a cadence an operator reads, not a raw number. */
  function formatInterval(seconds: number): string {
    if (seconds <= 0) return '—'
    if (seconds % 3600 === 0) return t('systemHealth.everyHours', { count: seconds / 3600 })
    if (seconds % 60 === 0) return t('systemHealth.everyMinutes', { count: seconds / 60 })
    return t('systemHealth.everySeconds', { count: seconds })
  }

  const staleJobCount = status
    ? status.jobs.filter((job) => job.status === 'stale' || job.status === 'failing').length
    : 0

  return (
    <div>
      {/* The one case PageTopBar's own docs name for passing `eyebrow` explicitly: "a page
          belongs somewhere the nav does not say". This page's subject is platform
          administration, but its nav row sits under WORKSPACE because everything in the
          ADMINISTRATION section lands in the mobile tab bar's four slots and would displace
          Benchmarks (see navSections.ts). Deriving would print WORKSPACE over a page about
          the platform's own health. */}
      <PageTopBar
        eyebrow={t('navigation.sectionAdministration')}
        title={t('systemHealth.title')}
        description={t('systemHealth.description')}
        actions={
          status ? (
            <Chip tone={aggregateTone(status.status)} label={statusWord(status.status)} />
          ) : undefined
        }
      />

      {loading && <SkeletonText lines={6} />}

      {failed && !loading && (
        <NetworkError
          title={t('systemHealth.loadFailed')}
          description={t('systemHealth.loadFailedDescription')}
          onRetry={() => void load()}
          retryText={t('common.retry')}
        />
      )}

      {status && !loading && !failed && (
        <div className="flex flex-col gap-section">
          <div className="grid grid-cols-2 gap-inline lg:grid-cols-4">
            <KpiTile
              label={t('systemHealth.kpiDatabaseLatency')}
              value={status.database.latencyMs}
              locale={locale}
              sub={t('systemHealth.kpiPort', { port: status.database.port })}
            />
            <KpiTile
              label={t('systemHealth.kpiQueueDue')}
              value={status.notificationQueue.due}
              higherIsBetter={false}
              locale={locale}
              sub={t('systemHealth.kpiPending', { count: status.notificationQueue.pending })}
            />
            <KpiTile
              label={t('systemHealth.kpiDeadLettered')}
              value={status.notificationQueue.deadLettered}
              higherIsBetter={false}
              locale={locale}
              sub={t('systemHealth.kpiDeadLetteredSub')}
            />
            <KpiTile
              label={t('systemHealth.kpiJobsNeedingAttention')}
              value={staleJobCount}
              higherIsBetter={false}
              locale={locale}
              sub={t('systemHealth.kpiJobsSub', { count: status.jobs.length })}
            />
          </div>

          <section aria-labelledby="system-health-build">
            <H2 id="system-health-build" className="text-2xl">
              {t('systemHealth.buildHeading')}
            </H2>
            <dl className="rounded-lg border border-line-light bg-surface-panel p-panel">
              <div className="flex flex-wrap justify-between gap-inline py-1">
                <dt className="text-fg-secondary">{t('systemHealth.commit')}</dt>
                {/* The running commit appears nowhere else in the shell. Without it a
                    deploy that silently no-op'd and one that worked are indistinguishable
                    from inside the product (#69). */}
                <dd className="font-mono tabular-nums">{status.build.commit.slice(0, 12)}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-inline py-1">
                <dt className="text-fg-secondary">{t('systemHealth.builtAt')}</dt>
                <dd className="font-mono tabular-nums">{status.build.builtAt}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-inline py-1">
                <dt className="text-fg-secondary">{t('systemHealth.runtime')}</dt>
                <dd className="font-mono tabular-nums">{status.build.runtime}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-inline py-1">
                <dt className="text-fg-secondary">{t('systemHealth.environment')}</dt>
                <dd>{status.environment}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="system-health-database">
            <H2 id="system-health-database" className="text-2xl">
              {t('systemHealth.databaseHeading')}
            </H2>
            <dl className="rounded-lg border border-line-light bg-surface-panel p-panel">
              <div className="flex flex-wrap justify-between gap-inline py-1">
                <dt className="text-fg-secondary">{t('systemHealth.databaseStatus')}</dt>
                <dd><Chip tone={toneFor(status.database.status)} label={statusWord(status.database.status)} /></dd>
              </div>
              <div className="flex flex-wrap justify-between gap-inline py-1">
                <dt className="text-fg-secondary">{t('systemHealth.poolerPort')}</dt>
                {/* #220 made a fact on a page rather than a coin flip: on the transaction
                    pooler the service works most of the time, which is exactly why it has
                    to be shown rather than waited for. */}
                <dd>
                  <Chip
                    tone={status.database.usesTransactionPoolerPort ? 'critical' : 'good'}
                    label={
                      status.database.usesTransactionPoolerPort
                        ? t('systemHealth.poolerTransaction')
                        : t('systemHealth.poolerSession')
                    }
                  />
                </dd>
              </div>
              <div className="flex flex-wrap justify-between gap-inline py-1">
                <dt className="text-fg-secondary">{t('systemHealth.maxPoolSize')}</dt>
                <dd className="font-mono tabular-nums">
                  {status.database.maxPoolSize}
                  {status.database.maxPoolSizeDefaulted ? ` ${t('systemHealth.defaulted')}` : ''}
                </dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="system-health-jobs">
            <H2 id="system-health-jobs" className="text-2xl">
              {t('systemHealth.jobsHeading')}
            </H2>
            <div className="overflow-x-auto rounded-lg border border-line-light">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('systemHealth.jobName')}</TableHead>
                    <TableHead>{t('systemHealth.jobInterval')}</TableHead>
                    <TableHead>{t('systemHealth.jobLastAttempt')}</TableHead>
                    <TableHead>{t('systemHealth.jobLastSuccess')}</TableHead>
                    <TableHead>{t('systemHealth.jobFailures')}</TableHead>
                    <TableHead>{t('systemHealth.jobStatus')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {status.jobs.map((job) => (
                    <TableRow key={job.jobName}>
                      <TableCell className="font-mono">{job.jobName}</TableCell>
                      <TableCell>{formatInterval(job.intervalSeconds)}</TableCell>
                      <TableCell className="font-mono tabular-nums">{formatInstant(job.lastAttemptAt)}</TableCell>
                      <TableCell className="font-mono tabular-nums">{formatInstant(job.lastSuccessAt)}</TableCell>
                      <TableCell className="font-mono tabular-nums">{job.consecutiveFailures}</TableCell>
                      <TableCell><Chip tone={toneFor(job.status)} label={statusWord(job.status)} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {/* An empty registry is not "all healthy" -- it means no scheduler was observed,
                which is the #275 failure itself. Said plainly rather than drawn as a blank. */}
            {status.jobs.length === 0 && (
              <p className="p-panel text-fg-secondary" role="status">
                {t('systemHealth.noJobsObserved')}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
