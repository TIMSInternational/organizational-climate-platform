import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import type { ReportShareSummary } from '../api/reportShares'
import ReportShareDialog from './ReportShareDialog'

/**
 * The share dialog opened from Informes. It carries every guarantee
 * `components/ReportSharePanel.test.tsx` pins on the old panel — the token shown once and
 * never listed, the lifetime sent as typed, a revoked link dropped, a failed copy said —
 * plus the redesign's: active links only, the revoked ones behind "Mostrar revocados".
 */

const TOKEN = 'z'.repeat(43)

function share(over: Partial<ReportShareSummary> = {}): ReportShareSummary {
  return {
    id: 'live',
    createdAt: '2026-09-10T02:14:45Z',
    expiresAt: '2026-10-10T02:14:45Z',
    revokedAt: null,
    accessCount: 2,
    lastAccessedAt: '2026-09-10T02:14:47Z',
    isActive: true,
    ...over,
  }
}

/** The CSV report on 10 Sep: one live link and five revoked ones, all revoked that day. */
function meridianoShares(): ReportShareSummary[] {
  return [
    share(),
    ...[1, 2, 3, 4, 5].map((n) =>
      share({ id: `dead${n}`, createdAt: `2026-09-10T02:0${n}:00Z`, revokedAt: '2026-09-10T02:55:09Z', isActive: false }),
    ),
  ]
}

let shares: ReportShareSummary[] = []

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function routeFetch(overrides: { list?: () => Response; mint?: () => Response } = {}) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://test.local')
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url.pathname === '/admin/reports/r1/shares') {
      return Promise.resolve(overrides.list ? overrides.list() : json(shares))
    }
    if (method === 'POST' && url.pathname === '/admin/reports/r1/share') {
      if (overrides.mint) return Promise.resolve(overrides.mint())
      shares = [share({ id: 'new', createdAt: '2026-09-10T20:00:00Z', expiresAt: '2026-10-01T00:00:00Z', accessCount: 0 }), ...shares]
      return Promise.resolve(json({ id: 'new', token: TOKEN, path: `/shared/reports/${TOKEN}`, expiresAt: '2026-10-01T00:00:00Z' }))
    }
    const revoke = url.pathname.match(/^\/admin\/reports\/r1\/shares\/([^/]+)$/)
    if (method === 'DELETE' && revoke) {
      shares = shares.map((s) => (s.id === revoke[1] ? { ...s, isActive: false, revokedAt: '2026-09-10T21:00:00Z' } : s))
      return Promise.resolve(new Response(null, { status: 204 }))
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })
}

function renderDialog(onSharesChange?: (next: readonly ReportShareSummary[]) => void) {
  return render(
    <TranslationProvider>
      <ReportShareDialog
        open
        onOpenChange={() => {}}
        baseUrl="http://api.test"
        report={{ id: 'r1', title: 'Datos de clima — T3 2026', format: 'csv' }}
        onSharesChange={onSharesChange}
      />
    </TranslationProvider>,
  )
}

describe('ReportShareDialog', () => {
  beforeEach(() => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
    shares = meridianoShares()
  })

  afterEach(() => {
    cleanup()
    clearToken()
    window.localStorage.clear()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('heads itself with the report and its format, and warns first that the link needs no password', async () => {
    routeFetch()
    renderDialog()
    const dialog = await screen.findByRole('dialog')
    expect(dialog.querySelector('[data-slot="share-eyebrow"]')?.textContent).toBe('Datos de clima — T3 2026 · CSV')
    expect(within(dialog).getByRole('heading', { name: 'Compartir con un enlace público' })).toBeTruthy()
    const warning = dialog.querySelector('[data-slot="share-warning"]')!
    expect(warning.textContent).toContain('Este enlace no pide contraseña')
    expect(warning.textContent).toContain('Revoca los enlaces que ya no necesites')
  })

  it('lists the active link only, and keeps the revoked ones behind "Mostrar revocados"', async () => {
    routeFetch()
    renderDialog()
    await waitFor(() => expect(document.querySelectorAll('[data-slot="active-link"]').length).toBe(1))
    expect(screen.getByText('Enlace activo · 1')).toBeTruthy()
    expect(screen.getByText('2 aperturas en total')).toBeTruthy()
    // The five revoked links are counted and dated, not listed, until asked for.
    expect(document.querySelector('[data-slot="inactive-links"]')).toBeNull()
    const toggle = screen.getByRole('button', { name: /Mostrar revocados/ })
    expect(toggle.textContent).toContain('5')
    expect(screen.getByText(/todos del 10 sept/)).toBeTruthy()

    await userEvent.click(toggle)
    expect(document.querySelectorAll('[data-slot="inactive-link"]').length).toBe(5)
    expect(document.querySelector('[data-slot="inactive-links"]')?.textContent).toContain('revocado el 10 sept')
  })

  it('never shows a token for a link minted earlier, and offers no Copiar it could not honour', async () => {
    routeFetch()
    renderDialog()
    const link = await waitFor(() => {
      const found = document.querySelector('[data-slot="active-link"]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    expect(link.querySelector('[data-slot="report-share-masked"]')?.textContent).toMatch(/\/shared\/reports\/····$/)
    expect(within(link).queryByRole('button', { name: 'Copiar' })).toBeNull()
    expect(within(link).getByRole('button', { name: 'Revocar' })).toBeTruthy()
    expect(screen.getByText('El enlace completo solo se muestra al crearlo.')).toBeTruthy()
  })

  it('mints with the lifetime typed, then shows the absolute URL once with Copiar', async () => {
    routeFetch()
    renderDialog()
    await screen.findByText('Enlace activo · 1')
    const days = screen.getByLabelText('Vence en')
    await userEvent.clear(days)
    await userEvent.type(days, '21')
    await userEvent.click(screen.getByRole('button', { name: 'Crear enlace' }))

    const minted = await waitFor(() => {
      const found = document.querySelector('[data-minted="true"]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    expect(minted.querySelector('[data-slot="report-share-url"]')?.textContent).toBe(
      `${window.location.origin}/shared/reports/${TOKEN}`,
    )
    expect(within(minted).getByRole('button', { name: 'Copiar' })).toBeTruthy()
    expect(minted.textContent).toContain('no se puede volver a mostrar')

    const post = vi.mocked(fetch).mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === 'POST')!
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ expiresInDays: 21 })
    // The list the dialog reads back never carries the token — only the mint did.
    expect(screen.getByText('Enlaces activos · 2')).toBeTruthy()
  })

  it('stops offering the URL of the link it has just revoked', async () => {
    routeFetch()
    renderDialog()
    await screen.findByText('Enlace activo · 1')
    await userEvent.click(screen.getByRole('button', { name: 'Crear enlace' }))
    const minted = await waitFor(() => {
      const found = document.querySelector('[data-minted="true"]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    await userEvent.click(within(minted).getByRole('button', { name: 'Revocar' }))
    await waitFor(() => expect(document.querySelector('[data-minted="true"]')).toBeNull())
    expect(document.body.textContent).not.toContain(TOKEN)
    const del = vi.mocked(fetch).mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === 'DELETE')!
    expect(String(del[0])).toContain('/admin/reports/r1/shares/new')
  })

  it('says the copy failed rather than claiming it worked', async () => {
    routeFetch()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    renderDialog()
    await screen.findByText('Enlace activo · 1')
    await userEvent.click(screen.getByRole('button', { name: 'Crear enlace' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Copiar' }))
    // Announced, and in words: the loading region owns another live region, so the
    // sentence is found by its text and then proved to be a status.
    const said = await screen.findByText('No se pudo copiar. Selecciona el enlace y cópialo a mano.')
    expect(said.getAttribute('role')).toBe('status')
    expect(screen.queryByText('Copiado.')).toBeNull()
  })

  it('previews the day the link stops opening, as the server will clamp it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-10T12:00:00Z'))
    routeFetch()
    renderDialog()
    await screen.findByText('Enlace activo · 1')
    const until = document.querySelector('[data-slot="share-until"]')!
    expect(until.textContent).toBe('días · hasta el 10 oct')
    const days = screen.getByLabelText('Vence en')
    await userEvent.clear(days)
    await userEvent.type(days, '900')
    // 365 days, the server's ceiling, not 900.
    expect(until.textContent).toBe('días · hasta el 10 sept 2027')
  })

  it('hands the page every list it reads, so the row and the tile agree with the dialog', async () => {
    routeFetch()
    const onSharesChange = vi.fn()
    renderDialog(onSharesChange)
    await waitFor(() => expect(onSharesChange).toHaveBeenCalledTimes(1))
    expect(onSharesChange.mock.calls[0][0]).toHaveLength(6)
    await userEvent.click(screen.getByRole('button', { name: 'Crear enlace' }))
    await waitFor(() => expect(onSharesChange).toHaveBeenCalledTimes(2))
    expect(onSharesChange.mock.calls[1][0]).toHaveLength(7)
  })

  it('opens with focus on its title rather than on "×", and Tab reaches "×" first', async () => {
    // A visit to `?share=<id>` has had no pointer interaction, so a control focused on open
    // wears the focus ring — the artboard shows none. The title is focused instead.
    routeFetch()
    renderDialog()
    const heading = await screen.findByRole('heading', { name: 'Compartir con un enlace público' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    const [close] = screen.getAllByRole('button', { name: 'Cerrar' })
    expect(close.closest('[data-slot="report-share-dialog"]')).not.toBeNull()
    expect(heading.getAttribute('tabindex')).toBe('-1')
    await userEvent.tab()
    expect(document.activeElement).toBe(close)
  })

  it('surfaces the refusal instead of an empty dialog when the links cannot be read', async () => {
    routeFetch({ list: () => json({ message: 'Forbidden' }, 403) })
    renderDialog()
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText(/Ningún enlace activo/)).toBeTruthy()
  })
})
