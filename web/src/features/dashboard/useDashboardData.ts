import { useCallback, useEffect, useState } from 'react'

export interface DashboardData<T> {
  data: T | null
  loading: boolean
  /** True once a load has failed. Distinct from `error`, which may be null even so. */
  failed: boolean
  /**
   * The server's own message, when there was one.
   *
   * Null rather than a placeholder string when the thrown value was not an `Error` — this
   * hook translates nothing, so inventing copy here would put untranslated English behind
   * the i18n layer. The caller substitutes a catalogue string.
   */
  error: string | null
  reload: () => void
}

/**
 * Load-once-then-retry, shared by the four role dashboards.
 *
 * The four views are separate components with separate payload types precisely so that no
 * role's data can be reached from another role's page, and that split would otherwise mean
 * four identical copies of this state machine — which is where a page acquires an error
 * branch nobody wired up.
 *
 * `load` **must be stable** (wrap it in `useCallback` at the call site). It is a dependency
 * of the effect, so a fresh closure on every render is an infinite fetch loop. Suppressing
 * the dependency instead would not fix that, it would only hide it behind a stale closure
 * that never refetches when the scope changes — and the scope does change, see the
 * stale-response guard below.
 *
 * ## The stale-response guard
 *
 * When `load` changes identity the effect refires, but the previous request is still in
 * flight and may resolve *after* the new one. Without the `ignore` flag below, the older
 * payload wins and lands under the newer header.
 *
 * This is reachable, not theoretical: a SuperAdmin changing the tenant in the header
 * switcher gives `CompanyAdminDashboardView` a new `companyId` prop without remounting it,
 * so company A's figures can be painted under company B's name. The flag is set in the
 * effect's cleanup, which React runs before the re-run, so exactly one response — the
 * newest — is ever allowed to call `setData`.
 */
export function useDashboardData<T>(load: () => Promise<T>): DashboardData<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * `isCurrent` decides whether this call's result may still be published. `reload` passes
   * a function that is always true — a manual retry is by definition the current request,
   * and it has no cleanup to hang a flag on.
   */
  const run = useCallback(
    async (isCurrent: () => boolean = () => true) => {
      setLoading(true)
      setFailed(false)
      setError(null)
      try {
        const result = await load()
        if (!isCurrent()) return
        setData(result)
      } catch (err) {
        if (!isCurrent()) return
        setFailed(true)
        setError(err instanceof Error ? err.message : null)
      } finally {
        // Guarded too, and `finally` still runs after the early returns above. A superseded
        // request clearing `loading` would hide the spinner belonging to the request that
        // superseded it; whoever is current will clear it when they land.
        if (isCurrent()) {
          setLoading(false)
        }
      }
    },
    [load],
  )

  useEffect(() => {
    let current = true
    run(() => current)
    return () => {
      current = false
    }
  }, [run])

  const reload = useCallback(() => {
    void run()
  }, [run])

  return { data, loading, failed, error, reload }
}
