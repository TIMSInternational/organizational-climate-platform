import {
  Shield,
  Building2,
  Settings,
  Users,
  Tags,
  Target,
  Waves,
  Gauge,
  Sparkles,
  FileText,
  ChartColumn,
  Bell,
  ClipboardList,
  Inbox,
  LayoutTemplate,
} from 'lucide-react'

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
// Action Plans, Microclimates and AI Insights ARE in the SuperAdmin section, as
// of #124. They were withheld because those pages had no company-picker, so a
// SuperAdmin landing on one would have been silently scoped to whatever company
// their own user row happened to point at (Action Plans, Microclimates) or would
// have had nothing at all to ask the API for, since #191 makes a global
// SuperAdmin's companyId claim the empty string (AI Insights).
//
// The picker now exists: `company-context/` holds one selection for the whole
// shell, `components/layout/CompanyContextSwitcher.tsx` renders it in the header
// for this role only, and `resolveCompanyScope` is where the rule that a
// SuperAdmin's company is their *explicit selection and never their claim* lives.
// A SuperAdmin who has selected nothing lands on "choose a company", which is the
// outcome these entries were held back to avoid getting wrong -- so the reason to
// withhold them is gone, and with it the reason to make the pages unreachable.
//
// Notifications (#99) is the one entry every role gets, including the roles that
// previously got an empty array. `/notifications/mine` authorizes per **user**,
// not per company or per role -- any authenticated caller can load their own
// inbox, and a CompanyAdmin calling it gets their own, not their tenant's. So it
// is the first entry that satisfies the role-awareness rule for `employee`,
// `supervisor` and `leader`, and the reason the fallback stopped being `[]`.
const NOTIFICATIONS_ITEM: NavItem = {
  labelKey: 'notifications.title',
  href: '/notifications',
  icon: Bell,
}

// "My surveys" (#109) is the second entry, after Notifications, that a non-admin role
// can load -- and for the same structural reason: `GET /surveys/my` resolves the
// caller's OWN user row and filters by that row's company and department, reading no
// role claim at all. So employee/supervisor/leader get a real, non-empty page.
//
// Deliberately NOT offered to super_admin. A global super admin's `User.CompanyId` is
// NULL since #191, so the endpoint correctly returns an empty list for them -- and an
// always-empty page is not a destination. It sits in the fallback branch instead,
// which is also where a company_admin with no companyId claim lands.
const MY_SURVEYS_ITEM: NavItem = {
  labelKey: 'navigation.mySurveys',
  href: '/surveys/my',
  icon: Inbox,
}

// The admin listing. Safe for BOTH admin roles, unlike Action Plans: `ListAsync`
// applies no company predicate at all for a super_admin who sends no `companyId`, so
// the page is a genuine cross-company view rather than a silently single-company one
// (the `/admin/benchmarks` shape). For anyone else the server overwrites the scope
// with their own company whatever they send. No companyId is interpolated, so this
// one entry serves both branches.
const SURVEYS_ITEM: NavItem = {
  labelKey: 'navigation.surveys',
  href: '/surveys',
  icon: ClipboardList,
}

// The template catalogue (#107's endpoints, #109's page). Admin-only, like the
// listing above and for the same reason: `GET /survey-templates` gates on
// `Roles.Admin` and then scopes by role -- a super_admin sees every tenant's plus the
// global ones, a company_admin the global ones plus their own. So one entry, no
// companyId interpolated, correct for both branches and offered to neither employee
// nor supervisor, who would get a 403.
const SURVEY_TEMPLATES_ITEM: NavItem = {
  labelKey: 'navigation.surveyTemplates',
  href: '/surveys/templates',
  icon: LayoutTemplate,
}

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
          // Benchmarks was offered to a SuperAdmin even before #124, and stays
          // exactly where it was. `GET /admin/benchmarks` returns every tenant's
          // benchmarks plus the global ones for this role, so the page is a real
          // cross-company view rather than a silent single-company one -- the
          // picker was never load-bearing here (see BenchmarksPage.tsx), and
          // #124 deliberately does NOT push the selected company onto it. Forcing
          // one company onto the one genuinely cross-company page would be the
          // selector breaking the case it was built to protect.
          //
          // Its position also matters: it is third, so the four-slot mobile tab
          // bar still offers Companies / System settings / Benchmarks, unchanged
          // by the three entries appended below.
          {
            labelKey: 'navigation.benchmarks',
            href: '/analytics/benchmarks',
            icon: Gauge,
          },
          // Restored by #124 -- see the block comment above.
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
            labelKey: 'navigation.aiInsights',
            href: '/analytics/ai-insights',
            icon: Sparkles,
          },
          // Appended after #124's three restored entries, not among them: that PR
          // pins a super_admin's first four leaves to Companies / System settings /
          // Benchmarks / Action Plans, and inserting the survey listing higher would
          // take Action Plans' mobile tab slot away again.
          //
          // Needs no company context of its own, unlike the three above: `ListAsync`
          // applies no company predicate at all for a super_admin, so this is the
          // genuinely cross-company shape Benchmarks has, and #124's selector is not
          // load-bearing here.
          SURVEYS_ITEM,
          SURVEY_TEMPLATES_ITEM,
          // Last on purpose: `leafNavItems` feeds the first four leaves to the mobile
          // tab bar, so Notifications sits behind "More" instead of displacing a
          // primary page. navSections.test.ts pins this position.
          NOTIFICATIONS_ITEM,
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
          // Placed after Microclimates -- a peer work surface -- rather than before
          // Action Plans, so the first four leaves are unchanged and Action Plans
          // keeps the mobile tab slot navSections.test.ts pins for it.
          SURVEYS_ITEM,
          SURVEY_TEMPLATES_ITEM,
          {
            labelKey: 'navigation.benchmarks',
            href: '/analytics/benchmarks',
            icon: Gauge,
          },
          // AI Insights, for a CompanyAdmin, takes its company from their own
          // claim. `GET /admin/ai-insights` requires a company id, and this is the
          // role that always has one. A SuperAdmin now gets this entry too (see
          // the branch above): #124's selector supplies the id their claim cannot,
          // and until they choose one the page says so rather than guessing.
          {
            labelKey: 'navigation.aiInsights',
            href: '/analytics/ai-insights',
            icon: Sparkles,
          },
          // Reports and Analytics are top-level destinations rather than children of
          // "Company Administration", for two reasons. They are work surfaces like
          // Action Plans and Microclimates, not configuration like Users and
          // Demographic fields -- and `leafNavItems` flattens a group's children ahead
          // of the top-level rows that follow it, so putting them in the group would
          // push Action Plans off the four-slot mobile tab bar (MobileNav.test.tsx
          // records that ordering consequence, and it is not this issue's to change).
          //
          // Unlike Action Plans, they carry NO silent-scoping hazard: they take their
          // company from the URL, not from a claim. They are absent from the
          // super_admin branch only because a super_admin's sections deliberately
          // contain no company id to interpolate; that role reaches them from the
          // company it opened, via CompanyDetailPage.
          {
            labelKey: 'navigation.reports',
            href: `/admin/companies/${companyId}/reports`,
            icon: FileText,
          },
          {
            labelKey: 'navigation.analytics',
            href: `/admin/companies/${companyId}/analytics`,
            icon: ChartColumn,
          },
          // Last on purpose -- see the super_admin branch. A company_admin's first
          // four leaves are their own company's pages; Notifications must not push
          // one of them off the mobile tab bar.
          NOTIFICATIONS_ITEM,
        ],
      },
    ]
  }

  // Every other role -- and a company_admin whose token carries no companyId.
  // Previously `[]`, then just Notifications; now the two pages they can all load.
  // See NOTIFICATIONS_ITEM and MY_SURVEYS_ITEM -- both authorize per *user* rather
  // than per role, which is what makes them safe for a branch that includes
  // employee, supervisor and leader.
  //
  // My surveys first: it is a work destination, Notifications is an inbox. Same
  // ordering principle as the admin branches above.
  return [{ titleKey: '', items: [MY_SURVEYS_ITEM, NOTIFICATIONS_ITEM] }]
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
