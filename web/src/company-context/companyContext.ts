import { getToken } from '../auth/token'
import { decodeJwtPayload } from '../auth/jwt'

/**
 * The one place the app decides *which company a page is looking at* (#124).
 *
 * ## The failure this replaces
 *
 * Before this module, every company-scoped page read `companyId` off the JWT and
 * used it directly. For a CompanyAdmin that is right — their token names their
 * tenant. For a SuperAdmin it is a trap, and one that three separate lanes wrote
 * comments about rather than shipping:
 *
 * - `navigation/navSections.ts` withheld Action Plans from a SuperAdmin, because
 *   `/action-plans` would have scoped them to whatever company their own user row
 *   happened to point at and shown no sign of having done so.
 * - `ActionPlansListPage` / `MicroclimatesListPage` blocked the role outright with
 *   `common.superAdminScopedBrowsingUnavailable`.
 * - `navSections.ts` also withheld AI Insights, because since #191 a global
 *   SuperAdmin's `companyId` claim is the **empty string** (`User.CompanyId` is
 *   `Guid?`, NULL meaning no tenant), so there was nothing to send.
 *
 * So the rule this module exists to enforce, and the reason the resolution below
 * is a pure function with its own test:
 *
 * > **A SuperAdmin's effective company is their explicit selection, and nothing
 * > else.** It never falls back to their own `companyId` claim, whether that claim
 * > is a real company id, `''`, or absent. No selection resolves to
 * > `needs-selection` — "choose one" — never to "default to something".
 *
 * And its mirror image, which is a privilege boundary rather than a UX one:
 *
 * > **A non-SuperAdmin's effective company is their claim, and nothing else.** A
 * > stored selection is ignored entirely for those roles, so writing one by hand
 * > into `localStorage` changes nothing about what they see. The API enforces the
 * > same rule independently (`CanAccessCompany` short-circuits on SuperAdmin and
 * > otherwise compares the claim to the requested id) — this is the client half,
 * > not the boundary.
 */

/**
 * Where the selection lives. `localStorage`, matching `theme/adminTheme.ts` and
 * `i18n/locale.ts`: it must survive a reload and a new tab, and it is a display
 * preference rather than a credential — the server re-derives authority from the
 * bearer token on every request regardless of what is stored here.
 */
export const COMPANY_CONTEXT_STORAGE_KEY = 'admin-company-context'

/** The JWT `role` claim for a platform-wide administrator. */
export const SUPER_ADMIN = 'super_admin'

export interface SessionClaims {
  role: string | undefined
  /**
   * `undefined` for a company-less SuperAdmin.
   *
   * The claim itself is `''` in that case, not absent — `AuthEndpoints` emits
   * `user.CompanyId?.ToString() ?? string.Empty`. Normalising it here is what
   * keeps every consumer a plain truthiness check instead of one that has to
   * remember `''` is a third state; several pages were each doing that
   * normalisation by hand before this module.
   */
  companyId: string | undefined
}

/** The claims the shell and company-scoped pages read, normalised. */
export function readSessionClaims(): SessionClaims {
  const token = getToken()
  const claims = token ? decodeJwtPayload(token) : null
  const role = typeof claims?.role === 'string' ? claims.role : undefined
  const rawCompanyId = typeof claims?.companyId === 'string' ? claims.companyId : undefined
  return { role, companyId: rawCompanyId ? rawCompanyId : undefined }
}

/** The stored selection, or `null` when nothing is stored or storage is unavailable. */
export function readSelectedCompanyId(): string | null {
  try {
    const stored = window.localStorage.getItem(COMPANY_CONTEXT_STORAGE_KEY)
    return stored && stored.trim() !== '' ? stored : null
  } catch {
    // Storage can throw outright in private-browsing / blocked-cookie modes.
    // No selection is the safe answer: the caller renders "choose a company".
    return null
  }
}

/** Persists the selection. `null` clears it. */
export function writeSelectedCompanyId(companyId: string | null): void {
  try {
    if (companyId) {
      window.localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, companyId)
    } else {
      window.localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
    }
  } catch {
    // As above. The in-memory context still updates, so the selection holds for
    // this session and is simply not remembered across a reload.
  }
}

/**
 * `ready` — there is a company to scope by, in `companyId`.
 * `needs-selection` — a SuperAdmin who has not chosen one. Ask; do not guess.
 * `no-company` — any other role whose token names no tenant. Nothing to ask for.
 */
export type CompanyScopeStatus = 'ready' | 'needs-selection' | 'no-company'

export interface CompanyScope {
  role: string | undefined
  isSuperAdmin: boolean
  status: CompanyScopeStatus
  /** Defined exactly when `status === 'ready'`. */
  companyId: string | undefined
}

/**
 * The whole rule, in one pure function so it can be tested without a DOM.
 *
 * `selectedCompanyId` is consulted **only** for a SuperAdmin. That asymmetry is
 * the point: see this module's header.
 */
export function resolveCompanyScope(
  claims: SessionClaims,
  selectedCompanyId: string | null,
): CompanyScope {
  if (claims.role === SUPER_ADMIN) {
    const companyId = selectedCompanyId || undefined
    return {
      role: claims.role,
      isSuperAdmin: true,
      status: companyId ? 'ready' : 'needs-selection',
      companyId,
    }
  }

  const companyId = claims.companyId
  return {
    role: claims.role,
    isSuperAdmin: false,
    status: companyId ? 'ready' : 'no-company',
    companyId,
  }
}
