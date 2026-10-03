import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../company-context'
import { setToken, clearToken } from '../../auth/token'
import { tokenFor } from '../../test/jwtFixture'
import { DEFAULT_RESULT_BANDS } from '../../components/charts'
import { getResultBands } from './api'
import { rememberResultBands, useResultBands } from './useResultBands'

const wrapper = ({ children }: { children: ReactNode }) => <CompanyContextProvider>{children}</CompanyContextProvider>

const CUSTOM = { opportunityMin: 2.5, strengthMin: 4.25, names: { critical: 'Zona roja', opportunity: null, strength: null } }

describe('useResultBands', () => {
  afterEach(() => {
    cleanup()
    clearToken()
    window.localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
    vi.mocked(getResultBands).mockReset()
    vi.mocked(getResultBands).mockImplementation(async () => DEFAULT_RESULT_BANDS)
  })

  it('reads the company’s own scale, once per company', async () => {
    setToken(tokenFor({ sub: 'u1', role: 'leader', companyId: 'c1' }))
    vi.mocked(getResultBands).mockResolvedValue(CUSTOM)
    const first = renderHook(() => useResultBands(), { wrapper })
    await waitFor(() => expect(first.result.current.status).toBe('ready'))
    expect(first.result.current.bands).toEqual(CUSTOM)
    expect(vi.mocked(getResultBands).mock.calls.map(([, companyId]) => companyId)).toEqual(['c1'])
    // A second screen in the same session shares the read.
    const second = renderHook(() => useResultBands(), { wrapper })
    await waitFor(() => expect(second.result.current.status).toBe('ready'))
    expect(vi.mocked(getResultBands)).toHaveBeenCalledTimes(1)
  })

  it('fails as an error — never the product default — when the scale cannot be read', async () => {
    setToken(tokenFor({ sub: 'u1', role: 'company_admin', companyId: 'c1' }))
    vi.mocked(getResultBands).mockRejectedValue(new Error('Request failed: 500'))
    const { result } = renderHook(() => useResultBands(), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.bands).toBeNull()
  })

  it('reads what a save just wrote, without asking again', async () => {
    setToken(tokenFor({ sub: 'u1', role: 'company_admin', companyId: 'c1' }))
    rememberResultBands('c1', CUSTOM)
    const { result } = renderHook(() => useResultBands(), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.bands).toEqual(CUSTOM)
    expect(vi.mocked(getResultBands)).not.toHaveBeenCalled()
  })
})
