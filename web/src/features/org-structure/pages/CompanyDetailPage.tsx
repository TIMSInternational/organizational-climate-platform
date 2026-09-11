import { readViewerClaims } from '../../../auth/viewerCapabilities'
import SuperCompanyDetailView from '../next/super/SuperCompanyDetailView'
import CompanySettingsNextView from '../next/settings/CompanySettingsNextView'

/**
 * `/admin/companies/:id` — one route, two artboards, dispatched on the role.
 *
 * - A `super_admin` gets the per-role canvas's tenant detail, `SuperCompanyDetailView` (10 Sep).
 *   `canManageCompanies` is exactly this role (`viewerCapabilities.ts`).
 * - Everyone else gets the CompanySettings artboard, `CompanySettingsNextView` — the page the
 *   company administrator's sidebar links as "Administración de Empresa → Configuración"
 *   (`navSections.ts`). It decides itself whether this viewer may manage THIS company.
 *
 * Read off the claim, not the hook, so the dispatch works outside `CompanyContextProvider`.
 * The page this route used to mount for administrators stays in the tree, unrouted, as
 * `CompanyDetailLegacyAdminPage.tsx` — the wiring reference.
 */
export default function CompanyDetailPage() {
  return readViewerClaims().role === 'super_admin' ? <SuperCompanyDetailView /> : <CompanySettingsNextView />
}
