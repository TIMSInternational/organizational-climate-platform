/**
 * What each role can actually **reach and load** — the enumeration #138 asks to be
 * "recorded", written as a module rather than as prose so it can be checked.
 *
 * ## Why this exists at all
 *
 * `navSections.ts` carries the rule "never add an entry that would 403 for the role
 * that can see it" and forty paragraphs of reasoning for individual rows, but it has
 * no *statement* of what a role can do — only of what the sidebar happens to offer
 * it. Those are different sets. A destination reached from a page (`/surveys/:id/respond`
 * from a task card) or from the user menu (`/profile`) is a capability with no nav row,
 * and a link drawn on a page the role can load may point at an endpoint the role cannot
 * call. #138 shipped with exactly that defect: `DepartmentAdminDashboardView` — a page
 * only `leader` and `supervisor` ever see — put a primary button on `/action-plans`,
 * whose `ListAsync` is `super_admin`/`company_admin` only, so 100% of that button's
 * viewers landed on "Request failed: 403".
 *
 * So the sidebar is checked against this table (`roleCapabilities.test.ts`), and so are
 * the links a non-admin page renders. The table is hand-written and the nav is not
 * derived from it, deliberately: a derived table would agree with the nav by
 * construction and could not catch the nav being wrong.
 *
 * ## `authorizedBy` is the evidence, and it is checked
 *
 * Every entry names the endpoint behind the destination and the rule that makes it safe
 * for that role. Where the rule is "the handler resolves the caller's own row and reads
 * no role claim", the destination is safe for *every* role including one this repo has
 * never heard of. Where the rule is a role list, the destination belongs to those roles
 * and to nobody else. Reviewed against `src/ClimateProject.Api/Endpoints/` and
 * `services/tracking-api/` at 8f0eacc.
 *
 * That used to be all it was — prose a reviewer was trusted to check, asserted only to be
 * longer than twenty characters, which meant the whole table could be replaced with lorem
 * ipsum, or a non-admin role handed `/microclimates`, with the suite still green. Three
 * things now hold it to the backend, and they are in `roleCapabilities.test.ts`:
 *
 * 1. every entry must name at least one `VERB /path`, and that path must be a route the
 *    C# actually registers — the check that found this table claiming a
 *    `GET /admin/analytics` which has never existed;
 * 2. no destination given to a non-admin role may carry evidence that names an admin gate
 *    (`Roles.Admin`, `super_admin`, `CanAdminister`, `CanAccessCompany`…), so a row cannot
 *    be pasted from the admin section and keep its own refutation in its evidence;
 * 3. the endpoints a non-admin role may call are listed a second time, in the test, with
 *    the reason each is caller-scoped. Widening the non-admin surface takes two edits in
 *    two files, and the second one is next to that reasoning.
 *
 * What none of that is: a proof. Only the backend's own integration tests can say what a
 * role really gets, and they are the reason each `authorizedBy` names a handler rather
 * than a feeling. These checks make a wrong entry hard to write by accident, not
 * impossible to write on purpose.
 *
 * ## What a leader and a supervisor can see of their team, in full
 *
 * One endpoint. `GET /dashboard/department-admin` admits `Roles.Leader` and
 * `Roles.Supervisor`, reads the department off their own user row (never off the token,
 * because people move teams), and refuses a `departmentId` that is not their own. There
 * is no second team-scoped read: `GET /admin/users` (the roster),
 * `GET /surveys/{id}/results`, `GET /surveys/{id}` and `GET /action-plans` are all
 * `Roles.Admin`-gated, so a leader cannot list their own team's members, read their own
 * team's results, or open the action plans their own dashboard counts. Those are
 * reported as backend gaps rather than papered over with a client-side filter — there is
 * nothing to filter, the server returns 403 before any row is selected.
 */

/**
 * The role vocabulary, in the order `ClimateProject.Application.Auth.Roles.All`
 * declares it.
 *
 * `roleCapabilities.test.ts` reads that C# file and fails if the two disagree, which is
 * the check the issue asks for by name ("Confirm the role set against `Roles` in the
 * backend rather than assuming"). There is **no `department_admin`** — the legacy app's
 * fourth dashboard maps onto `leader` and `supervisor`, which is why
 * `DepartmentAdminDashboardView` is named for a role that does not exist here.
 */
export const PLATFORM_ROLES = [
  'super_admin',
  'company_admin',
  'leader',
  'supervisor',
  'employee',
] as const

export type PlatformRole = (typeof PLATFORM_ROLES)[number]

/** The three roles this issue is about: everyone who is not an administrator. */
export const NON_ADMIN_ROLES: readonly PlatformRole[] = ['leader', 'supervisor', 'employee']

export interface RoleCapability {
  /**
   * The **route pattern**, exactly as `app/router.tsx` registers it — `:id` and not a
   * concrete value.
   *
   * A pattern rather than an href because a company_admin's nav interpolates their own
   * company id (`/admin/companies/{id}/users`), so a literal here would either be a
   * fixture id that matches nothing or a second place that has to know how the nav
   * builds its URLs. The test matches nav hrefs against these patterns segment by
   * segment.
   */
  route: string
  /** Catalogue path for how this destination is named to the user. */
  labelKey: string
  /**
   * The endpoint behind it, and why this role may call it.
   *
   * Prose, and load-bearing prose: it is what a reviewer checks a new entry against, and
   * what says whether a row belongs to a role or merely has not 403'd yet.
   */
  authorizedBy: string
  /**
   * True when **some** role's sidebar offers this destination in **some** deployment;
   * false when it is only ever reached from a page or from the user menu.
   *
   * Deliberately a property of the destination rather than of the role holding it, because
   * the same row object is shared by several roles and they do not agree: a company_admin's
   * sidebar carries `/admin/companies/{id}/users`, a super_admin reaches the same page by
   * opening a tenant first, and `/action-plans` is a sidebar row only where the deployment
   * has no `services/tracking-api`. `roleCapabilities.test.ts` asserts exactly that
   * reading — every `true` is a row `buildNavSections` really emits for somebody, and every
   * `false` is a route no role's sidebar offers under either tracking setting. Until #138
   * was reviewed the field was read by nothing at all, so all thirty-nine values could be
   * inverted with the suite still green.
   */
  inNav: boolean
  /**
   * True when the destination only exists where the deployment has configured a
   * `services/tracking-api` (`features/tracking/api/config.ts`). A capability, not
   * company scoping — the tracking service resolves the tenant from the caller's own claim.
   */
  requiresTracking?: boolean
}

// ---------------------------------------------------------------------------
// The sets that more than one role shares
// ---------------------------------------------------------------------------

/**
 * Every authenticated caller, whatever their role — including a role this repo has never
 * heard of.
 *
 * Each of these resolves the caller's **own** row and takes no user id, which is a
 * stronger guarantee than "no role check": there is no argument any of them accepts that
 * could be pointed at somebody else.
 */
const SELF_SERVICE: readonly RoleCapability[] = [
  {
    route: '/dashboard',
    labelKey: 'navigation.dashboard',
    authorizedBy:
      'DashboardPage dispatches on the role claim; each of the four endpoints refuses the other roles, ' +
      'and an unrecognised role falls through to GET /dashboard/employee, which reads no role claim at all.',
    inNav: true,
  },
  {
    route: '/notifications',
    labelKey: 'notifications.title',
    authorizedBy: 'GET /notifications/mine — scoped to the caller’s own user id, never to a company or a role.',
    inNav: true,
  },
  {
    route: '/profile',
    labelKey: 'profile.title',
    authorizedBy:
      'GET/PUT /profile/* (#136) — every endpoint behind the page resolves the caller from their own token and takes no user id.',
    inNav: false,
  },
  {
    route: '/settings/notifications',
    labelKey: 'notifications.preferences.title',
    authorizedBy: 'GET/PUT /notifications/preferences (#103) — the caller’s own preferences; takes no user id.',
    inNav: false,
  },
  {
    route: '/settings/privacy',
    labelKey: 'privacy.navLabel',
    authorizedBy:
      'GET /gdpr/access with no userId (#137) — the handler treats a missing userId as the self-service case and needs no role.',
    inNav: false,
  },
  {
    route: '/surveys/:id/respond',
    labelKey: 'dashboard.respondNow',
    authorizedBy:
      'GET /surveys/{id}/respond — resolves the caller’s own user row and checks the survey’s own department targets; ' +
      'no role claim is read, so every role that can be sent a survey can answer one.',
    inNav: false,
  },
  {
    route: '/surveys/my',
    labelKey: 'navigation.mySurveys',
    authorizedBy:
      'GET /surveys/my — resolves the caller’s own user row and filters by that row’s company and department, ' +
      'reading no role claim.',
    inNav: true,
  },
]

/**
 * The one tracking row every role gets.
 *
 * `MisTareasAsync` filters on the caller's own `sub` claim and reads no role, so an
 * involucrado of any role is a first-class caller — an administrator named on a plan is
 * as much an involucrado as anybody. It is the *only* tracking screen a plain employee or
 * a supervisor is **offered**; the full board is the node leader's, which is §7 of the
 * client's spec rather than a boundary (see `trackingAccess.ts`).
 *
 * Offered and reachable are different questions, and this table answers the second. The
 * admin sidebar does not carry this row when the token has a company id — it carries the
 * consolidated view instead — but the page loads for them, so it is their capability too.
 * See {@link ROLE_CAPABILITIES} on why that distinction had to be made explicit.
 */
const TRACKING_TASKS: RoleCapability = {
  route: '/tracking/mis-tareas',
  labelKey: 'navigation.trackingMisTareas',
  authorizedBy:
    'GET /api/mis-tareas — filters on the caller’s own sub claim and reads no role claim.',
  inNav: true,
  requiresTracking: true,
}

/** The plans surface, for the roles `ClimateTracking.Application.Auth.Roles.PlanCreator` admits. */
const TRACKING_PLANS: readonly RoleCapability[] = [
  {
    route: '/tracking/planes',
    labelKey: 'navigation.trackingPlans',
    authorizedBy:
      'GET /api/planes-accion — PlanesAccionEndpoints.ListAsync scopes the query itself: an admin gets the tenant, ' +
      'everyone else gets their own nodo plus the plans they are responsable or involucrado on.',
    inNav: true,
    requiresTracking: true,
  },
  {
    route: '/tracking/planes/:id',
    labelKey: 'tracking.detail.title',
    authorizedBy:
      'GET /api/planes-accion/{id} — PlanAccessHandler: admins always, a leader on their own nodo, ' +
      'and the responsable or an involucrado read-only.',
    inNav: false,
    requiresTracking: true,
  },
]

/**
 * ## Where the non-admin work surface went, and where the team view is
 *
 * There is no `NON_ADMIN_WORK` list. `/surveys/my` is in {@link SELF_SERVICE} with the
 * rest of the caller-scoped pages, because that is what it is: `ListMineAsync` resolves
 * the caller's own user row and reads no role claim, so it loads for a company_admin
 * exactly as it loads for an employee. It was filed as a non-admin capability, and that
 * was wrong in a way a sweep could see: `buildNavSections` puts a company_admin whose
 * token carries **no** companyId (`AdminLayout` reads the claim, and #191 leaves it
 * absent for a global admin) into the same fallback branch as the non-admin roles, so
 * that role's own sidebar offered a row this table said it could not reach. The table
 * records what a role can **load**; which roles are *offered* a row is
 * `navSections.ts`'s judgement and belongs there.
 *
 * The team view is not missing either, and its absence is the finding rather than an
 * omission. `/dashboard` (in {@link SELF_SERVICE}) dispatches to
 * `DepartmentAdminDashboardView` for `leader` and `supervisor`, and *that* is the team
 * view — the single team-scoped read the backend offers. A page mounted at `/team` would
 * be a second caller of the same endpoint drawing the same figures, so this table records
 * the capability where it lives instead of inventing a route for it.
 */

// ---------------------------------------------------------------------------
// The administration surface, for the two roles that have one
// ---------------------------------------------------------------------------

const ADMIN_SHARED: readonly RoleCapability[] = [
  {
    route: '/surveys',
    labelKey: 'navigation.surveys',
    authorizedBy:
      'GET /surveys — ListAsync applies no company predicate for a super_admin who sends none, and overwrites ' +
      'the scope with their own company for a company_admin.',
    inNav: true,
  },
  {
    route: '/surveys/new',
    labelKey: 'surveys.createSurvey',
    authorizedBy: 'POST /surveys — SurveyEndpoints.CanAdminister: super_admin, or a company_admin on their own tenant.',
    inNav: false,
  },
  {
    route: '/surveys/:id',
    labelKey: 'navigation.surveys',
    authorizedBy: 'GET /surveys/{id} — SurveyEndpoints.CanAdminister. A leader or supervisor following this link gets 403.',
    inNav: false,
  },
  {
    route: '/surveys/:id/questions',
    labelKey: 'surveys.questionEditor.title',
    authorizedBy: 'PUT /surveys/{id} (#273) — SurveyEndpoints.CanAdminister, and only while the survey is a draft.',
    inNav: false,
  },
  {
    route: '/surveys/:id/results',
    labelKey: 'surveys.results',
    authorizedBy: 'GET /surveys/{id}/results — SurveyEndpoints.CanAdminister via SurveyResultsEndpoints.LoadAsync.',
    inNav: false,
  },
  {
    route: '/surveys/:surveyId/distribution',
    labelKey: 'surveys.distribution.title',
    authorizedBy: 'GET/PUT /surveys/{id}/distribution — SurveyEndpoints.CanAdminister.',
    inNav: false,
  },
  {
    route: '/surveys/templates',
    labelKey: 'navigation.surveyTemplates',
    authorizedBy: 'GET /survey-templates — gates on Roles.Admin, then scopes by role.',
    inNav: true,
  },
  {
    route: '/surveys/templates/:id',
    labelKey: 'navigation.surveyTemplates',
    authorizedBy: 'GET /survey-templates/{id} — gates on Roles.Admin.',
    inNav: false,
  },
  {
    route: '/microclimates',
    labelKey: 'navigation.microclimates',
    authorizedBy: 'GET /microclimates — Roles.Admin plus a company match.',
    inNav: true,
  },
  {
    route: '/microclimates/new',
    labelKey: 'microclimates.createMicroclimate',
    authorizedBy: 'POST /microclimates — Roles.Admin plus a company match.',
    inNav: false,
  },
  {
    route: '/microclimates/analytics',
    labelKey: 'navigation.analytics',
    authorizedBy: 'GET /microclimates/{id}/insights — Roles.Admin plus a company match.',
    inNav: false,
  },
  {
    route: '/microclimates/:id',
    labelKey: 'navigation.microclimates',
    authorizedBy: 'GET /microclimates/{id} — Roles.Admin plus a company match.',
    inNav: false,
  },
  {
    route: '/microclimates/:id/live',
    labelKey: 'microclimates.liveHeading',
    authorizedBy: 'GET /microclimates/{id}/live-results — Roles.Admin plus a company match.',
    inNav: false,
  },
  {
    route: '/microclimates/:id/results',
    labelKey: 'microclimates.results',
    authorizedBy: 'GET /microclimates/{id}/export — Roles.Admin plus a company match.',
    inNav: false,
  },
  {
    route: '/departments',
    labelKey: 'navigation.departments',
    authorizedBy:
      'GET /admin/departments — a super_admin always, a company_admin on their own company, 403 for everyone else.',
    inNav: true,
  },
  {
    route: '/analytics/benchmarks',
    labelKey: 'navigation.benchmarks',
    authorizedBy: 'GET /admin/benchmarks — BenchmarkEndpoints gates on Roles.Admin.',
    inNav: true,
  },
  {
    route: '/analytics/ai-insights',
    labelKey: 'navigation.aiInsights',
    authorizedBy: 'GET /admin/ai-insights — Roles.Admin, and requires a company id.',
    inNav: true,
  },
  {
    route: '/action-plans',
    labelKey: 'navigation.actionPlans',
    authorizedBy:
      'GET /action-plans — ActionPlanEndpoints.CanAccessCompany is super_admin, or company_admin on their own ' +
      'company. There is no department-scoped read, so this belongs to the two admin roles and to nobody else.',
    inNav: true,
  },
  {
    route: '/action-plans/:id',
    labelKey: 'actionPlans.title',
    authorizedBy: 'GET /action-plans/{id} — ActionPlanEndpoints.CanAccessCompany.',
    inNav: false,
  },
  {
    route: '/tracking',
    labelKey: 'navigation.trackingConsolidado',
    authorizedBy:
      'GET /api/consolidado — DashboardEndpoints.ConsolidadoAsync returns Forbid() for anything outside ' +
      'ClimateTracking Roles.Admin.',
    inNav: true,
    requiresTracking: true,
  },
]

const SUPER_ADMIN_ONLY: readonly RoleCapability[] = [
  {
    route: '/admin/companies',
    labelKey: 'navigation.companies',
    authorizedBy: 'GET /admin/companies — CompanyEndpoints.ListAsync is super_admin only.',
    inNav: true,
  },
  {
    route: '/admin/system-settings',
    labelKey: 'navigation.systemSettings',
    authorizedBy: 'GET /admin/system-settings — super_admin only.',
    inNav: true,
  },
  {
    route: '/admin/system',
    labelKey: 'navigation.systemHealth',
    authorizedBy: 'GET /admin/system/status (#275) — super_admin only.',
    inNav: true,
  },
]

/**
 * The company-scoped pages, which both admin roles reach — a super_admin by opening a
 * tenant from the companies list, a company_admin straight from their own nav.
 */
const COMPANY_SCOPED: readonly RoleCapability[] = [
  {
    route: '/admin/companies/:id',
    labelKey: 'navigation.companySettings',
    authorizedBy: 'GET /admin/companies/{id} — Roles.Admin, and a company_admin only on their own company.',
    inNav: true,
  },
  {
    route: '/admin/companies/:companyId/users',
    labelKey: 'navigation.users',
    authorizedBy:
      'GET /admin/users?companyId= — UserEndpoints.CanAccessCompany, i.e. super_admin or a company_admin on ' +
      'their own tenant. This is why a leader has no team roster: there is no non-admin path to a user list.',
    inNav: true,
  },
  {
    route: '/admin/companies/:companyId/demographic-fields',
    labelKey: 'navigation.demographicFields',
    authorizedBy: 'GET /admin/demographic-fields — Roles.Admin plus a company match.',
    inNav: true,
  },
  {
    route: '/admin/companies/:companyId/reports',
    labelKey: 'navigation.reports',
    authorizedBy: 'GET /admin/reports — Roles.Admin plus a company match.',
    inNav: true,
  },
  {
    route: '/admin/companies/:companyId/analytics',
    labelKey: 'navigation.analytics',
    // There is no `GET /admin/analytics`, which is what this row used to claim and what
    // the endpoint sweep below caught. `AnalyticsDashboardPage` is assembled from two
    // existing admin reads.
    authorizedBy:
      'GET /admin/benchmarks and GET /admin/ai-insights — BenchmarkEndpoints gates on Roles.Admin, ' +
      'AIInsightEndpoints on Roles.Admin plus a company match.',
    inNav: true,
  },
]

// ---------------------------------------------------------------------------
// The table itself
// ---------------------------------------------------------------------------

/**
 * Every destination each role can reach and load, nav rows and non-nav destinations alike.
 *
 * **Reach and load, not "is offered".** A row here says the page renders and its requests
 * come back — it does not say the sidebar points at it, which is `inNav`'s much weaker
 * claim, and it does not say the page is worth offering. `/surveys/my` answers a
 * super_admin with an empty list (#191 leaves a global admin no company), and an
 * always-empty page is a poor nav row; it is still a page they can open, so it is in their
 * list and out of their nav. Conflating the two is how the first draft of this table came
 * to refuse a company_admin a row their own sidebar offers.
 *
 * The three non-admin lists are deliberately short, and that shortness is the finding this
 * issue was opened to establish. **A supervisor's list and an employee's differ by nothing
 * at all**, because the one thing that distinguishes them — running a team — has exactly
 * one endpoint behind it and that endpoint is reached at `/dashboard`, which every role
 * already has. `leader` differs from `supervisor` only inside the tracking module, where
 * the client's §7 gives the node leader the board and the plans.
 */
export const ROLE_CAPABILITIES: Record<PlatformRole, readonly RoleCapability[]> = {
  super_admin: [
    ...SELF_SERVICE,
    ...SUPER_ADMIN_ONLY,
    ...COMPANY_SCOPED,
    ...ADMIN_SHARED,
    ...TRACKING_PLANS,
    TRACKING_TASKS,
  ],
  company_admin: [...SELF_SERVICE, ...COMPANY_SCOPED, ...ADMIN_SHARED, ...TRACKING_PLANS, TRACKING_TASKS],
  // The node leader. `Roles.PlanCreator` in the tracking service, and the only non-admin
  // role with a jefatura of its own to show.
  leader: [
    ...SELF_SERVICE,
    {
      route: '/tracking/tablero',
      labelKey: 'navigation.trackingDashboard',
      authorizedBy:
        'GET /api/tablero-seguimiento with no nodoId — TableroAsync falls back to the caller’s own nodoId claim. ' +
        'The role list is the client’s §7 product rule, not a boundary: see trackingAccess.ts.',
      inNav: true,
      requiresTracking: true,
    },
    ...TRACKING_PLANS,
    TRACKING_TASKS,
  ],
  supervisor: [...SELF_SERVICE, TRACKING_TASKS],
  employee: [...SELF_SERVICE, TRACKING_TASKS],
}

/**
 * The route patterns a role may be sent to, as a set — what a link check asks.
 *
 * `trackingEnabled` defaults to `false` so a caller that forgets it gets the **smaller**
 * set and a link check fails closed. (Optional-with-a-default goes last, per the house
 * rule; a prior bug put `baseUrl` before required args and broke five exports.)
 */
export function reachableRoutes(
  role: string | undefined,
  trackingEnabled = false,
): ReadonlySet<string> {
  // `Object.hasOwn`, not `?? ROLE_CAPABILITIES.employee`: `??` only catches null and
  // undefined, so `ROLE_CAPABILITIES['constructor']` — a truthy inherited function —
  // reached `.filter` and threw. A role arrives here as an untrusted string off a JWT
  // claim, and `toString`, `valueOf` and `__proto__` are all strings a claim can carry.
  const capabilities = Object.hasOwn(ROLE_CAPABILITIES, role as PlatformRole)
    ? ROLE_CAPABILITIES[role as PlatformRole]
    : ROLE_CAPABILITIES.employee
  return new Set(
    capabilities
      .filter((capability) => trackingEnabled || capability.requiresTracking !== true)
      .map((capability) => capability.route),
  )
}

/**
 * Does `pathname` match `pattern`, treating a `:name` segment as one wildcard segment?
 *
 * The same rule react-router applies, minus splats and optional segments, neither of
 * which this route table uses. Exported because both the nav check and the rendered-link
 * check need it, and two copies would be two chances to disagree about
 * `/surveys/my` versus `/surveys/:id`.
 *
 * A literal segment always beats a parameter, so `/surveys/my` is tested against every
 * pattern and only matches the literal one — `matchesRoute('/surveys/my', '/surveys/:id')`
 * is `true` on its own, which is why callers must ask for the *most specific* match rather
 * than the first.
 */
export function matchesRoute(pathname: string, pattern: string): boolean {
  const path = pathname.split('/')
  const parts = pattern.split('/')
  if (path.length !== parts.length) return false
  return parts.every((part, index) => part.startsWith(':') || part === path[index])
}

/**
 * Every route in the table with no `:param` in it, from **all** roles.
 *
 * The set a parameterised pattern is forbidden to swallow. See {@link canReach}.
 */
const LITERAL_ROUTES: ReadonlySet<string> = new Set(
  Object.values(ROLE_CAPABILITIES)
    .flat()
    .filter((capability) => !capability.route.includes(':'))
    .map((capability) => capability.route),
)

/**
 * True when `href` is a destination this role can load.
 *
 * ## Why a literal beats a parameter, across roles rather than within one
 *
 * `/surveys/my` and `/surveys/:id` are different pages belonging to different roles: an
 * employee has the first and would be 403'd by the second. A plain "does any pattern
 * match" test answers `canReach('company_admin', '/surveys/my')` with `true`, because
 * `/surveys/:id` matches it segment for segment — and would then certify a link to an
 * employee's page as a company_admin capability.
 *
 * React-router does not have that problem: it ranks a static segment above a dynamic one,
 * so `/surveys/my` is *never* served by `/surveys/:id` for anybody. This mirrors that
 * ranking. A pathname that is itself a declared literal route is answerable only by the
 * literal, whoever is asking — which is why {@link LITERAL_ROUTES} is drawn from every
 * role's list and not from the caller's.
 */
export function canReach(role: string | undefined, href: string, trackingEnabled = false): boolean {
  return canReachIn(reachableRoutes(role, trackingEnabled), href)
}

/**
 * {@link canReach}'s rule, over an explicit set of patterns rather than a role's.
 *
 * Exported so the ranking above can be tested on a set the test writes itself. It could
 * not otherwise be tested at all: whether any *role* currently holds a parameter pattern
 * that would swallow a literal it does not hold is an accident of the table's present
 * contents, and today no role does — so a test phrased over roles would pass with the
 * `LITERAL_ROUTES` clause deleted. The guard is for the table's future, so it is asserted
 * against a set that states the hazard directly.
 */
export function canReachIn(routes: ReadonlySet<string>, href: string): boolean {
  if (routes.has(href)) return true
  if (LITERAL_ROUTES.has(href)) return false
  return [...routes].some((pattern) => pattern.includes(':') && matchesRoute(href, pattern))
}
