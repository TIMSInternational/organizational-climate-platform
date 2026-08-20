import { describe, it, expect } from 'vitest'
import { readFileSync, globSync } from 'node:fs'
import { join } from 'node:path'
import { router } from './router'

/**
 * A construction guard for the router.
 *
 * `router.tsx` calls `createBrowserRouter` at module scope, so importing this
 * module is enough to fail if the router API changed shape. That matters here
 * because the app moved from `react-router-dom` v7 to `react-router` v8 (#177) —
 * a major bump, and nothing else in the suite renders the router. Every other test
 * exercises a page or a helper in isolation, so a broken route table would have
 * shipped green.
 */
describe('router', () => {
  it('constructs without throwing', () => {
    expect(router).toBeTruthy()
    expect(router.routes.length).toBeGreaterThan(0)
  })

  it('registers every public route', () => {
    // These four are reachable without a token; a regression that put them behind
    // RequireAuth would lock out login and the anonymous respond page.
    const paths = new Set<string>()
    function walk(routes: typeof router.routes): void {
      for (const route of routes) {
        if (route.path) paths.add(route.path)
        if (route.children) walk(route.children as typeof router.routes)
      }
    }
    walk(router.routes)

    expect(paths).toContain('/')
    expect(paths).toContain('/login')
    expect(paths).toContain('/accept-invitation/:token')
    expect(paths).toContain('/microclimates/:id/respond')
    expect(paths).toContain('/survey/:id')

    // The two links this product actually distributes. `/s/:token` is the literal
    // `SurveyAccessTokens.PublicLinkPath` builds and `survey_distributions.public_url`
    // already stores, and `/survey-invitations/:token` mirrors the API route of the same
    // name — which nothing mails yet. Both shipped with the API minting
    // links and the router serving nothing, so every one of them reached the error
    // boundary — this is the assertion that would have caught it.
    expect(paths).toContain('/s/:token')
    expect(paths).toContain('/survey-invitations/:token')

    // #81's auth states. Each is a state the app is in BECAUSE there is no usable
    // session, so putting any of them behind RequireAuth would redirect it to
    // /login and lose the reason it exists. /auth/inactive is the subtle one --
    // its visitor does hold a token, and it is public because RequireAuth is what
    // sends them there; a guard that redirects into itself is a loop.
    expect(paths).toContain('/register')
    expect(paths).toContain('/auth/error')
    expect(paths).toContain('/auth/inactive')
    expect(paths).toContain('/auth/success')
    // #81 AC1 says all five states are ROUTED. This one was the gap: the loading
    // state shipped as a component (`AuthPending`) with nothing in front of it,
    // and it is now the `redirect_uri` Google is told to come back to -- if it is
    // not in the table, every Google sign-in dead-ends on the 404 boundary.
    expect(paths).toContain('/auth/loading')
  })

  /**
   * `/auth/loading` completes the sign-in, so it cannot require one. Behind
   * `RequireAuth` it would bounce the arriving OAuth callback to `/login`, losing
   * the ID token in the fragment — and every unit test that renders the page
   * directly would still pass.
   */
  it('keeps the OAuth callback route outside RequireAuth structurally', () => {
    const topLevel = (router.routes[0].children ?? []).flatMap((route) =>
      route.path ? [route.path] : [],
    )

    expect(topLevel).toContain('/auth/loading')
  })

  /**
   * The check above walks the whole tree, so it proves a path exists rather than
   * where it sits. This one is structural: a public route has to be a direct child
   * of the root, not nested inside the pathless `RequireAuth` branch.
   *
   * It matters most for `/survey/:id` (#120). An anonymous survey is answered by
   * people who have no account at all, so `RequireAuth` there would redirect every
   * one of them to a login page they cannot pass — and the failure would be silent
   * in every unit test that renders the page directly.
   */
  it('keeps the anonymous respond routes outside RequireAuth structurally', () => {
    const topLevel = (router.routes[0].children ?? []).flatMap((route) =>
      route.path ? [route.path] : [],
    )

    expect(topLevel).toContain('/survey/:id')
    expect(topLevel).toContain('/microclimates/:id/respond')
    // The two token-addressed link routes, for the same reason and then some: on both
    // of them the token IS the credential, and the endpoints behind them take no
    // `ClaimsPrincipal` at all. `RequireAuth` there would send every invitee to a
    // sign-in form the invitation exists precisely to avoid — `Survey.Settings`
    // has an `InvitationIncludeCredentials` flag because some of them have no
    // credentials to hand.
    expect(topLevel).toContain('/s/:token')
    expect(topLevel).toContain('/survey-invitations/:token')
    // The authenticated twin is deliberately NOT out here: an employee answering a
    // survey their company does not run anonymously should be sent to sign in.
    expect(topLevel).not.toContain('/surveys/:id/respond')
  })

  /**
   * All three respond routes sit outside `AdminLayout`.
   *
   * `/surveys/:id/respond` is the one that has to be asserted structurally, because
   * it is the one still behind `RequireAuth` — the test above already pins that, and
   * "gated" and "wrapped in the admin shell" are two different statements that were
   * previously the same route entry. The respondent surface is the same page whether
   * the answerer holds a token or not, and `AdminLayout` is the administrator's
   * frame: a role-aware rail, a company-context switcher, a notification bell, a
   * sign-out control. None of it belongs around a survey being answered.
   *
   * The shell branch is found by its contents rather than by its element, so this
   * does not depend on how `createBrowserRouter` stores an element.
   */
  it('keeps every respond route out of the AdminLayout branch', () => {
    function directPaths(routes: typeof router.routes): string[] {
      return routes.flatMap((route) => (route.path ? [route.path] : []))
    }

    function findShellBranch(routes: typeof router.routes): typeof router.routes | null {
      for (const route of routes) {
        const children = (route.children ?? []) as typeof router.routes
        if (children.length === 0) continue
        const paths = directPaths(children)
        if (paths.includes('/dashboard') && paths.includes('/admin/companies')) return children
        const nested = findShellBranch(children)
        if (nested) return nested
      }
      return null
    }

    const shellChildren = findShellBranch(router.routes)
    // Guard the guard: if the branch were not found, every assertion below would
    // pass vacuously against an empty list.
    expect(shellChildren, 'the AdminLayout branch was not found').not.toBeNull()
    expect(directPaths(shellChildren ?? []).length).toBeGreaterThan(10)

    for (const respondRoute of [
      '/surveys/:id/respond',
      '/survey/:id',
      '/microclimates/:id/respond',
      '/s/:token',
      '/survey-invitations/:token',
    ]) {
      expect(directPaths(shellChildren ?? [])).not.toContain(respondRoute)
    }
  })

  it('registers the authenticated admin routes', () => {
    const paths: string[] = []
    function walk(routes: typeof router.routes): void {
      for (const route of routes) {
        if (route.path) paths.push(route.path)
        if (route.children) walk(route.children as typeof router.routes)
      }
    }
    walk(router.routes)

    expect(paths).toContain('/admin/companies')
    expect(paths).toContain('/admin/companies/:id')
    expect(paths).toContain('/action-plans')
    expect(paths).toContain('/microclimates')
    // #127-#129. `/new` and `/analytics` are declared before `/:id` for readability;
    // react-router ranks a static segment above a dynamic one regardless, so neither
    // could ever be parsed as a microclimate id.
    expect(paths).toContain('/microclimates/new')
    expect(paths).toContain('/microclimates/analytics')
    expect(paths).toContain('/microclimates/:id/live')
    expect(paths).toContain('/microclimates/:id/results')
    // #99. Behind RequireAuth like the rest, but with no role gate of its own:
    // /notifications/mine authorizes per user, so every authenticated role can
    // load their own inbox and the nav offers it to all of them.
    expect(paths).toContain('/notifications')
    // #136. Same rule as /notifications above and for the same reason: every route
    // behind this page resolves the caller from their own token and takes no user
    // id, so a plain employee must be able to load it.
    expect(paths).toContain('/profile')
    expect(paths).toContain('/analytics/benchmarks')
    expect(paths).toContain('/analytics/ai-insights')
    expect(paths).toContain('/admin/companies/:companyId/reports')
    expect(paths).toContain('/admin/companies/:companyId/analytics')
    // #120's authenticated half. No role gate of its own: the respond endpoint
    // resolves the caller's own user row and checks the survey's department targets
    // itself, so every role that can be sent a survey can load this.
    expect(paths).toContain('/surveys/:id/respond')
    // #142. Flat rather than nested under a company: the page takes its company
    // from company-context, so one route serves super_admin and company_admin.
    expect(paths).toContain('/departments')
  })

  it('has an error element so a thrown render does not blank the page', () => {
    expect(router.routes[0]?.errorElement ?? router.routes[0]?.ErrorBoundary).toBeTruthy()
  })

  /**
   * The #79 chart gallery must exist in development and be absent from a production
   * build — it renders placeholder numbers and sits outside `RequireAuth`.
   *
   * Two halves, because neither alone is enough. The first asserts the behaviour in
   * whichever mode the suite is running in. The second asserts the *mechanism*: the
   * production half cannot be observed from inside a dev-mode test run, so what is
   * checked instead is the invariant that makes it true — nothing in the production
   * module graph may reach the gallery except through a dynamic import inside the
   * `import.meta.env.DEV` branch. Move that import to the top of the file and the
   * route still disappears in production while the *chunk* ships, which is the
   * regression that would otherwise go unnoticed.
   */
  describe('the dev-only chart gallery', () => {
    function allPaths(): string[] {
      const paths: string[] = []
      function walk(routes: typeof router.routes): void {
        for (const route of routes) {
          if (route.path) paths.push(route.path)
          if (route.children) walk(route.children as typeof router.routes)
        }
      }
      walk(router.routes)
      return paths
    }

    it('is registered in a development build and nowhere else', () => {
      if (import.meta.env.DEV) {
        expect(allPaths()).toContain('/dev/chart-gallery')
      } else {
        expect(allPaths()).not.toContain('/dev/chart-gallery')
      }
    })

    it('is reached only by a dynamic import inside the DEV branch', () => {
      const source = readFileSync(join(process.cwd(), 'src', 'app', 'router.tsx'), 'utf8')

      // The reference exists, and it is a dynamic import -- not a static one.
      expect(source).toContain("await import('../features/charts/pages/ChartGalleryPage')")
      expect(source).not.toMatch(/^import .*ChartGallery.*$/m)

      // And it sits inside the gate rather than beside it.
      const gate = source.indexOf('import.meta.env.DEV')
      const dynamicImport = source.indexOf("import('../features/charts/pages/ChartGalleryPage')")
      expect(gate).toBeGreaterThan(-1)
      expect(dynamicImport).toBeGreaterThan(gate)
    })

    it('is statically imported by nothing in the production graph', () => {
      const src = join(process.cwd(), 'src')
      const offenders = globSync('**/*.{ts,tsx}', { cwd: src })
        // The gallery's own folder may import itself; tests may import it directly.
        .filter((file) => !file.includes('features/charts/') && !/\.test\.tsx?$/.test(file))
        .filter((file) =>
          /^\s*import\s[^\n]*ChartGalleryPage/m.test(readFileSync(join(src, file), 'utf8')),
        )

      expect(
        offenders,
        'A static import puts the gallery and its sample data in the production ' +
          'bundle even though the route is gated. Import it dynamically inside the ' +
          'import.meta.env.DEV branch in router.tsx.',
      ).toEqual([])
    })
  })
})
