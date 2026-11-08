import { useEffect, useState } from 'react'
import { getCompany } from '../features/org-structure/api/companies'
import { useCompanyName } from './useCompanyName'
import { useCompanyScope } from './useCompanyScope'

const names = new Map<string, Promise<string | null>>()

/**
 * The name of a NAMED company — the one a page is about — for its title.
 *
 * `useCompanyName` answers the viewer's OWN company, which for a super administrator is none (or
 * TIMS's), so a page about one client printed "Configuración de empresa" or nothing where the
 * client's name belonged. With several clients open in a day, a TIMS operator could not see whose
 * reports, departments or new survey they were looking at
 * (docs/audits/2026-11-08-operator-ui-walkthrough.md, C).
 *
 * A super administrator: `GET /admin/companies/{id}`, read once per company per page load. Anyone
 * else can only be looking at their own company, so their profile's name is the answer and no
 * request is made. `null` while unknown, or when the read fails — the caller keeps its generic
 * label rather than printing a wrong one.
 */
export function useCompanyNameFor(companyId: string | undefined): string | null {
  const scope = useCompanyScope()
  const own = useCompanyName()
  const [read, setRead] = useState<{ id: string; name: string | null } | null>(null)

  useEffect(() => {
    if (!scope.isSuperAdmin || !companyId) return
    let cancelled = false
    let pending = names.get(companyId)
    if (!pending) {
      const baseUrl = import.meta.env.VITE_API_BASE_URL as string
      pending = getCompany(baseUrl, companyId).then(
        (company) => company.name ?? null,
        () => {
          names.delete(companyId)
          return null
        },
      )
      names.set(companyId, pending)
    }
    void pending.then((name) => {
      if (!cancelled) setRead({ id: companyId, name })
    })
    return () => {
      cancelled = true
    }
  }, [scope.isSuperAdmin, companyId])

  if (!companyId) return null
  if (!scope.isSuperAdmin) return own
  return read !== null && read.id === companyId ? read.name : null
}

/** For tests: forget every name read so far. */
export function forgetCompanyNames(): void {
  names.clear()
}
