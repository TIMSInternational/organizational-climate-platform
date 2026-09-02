import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import SystemHealthPage from './SystemHealthPage'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import type { SystemStatusResponse } from '../api/systemStatus'
import { tokenFor } from '../../../test/jwtFixture'

function status(overrides: Partial<SystemStatusResponse> = {}): SystemStatusResponse {
  return {
    service: 'climate-project-api',
    status: 'ok',
    checkedAt: '2026-08-19T12:00:00Z',
    environment: 'Production',
    build: { commit: 'd3b1fce0123456789', builtAt: '2026-08-19T04:30:57Z', runtime: '10.0.11' },
    database: {
      status: 'ok',
      latencyMs: 3,
      port: 5432,
      usesTransactionPoolerPort: false,
      maxPoolSize: 10,
      maxPoolSizeDefaulted: true,
    },
    notificationQueue: { status: 'ok', pending: 0, due: 0, deadLettered: 0, oldestDueAgeSeconds: null },
    dispatcher: { status: 'ok', lastDispatchAt: '2026-08-19T11:52:00Z' },
    jobs: [
      {
        jobName: 'notification-dispatch',
        intervalSeconds: 300,
        lastAttemptAt: '2026-08-19T11:58:00Z',
        lastSuccessAt: '2026-08-19T11:58:00Z',
        consecutiveFailures: 0,
        status: 'ok',
      },
    ],
    ...overrides,
  }
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/admin/system']}>
        <SystemHealthPage />
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function serve(body: SystemStatusResponse, httpStatus = 200) {
  vi.mocked(fetch).mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status: httpStatus })),
  )
}

describe('SystemHealthPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    setToken(tokenFor({ role: 'super_admin' }))
  })

  afterEach(() => {
    cleanup()
    clearToken()
    vi.unstubAllGlobals()
  })

  it('reports each scheduled job with its own heartbeat', async () => {
    serve(status())
    renderPage()

    const row = (await screen.findByText('notification-dispatch')).closest('tr')
    expect(row).toBeTruthy()
    expect(within(row!).getByText('OK')).toBeTruthy()
  })

  /**
   * The #275 failure itself. An `unhealthy` verdict arrives as **503 with a full body**,
   * and rendering that as a generic network error would hide precisely the state the
   * operator opened the page to read.
   */
  it('renders the payload of a 503 rather than treating it as a failed request', async () => {
    serve(status({ status: 'unhealthy', database: { ...status().database, status: 'timeout' } }), 503)
    renderPage()

    expect(await screen.findByText('Unhealthy')).toBeTruthy()
    expect(screen.getByText('Timed out')).toBeTruthy()
  })

  /**
   * An empty job list is not "all healthy" — it means no scheduler reported at all, which
   * is the #275 incident. Drawing it as a clean empty table would repeat that failure.
   */
  it('says so when no scheduler was observed, instead of showing an empty table', async () => {
    serve(status({ jobs: [] }))
    renderPage()

    const notice = await screen.findByRole('status')
    expect(notice.textContent).toMatch(/no scheduler was observed/i)
  })

  /**
   * An API OLDER than #355 answers without a `jobs` field at all. That is out of
   * contract — the type declares it required — and it still happened in a local
   * run: `status.jobs.filter` threw, the router's error boundary took the whole
   * route, and the one page whose purpose is to say what is broken rendered
   * nothing. A diagnostics screen that only works against a healthy backend is
   * not a diagnostics screen.
   *
   * The cast is the point of the test: it builds the payload the contract forbids
   * and this page must survive anyway.
   */
  it('survives an API too old to report jobs, and still says no scheduler was observed', async () => {
    const { jobs: _dropped, ...withoutJobs } = status()
    serve(withoutJobs as SystemStatusResponse)
    renderPage()

    // The page renders at all...
    expect(await screen.findByText('d3b1fce01234')).toBeTruthy()
    // ...and reports the absence rather than an empty table or a clean bill.
    const notice = await screen.findByRole('status')
    expect(notice.textContent).toMatch(/no scheduler was observed/i)
  })

  /** #220: the pooler port is a fact on the page, not a coin flip. */
  it('names the transaction pooler when the runtime is pointed at it', async () => {
    serve(status({ database: { ...status().database, usesTransactionPoolerPort: true, port: 6543 } }))
    renderPage()

    expect(await screen.findByText(/transaction pooler \(6543\)/i)).toBeTruthy()
  })

  it('surfaces a retry when the request itself fails', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    renderPage()

    expect(await screen.findByRole('button', { name: /retry/i })).toBeTruthy()
  })
})
