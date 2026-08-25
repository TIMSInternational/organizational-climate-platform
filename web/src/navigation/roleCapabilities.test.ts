import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  NON_ADMIN_ROLES,
  PLATFORM_ROLES,
  ROLE_CAPABILITIES,
  canReach,
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

const COMPANY = 'company-1'

/** Every href the sidebar offers this role, flattened the way the mobile bar flattens it. */
function navHrefs(role: string, trackingEnabled: boolean): string[] {
  return leafNavItems(buildNavSections(role, COMPANY, { trackingEnabled })).map((item) => item.href)
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

  it('names the endpoint that authorizes it', () => {
    for (const role of PLATFORM_ROLES) {
      for (const capability of ROLE_CAPABILITIES[role]) {
        expect(capability.authorizedBy.length, `${role} → ${capability.route}`).toBeGreaterThan(20)
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
      for (const href of navHrefs(role, trackingEnabled)) {
        expect(
          canReach(role, href, trackingEnabled),
          `${role}'s sidebar offers ${href}, which is not one of its capabilities`,
        ).toBe(true)
      }
    }
  })

  it('holds for a role neither module has heard of, which falls back to the employee set', () => {
    for (const href of navHrefs('auditor', true)) {
      expect(canReach('auditor', href, true), `an unknown role's sidebar offers ${href}`).toBe(true)
    }
  })
})

describe('each non-admin role', () => {
  // AC: "Each non-admin role has a non-empty nav with no dead or 403 links."
  it.each([...NON_ADMIN_ROLES])('has a non-empty nav (%s)', (role) => {
    expect(navHrefs(role, false).length).toBeGreaterThan(0)
    expect(navHrefs(role, true).length).toBeGreaterThan(0)
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
  it('prefers a literal capability over a parameterised one', () => {
    // `/surveys/my` and `/surveys/:id` differ by role: an employee has the first and not
    // the second. A naive parameter match would hand an employee the admin detail page.
    expect(canReach('employee', '/surveys/my')).toBe(true)
    expect(canReach('company_admin', '/surveys/my')).toBe(false)
  })
})
