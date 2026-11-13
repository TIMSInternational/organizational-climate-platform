import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../i18n'
import { ApiError } from '../../../api/authFetch'
import { DEFAULT_RESULT_BANDS } from '../../../components/charts'
import en from '../../../i18n/en.json'

/**
 * The admin dashboard's WHOLE-PAGE failure says the cause in the reader's words, never the
 * server's text.
 *
 * Review of 12 Nov: a mutation that put `(thrown as Error).message` back on this path
 * survived every test in `DashboardPage.test.tsx`, because those tests reach the partial
 * page (each region falls back on its own) and never the branch where the load itself
 * throws. Server text carries stack traces, ids and English, and obeys no privacy rule.
 */

const loadAdminDashboard = vi.fn()
vi.mock('./loadModel', () => ({ loadAdminDashboard: (...args: unknown[]) => loadAdminDashboard(...args) }))
vi.mock('../../result-bands/useResultBands', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useResultBands: () => ({ status: 'ready', bands: DEFAULT_RESULT_BANDS, retry: () => {} }),
}))

const { useAdminDashboardModel } = await import('./useAdminDashboardModel')

function wrapper({ children }: { children: ReactNode }) {
  return <TranslationProvider>{children}</TranslationProvider>
}

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
  loadAdminDashboard.mockReset()
})
afterEach(cleanup)

describe('useAdminDashboardModel, when the load itself fails', () => {
  it('says a server failure as the localized cause, and never prints the server text', async () => {
    const raw = 'System.NullReferenceException at DashboardEndpoints.cs:212 (tenant 7f3a)'
    loadAdminDashboard.mockRejectedValue(new ApiError(500, raw))

    const { result } = renderHook(() => useAdminDashboardModel(), { wrapper })

    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.model).toBeNull()
    expect(result.current.error).toBe(en.errors.api.server)
    expect(result.current.error).not.toContain('NullReference')
    expect(result.current.error).not.toContain(raw)
  })

  it('says a refusal by its status, not by the message the server attached', async () => {
    loadAdminDashboard.mockRejectedValue(new ApiError(403, 'Forbidden: role company_admin lacks claim X'))

    const { result } = renderHook(() => useAdminDashboardModel(), { wrapper })

    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.error).toBe(en.errors.api.forbidden)
    expect(result.current.error).not.toMatch(/claim X/)
  })
})
