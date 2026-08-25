import {
  Activity,
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
  LayoutDashboard,
  LayoutTemplate,
  ListChecks,
  Network,
  SquareKanban,
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
  // Typed as an SVG component rather than `{ className?: string }`: the sub-item
  // rows style their glyph inline (size and colour flip with the active state),
  // and the narrower type rejected `style` and `aria-hidden`. Every icon passed
  // here is a lucide component, which takes the full SVG prop set.
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
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
// - Any other role (employee/supervisor/leader): a real nav since #109/#132 -- the
//   pages that authorize per USER rather than per role. It was `[]` when none of
//   those existed, on the principle that an empty rail beats a broken link.
//
// Since #138 the rule above is checked rather than merely stated.
// `navigation/roleCapabilities.ts` records, per role, every destination that role
// can load and the endpoint that authorizes it, and `roleCapabilities.test.ts`
// fails if anything this module returns for a role is not in that role's list --
// with tracking on and off, and for a role neither module has heard of. Add a row
// here and the table has to gain the destination, with its `authorizedBy`, or the
// suite goes red. That table is also what non-nav links are checked against: the
// defect that prompted it was a primary button on `/action-plans` drawn on a page
// only `leader` and `supervisor` ever see, which 403s for both.
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

// The landing page (#132), and the other entry every role gets — for the same
// structural reason as Notifications, arrived at differently. `/dashboard` is not one
// page: `DashboardPage` dispatches on the role claim and each of the four endpoints
// behind it refuses the other three roles, so there is no role for which this row leads
// to a 403. That includes a role this module has never heard of, which falls through to
// the per-user employee view.
//
// **First in every branch, deliberately, and it moves each role's mobile tab bar.**
// `leafNavItems` feeds MobileNav the first four leaves; Dashboard taking the first slot
// pushes the fourth entry each role previously had behind "More". That is the right
// trade rather than an accidental one: this is the page every user is now landed on
// after login, and a bottom bar that cannot return to it is a bar missing its home
// button. navSections.test.ts and MobileNav.test.tsx pin the new order.
const DASHBOARD_ITEM: NavItem = {
  labelKey: 'navigation.dashboard',
  href: '/dashboard',
  icon: LayoutDashboard,
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

// Departments (#142). Admin-only: `/admin/departments` allows a super_admin
// always and a company_admin on their own company, and 403s everyone else, so it
// belongs to the two admin branches and not the fallback.
//
// No companyId is interpolated even though the endpoint *requires* one — the page
// takes it from `company-context` (#124), which is what lets a single entry serve
// a super_admin (their explicit selection) and a company_admin (their claim)
// without two different hrefs.
//
// Appended immediately before NOTIFICATIONS_ITEM in both branches, and
// deliberately NOT inside the company_admin group's `sub`: `leafNavItems` flattens
// a group's children ahead of the top-level rows that follow it, so a nested entry
// would become the fourth leaf and take Action Plans' mobile tab slot.
const DEPARTMENTS_ITEM: NavItem = {
  labelKey: 'navigation.departments',
  href: '/departments',
  icon: Network,
}

// The generic action-plan listing, lifted out of both admin branches so the one
// place that can hide it is `workspaceActionPlanItems` below.
const ACTION_PLANS_ITEM: NavItem = {
  labelKey: 'navigation.actionPlans',
  href: '/action-plans',
  icon: Target,
}

// The tracking module's two dashboards (#125). Both labels already existed in the
// catalogue from the legacy port and had no caller.
//
// The consolidado is offered to the two admin roles ONLY, and that is the
// role-awareness rule rather than a preference: `DashboardEndpoints.ConsolidadoAsync`
// returns `Results.Forbid()` for anything outside `Roles.Admin` (`company_admin`,
// `super_admin`), so this row would 403 for anyone else.
const TRACKING_CONSOLIDADO_ITEM: NavItem = {
  labelKey: 'navigation.trackingConsolidado',
  href: '/tracking',
  icon: SquareKanban,
}

// A node leader's own board. Deliberately NOT offered to either admin role even
// though the endpoint admits them: `TableroAsync` falls back to the caller's own
// `nodoId` claim, and an administrator's is `unassigned-<companyId>` or empty
// (`TrackingIdentifiers.NodoIdClaimForUser`), so the row would lead to an empty
// board every time. An always-empty page is not a destination — the same rule that
// keeps `/surveys/my` out of the super_admin branch. Admins reach a board by
// drilling into a nodo from the consolidado, which is where the id comes from.
const TRACKING_TABLERO_ITEM: NavItem = {
  labelKey: 'navigation.trackingDashboard',
  href: '/tracking/tablero',
  icon: Gauge,
}

// The plans listing (#126). `PlanesAccionEndpoints.ListAsync` scopes the query
// itself — an admin gets the tenant, everyone else gets their own nodo plus the
// plans they are responsable or involucrado on — so this row is safe for every role
// that has one. It is offered to the roles that MANAGE plans; an involucrado gets
// the task view below instead, which is §7's split.
const TRACKING_PLANES_ITEM: NavItem = {
  labelKey: 'navigation.trackingPlans',
  href: '/tracking/planes',
  icon: Target,
}

// The involucrado's view (#126). `MisTareasAsync` reads no role claim at all — it
// filters on the caller's own `sub` — so every authenticated role is a first-class
// caller, and this is the one tracking row a plain employee gets.
const TRACKING_MIS_TAREAS_ITEM: NavItem = {
  labelKey: 'navigation.trackingMisTareas',
  href: '/tracking/mis-tareas',
  icon: ListChecks,
}

/**
 * Options that are properties of the DEPLOYMENT rather than of the caller.
 *
 * Kept as an options object with a default so the two existing call sites and the
 * forty-odd assertions in `navSections.test.ts` keep meaning what they meant. The
 * risk that buys — a caller forgetting to pass it and silently losing the tracking
 * rows — is covered by `navSections.test.ts`, which reads `AdminLayout.tsx` and
 * `PageTopBar.tsx` and fails if either stops asking.
 */
export interface NavOptions {
  /**
   * Whether this build has a `services/tracking-api` configured.
   *
   * Comes from `features/tracking/api/config.ts`'s `isTrackingEnabled()`, which is
   * a capability flag and not company scoping — the tracking service decides the
   * tenant itself, from the caller's own `companyId` claim. See that module.
   */
  trackingEnabled?: boolean
}

/**
 * The work-surface rows for managing plans, which is **either** the generic
 * listing **or** the tracking module and never both.
 *
 * Federico's decision of 2026-08-21: where a tenant uses tracking, `/action-plans`
 * and `/tracking` are two different models of the same idea, and the client should
 * see one place to manage plans rather than two that disagree. They are not being
 * converged — the models stay separate — so the nav is what resolves the ambiguity.
 *
 * Returned in `/action-plans`' own position in both admin branches, deliberately:
 * `leafNavItems` feeds the mobile tab bar the first four leaves, and swapping a row
 * in place cannot move them, whereas appending the tracking rows at the end and
 * removing Action Plans from the middle would.
 */
function workspacePlanItems(role: string, options: NavOptions): NavItem[] {
  if (!options.trackingEnabled) return [ACTION_PLANS_ITEM]
  // Both admin roles get the consolidado and the plans listing; neither gets a
  // board of their own. The listing is what makes a plan reachable at all — every
  // plan code on it links to `/tracking/planes/:id`, which is the only screen where
  // avance is recorded.
  return role === 'super_admin' || role === 'company_admin'
    ? [TRACKING_CONSOLIDADO_ITEM, TRACKING_PLANES_ITEM]
    : []
}

export function buildNavSections(
  role: string | undefined,
  companyId: string | undefined,
  options: NavOptions = {},
): NavSection[] {
  if (role === 'super_admin') {
    // Three titled groups rather than one unheaded list, matching the ForMaps admin
    // sidebar this shell is modelled on. `.nav-section-title` was ported for exactly
    // this and had never been used, because every section shipped `titleKey: ''`.
    //
    // The item ORDER is byte-for-byte what it was. `leafNavItems` flattens sections
    // in order, so splitting the list changes nothing it produces -- which matters,
    // because the mobile tab bar takes the first four leaves and navSections.test.ts
    // pins them. Grouping is presentational here and must stay that way.
    return [
      {
        titleKey: 'navigation.sectionAdministration',
        items: [
          DASHBOARD_ITEM,
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
        ],
      },
      {
        titleKey: 'navigation.sectionWorkspace',
        items: [
          {
            labelKey: 'navigation.benchmarks',
            href: '/analytics/benchmarks',
            icon: Gauge,
          },
          // Restored by #124 -- see the block comment above. Since #125 this slot
          // is Action Plans OR the tracking consolidado, never both; the swap is
          // in place so the mobile tab bar's first four leaves cannot move.
          ...workspacePlanItems('super_admin', options),
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
          DEPARTMENTS_ITEM,
          // System Health (#275) is appended here rather than filed under System
          // Administration beside Companies and System settings, where it belongs by
          // subject. The reason is the one #124 and #142 both hit: everything in the
          // ADMINISTRATION section lands in the first four leaves, and those four ARE
          // the mobile tab bar. Adding it there displaces Benchmarks, which
          // `keeps Benchmarks on a super_admin mobile tab bar` exists to forbid.
          //
          // Losing the tab slot would be the wrong trade anyway: this is the page an
          // operator opens when something is already wrong, not one of the four things
          // they do most. Appended, it keeps a sidebar row and costs nobody a tab.
          {
            labelKey: 'navigation.systemHealth',
            href: '/admin/system',
            icon: Activity,
          },
        ],
      },
      {
        titleKey: 'navigation.sectionCommunication',
        // Last on purpose: `leafNavItems` feeds the first four leaves to the mobile
        // tab bar, so Notifications sits behind "More" instead of displacing a
        // primary page. navSections.test.ts pins this position.
        items: [NOTIFICATIONS_ITEM],
      },
    ]
  }

  if (role === 'company_admin' && companyId) {
    // Same three groups as the super_admin branch above, same rule: presentation
    // only, item order untouched so `leafNavItems` keeps its pinned first four.
    return [
      {
        titleKey: 'navigation.sectionAdministration',
        items: [
          DASHBOARD_ITEM,
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
        ],
      },
      {
        titleKey: 'navigation.sectionWorkspace',
        items: [
          // Action Plans OR the tracking consolidado, in the same slot -- see
          // `workspacePlanItems`.
          ...workspacePlanItems('company_admin', options),
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
          DEPARTMENTS_ITEM,
        ],
      },
      {
        titleKey: 'navigation.sectionCommunication',
        // Last on purpose -- see the super_admin branch. A company_admin's first
        // four leaves are their own company's pages; Notifications must not push
        // one of them off the mobile tab bar.
        items: [NOTIFICATIONS_ITEM],
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
  //
  // The tracking rows (#125, #126) are the first entries this branch has ever had
  // that are NOT offered to every role in it. `leader` is the node leader -- the
  // role `services/tracking-api` spells `Roles.PlanCreator` and the role the
  // client's §7 gives the full board to -- and it is the only one of these roles
  // with a jefatura to show. An `employee` or `supervisor` gets the task-only view
  // (`/tracking/mis-tareas`) instead.
  const trackingItems: NavItem[] = !options.trackingEnabled
    ? []
    : role === 'leader'
      ? // The node leader manages: their own board, the plans they own, and the
        // tasks they were named on like anybody else.
        [TRACKING_TABLERO_ITEM, TRACKING_PLANES_ITEM, TRACKING_MIS_TAREAS_ITEM]
      : // An employee or a supervisor gets the task-only view and nothing else.
        // `TableroAsync` would in fact serve them their nodo's whole board — it
        // gates on nodo membership, not on role — but §7 says the full board is
        // the leader's screen, so the nav implements the product rule. See
        // `trackingAccess.ts` on why that is a rule and not protection.
        [TRACKING_MIS_TAREAS_ITEM]

  return [
    // Dashboard first: since #132 it is where this role lands after login, and it is
    // their only page that is a summary rather than a list.
    {
      titleKey: 'navigation.sectionWorkspace',
      items: [DASHBOARD_ITEM, MY_SURVEYS_ITEM, ...trackingItems],
    },
    { titleKey: 'navigation.sectionCommunication', items: [NOTIFICATIONS_ITEM] },
  ]
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

/**
 * The Notifications row, carrying the caller's unread tally.
 *
 * ## Why this is the only badged row
 *
 * ForMaps' brand notes describe nav badges ("yellow pills for counts"), but **none
 * of their five live sidebars renders one** — Student, Counselor, SchoolAdmin,
 * Admin and Parent all pass counts nowhere. So there is no badge to port, and the
 * `badge` field here plus `.nav-badge` in `index.css` were built for a legacy nav
 * that had no counterpart either. Inventing counts to fill them would put a number
 * beside "Action Plans" that is either a second copy of one already on the page or
 * a fresh request per rail render.
 *
 * Notifications is different: the shell already polls that number for the bell, it
 * is not otherwise visible while the bell's dropdown is closed, and it is the one
 * count that means "there is something here you have not seen". So exactly one row
 * gets a badge, from data that already exists.
 *
 * Capped at "99+": the label box in a 220px rail is 151px, and a four-digit count
 * pushes the row's text into an ellipsis to make room for a number nobody reads
 * precisely.
 *
 * Returns the sections unchanged at zero — an empty pill reading "0" is noise, and
 * a badge's whole job is to be absent when there is nothing to say.
 */
export function withUnreadBadge(sections: NavSection[], unreadCount: number): NavSection[] {
  if (unreadCount <= 0) return sections

  const badge = unreadCount > 99 ? '99+' : String(unreadCount)
  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) =>
      item.href === NOTIFICATIONS_ITEM.href ? { ...item, badge } : item,
    ),
  }))
}

/**
 * Does `pathname` sit under `href` at all?
 *
 * Segment-aware: `/surveys` must not claim `/surveys-archive`, which a bare
 * `startsWith` would. Being *under* a row is necessary but not sufficient for the
 * row to light up — see `activeHref`.
 */
export function isUnder(pathname: string, href: string): boolean {
  if (href === '/dashboard') {
    return pathname === '/dashboard' || pathname === '/'
  }
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * The one row that should read as active: the **longest** href the current path
 * sits under.
 *
 * A plain prefix test lit two rows at once. `/admin/companies/{id}` (Company
 * Settings) is a prefix of `/admin/companies/{id}/demographic-fields`, so opening
 * Demographic fields filled both — invisible while "active" was a shade of text,
 * obvious once it became a filled pill.
 *
 * ForMaps hits the same thing and answers it by naming the offending parents in
 * `isActive` one at a time (`if (href === "/dashboard/assessments") return
 * pathname === href`). That works for their tree and needs a new line for every
 * parent that later gains a child. Deriving it instead means nothing to maintain:
 * the most specific matching row wins, which is the rule those exceptions were
 * approximating anyway.
 *
 * Lives here rather than in `RoleBasedNav`, where it was written, because the page
 * header needs the same answer to name the area it is in — see
 * `sectionTitleKeyForPath`. Pure, so it is asserted directly in
 * `navSections.test.ts` without rendering a rail.
 */
export function activeHref(pathname: string, sections: NavSection[]): string | null {
  const hrefs = sections.flatMap((section) =>
    section.items.flatMap((item) => [item.href, ...(item.sub?.map((sub) => sub.href) ?? [])]),
  )
  return hrefs
    .filter((href) => isUnder(pathname, href))
    .reduce<string | null>((best, href) => (best === null || href.length > best.length ? href : best), null)
}

/**
 * Which section of the app a path belongs to, as a catalogue key.
 *
 * This is what the page eyebrow says — ForMaps prints "STUDENT PORTAL" above the
 * page title, and the equivalent here is the nav group the open page sits in
 * ("ADMINISTRATION", "WORKSPACE", "COMMUNICATION"). Derived rather than passed per
 * page: there are 27 `PageTopBar` callers, and a hand-written eyebrow on each is 27
 * chances to name the wrong area and 27 more the day a nav entry moves group.
 *
 * `null` for a path no nav row covers (a detail route reached from a list, say),
 * where the honest answer is to print no eyebrow rather than to guess one.
 */
export function sectionTitleKeyForPath(pathname: string, sections: NavSection[]): string | null {
  const href = activeHref(pathname, sections)
  if (href === null) return null

  const section = sections.find((candidate) =>
    candidate.items.some(
      (item) => item.href === href || (item.sub?.some((sub) => sub.href === href) ?? false),
    ),
  )
  return section?.titleKey || null
}
