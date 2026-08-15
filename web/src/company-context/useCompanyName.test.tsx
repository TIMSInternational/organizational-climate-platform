import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { useCompanyName, clearCompanyNameCache } from './useCompanyName'
import { setToken, clearToken } from '../auth/token'

function Probe() {
  const name = useCompanyName()
  return <span data-testid="name">{name ?? '(none)'}</span>
}

function profile(companyName: string | null) {
  return new Response(JSON.stringify({ companyName }), { status: 200 })
}

beforeEach(() => {
  clearCompanyNameCache()
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  clearToken()
  clearCompanyNameCache()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useCompanyName', () => {
  it('reads the company name from the caller’s own profile', async () => {
    setToken('token-a')
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(profile('Acme Corporation')))

    render(<Probe />)

    await waitFor(() => expect(screen.getByTestId('name').textContent).toBe('Acme Corporation'))
    // /profile takes no id and can address no row but the caller's own, which is why it is
    // usable by a leader where /admin/companies/{id} would 403.
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toMatch(/\/profile$/)
  })

  it('asks once for a given token, however many components ask', async () => {
    setToken('token-a')
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(profile('Acme Corporation')))

    render(
      <>
        <Probe />
        <Probe />
        <Probe />
      </>,
    )

    await waitFor(() => expect(screen.getAllByTestId('name')[0].textContent).toBe('Acme Corporation'))
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  /**
   * The reason the cache is a Map keyed by token rather than a bare module-level string.
   * A plain `let cached` would hand the second account the first account's company name —
   * silently, and on a screen whose whole job is to say which tenant you are looking at.
   */
  it('does not serve one account’s company to the next account', async () => {
    setToken('token-a')
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(profile('Acme Corporation')))
    const first = render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('name').textContent).toBe('Acme Corporation'))
    first.unmount()

    setToken('token-b')
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(profile('Northwind Logistics')))
    render(<Probe />)

    await waitFor(() => expect(screen.getByTestId('name').textContent).toBe('Northwind Logistics'))
  })

  it('renders nothing rather than a stale or wrong label when the lookup fails', async () => {
    setToken('token-a')
    vi.mocked(fetch).mockImplementation(() => Promise.reject(new Error('offline')))

    render(<Probe />)

    await waitFor(() => expect(screen.getByTestId('name').textContent).toBe('(none)'))
  })

  /** A super_admin has no tenant at all (#191), so null is the honest answer. */
  it('answers null for an account with no company', async () => {
    setToken('token-a')
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(profile(null)))

    render(<Probe />)

    await waitFor(() => expect(screen.getByTestId('name').textContent).toBe('(none)'))
  })

  it('does not call the API at all when there is no token', async () => {
    clearToken()

    render(<Probe />)

    await waitFor(() => expect(screen.getByTestId('name').textContent).toBe('(none)'))
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })
})
