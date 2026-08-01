import { Shield, Building2, Settings, Users, Tags, Target } from 'lucide-react'

export interface NavItem {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  badge?: string
  sub?: NavItem[]
}

export interface NavSection {
  title: string
  items: NavItem[]
}

// Nav is role-aware: neither SuperAdmin's nor CompanyAdmin's entries point
// anywhere the backend would 403 for that role.
//
// - SuperAdmin: platform-wide pages (Companies, System settings). Previously
//   this list was static and only ever contained "Companies" -- SystemSettingsPage
//   existed and worked but had no nav entry, reachable only by typing the URL.
// - CompanyAdmin: their own company's pages. Previously there was no nav path
//   to any of these at all -- CompanyDetailPage.tsx (Settings/Departments) and
//   DemographicFieldsPage were reachable only via a link buried inside
//   CompanyDetailPage, which is itself unreachable without a nav entry (a
//   CompanyAdmin has no companies-list page to click into one from).
// - Any other role (employee/supervisor/leader): no admin pages exist for them
//   yet (see postAcceptRoute.ts) -- empty nav, not a broken link.
//
// Action Plans is intentionally NOT in the SuperAdmin section: /action-plans has
// no company-picker (see ActionPlansListPage.tsx), so a SuperAdmin landing on it
// would be silently scoped to whatever company their own user row happens to
// point at, not shown a genuine cross-company view. Add it back once #57
// (cross-cutting company-context selector) lands.
export function buildNavSections(role: string | undefined, companyId: string | undefined): NavSection[] {
  if (role === 'super_admin') {
    return [
      {
        title: '',
        items: [
          {
            label: 'System Administration',
            href: '/admin/companies',
            icon: Shield,
            sub: [
              { label: 'Companies', href: '/admin/companies', icon: Building2 },
              { label: 'System settings', href: '/admin/system-settings', icon: Settings },
            ],
          },
        ],
      },
    ]
  }

  if (role === 'company_admin' && companyId) {
    return [
      {
        title: '',
        items: [
          {
            label: 'Company Administration',
            href: `/admin/companies/${companyId}`,
            icon: Shield,
            sub: [
              { label: 'Company settings', href: `/admin/companies/${companyId}`, icon: Building2 },
              { label: 'Users', href: `/admin/companies/${companyId}/users`, icon: Users },
              { label: 'Demographic fields', href: `/admin/companies/${companyId}/demographic-fields`, icon: Tags },
            ],
          },
          {
            label: 'Action Plans',
            href: '/action-plans',
            icon: Target,
          },
        ],
      },
    ]
  }

  return []
}
