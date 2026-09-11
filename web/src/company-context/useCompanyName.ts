import { useEffect, useState } from 'react'
import { getProfile } from '../features/profile/api/profile'
import { getToken } from '../auth/token'

/**
 * The viewer's own company name, for the pages whose eyebrow is the company (Departments,
 * Action Plans, Surveys — `ptb('Acme Manufacturing', …)` in the approved briefs).
 *
 * ## Why `/profile` and not `/admin/companies/{id}`
 *
 * The name has to resolve for **every** role that can open those three screens, which
 * includes leaders and supervisors. `/admin/companies/{id}` is reachable only by a
 * super_admin or that company's own company_admin, so it would 403 for exactly the
 * non-admin viewers who make up most of the audience, and the eyebrow would be blank for
 * them and present for admins — the kind of difference nobody notices until a customer
 * screenshot shows it. `/profile` is `RequireAuthorization()` with no role gate and already
 * returns `companyName`, and it can address no row but the caller's own.
 *
 * ## Why the result is cached per token, in module scope
 *
 * Three pages ask for the same string, and a company's name does not change inside a
 * session. Without a cache, every navigation between those screens refetches. The cache is
 * keyed by the **token**, not stored bare, so signing in as somebody else cannot inherit
 * the previous account's company — which a plain module-level `let name` would do, and
 * which is the failure mode worth spending a Map on.
 *
 * ## Why it answers `null` rather than something while it is loading
 *
 * `PageTopBar` treats `undefined` as "derive the nav section" and `null` as "render none".
 * Returning `undefined` here would print WORKSPACE for one frame and then replace it with
 * the company name — a visibly wrong label, briefly, on every load. Rendering nothing until
 * the name is known is a smaller lie than rendering the wrong one. A super_admin has no
 * tenant at all (#191), so `companyName` is legitimately null for them and the eyebrow
 * stays empty, which is the honest answer rather than a placeholder.
 */
/** The two names the shell and the page eyebrows read off `/profile`. */
interface ProfileNames {
  companyName: string | null
  departmentName: string | null
}

const cache = new Map<string, Promise<ProfileNames | null>>()

/** Exported for tests: a fresh module per test file would otherwise still share this Map. */
export function clearCompanyNameCache(): void {
  cache.clear()
}

/** The caller's own `/profile`, read once per token — see the module comment. */
function profileNames(token: string): Promise<ProfileNames | null> {
  let pending = cache.get(token)
  if (!pending) {
    const baseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined
    // No API configured (a unit test that renders the shell alone): nothing to ask.
    if (!baseUrl) return Promise.resolve(null)
    pending = getProfile(baseUrl)
      .then((profile) => ({ companyName: profile.companyName ?? null, departmentName: profile.departmentName ?? null }))
      // A failed lookup is not worth an error state on a page whose actual content
      // loaded fine: the eyebrow simply stays empty. Cached as a resolved null so a
      // page that remounts does not retry on every navigation.
      .catch(() => null)
    cache.set(token, pending)
  }
  return pending
}

function useProfileName(pick: (names: ProfileNames) => string | null, enabled: boolean): string | null {
  const [name, setName] = useState<string | null>(null)

  useEffect(() => {
    const token = getToken()
    if (!token || !enabled) {
      setName(null)
      return
    }

    let cancelled = false
    void profileNames(token).then((resolved) => {
      if (!cancelled) setName(resolved ? pick(resolved) : null)
    })

    return () => {
      cancelled = true
    }
  }, [enabled, pick])

  return name
}

const pickCompany = (names: ProfileNames) => names.companyName
const pickDepartment = (names: ProfileNames) => names.departmentName

export function useCompanyName(): string | null {
  return useProfileName(pickCompany, true)
}

/**
 * The viewer's own department's name — the "· Ingeniería" the canvas's rail prints after a
 * leader's, a supervisor's or an employee's role (LeaderDashboard, SupervisorDashboard,
 * EmployeeDashboard and TrackingTablero, 10 Sep). Off the same cached `/profile` read as the
 * company name, so a page that already names its company costs no second request. `null`
 * while loading, when the caller has no department, and when `enabled` is false (the two
 * administrator roles belong to no department).
 */
export function useOwnDepartmentName(enabled: boolean): string | null {
  return useProfileName(pickDepartment, enabled)
}
