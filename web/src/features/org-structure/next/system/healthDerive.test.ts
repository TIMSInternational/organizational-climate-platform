import { describe, it, expect } from 'vitest'
import type { SystemJobStatus, SystemStatusResponse } from '../../api/systemStatus'
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
} from './healthDerive'

function job(over: Partial<SystemJobStatus> = {}): SystemJobStatus {
  return {
    jobName: 'digests',
    intervalSeconds: 900,
    lastAttemptAt: '2026-09-10T19:15:46Z',
    lastSuccessAt: '2026-09-10T19:15:46Z',
    consecutiveFailures: 0,
    status: 'ok',
    ...over,
  }
}

/** The local API's answer on 10 Sep 2026 (super-meridiano.json), trimmed to what these read. */
function status(over: Partial<SystemStatusResponse> = {}): SystemStatusResponse {
  return {
    service: 'climate-project-api',
    status: 'ok',
    checkedAt: '2026-09-10T19:20:37Z',
    environment: 'Development',
    build: { commit: 'unknown', builtAt: 'unknown', runtime: '10.0.10' },
    database: { status: 'ok', latencyMs: 1, port: 5432, usesTransactionPoolerPort: false, maxPoolSize: 10, maxPoolSizeDefaulted: true },
    notificationQueue: { status: 'ok', pending: 0, due: 0, deadLettered: 0, oldestDueAgeSeconds: null },
    dispatcher: { status: 'never-run', lastDispatchAt: null },
    jobs: [job(), job({ jobName: 'notification-dispatch', intervalSeconds: 60, lastAttemptAt: '2026-09-10T19:20:09Z' })],
    ...over,
  }
}

describe('healthDerive', () => {
  it('draws a hang or a refusal critical, a thing to look at amber, and an unknown token neutral — never green', () => {
    expect(componentTone('ok')).toBe('good')
    expect(['slow', 'backlog', 'failing', 'never-run'].map(componentTone)).toEqual(['warning', 'warning', 'warning', 'warning'])
    expect(['timeout', 'unreachable', 'stale'].map(componentTone)).toEqual(['critical', 'critical', 'critical'])
    expect(componentTone('something-new')).toBe('neutral')
    expect([aggregateTone('ok'), aggregateTone('degraded'), aggregateTone('unhealthy')]).toEqual(['good', 'warning', 'critical'])
  })

  it('counts every chip that does not read Correcto: the dispatcher that never delivered and the stored SMTP switch make two', () => {
    const email = { smtpEnabled: false, fromEmail: null, smtpHost: null, smtpPort: null }
    expect(warningCount(status(), email)).toBe(2)
    // A failed settings read is not "SMTP off": the mail tile says it could not look, and counts nothing.
    expect(warningCount(status(), null)).toBe(1)
    expect(mailTone(null)).toBe('neutral')
    expect(warningCount(status({ jobs: [job({ status: 'stale' }), job({ status: 'failing' })] }), { ...email, smtpEnabled: true })).toBe(3)
  })

  it('survives an API too old to report jobs', () => {
    const old = status()
    delete (old as Partial<SystemStatusResponse>).jobs
    expect(warningCount(old, null)).toBe(1)
  })

  it('tallies the jobs: healthy of total, summed failures, the latest attempt and the worst token first', () => {
    const tally = tallyJobs([
      job({ status: 'failing', consecutiveFailures: 2, lastAttemptAt: '2026-09-10T19:18:00Z' }),
      job({ status: 'stale', consecutiveFailures: 1, lastAttemptAt: '2026-09-10T10:00:00Z' }),
      job({ lastAttemptAt: '2026-09-10T19:20:09Z' }),
    ])
    expect(tally).toEqual({ total: 3, ok: 1, failures: 3, lastAttemptAt: '2026-09-10T19:20:09Z', worst: 'stale' })
    expect(tallyJobs([job(), job()]).worst).toBeNull()
    expect(tallyJobs([]).lastAttemptAt).toBeNull()
  })

  it('says a job that ran 28 seconds before the check ran a minute ago, never zero minutes', () => {
    expect(minutesSince('2026-09-10T19:20:09Z', '2026-09-10T19:20:37Z')).toBe(1)
    expect(minutesSince('2026-09-10T19:05:37Z', '2026-09-10T19:20:37Z')).toBe(15)
  })

  it('prints the day and the hour in one zone: 03:01 UTC on 10 Sep is 9 Sep, 21:01 in Costa Rica', () => {
    const iso = '2026-09-10T03:01:05Z'
    expect(clockTime(iso, 'es', 'America/Costa_Rica')).toBe('21:01')
    expect(localDay(iso, 'es', 'America/Costa_Rica')).toMatch(/^9 sept?/)
    expect(dayKey(iso, 'America/Costa_Rica')).toBe('2026-09-09')
    expect(dayKey(iso, 'UTC')).toBe('2026-09-10')
  })

  it('names the zone offset the job times are printed in', () => {
    expect(utcOffsetLabel('America/Costa_Rica', new Date('2026-09-10T19:20:37Z'))).toBe('UTC−6')
    expect(utcOffsetLabel('UTC', new Date('2026-09-10T19:20:37Z'))).toBe('UTC')
    expect(utcOffsetLabel('Asia/Kolkata', new Date('2026-09-10T19:20:37Z'))).toBe('UTC+5:30')
  })
})
