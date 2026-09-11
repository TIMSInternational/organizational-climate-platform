import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import SystemHealthNextPage from './SystemHealthNextPage'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../../i18n'
import { setToken, clearToken } from '../../../../auth/token'
import type { SystemStatusResponse } from '../../api/systemStatus'
import type { SystemSettingsData } from '../../api/systemSettings'
import { tokenFor } from '../../../../test/jwtFixture'
import en from '../../../../i18n/en.json'

const copy = en.systemHealth
const next = en.systemHealth.next

/**
 * The old `SystemHealthPage` guarantees, moved onto the redesigned Estado del sistema (the
 * per-role canvas, 10 Sep), plus the ones the redesign adds: the verdict counts what is not
 * "OK", and the mail tile says it could not look rather than "off" when the settings read fails.
 */
function status(overrides: Partial<SystemStatusResponse> = {}): SystemStatusResponse {
  return {
    service: 'climate-project-api',
    status: 'ok',
    checkedAt: '2026-09-10T19:20:37Z',
    environment: 'Development',
    build: { commit: 'unknown', builtAt: 'unknown', runtime: '10.0.10' },
    database: { status: 'ok', latencyMs: 1, port: 5432, usesTransactionPoolerPort: false, maxPoolSize: 10, maxPoolSizeDefaulted: true },
    notificationQueue: { status: 'ok', pending: 0, due: 0, deadLettered: 0, oldestDueAgeSeconds: null },
    dispatcher: { status: 'never-run', lastDispatchAt: null },
    jobs: [
      {
        jobName: 'notification-dispatch',
        intervalSeconds: 60,
        lastAttemptAt: '2026-09-10T19:20:09Z',
        lastSuccessAt: '2026-09-10T19:20:09Z',
        consecutiveFailures: 0,
        status: 'ok',
      },
      {
        jobName: 'digests',
        intervalSeconds: 900,
        lastAttemptAt: '2026-09-10T18:00:00Z',
        lastSuccessAt: '2026-09-10T17:00:00Z',
        consecutiveFailures: 2,
        status: 'failing',
      },
    ],
    ...overrides,
  }
}

const SETTINGS: SystemSettingsData = {
  loginEnabled: true,
  maintenanceMode: false,
  maintenanceMessage: null,
  maxLoginAttempts: 5,
  sessionTimeoutMinutes: 60,
  passwordPolicy: { minLength: 8, requireUppercase: true, requireLowercase: true, requireNumbers: true, requireSpecialChars: false },
  emailSettings: { smtpEnabled: false, fromEmail: null, smtpHost: null, smtpPort: null },
  updatedAt: '2026-08-12T02:47:06Z',
}

function serve(body: SystemStatusResponse | null, httpStatus = 200, settings: SystemSettingsData | null = SETTINGS) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/admin/system-settings')) {
      return Promise.resolve(settings ? new Response(JSON.stringify(settings), { status: 200 }) : new Response(null, { status: 500 }))
    }
    if (url.includes('/admin/system/status')) {
      return Promise.resolve(body ? new Response(JSON.stringify(body), { status: httpStatus }) : new Response(null, { status: 500 }))
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/admin/system']}>
        <SystemHealthNextPage />
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function jobRow(name: string): HTMLElement {
  return document.querySelector(`tr[data-job="${name}"]`) as HTMLElement
}

describe('SystemHealthNextPage', () => {
  beforeEach(() => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    vi.stubGlobal('fetch', vi.fn())
    setToken(tokenFor({ role: 'super_admin' }))
  })

  afterEach(() => {
    cleanup()
    clearToken()
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('reports each scheduled job with its own heartbeat', async () => {
    serve(status())
    renderPage()
    await screen.findByText('notification-dispatch')
    expect(within(jobRow('notification-dispatch')).getByText(copy.statusOk)).toBeTruthy()
    expect(within(jobRow('digests')).getByText(copy.statusFailing)).toBeTruthy()
    expect(within(jobRow('digests')).getByText('2')).toBeTruthy()
  })

  it('counts every chip that is not OK beside the verdict — the failing job, the dispatcher and the stored SMTP switch', async () => {
    serve(status())
    renderPage()
    const verdict = await screen.findByText(next.verdictWithWarnings.replace('{verdict}', copy.statusOk).replace('{count}', '3'))
    expect(verdict.closest('[data-slot="system-verdict"]')).toBeTruthy()
  })

  it('renders the payload of a 503 rather than treating it as a failed request', async () => {
    serve(status({ status: 'unhealthy', database: { ...status().database, status: 'timeout' } }), 503)
    renderPage()
    expect(await screen.findAllByText(copy.statusTimeout)).not.toHaveLength(0)
    expect(screen.queryByText(copy.loadFailed)).toBeNull()
    expect(document.querySelector('[data-slot="system-verdict"]')?.textContent).toContain(copy.statusUnhealthy)
  })

  it('says so when no scheduler was observed, instead of showing an empty table', async () => {
    serve(status({ jobs: [] }))
    renderPage()
    expect(await screen.findByText(copy.noJobsObserved)).toBeTruthy()
    expect(screen.getByText(next.jobsNone)).toBeTruthy()
  })

  it('survives an API too old to report jobs, and still says no scheduler was observed', async () => {
    const old = status()
    delete (old as Partial<SystemStatusResponse>).jobs
    serve(old)
    renderPage()
    expect(await screen.findByText(copy.noJobsObserved)).toBeTruthy()
  })

  it('names the transaction pooler when the runtime is pointed at it', async () => {
    serve(status({ database: { ...status().database, port: 6543, usesTransactionPoolerPort: true } }))
    renderPage()
    expect(await screen.findByText(next.poolerTransaction.replace('{port}', '6543'))).toBeTruthy()
  })

  it('says the mail tile could not look when the settings read fails — never "off"', async () => {
    serve(status(), 200, null)
    renderPage()
    expect(await screen.findByText(next.mailUnknownTitle)).toBeTruthy()
    expect(screen.queryByText(next.mailTitleOff)).toBeNull()
  })

  it('reads the stored SMTP switch, and names where it read it', async () => {
    serve(status())
    renderPage()
    expect(await screen.findByText(next.mailTitleOff)).toBeTruthy()
    expect(screen.getByText(next.mailSubEmpty)).toBeTruthy()
  })

  it('surfaces a retry when the request itself fails, and the retry asks again', async () => {
    serve(null)
    renderPage()
    expect(await screen.findByText(copy.loadFailed)).toBeTruthy()
    serve(status())
    await userEvent.click(screen.getByRole('button', { name: en.common.retry }))
    expect(await screen.findByText('notification-dispatch')).toBeTruthy()
  })
})

// The page-level half of "a job's day and clock are printed in one zone" (the refuter's R11:
// `localDay` read in UTC whenever no zone is passed — the page's own call — and every helper
// test still passed). The ambient zone is set here, as AdminDashboardNextView.test.tsx does.
describe('SystemHealthNextPage — one zone for a job\'s day and hour', () => {
  const AMBIENT = process.env.TZ

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    setToken(tokenFor({ role: 'super_admin' }))
  })

  afterEach(() => {
    cleanup()
    clearToken()
    localStorage.clear()
    vi.unstubAllGlobals()
    if (AMBIENT === undefined) delete process.env.TZ
    else process.env.TZ = AMBIENT
  })

  it('prints a job that ran at 03:01 UTC as "9 sept · 21:01" in Costa Rica, beside a check made on the 10th', async () => {
    process.env.TZ = 'America/Costa_Rica'
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    serve(
      status({
        jobs: [
          {
            jobName: 'retention-cleanup',
            intervalSeconds: 86400,
            lastAttemptAt: '2026-09-10T03:01:00Z',
            lastSuccessAt: '2026-09-10T03:01:00Z',
            consecutiveFailures: 0,
            status: 'ok',
          },
        ],
      }),
    )
    renderPage()
    const row = await waitFor(() => {
      const found = jobRow('retention-cleanup')
      expect(found).not.toBeNull()
      return found
    })
    // Last attempt and last success, both on the viewer's clock and the viewer's day.
    expect(within(row).getAllByText('9 sept · 21:01')).toHaveLength(2)
  })

  it('writes the dispatcher\'s cadence as a sentence — "corre cada minuto", never "cada 1 min"', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    serve(status())
    renderPage()
    const note = await waitFor(() => {
      const found = document.querySelector('[data-slot="dispatcher-note"]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    expect(note.textContent).toMatch(/notification-dispatch corre cada minuto;/)
    expect(note.textContent).not.toMatch(/1 min/)
  })
})
