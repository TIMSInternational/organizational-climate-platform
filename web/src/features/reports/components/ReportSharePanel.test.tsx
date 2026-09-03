import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReportSharePanel from './ReportSharePanel'
import { TranslationProvider } from '../../../i18n'
import { setToken } from '../../../auth/token'
import { calendarDay } from '../../../lib/calendarDay'

const TOKEN = 'z'.repeat(43)

/** What the server says it minted, which is not what the panel asked for. */
const SERVER_EXPIRY = '2026-10-01T00:00:00Z'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function share(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    createdAt: '2026-09-01T00:00:00Z',
    expiresAt: '2026-10-01T00:00:00Z',
    revokedAt: null,
    accessCount: 4,
    lastAccessedAt: '2026-09-02T00:00:00Z',
    isActive: true,
    ...overrides,
  }
}

function renderPanel() {
  return render(
    <TranslationProvider>
      <ReportSharePanel
        open
        onOpenChange={() => {}}
        baseUrl="http://api.test"
        reportId="r1"
        reportTitle="Q3 climate summary"
      />
    </TranslationProvider>,
  )
}

describe('ReportSharePanel', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    // No `globals: true` in vite.config.ts, so RTL's auto-cleanup never registers.
    cleanup()
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('lists the existing links on open, with no token among them', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([share()]))
    renderPanel()

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('http://api.test/admin/reports/r1/shares')
    expect(await screen.findByText('Active')).toBeTruthy()
    // `ReportShareSummary` carries no token by design, so nothing that looks like one is on
    // screen before a mint.
    expect(document.querySelector('[data-slot="report-share-url"]')).toBeNull()
  })

  it('shows the empty state rather than a bare table when no link has been created', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([]))
    renderPanel()

    expect(
      await screen.findByText('No share links have been created for this report.'),
    ).toBeTruthy()
    expect(document.querySelector('table')).toBeNull()
  })

  it('mints a link, shows the absolute URL once, and says it cannot be shown again', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            id: 's9',
            token: TOKEN,
            path: `/shared/reports/${TOKEN}`,
            expiresAt: SERVER_EXPIRY,
          },
          201,
        ),
      )
      .mockResolvedValueOnce(jsonResponse([share({ id: 's9' })]))
    renderPanel()

    await screen.findByText('No share links have been created for this report.')
    // 999 days is out of range. The server CLAMPS to [1, 365] rather than rejecting, so what
    // the panel must print is the response's own `expiresAt` -- printing the date it asked for
    // would be a promise the server did not make.
    const days = screen.getByLabelText('Expires in (days)')
    await userEvent.clear(days)
    await userEvent.type(days, '999')
    await userEvent.click(screen.getByRole('button', { name: 'Create link' }))

    const url = await waitFor(() => {
      const node = document.querySelector('[data-slot="report-share-url"]')
      expect(node).toBeTruthy()
      return node!
    })

    // The ORIGIN is the viewer's own, not a configured base URL: the server returns only the
    // path, because it does not know which front end is asking.
    expect(url.textContent).toBe(`${window.location.origin}/shared/reports/${TOKEN}`)

    // The statement that makes the panel usable: there is no second chance, because
    // `report_shares` stores only a SHA-256 hash.
    expect(screen.getByText(/cannot be shown again/)).toBeTruthy()

    // Formatted through the app's own `calendarDay`, so the assertion is about WHICH value is
    // printed rather than about a date format -- and it does not depend on what month the
    // suite happens to run in, which is how a date test goes red by itself a year later.
    const expiry = document.querySelector('[data-slot="report-share-expiry"]')
    expect(expiry?.textContent).toBe(`Expires ${calendarDay(Date.parse(SERVER_EXPIRY), 'en')}.`)
  })

  it('sends the lifetime the admin typed', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ id: 's9', token: TOKEN, path: '/shared/reports/x', expiresAt: '2026-09-08T00:00:00Z' }, 201))
      .mockResolvedValueOnce(jsonResponse([]))
    renderPanel()

    await screen.findByText('No share links have been created for this report.')
    const days = screen.getByLabelText('Expires in (days)')
    await userEvent.clear(days)
    await userEvent.type(days, '7')
    await userEvent.click(screen.getByRole('button', { name: 'Create link' }))

    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(1))
    const [, init] = vi.mocked(fetch).mock.calls[1]
    expect(JSON.parse(init?.body as string)).toEqual({ expiresInDays: 7 })
  })

  it('revokes a link and drops it from the list', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([share()]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse([]))
    renderPanel()

    await screen.findByText('Active')
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }))

    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls[1][0]).toBe(
        'http://api.test/admin/reports/r1/shares/s1',
      ),
    )
    expect(vi.mocked(fetch).mock.calls[1][1]).toEqual(
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(
      await screen.findByText('No share links have been created for this report.'),
    ).toBeTruthy()
  })

  it('stops offering the URL of the link it has just revoked', async () => {
    // Otherwise the panel goes on displaying a copyable URL for a token the server has
    // killed, and an admin forwards a link that resolves to "not available".
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse({ id: 's9', token: TOKEN, path: `/shared/reports/${TOKEN}`, expiresAt: '2026-10-01T00:00:00Z' }, 201),
      )
      .mockResolvedValueOnce(jsonResponse([share({ id: 's9' })]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse([]))
    renderPanel()

    await screen.findByText('No share links have been created for this report.')
    await userEvent.click(screen.getByRole('button', { name: 'Create link' }))
    await waitFor(() =>
      expect(document.querySelector('[data-slot="report-share-url"]')).toBeTruthy(),
    )

    await userEvent.click(await screen.findByRole('button', { name: 'Revoke' }))

    await waitFor(() =>
      expect(document.querySelector('[data-slot="report-share-url"]')).toBeNull(),
    )
  })

  it('says the copy failed rather than claiming success when the clipboard is unavailable', async () => {
    // The clipboard API is blocked outside a secure context and no-ops in several embedded
    // browsers (MicroclimateLivePage records the finding). A button that silently does
    // nothing is worse than a link somebody can select, so the URL stays on screen and the
    // failure is stated.
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse({ id: 's9', token: TOKEN, path: `/shared/reports/${TOKEN}`, expiresAt: '2026-10-01T00:00:00Z' }, 201),
      )
      .mockResolvedValueOnce(jsonResponse([share({ id: 's9' })]))
    renderPanel()

    await screen.findByText('No share links have been created for this report.')
    await userEvent.click(screen.getByRole('button', { name: 'Create link' }))
    await waitFor(() =>
      expect(document.querySelector('[data-slot="report-share-url"]')).toBeTruthy(),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }))

    expect(
      await screen.findByText('Could not copy. Select the link above instead.'),
    ).toBeTruthy()
    // And the URL is still there to select.
    expect(document.querySelector('[data-slot="report-share-url"]')).toBeTruthy()
  })

  it('surfaces the backend refusal instead of an empty panel', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ message: 'Report not found' }, 404))
    renderPanel()

    const alert = await screen.findByText('Report not found')
    expect(alert.getAttribute('role')).toBe('alert')
  })

  it('warns that the link needs no password, in Spanish too', async () => {
    // The one sentence an administrator has to read before minting. Half the copy defects in
    // this app only appear in Spanish.
    vi.mocked(fetch).mockResolvedValue(jsonResponse([]))
    window.localStorage.setItem('preferredLocale', 'es')
    renderPanel()

    expect(await screen.findByText('Este enlace no pide contraseña')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Crear enlace' })).toBeTruthy()
  })
})
