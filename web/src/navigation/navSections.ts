import { Shield, Building2, Settings, Users, Tags, Target, Waves, Gauge, Sparkles } from 'lucide-react'

export interface NavItem {
  /**
   * Catalogue path for the row's label, e.g. `navigation.companies`.
   *
   * Not a literal string. This module used to carry English labels
   * (`label: 'Companies'`), which rendered untranslated for a Spanish user in
   * both the sidebar and — once #80 added it — the mobile nav. It went unnoticed
   * because `i18n/noHardcodedStrings.test.ts` sweeps `.tsx` files only, and this
   * is a `.ts` module, so the guard could not see it. Keys keep `buildNavSections`
   * a pure function of the JWT claims (no React, no context) while making the
   * copy the catalogue's problem; `navSections.test.ts` asserts every key
   * resolves in every locale, which is the check that replaces the guard here.
   */
  labelKey: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  badge?: string
  sub?: NavItem[]
}

export interface NavSection {
  /** Catalogue path for the section heading, or `''` for an unheaded section. */
  titleKey: string
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
        titleKey: '',
        items: [
          {
            labelKey: 'navigation.systemAdministration',
            href: '/admin/companies',
            icon: Shield,
            sub: [
              { labelKey: 'navigation.companies', href: '/admin/companies', icon: Building2 },
              { labelKey: 'navigation.systemSettings', href: '/admin/system-settings', icon: Settings },
            ],
          },
          // Benchmarks IS offered to a SuperAdmin, unlike Action Plans above.
          // `GET /admin/benchmarks` returns every tenant's benchmarks plus the
          // global ones for this role, so the page is a real cross-company view
          // rather than a silent single-company one -- the missing #57 picker is
          // not load-bearing here (see BenchmarksPage.tsx).
          {
            labelKey: 'navigation.benchmarks',
            href: '/analytics/benchmarks',
            icon: Gauge,
          },
        ],
      },
    ]
  }

  if (role === 'company_admin' && companyId) {
    return [
      {
        titleKey: '',
        items: [
          {
            labelKey: 'navigation.companyAdministration',
            href: `/admin/companies/${companyId}`,
            icon: Shield,
            sub: [
              { labelKey: 'navigation.companySettings', href: `/admin/companies/${companyId}`, icon: Building2 },
              { labelKey: 'navigation.users', href: `/admin/companies/${companyId}/users`, icon: Users },
              { labelKey: 'navigation.demographicFields', href: `/admin/companies/${companyId}/demographic-fields`, icon: Tags },
            ],
          },
          {
            labelKey: 'navigation.actionPlans',
            href: '/action-plans',
            icon: Target,
          },
          {
            labelKey: 'navigation.microclimates',
            href: '/microclimates',
            icon: Waves,
          },
          {
            labelKey: 'navigation.benchmarks',
            href: '/analytics/benchmarks',
            icon: Gauge,
          },
          // AI Insights is CompanyAdmin-only, and deliberately not in the
          // SuperAdmin section above. `GET /admin/ai-insights` takes a required
          // company id, and since #191 a global SuperAdmin's `companyId` claim is
          // the empty string (`User.CompanyId` is `Guid?`, NULL meaning no
          // tenant) -- so the page would have nothing to ask for. Revisit with
          // #57's company selector.
          {
            labelKey: 'navigation.aiInsights',
            href: '/analytics/ai-insights',
            icon: Sparkles,
          },
        ],
      },
    ]
  }

  return []
}

/**
 * The rows a bottom tab bar can offer, in order.
 *
 * A grouped item (one with `sub`) is a *toggle* in the sidebar, not a
 * destination — clicking it expands children rather than navigating — so it must
 * not occupy one of the bar's few slots. Ported from the legacy `MobileNav`,
 * where the same flatten was written inline.
 *
 * Lives here rather than in the component so it can be asserted against the
 * role-aware sections directly, without rendering.
 */
export function leafNavItems(sections: NavSection[]): NavItem[] {
  return sections
    .flatMap((section) => section.items)
    .flatMap((item) => (item.sub?.length ? item.sub : [item]))
}
