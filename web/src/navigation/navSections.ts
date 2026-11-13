import { Tags } from 'lucide-react'
import {
  RailActivityIcon,
  RailAnalyticsIcon,
  RailBenchmarksIcon,
  RailCompaniesIcon,
  RailConsolidatedIcon,
  RailDepartmentsIcon,
  RailHomeIcon,
  RailInsightsIcon,
  RailMicroclimatesIcon,
  RailMySurveysIcon,
  RailPeopleIcon,
  RailPlansIcon,
  RailQuestionBankIcon,
  RailQuestionLibraryIcon,
  RailQuestionsIcon,
  RailReportsIcon,
  RailSettingsIcon,
  RailStatusIcon,
  RailSurveysIcon,
  RailTasksIcon,
  RailTemplatesIcon,
  RailTrendsIcon,
} from './railIcons'

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
  // here is a lucide component or one of the canvas's rail glyphs (`railIcons.tsx`);
  // both take the full SVG prop set.
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  /**
   * A count drawn as a small pill at the row's end. Nothing in this module sets one: the
   * shell fetches no per-row tally, and inventing one would be a second copy of a number a
   * page already prints, or a fresh request per rail render. The field stays so a count the
   * shell already holds can be handed to a row without a schema change.
   */
  badge?: string
  sub?: NavItem[]
  /**
   * Further paths this row reads as active under, besides its own `href` — for a row that
   * stands for an area another route also belongs to. `activeHref` weighs each by its own
   * length, so a row whose `href` is the more specific match still wins.
   */
  activeUnder?: readonly string[]
  /**
   * Paths under this row's `href` that are NOT this row's — another destination that merely
   * shares the prefix, and that this role's rail has no row for. `/surveys/my` sits under
   * `/surveys` but is "Mis encuestas", not "Todas las encuestas": an administrator who opens
   * it from a link must see no row lit rather than the wrong one (HIG `sidebars.md`: the
   * selected row says where you are).
   */
  activeExcept?: readonly string[]
}

export interface NavSection {
  /**
   * Catalogue path for the section heading, or `''` for the unheaded home section.
   *
   * Only the FIRST section may be unheaded, and only to hold the reader's home row(s) —
   * Inicio, or a leader's Mi equipo and Mis encuestas. Every Apple-design board (Main,
   * CompanyHome, TeamHome, 11 Nov) draws exactly that: the home row on its own at the top
   * of the rail, then the titled sections. `navSections.test.ts` pins both halves, because
   * `climate-project#22` was a rail whose headed and unheaded groups interleaved.
   */
  titleKey: string
  items: NavItem[]
}

// ---------------------------------------------------------------------------
// The rail, regrouped (user ruling, 11 Nov 2026)
// ---------------------------------------------------------------------------
//
// Every role's rail follows the Apple-design canvas: an unheaded home row, then
// Encuestas · Seguimiento · Analítica · Organización · Sistema for the administrators,
// and Seguimiento for a leader (TeamHome.dc.html). The grouping is presentation. The
// DESTINATIONS are exactly the ones each role had before the regroup — same hrefs, same
// gating — with one move: Notificaciones left the rail for the bell in the top bar, which
// links to the inbox ("Ver todas") and carries the unread count.
//
// Nav is role-aware: no entry points anywhere the backend would 403 for that role.
// Since #138 that rule is checked rather than merely stated:
// `navigation/roleCapabilities.ts` records, per role, every destination that role can
// load and the endpoint that authorizes it, and `roleCapabilities.test.ts` fails if
// anything this module returns for a role is not in that role's list -- with tracking on
// and off, and for a role neither module has heard of. Add a row here and the table has
// to gain the destination, with its `authorizedBy`, or the suite goes red.
//
// A super administrator's rows carry no company id: their company is their explicit
// selection in the header (`company-context/`), never their claim (#124, #191). A company
// administrator's company-scoped rows interpolate their own claim.

// The landing page (#132) and every role's first row. `/dashboard` is not one page:
// `DashboardPage` dispatches on the role claim and each of the four endpoints behind it
// refuses the other three roles, so there is no role for which this row leads to a 403 —
// including a role this module has never heard of, which falls through to the per-user
// employee view. Named "Inicio" in the rail, as every board names it; the page keeps its
// own title.
const HOME_ITEM: NavItem = {
  labelKey: 'navigation.home',
  href: '/dashboard',
  icon: RailHomeIcon,
}

// The same destination for a leader, named for what it shows them: their own team
// (TeamHome.dc.html, "Mi equipo"). `DashboardPage` dispatches a leader to the team view.
const MY_TEAM_ITEM: NavItem = {
  labelKey: 'navigation.myTeam',
  href: '/dashboard',
  icon: RailPeopleIcon,
}

// "My surveys" (#109). `GET /surveys/my` resolves the caller's OWN user row and filters by
// that row's company and department, reading no role claim at all, so
// employee/supervisor/leader get a real, non-empty page.
//
// Deliberately NOT offered to super_admin. A global super admin's `User.CompanyId` is
// NULL since #191, so the endpoint correctly returns an empty list for them -- and an
// always-empty page is not a destination.
const MY_SURVEYS_ITEM: NavItem = {
  labelKey: 'navigation.mySurveys',
  href: '/surveys/my',
  icon: RailMySurveysIcon,
}

// The admin listing. Safe for BOTH admin roles: `ListAsync` applies no company predicate
// at all for a super_admin who sends no `companyId`, so the page is a genuine
// cross-company view; for anyone else the server overwrites the scope with their own
// company whatever they send.
const SURVEYS_ITEM: NavItem = {
  labelKey: 'navigation.surveys',
  href: '/surveys',
  icon: RailSurveysIcon,
  // The admin rails carry no "Mis encuestas"; where a rail does, its own longer href wins.
  activeExcept: ['/surveys/my'],
}

// The template catalogue (#107's endpoints, #109's page). `GET /survey-templates` gates on
// `Roles.Admin` and then scopes by role, so one entry serves both admin branches. "Plantillas"
// in the rail: it sits under Encuestas, which already says whose templates they are.
const SURVEY_TEMPLATES_ITEM: NavItem = {
  labelKey: 'navigation.templates',
  href: '/surveys/templates',
  icon: RailTemplatesIcon,
}

// Climate over time. Admin-only: the endpoint authorizes through the same CanAdminister
// rule the results routes use, so a leader or supervisor following this link would get a
// 403. No companyId is interpolated -- a super_admin's selection comes from
// `company-context` and a company_admin's from their claim.
const CLIMATE_TRENDS_ITEM: NavItem = {
  labelKey: 'navigation.climateTrends',
  href: '/surveys/climate-trends',
  icon: RailTrendsIcon,
}

// The question bank (#114) and the question LIBRARY's authoring screen (#423), under the one
// "Preguntas" row the boards draw. They are two surfaces over two sets of tables (#58 settles
// that they must not be merged), so the row is a disclosure holding both rather than a link to
// one of them. Both gate on `Roles.Admin` and then scope by role: a super_admin reads the
// global rows plus every tenant's, a company_admin the global ones plus their own; everyone
// else would get a 403 and is not offered the row.
//
// The group's own `href` is the bank's, as a group's always is its first child's: it is what
// a collapsed rail's row links to, and what the closed group lights up for.
const QUESTIONS_ITEM: NavItem = {
  labelKey: 'navigation.questions',
  href: '/admin/question-bank',
  icon: RailQuestionsIcon,
  sub: [
    // The open book and the shelf: the two children sit next to each other, so sharing a
    // glyph would make the pair unreadable at exactly the place a reader tells them apart.
    { labelKey: 'navigation.questionBank', href: '/admin/question-bank', icon: RailQuestionBankIcon },
    { labelKey: 'navigation.questionLibrary', href: '/admin/question-library', icon: RailQuestionLibraryIcon },
  ],
}

// The generic action-plan listing. The one place that can hide it is `planItems` below.
const ACTION_PLANS_ITEM: NavItem = {
  labelKey: 'navigation.actionPlans',
  href: '/action-plans',
  icon: RailPlansIcon,
}

// The tracking module's consolidado (#125). Offered to the two admin roles ONLY, and that is
// the role-awareness rule rather than a preference: `DashboardEndpoints.ConsolidadoAsync`
// returns `Results.Forbid()` for anything outside `Roles.Admin`.
const TRACKING_CONSOLIDADO_ITEM: NavItem = {
  labelKey: 'navigation.trackingConsolidado',
  href: '/tracking',
  icon: RailConsolidatedIcon,
  // An administrator's own task list is not the consolidado; the admin rail has no row for it.
  activeExcept: ['/tracking/mis-tareas'],
}

// A node leader's own board. Deliberately NOT offered to either admin role even though the
// endpoint admits them: `TableroAsync` falls back to the caller's own `nodoId` claim, and an
// administrator's is `unassigned-<companyId>` or empty
// (`TrackingIdentifiers.NodoIdClaimForUser`), so the row would lead to an empty board every
// time. Admins reach a board by drilling into a nodo from the consolidado.
const TRACKING_TABLERO_ITEM: NavItem = {
  labelKey: 'navigation.trackingDashboard',
  href: '/tracking/tablero',
  // The canvas draws the tablero with the consolidado's table mark (TrackingTablero, 10 Sep):
  // the same sheet, one nodo of it.
  icon: RailConsolidatedIcon,
}

// The plans listing (#126). `PlanesAccionEndpoints.ListAsync` scopes the query itself — an
// admin gets the tenant, everyone else gets their own nodo plus the plans they are
// responsable or involucrado on — so this row is safe for every role that has one.
const TRACKING_PLANES_ITEM: NavItem = {
  labelKey: 'navigation.trackingPlans',
  href: '/tracking/planes',
  icon: RailPlansIcon,
  // Where tracking is on this is the rail's one "Planes de acción", so it is also the row a
  // reader is in on `/action-plans` — reached from the dashboard's "Crear plan" and from
  // search. The row still LEADS to the tracking listing (the 2026-08-21 decision below); it
  // only lights up for both.
  activeUnder: ['/action-plans'],
}

// The involucrado's view (#126). `MisTareasAsync` reads no role claim at all — it filters on
// the caller's own `sub` — so every authenticated role is a first-class caller.
const TRACKING_MIS_TAREAS_ITEM: NavItem = {
  labelKey: 'navigation.trackingMisTareas',
  href: '/tracking/mis-tareas',
  icon: RailTasksIcon,
}

const MICROCLIMATES_ITEM: NavItem = {
  labelKey: 'navigation.microclimates',
  href: '/microclimates',
  icon: RailMicroclimatesIcon,
}

// `GET /admin/benchmarks` returns every tenant's benchmarks plus the global ones for a
// super_admin, so the page is a real cross-company view; #124 deliberately does NOT push the
// selected company onto it. "Referencias" in the rail, as the boards name it.
const BENCHMARKS_ITEM: NavItem = {
  labelKey: 'navigation.references',
  href: '/analytics/benchmarks',
  icon: RailBenchmarksIcon,
}

// AI Insights takes a required company id: a company_admin's own claim, a super_admin's
// header selection (#124) — until they choose one the page says so rather than guessing.
const AI_INSIGHTS_ITEM: NavItem = {
  labelKey: 'navigation.aiInsights',
  href: '/analytics/ai-insights',
  icon: RailInsightsIcon,
}

// Departments (#142). `/admin/departments` allows a super_admin always and a company_admin
// on their own company, and 403s everyone else. No companyId is interpolated even though the
// endpoint *requires* one — the page takes it from `company-context` (#124).
const DEPARTMENTS_ITEM: NavItem = {
  labelKey: 'navigation.departments',
  href: '/departments',
  icon: RailDepartmentsIcon,
}

// The audit log (G21). Both admin roles: `GET /audit/logs` admits a super_admin (the page
// sends the company chosen in the header) and a company_admin held to their own tenant.
// "Actividad" in the rail, under Sistema.
const AUDIT_LOG_ITEM: NavItem = {
  labelKey: 'navigation.activity',
  href: '/admin/audit',
  icon: RailActivityIcon,
}

/**
 * Options that are properties of the DEPLOYMENT rather than of the caller.
 *
 * Kept as an options object with a default so the call sites and the assertions in
 * `navSections.test.ts` keep meaning what they meant. The risk that buys — a caller
 * forgetting to pass it and silently losing the tracking rows — is covered by
 * `navSections.test.ts`, which reads `AdminLayout.tsx` and `PageTopBar.tsx` and fails if
 * either stops asking.
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
 * The administrators' rows for managing plans, which is **either** the generic listing
 * **or** the tracking module and never both.
 *
 * Federico's decision of 2026-08-21: where a tenant uses tracking, `/action-plans` and
 * `/tracking` are two different models of the same idea, and the client should see one
 * place to manage plans rather than two that disagree. They are not being converged — the
 * models stay separate — so the nav is what resolves the ambiguity.
 *
 * Planes de acción first, then the Vista consolidada, as the Main and CompanyHome boards
 * order them. The listing is what makes a plan reachable at all — every plan code on it links
 * to `/tracking/planes/:id`, the only screen where avance is recorded.
 */
function adminPlanItems(options: NavOptions): NavItem[] {
  return options.trackingEnabled ? [TRACKING_PLANES_ITEM, TRACKING_CONSOLIDADO_ITEM] : [ACTION_PLANS_ITEM]
}

/** The two sections both administrators share, word for word: what they make, and how they follow it up. */
function adminSurveysAndFollowUp(options: NavOptions): NavSection[] {
  return [
    {
      titleKey: 'navigation.sectionSurveys',
      items: [SURVEYS_ITEM, SURVEY_TEMPLATES_ITEM, CLIMATE_TRENDS_ITEM, QUESTIONS_ITEM],
    },
    {
      titleKey: 'navigation.sectionFollowUp',
      items: [...adminPlanItems(options), MICROCLIMATES_ITEM],
    },
  ]
}

export function buildNavSections(
  role: string | undefined,
  companyId: string | undefined,
  options: NavOptions = {},
): NavSection[] {
  if (role === 'super_admin') {
    // The Main board (TIMS, 11 Nov). Two rows it draws are not this role's: "Personas"
    // (people are per company — a super_admin reaches `/admin/companies/:id/users` by opening
    // the tenant, and this rail carries no company id to interpolate) and "Informes" (same
    // reason: `/admin/companies/:id/reports`). Neither was in this role's rail before the
    // regroup, and the regroup adds no destination.
    return [
      { titleKey: '', items: [HOME_ITEM] },
      ...adminSurveysAndFollowUp(options),
      { titleKey: 'navigation.sectionAnalytics', items: [BENCHMARKS_ITEM, AI_INSIGHTS_ITEM] },
      {
        titleKey: 'navigation.sectionOrganization',
        items: [
          DEPARTMENTS_ITEM,
          { labelKey: 'navigation.companies', href: '/admin/companies', icon: RailCompaniesIcon },
        ],
      },
      {
        titleKey: 'navigation.sectionSystem',
        items: [
          { labelKey: 'navigation.systemConfiguration', href: '/admin/system-settings', icon: RailSettingsIcon },
          // System Health (#275): the page an operator opens when something is already wrong.
          { labelKey: 'navigation.status', href: '/admin/system', icon: RailStatusIcon },
          AUDIT_LOG_ITEM,
        ],
      },
    ]
  }

  if (role === 'company_admin' && companyId) {
    // The CompanyHome board. Rows it does not draw but this role already had keep a place in
    // the section they belong to: the company's own Analítica summary (first in Analítica,
    // as its overview), Campos demográficos (Organización, beside the people they describe)
    // and Actividad (Sistema, as the super administrator's rail files it).
    //
    // Reports and Analytics take their company from the URL, not from a claim, so they carry
    // no silent-scoping hazard. They are absent from the super_admin branch only because that
    // branch carries no company id to interpolate.
    const base = `/admin/companies/${companyId}`
    return [
      { titleKey: '', items: [HOME_ITEM] },
      ...adminSurveysAndFollowUp(options),
      {
        titleKey: 'navigation.sectionAnalytics',
        items: [
          { labelKey: 'navigation.overview', href: `${base}/analytics`, icon: RailAnalyticsIcon },
          BENCHMARKS_ITEM,
          AI_INSIGHTS_ITEM,
          { labelKey: 'navigation.reports', href: `${base}/reports`, icon: RailReportsIcon },
        ],
      },
      {
        titleKey: 'navigation.sectionOrganization',
        items: [
          { labelKey: 'navigation.people', href: `${base}/users`, icon: RailPeopleIcon },
          DEPARTMENTS_ITEM,
          { labelKey: 'navigation.demographicFields', href: `${base}/demographic-fields`, icon: Tags },
          { labelKey: 'navigation.companySettings', href: base, icon: RailCompaniesIcon },
        ],
      },
      { titleKey: 'navigation.sectionSystem', items: [AUDIT_LOG_ITEM] },
    ]
  }

  // Every other role -- and a company_admin whose token carries no companyId. The pages
  // these roles can load authorize per *user* rather than per role, which is what makes them
  // safe for a branch that includes employee, supervisor and leader.
  //
  // The tracking rows (#125, #126) are the first entries this branch has that are NOT offered
  // to every role in it. `leader` is the node leader -- the role `services/tracking-api`
  // spells `Roles.PlanCreator` and the role the client's §7 gives the full board to. An
  // `employee` or `supervisor` gets the task-only view (`/tracking/mis-tareas`) instead.
  //
  // A leader without a tracking service gets Planes de acción instead, for the reason the
  // admin branches swap the same rows (`adminPlanItems`): one place to see plans, not two
  // that disagree. It is the list of the plans they OWN -- `ListAsync` scopes a non-admin to
  // those -- and it is where the due-date nudge sends them.
  const followUp: NavItem[] = !options.trackingEnabled
    ? role === 'leader'
      ? [ACTION_PLANS_ITEM]
      : []
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

  // TeamHome.dc.html: the leader's home is their team. Its Analítica section ("Clima en el
  // tiempo") and its Microclimas row are not drawn here: `roleCapabilities.ts` gives a leader
  // neither destination, and the regroup adds none.
  const home: NavSection = {
    titleKey: '',
    items: [role === 'leader' ? MY_TEAM_ITEM : HOME_ITEM, MY_SURVEYS_ITEM],
  }
  return followUp.length > 0 ? [home, { titleKey: 'navigation.sectionFollowUp', items: followUp }] : [home]
}

/**
 * Every destination the sections hold, in order: a grouped item (one with `sub`) is a
 * *toggle* in the sidebar, not a destination, so it is replaced by its children.
 *
 * Lives here rather than in a component so it can be asserted against the role-aware
 * sections directly, without rendering.
 */
export function leafNavItems(sections: NavSection[]): NavItem[] {
  return sections
    .flatMap((section) => section.items)
    .flatMap((item) => (item.sub?.length ? item.sub : [item]))
}

/** Tab slots before the bottom bar's "Más" button. */
export const MOBILE_TAB_SLOTS = 4

/** One tab of the phone's bottom bar. */
export interface MobileTab {
  href: string
  /** The section's heading for a section tab; the row's own label for a home row. */
  labelKey: string
  icon: NavItem['icon']
}

/**
 * The phone's bottom tab bar: one tab per section of the rail, so the bar is the rail's
 * table of contents rather than its first four rows.
 *
 * The unheaded home section contributes every row it has (Inicio; a leader's Mi equipo and
 * Mis encuestas). Each titled section contributes ONE tab, named for the section
 * ("Encuestas", "Seguimiento", "Analítica") and leading to its first destination, drawn
 * with that destination's glyph. Taking the first four LEAVES instead, as the bar did
 * before the regroup, would spend three of four tabs on Encuestas (Todas, Plantillas,
 * Clima en el tiempo) and put Seguimiento, the work an administrator does between surveys,
 * behind "Más" — whose drawer draws the whole rail, so nothing is lost from the phone.
 */
export function mobileTabs(sections: NavSection[], slots = MOBILE_TAB_SLOTS): MobileTab[] {
  const tabs = sections.flatMap((section): MobileTab[] => {
    const leaves = leafNavItems([section])
    if (!section.titleKey) return leaves.map(({ href, labelKey, icon }) => ({ href, labelKey, icon }))
    const first = leaves[0]
    return first ? [{ href: first.href, labelKey: section.titleKey, icon: first.icon }] : []
  })
  return tabs.slice(0, slots)
}

/**
 * The destinations that are about the signed-in PERSON rather than about the tenant:
 * their own home, their own surveys, their own notifications, their own tracking tasks.
 *
 * Deliberately the hrefs and not a list of roles. See {@link isPerUserOnly}.
 */
const PER_USER_HREFS: ReadonlySet<string> = new Set([
  '/dashboard',
  '/surveys/my',
  '/notifications',
  '/tracking/mis-tareas',
])

/**
 * True when every destination a role can reach is one of its own pages — no admin
 * surface, nothing tenant-wide, nothing it shares with anybody.
 *
 * ## Why this is computed and not `role === 'employee'`
 *
 * `AdminLayout` uses it to decide whether to draw a navigation rail at all, and a rail
 * is worth its 236px only when it reaches somewhere the page does not. For a respondent
 * it reaches the page they are already on: ESPH's 2026-10-17 rehearsal returned exactly
 * that as a finding — *"al ser un sistema nuevo y la gente no saber usarlo van a
 * consultar mucho referente a como ingresar en la encuesta"* — against a shell whose
 * every row was already on screen.
 *
 * A hardcoded `['employee', 'supervisor']` would answer today's question and then go
 * quietly stale: the day a supervisor gains a team page, the rail must come back, and
 * nothing would make that happen or fail. Reading the sections means the rail returns
 * on its own the moment there is somewhere to go, and `navSections.test.ts` asserts
 * that rather than trusting it.
 *
 * Empty sections answer **false**: a role with no destinations at all is a role this
 * module does not know, and stripping the chrome off an unknown role is a guess. The
 * shell it already had is the safer wrong answer.
 */
export function isPerUserOnly(sections: NavSection[]): boolean {
  const leaves = leafNavItems(sections)
  return leaves.length > 0 && leaves.every((item) => PER_USER_HREFS.has(item.href))
}

/**
 * The roles that keep the rail although every row in it is their own page.
 *
 * ⚠️ This NARROWS the 2026-10-18 ESPH ruling, it does not reverse it. That ruling stripped the
 * chrome from every role {@link isPerUserOnly} answers true for, which on 18 Oct was `employee`
 * and `supervisor` alike. Ruled by the owner 2026-11-12: a SUPERVISOR gets the rail shell --
 * Inicio, Mis encuestas and Seguimiento › Mis tareas, the account menu, the bell, the palette
 * chip and the phone's tab bar -- because a supervisor runs a team, and `/dashboard` is their
 * team's page (`DepartmentAdminDashboardView`), not a respondent's welcome. An EMPLOYEE keeps
 * the railless shell exactly as ESPH asked for it.
 *
 * A role list, and deliberately beside the computed check rather than inside it: the rows are
 * unchanged, so the hrefs cannot tell the two roles apart (`roleCapabilities.ts` gives them the
 * same list), and what differs is a decision about chrome, not a destination.
 */
const RAIL_DESPITE_PER_USER_ROLES: ReadonlySet<string> = new Set(['supervisor'])

/**
 * Whether the shell is the railless respondent one -- the single answer `AdminLayout` draws
 * and `useRespondentShell` reports, so the screens outside the shell cannot disagree with it.
 */
export function drawsRespondentShell(role: string | undefined, sections: NavSection[]): boolean {
  if (role !== undefined && RAIL_DESPITE_PER_USER_ROLES.has(role)) return false
  return isPerUserOnly(sections)
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
 * Deriving it means nothing to maintain: the most specific matching row wins. Lives here
 * rather than in `RoleBasedNav` because the page header needs the same answer to name the
 * area it is in — see `sectionTitleKeyForPath`. Pure, so it is asserted directly in
 * `navSections.test.ts` without rendering a rail.
 */
export function activeHref(pathname: string, sections: NavSection[]): string | null {
  const rows = sections.flatMap((section) => section.items.flatMap((item) => [item, ...(item.sub ?? [])]))
  let best: { href: string; weight: number } | null = null
  for (const row of rows) {
    if (row.activeExcept?.some((except) => isUnder(pathname, except))) continue
    for (const path of [row.href, ...(row.activeUnder ?? [])]) {
      if (isUnder(pathname, path) && (best === null || path.length > best.weight)) best = { href: row.href, weight: path.length }
    }
  }
  return best?.href ?? null
}

/**
 * Which section of the app a path belongs to, as a catalogue key.
 *
 * This is what `PageTopBar` prints as the page eyebrow when a page passes none — the nav
 * group the open page sits in ("ENCUESTAS", "SEGUIMIENTO", …). Derived rather than passed
 * per page: a hand-written eyebrow on each caller is a chance to name the wrong area, and
 * another the day a nav entry moves group.
 *
 * `null` for a path no nav row covers (a detail route reached from a list, say), and for
 * the unheaded home section, where the honest answer is to print no eyebrow rather than to
 * guess one.
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
