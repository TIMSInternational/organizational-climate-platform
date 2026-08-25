import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  NON_ADMIN_ROLES,
  PLATFORM_ROLES,
  ROLE_CAPABILITIES,
  canReach,
  canReachIn,
  matchesRoute,
  reachableRoutes,
  type PlatformRole,
} from './roleCapabilities'
import { buildNavSections, leafNavItems } from './navSections'
import { CATALOGUES, LOCALES } from '../i18n/locale'
import { createTranslator } from '../i18n/translate'

// Vitest runs with `web/` as cwd — the same assumption `erasureScope.test.ts`,
// `repoHygiene.test.ts` and `noHardcodedStrings.test.ts` already make.
const WEB = process.cwd()
const REPO = resolve(WEB, '..')
const ROLES_CS = join(REPO, 'src', 'ClimateProject.Application', 'Auth', 'Roles.cs')
const ROUTER = join(WEB, 'src', 'app', 'router.tsx')
const ENDPOINT_DIRS = [
  join(REPO, 'src', 'ClimateProject.Api', 'Endpoints'),
  join(REPO, 'services', 'tracking-api', 'src', 'ClimateTracking.Api', 'Endpoints'),
]

const COMPANY = 'company-1'

/**
 * The company ids a token can actually carry, and the reason the sweeps below run over
 * all three.
 *
 * `AdminLayout` reads the claim (`typeof claims?.companyId === 'string' ? … : undefined`)
 * and hands the result straight to `buildNavSections`, so `undefined` is what a global
 * super admin's token produces (#191) and `''` is what an empty claim produces. Both are
 * falsy, so both miss the `role === 'company_admin' && companyId` branch and land a
 * company_admin in the same fallback section as the non-admin roles — a branch
 * `navSections.ts` documents by name and which every sweep here used to skip, because
 * they all passed a populated id. It offered that role two rows this table then refused.
 */
const COMPANY_IDS: readonly (string | undefined)[] = [COMPANY, undefined, '']

/**
 * Every href the sidebar offers this role, flattened the way the mobile bar flattens it.
 *
 * `companyId` has no default on purpose. It was written `= COMPANY`, and a default is not
 * a value a caller can pass: `navHrefs(role, true, undefined)` **takes the default**, so
 * the sweep that was added to cover the absent-claim branch silently swept the populated
 * one twice and the assertion below caught it. The token shape is the variable under test.
 */
function navHrefs(role: string, trackingEnabled: boolean, companyId: string | undefined): string[] {
  return leafNavItems(buildNavSections(role, companyId, { trackingEnabled })).map((item) => item.href)
}

/** Every row every role's sidebar can emit, over both tracking settings and all three tokens. */
function everyNavHref(): ReadonlySet<string> {
  const hrefs = new Set<string>()
  for (const role of PLATFORM_ROLES) {
    for (const trackingEnabled of [true, false]) {
      for (const companyId of COMPANY_IDS) {
        for (const href of navHrefs(role, trackingEnabled, companyId)) hrefs.add(href)
      }
    }
  }
  return hrefs
}

/** Every route in the table with no `:param`, which a parameterised pattern may not answer for. */
const LITERAL_ROUTES = new Set(
  Object.values(ROLE_CAPABILITIES)
    .flat()
    .filter((capability) => !capability.route.includes(':'))
    .map((capability) => capability.route),
)

/** Does any sidebar row resolve to this route pattern, ranked the way react-router ranks? */
function isANavRow(route: string, hrefs: ReadonlySet<string>): boolean {
  return [...hrefs].some(
    (href) =>
      href === route ||
      (route.includes(':') && !LITERAL_ROUTES.has(href) && matchesRoute(href, route)),
  )
}

/**
 * Every `VERB /path` the evidence names, normalised the way the route table registers it.
 *
 * `{id:guid}` and `{id}` are the same route, a query string is not part of one, and
 * `/profile/*` is prose for "the endpoints under this prefix".
 */
const ENDPOINT_IN_PROSE =
  /\b(?:GET|POST|PUT|PATCH|DELETE)(?:\/(?:GET|POST|PUT|PATCH|DELETE))*\s+(\/[A-Za-z0-9/{}:_.\-*]+)/g

function normalisePath(path: string): string {
  const withoutQuery = path.split('?')[0].replace(/\{[^}]*\}/g, '{}')
  return withoutQuery.length > 1 && withoutQuery.endsWith('/')
    ? withoutQuery.slice(0, -1)
    : withoutQuery
}

function endpointsNamedBy(authorizedBy: string): string[] {
  return [...authorizedBy.matchAll(ENDPOINT_IN_PROSE)].map((match) => normalisePath(match[1]))
}

/**
 * Every route template the two APIs register, from their own source.
 *
 * A group prefix and a suffix are combined per file rather than per variable, which makes
 * the set a superset of what is really registered — the check is "this path exists", and a
 * looser set can only ever let a real path through, never invent authorization for one.
 */
function registeredEndpoints(): ReadonlySet<string> {
  const paths = new Set<string>()
  for (const dir of ENDPOINT_DIRS) {
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.cs'))) {
      const source = readFileSync(join(dir, file), 'utf8')
      const prefixes = ['', ...[...source.matchAll(/MapGroup\("([^"]*)"\)/g)].map((m) => m[1])]
      const suffixes = [...source.matchAll(/\.Map(?:Get|Post|Put|Patch|Delete)\("([^"]*)"/g)].map(
        (m) => m[1],
      )
      for (const prefix of prefixes) {
        for (const suffix of suffixes) paths.add(normalisePath(prefix + suffix))
      }
    }
  }
  return paths
}

describe('the role set', () => {
  /**
   * The check the issue asks for by name: "Confirm the role set against `Roles` in the
   * backend rather than assuming".
   *
   * Reads the C# source rather than calling an endpoint, for the reason
   * `erasureScope.test.ts` records: the list is a compile-time constant in a .NET
   * assembly and no route serves it. Parsing is guarded against itself below — a
   * `Roles.cs` written in a shape this regex cannot see would otherwise shrink the set
   * being compared and pass.
   */
  it('is exactly the vocabulary Roles.cs declares', () => {
    const source = readFileSync(ROLES_CS, 'utf8')
    const declared = [...source.matchAll(/public const string \w+ = "([a-z_]+)";/g)].map((m) => m[1])

    // Guard the guard: `Roles.All` names five constants, so five is what the sweep above
    // must have found. A sixth role added in another shape fails here rather than
    // silently escaping the comparison.
    const allMembers = /public static readonly string\[\] All = \[([^\]]+)\];/.exec(source)
    expect(allMembers, 'Roles.All is not declared in the shape this test can read').not.toBeNull()
    expect(declared).toHaveLength((allMembers as RegExpExecArray)[1].split(',').length)

    expect([...PLATFORM_ROLES].sort()).toEqual([...declared].sort())
  })

  it('has a capability list for every role, and none for a role the backend does not have', () => {
    expect(Object.keys(ROLE_CAPABILITIES).sort()).toEqual([...PLATFORM_ROLES].sort())
  })

  it('does not invent a department_admin, which this repo has never had', () => {
    expect(PLATFORM_ROLES).not.toContain('department_admin' as PlatformRole)
  })
})

describe('every capability points somewhere real', () => {
  /**
   * A route pattern that no longer exists is a capability claim about a 404. Reads
   * `router.tsx` for the same reason `router.test.ts` does: what is being asserted is the
   * wiring, and a rendered assertion would need the whole shell.
   */
  it('is a path app/router.tsx registers', () => {
    const registered = new Set(
      [...readFileSync(ROUTER, 'utf8').matchAll(/path: '([^']+)'/g)].map((m) => m[1]),
    )
    // Guard the guard: the router declares dozens of paths, so a regex that stopped
    // matching would make every assertion below vacuous.
    expect(registered.size).toBeGreaterThan(30)

    for (const role of PLATFORM_ROLES) {
      for (const capability of ROLE_CAPABILITIES[role]) {
        expect(registered, `${role} → ${capability.route}`).toContain(capability.route)
      }
    }
  })

  /**
   * The evidence has to *be* evidence.
   *
   * This assertion was `authorizedBy.length > 20`, which every one of the thirty-nine
   * entries passes when replaced with the same sentence of lorem ipsum — and did, in
   * review, with the suite green. A length is not a claim about a backend. Naming a route
   * the C# registers is.
   */
  it('names a route the API really registers', () => {
    const registered = registeredEndpoints()
    // Guard the guard: both trees together register hundreds of routes, so a parser that
    // stopped matching would make every path below trivially unfindable, not trivially
    // findable — but a set this size also proves the sweep read both APIs.
    expect(registered.size).toBeGreaterThan(150)
    expect(registered.has('/api/mis-tareas'), 'the tracking API was not read').toBe(true)

    for (const role of PLATFORM_ROLES) {
      for (const capability of ROLE_CAPABILITIES[role]) {
        const named = endpointsNamedBy(capability.authorizedBy)
        expect(named.length, `${role} → ${capability.route} names no VERB /path`).toBeGreaterThan(0)
        for (const path of named) {
          const found = path.endsWith('/*')
            ? [...registered].some((route) => route.startsWith(path.slice(0, -1)))
            : registered.has(path)
          expect(found, `${role} → ${capability.route} names ${path}, which no endpoint registers`).toBe(
            true,
          )
        }
      }
    }
  })

  /**
   * A row cannot be handed to a non-admin role while its own evidence says otherwise.
   *
   * The realistic way this table goes wrong is a copied row: the admin section already
   * contains a line for nearly every page in the product, and pasting one into a
   * non-admin list brings its evidence with it. Review demonstrated it — `/microclimates`,
   * `/analytics/benchmarks` and `/admin/system-settings` were given to all three
   * non-admin roles, each with evidence reading "super_admin only. A leader following this
   * gets 403", and the whole suite stayed green.
   */
  it('never gives a non-admin role a destination its own evidence gates on an admin', () => {
    const ADMIN_GATES = [
      /Roles\.Admin\b/,
      /Roles\.SuperAdmin\b/,
      /Roles\.CompanyAdmin\b/,
      /\bsuper_admin\b/,
      /\bcompany_admin\b/,
      /\bCanAdminister\b/,
      /\bCanAccessCompany\b/,
      /\badmins? only\b/i,
      /\badministrators only\b/i,
    ]
    // Guard the guard: the admin rows are written in exactly this vocabulary, so if none
    // of them trips these patterns the patterns have stopped matching prose.
    const tripped = ROLE_CAPABILITIES.super_admin.filter((capability) =>
      ADMIN_GATES.some((pattern) => pattern.test(capability.authorizedBy)),
    )
    expect(tripped.length, 'no admin row names an admin gate: the patterns are broken').toBeGreaterThan(5)

    for (const role of NON_ADMIN_ROLES) {
      for (const capability of ROLE_CAPABILITIES[role]) {
        for (const pattern of ADMIN_GATES) {
          expect(
            pattern.test(capability.authorizedBy),
            `${role} is given ${capability.route}, whose evidence names an admin gate (${pattern})`,
          ).toBe(false)
        }
      }
    }
  })

  /**
   * The non-admin surface is closed, and closing it takes a second edit in this file.
   *
   * Both lists are hand-written, so this is not a proof — it is a second signature. A row
   * added to a non-admin role with plausible-sounding evidence still fails here until
   * somebody writes down, next to the reason every other entry is caller-scoped, why the
   * new endpoint belongs among them. That is the review this table asks for, made
   * mandatory rather than hoped for.
   *
   * Read against `src/ClimateProject.Api/Endpoints/` and
   * `services/tracking-api/src/ClimateTracking.Api/Endpoints/` at 8f0eacc.
   */
  it('calls only endpoints that scope themselves to the caller', () => {
    const CALLER_SCOPED: Record<string, string> = {
      '/dashboard/employee':
        'DashboardEndpoints.EmployeeAsync — "No role gate at all, deliberately"; every figure is read off the caller’s own user row.',
      '/notifications/mine': 'NotificationEndpoints — filtered on the caller’s own user id.',
      '/profile/*': 'ProfileEndpoints — resolves the caller from their token and takes no user id (#136).',
      '/notifications/preferences': 'The caller’s own notification preferences; takes no user id (#103).',
      '/gdpr/access':
        'GdprEndpoints — a request with no userId is the self-service case and reads no role claim (#137).',
      '/surveys/my': 'SurveyEndpoints.ListMineAsync — the caller’s own row, its company and its department.',
      '/surveys/{}/respond':
        'SurveyEndpoints — resolves the caller’s own row and the survey’s own department targets; no role claim.',
      '/api/mis-tareas': 'ClimateTracking DashboardEndpoints.MisTareasAsync — filtered on the caller’s own sub claim.',
      '/api/planes-accion':
        'ClimateTracking PlanesAccionEndpoints.ListAsync — self-scoping: a non-admin caller gets their own nodo and the plans they are named on.',
      '/api/planes-accion/{}':
        'ClimateTracking PlanAccessHandler — the responsable, an involucrado, or a leader on their own nodo.',
      '/api/tablero-seguimiento':
        'ClimateTracking DashboardEndpoints.TableroAsync — with no nodoId it falls back to the caller’s own nodoId claim.',
    }

    const named = new Set<string>()
    for (const role of NON_ADMIN_ROLES) {
      for (const capability of ROLE_CAPABILITIES[role]) {
        for (const path of endpointsNamedBy(capability.authorizedBy)) {
          named.add(path)
          expect(
            Object.hasOwn(CALLER_SCOPED, path),
            `${role} is given ${capability.route}, which calls ${path} — not one of the endpoints ` +
              'recorded here as caller-scoped. Add it with its reason, or take the route away.',
          ).toBe(true)
        }
      }
    }
    // And the other direction, so the list cannot be padded with endpoints nothing uses.
    expect([...named].sort()).toEqual(Object.keys(CALLER_SCOPED).sort())
  })

  /**
   * `inNav` used to be read by nothing at all — not by `reachableRoutes`, not by
   * `canReach`, not by a test. Every one of its thirty-nine values could be inverted with
   * the suite green, which made the one field that distinguishes "the sidebar offers it"
   * from "reached from a page" pure decoration.
   */
  it('agrees with the sidebar about whether it is a row in one', () => {
    const hrefs = everyNavHref()
    // Guard the guard: a sweep that produced no rows, or rows nothing matches, would make
    // one of the two directions below vacuous.
    expect(hrefs.size).toBeGreaterThan(15)
    const declaredInNav = Object.values(ROLE_CAPABILITIES)
      .flat()
      .filter((capability) => capability.inNav)
    expect(declaredInNav.length).toBeGreaterThan(10)

    for (const role of PLATFORM_ROLES) {
      for (const capability of ROLE_CAPABILITIES[role]) {
        expect(
          isANavRow(capability.route, hrefs),
          `${role} → ${capability.route} is declared inNav: ${capability.inNav}, and no ` +
            `sidebar ${capability.inNav ? 'offers' : 'refuses'} it`,
        ).toBe(capability.inNav)
      }
    }
  })

  it('resolves its label in every locale', () => {
    for (const locale of LOCALES) {
      const t = createTranslator(CATALOGUES[locale])
      for (const role of PLATFORM_ROLES) {
        for (const capability of ROLE_CAPABILITIES[role]) {
          const value = t(capability.labelKey)
          // The translator falls back to the key itself, so an equal value is a missing
          // translation rather than a literal match.
          expect(value, `${capability.labelKey} is unresolved in ${locale}`).not.toBe(
            capability.labelKey,
          )
          expect(value.trim(), `${capability.labelKey} is blank in ${locale}`).not.toBe('')
        }
      }
    }
  })
})

describe('the sidebar never offers a destination the table does not claim', () => {
  /**
   * The guard the `/action-plans` defect needed and did not have.
   *
   * Run for both tracking states, because the rows differ between them and a
   * tracking-only row is exactly the kind that ships unchecked — `navSections.test.ts`
   * records the same trap for its label sweeps.
   */
  it.each([true, false])('holds with trackingEnabled=%s', (trackingEnabled) => {
    for (const role of PLATFORM_ROLES) {
      for (const companyId of COMPANY_IDS) {
        for (const href of navHrefs(role, trackingEnabled, companyId)) {
          expect(
            canReach(role, href, trackingEnabled),
            `${role}'s sidebar offers ${href} (companyId: ${JSON.stringify(companyId)}), ` +
              'which is not one of its capabilities',
          ).toBe(true)
        }
      }
    }
  })

  /**
   * Guard the guard, and the reason the sweep above gained a second and third token.
   *
   * Passing a populated company id on every sweep meant `buildNavSections`' documented
   * fallback branch — "every other role, **and a company_admin whose token carries no
   * companyId**" — was never entered, and it is the branch that was wrong: it offered that
   * role `/surveys/my` and `/tracking/mis-tareas`, neither of which this table then
   * claimed. A sweep that cannot tell the two navs apart is not sweeping both.
   */
  it('really does reach the branch a company_admin with no companyId falls into', () => {
    const withCompany = navHrefs('company_admin', true, COMPANY)
    for (const companyId of [undefined, '']) {
      const without = navHrefs('company_admin', true, companyId)
      expect(without, `companyId ${JSON.stringify(companyId)} produced the admin sidebar`).not.toEqual(
        withCompany,
      )
      expect(without).toContain('/surveys/my')
      // Nothing in it may interpolate an id the token does not have.
      for (const href of without) expect(href).not.toContain('undefined')
    }
  })

  it('holds for a role neither module has heard of, which falls back to the employee set', () => {
    for (const href of navHrefs('auditor', true, COMPANY)) {
      expect(canReach('auditor', href, true), `an unknown role's sidebar offers ${href}`).toBe(true)
    }
  })
})

describe('each non-admin role', () => {
  // AC: "Each non-admin role has a non-empty nav with no dead or 403 links."
  it.each([...NON_ADMIN_ROLES])('has a non-empty nav (%s)', (role) => {
    for (const companyId of COMPANY_IDS) {
      expect(navHrefs(role, false, companyId).length).toBeGreaterThan(0)
      expect(navHrefs(role, true, companyId).length).toBeGreaterThan(0)
    }
  })

  it.each([...NON_ADMIN_ROLES])('lands on a destination it can load after login (%s)', (role) => {
    // `resolveInitialRoute` is a constant; asserting the constant is in the role's
    // capability set is what connects the two.
    expect(canReach(role, '/dashboard')).toBe(true)
  })

  /**
   * The specific defect this issue was opened on, stated as a property.
   *
   * `ActionPlanEndpoints.CanAccessCompany` is `super_admin`, or `company_admin` on their
   * own company. `DepartmentAdminDashboardView` — the page only these roles see — used to
   * put a primary button on `/action-plans`, so every viewer of that button got
   * "Request failed: 403".
   */
  it.each([...NON_ADMIN_ROLES])('cannot reach the admin action-plan listing (%s)', (role) => {
    expect(canReach(role, '/action-plans', true)).toBe(false)
    expect(canReach(role, '/action-plans/some-id', true)).toBe(false)
  })

  it.each([...NON_ADMIN_ROLES])('cannot reach a survey admin page or its results (%s)', (role) => {
    // `SurveyEndpoints.CanAdminister` and `SurveyResultsEndpoints.LoadAsync`.
    expect(canReach(role, '/surveys/33333333-3333-3333-3333-333333333301', true)).toBe(false)
    expect(canReach(role, '/surveys/33333333-3333-3333-3333-333333333301/results', true)).toBe(false)
  })

  it.each([...NON_ADMIN_ROLES])('can still answer a survey it was sent (%s)', (role) => {
    // The same `:id` shape as the two above, and the opposite answer — which is the point
    // of enumerating destinations rather than URL prefixes.
    expect(canReach(role, '/surveys/33333333-3333-3333-3333-333333333301/respond', true)).toBe(true)
  })

  it.each([...NON_ADMIN_ROLES])('can reach its own team surface, and no other (%s)', (role) => {
    // `/surveys/my` reads no role claim; `/departments` and `/admin/users` are
    // `Roles.Admin`. There is no team roster for these roles — see the module header.
    expect(canReach(role, '/surveys/my')).toBe(true)
    expect(canReach(role, '/departments')).toBe(false)
    expect(canReach(role, `/admin/companies/${COMPANY}/users`)).toBe(false)
  })
})

describe('the self-service pages every role owns', () => {
  const SELF_SERVICE = ['/profile', '/settings/notifications', '/settings/privacy', '/notifications']

  it.each(SELF_SERVICE)('is a capability of every role (%s)', (route) => {
    for (const role of PLATFORM_ROLES) {
      expect(canReach(role, route), `${role} cannot reach ${route}`).toBe(true)
    }
  })

  /**
   * None of these has a sidebar row — they live in `SidebarUserMenu` on desktop and in
   * `ShellControls` inside the mobile drawer. A link drawn in the shell for every role is
   * a capability claim about every role, so the two files are read and every destination
   * they name has to be in the table.
   */
  it('is what the shell actually links to, for every role', () => {
    const shell = ['components/layout/ShellControls.tsx', 'components/layout/SidebarUserMenu.tsx']
    const linked = new Set<string>()
    for (const file of shell) {
      const source = readFileSync(join(WEB, 'src', ...file.split('/')), 'utf8')
      for (const match of source.matchAll(/\bto="(\/[^"]*)"/g)) linked.add(match[1])
    }
    // Guard the guard: the user menu links at least the profile and the two settings
    // pages, so an empty sweep is a broken regex rather than a shell with no links.
    expect(linked.size).toBeGreaterThanOrEqual(3)

    for (const href of linked) {
      for (const role of PLATFORM_ROLES) {
        expect(canReach(role, href, true), `${role} cannot reach ${href}, which the shell links`).toBe(true)
      }
    }
  })
})

describe('reachableRoutes', () => {
  it('fails closed: without tracking, no tracking route is reachable', () => {
    for (const role of PLATFORM_ROLES) {
      for (const route of reachableRoutes(role)) {
        expect(route.startsWith('/tracking'), `${role} → ${route}`).toBe(false)
      }
    }
  })

  it('adds the tracking rows only where the deployment has the service', () => {
    expect(reachableRoutes('leader', true).has('/tracking/tablero')).toBe(true)
    expect(reachableRoutes('leader', false).has('/tracking/tablero')).toBe(false)
  })

  it('gives a supervisor the task view but never the board, which is §7’s split', () => {
    expect(reachableRoutes('supervisor', true).has('/tracking/mis-tareas')).toBe(true)
    expect(reachableRoutes('supervisor', true).has('/tracking/tablero')).toBe(false)
    expect(reachableRoutes('employee', true).has('/tracking/tablero')).toBe(false)
  })

  it('gives an unknown role the employee set rather than everything or nothing', () => {
    expect([...reachableRoutes('auditor', true)].sort()).toEqual(
      [...reachableRoutes('employee', true)].sort(),
    )
  })
})

describe('matchesRoute', () => {
  it('treats a :param as exactly one segment', () => {
    expect(matchesRoute('/surveys/abc/respond', '/surveys/:id/respond')).toBe(true)
    expect(matchesRoute('/surveys/abc/def/respond', '/surveys/:id/respond')).toBe(false)
    expect(matchesRoute('/surveys/respond', '/surveys/:id/respond')).toBe(false)
  })

  it('does not let a prefix match, the way a bare startsWith would', () => {
    expect(matchesRoute('/surveys-archive', '/surveys')).toBe(false)
  })
})

describe('canReach', () => {
  /**
   * The ranking rule, asserted on a set that states the hazard rather than on a role.
   *
   * It used to be `canReach('company_admin', '/surveys/my')` — true then, false now that
   * the table records `/surveys/my` as loadable by everyone, and in any case an accident
   * of the table's contents rather than a test of the rule. Today **no** role holds a
   * parameterised pattern that would swallow a literal it does not hold, so a version of
   * this phrased over roles would pass with the literal-beats-parameter clause deleted.
   * `canReachIn` takes the set, so the hazard can be written down.
   */
  it('never lets a parameterised pattern answer for a literal route', () => {
    const surveyDetailOnly = new Set(['/surveys/:id'])
    // Segment for segment, `/surveys/:id` matches `/surveys/my` — which is why the rule
    // exists: they are different pages belonging to different people.
    expect(matchesRoute('/surveys/my', '/surveys/:id')).toBe(true)
    expect(canReachIn(surveyDetailOnly, '/surveys/my')).toBe(false)
    expect(canReachIn(surveyDetailOnly, '/surveys/templates')).toBe(false)
    // A concrete id is exactly what the pattern is for.
    expect(canReachIn(surveyDetailOnly, '/surveys/33333333-3333-3333-3333-333333333301')).toBe(true)
  })

  it('answers an employee for their own list and refuses them the admin detail page', () => {
    expect(canReach('employee', '/surveys/my')).toBe(true)
    expect(canReach('employee', '/surveys/33333333-3333-3333-3333-333333333301')).toBe(false)
  })

  /**
   * A role arrives as an untrusted string off a JWT claim, and `ROLE_CAPABILITIES[role]`
   * used to answer for anything on `Object.prototype`: `constructor` is a truthy function,
   * so `?? ROLE_CAPABILITIES.employee` never fired and `.filter` threw a TypeError. The
   * module is test-only today, but a capability table's next step is runtime enforcement,
   * and then a claim of `constructor` white-screens the shell instead of degrading to the
   * smallest set.
   */
  it.each(['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__'])(
    'treats %s as a role it has never heard of rather than throwing',
    (role) => {
      expect([...reachableRoutes(role, true)].sort()).toEqual(
        [...reachableRoutes('employee', true)].sort(),
      )
      expect(canReach(role, '/dashboard')).toBe(true)
      expect(canReach(role, '/action-plans', true)).toBe(false)
    },
  )
})
