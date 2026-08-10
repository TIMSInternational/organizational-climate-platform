import { describe, it, expect, afterEach } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useDashboardData } from './useDashboardData'

/** A promise whose settlement this test controls, so two loads can be interleaved. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * Every `load` below is captured **once**, outside the render callback. A fresh closure per
 * render is the infinite-fetch-loop the hook's docstring warns about, and it would hang this
 * file rather than fail it.
 */
describe('useDashboardData', () => {
  afterEach(cleanup)

  /**
   * The reachable path: a SuperAdmin changes the tenant in the header switcher, which hands
   * `CompanyAdminDashboardView` a new `companyId` prop without remounting it. The effect
   * refires with a new `load`, but the request for company A is still in flight — and if A
   * resolves after B, an unguarded hook paints A's figures under B's name.
   *
   * The interleaving is forced rather than raced: B settles first, then A.
   */
  it('ignores a response from a scope the caller has already navigated away from', async () => {
    const companyA = deferred<string>()
    const companyB = deferred<string>()

    const { result, rerender } = renderHook(({ load }) => useDashboardData(load), {
      initialProps: { load: () => companyA.promise },
    })

    rerender({ load: () => companyB.promise })

    await act(async () => {
      companyB.resolve('company B')
      await companyB.promise
    })
    await waitFor(() => expect(result.current.data).toBe('company B'))

    // Company A's request lands late. It must not win.
    await act(async () => {
      companyA.resolve('company A')
      await companyA.promise
    })

    expect(result.current.data).toBe('company B')
    expect(result.current.loading).toBe(false)
  })

  /**
   * The other half of the same guard: a late failure from the abandoned scope must not put
   * the current one into an error state either. Without it, switching tenants while the
   * previous request is failing shows "unable to load" over figures that loaded fine.
   */
  it('ignores a failure from a scope the caller has already navigated away from', async () => {
    const companyA = deferred<string>()
    const companyB = deferred<string>()

    const { result, rerender } = renderHook(({ load }) => useDashboardData(load), {
      initialProps: { load: () => companyA.promise },
    })

    rerender({ load: () => companyB.promise })

    await act(async () => {
      companyB.resolve('company B')
      await companyB.promise
    })
    await waitFor(() => expect(result.current.data).toBe('company B'))

    await act(async () => {
      companyA.reject(new Error('company A blew up'))
      await companyA.promise.catch(() => undefined)
    })

    expect(result.current.failed).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.data).toBe('company B')
  })

  it('still reports a failure from the current scope', async () => {
    const load = () => Promise.reject(new Error('Service unavailable'))

    const { result } = renderHook(() => useDashboardData(load))

    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.error).toBe('Service unavailable')
    expect(result.current.loading).toBe(false)
  })

  it('reloads on demand, and publishes the retry', async () => {
    let call = 0
    const load = () => Promise.resolve(`load ${++call}`)

    const { result } = renderHook(() => useDashboardData(load))

    await waitFor(() => expect(result.current.data).toBe('load 1'))

    act(() => result.current.reload())

    await waitFor(() => expect(result.current.data).toBe('load 2'))
  })
})
