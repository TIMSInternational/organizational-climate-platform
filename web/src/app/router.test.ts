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
    // #273's editor. Asserted here for the same reason the two token routes are: a route
    // the product links to and the router does not declare reaches the error boundary.
    expect(paths).toContain('/surveys/:id/questions')

    expect(paths).toContain('/s/:token')
    expect(paths).toContain('/survey-invitations/:token')

    // #130's link. Same reason as the two above and the same failure mode: the API mints
    // it, `MicroclimateInvitationLinks.LinkPrefix` composes it into outbound mail, and no
    // reference connects that C# constant to this router. A rename on either side sends
    // every invitation already in an inbox to the error boundary, and this is the
    // assertion that notices.
    expect(paths).toContain('/microclimate-invitations/:token')

    // #139's public consumption page. Registered here for the same reason the two token
    // routes above are — a route the product hands out and the router does not declare
    // reaches the error boundary — and the path is the legacy one
    // (`src/app/shared/reports/[token]/page.tsx`), kept literal so links already in
    // circulation keep resolving.
    expect(paths).toContain('/shared/reports/:token')

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
    // #130's, and on this one the case is stronger still: a microclimate is answered
    // anonymously by default, so its invitees routinely have no account to sign in with
    // at all.
    expect(topLevel).toContain('/microclimate-invitations/:token')
    // The authenticated twin is deliberately NOT out here: an employee answering a
    // survey their company does not run anonymously should be sent to sign in.
    expect(topLevel).not.toContain('/surveys/:id/respond')
  })

  /**
   * #139, and the structural half of its first acceptance criterion.
   *
   * The public shared report is read by people the product has no user row for — a board
   * member, an auditor, a ministry contact — so `RequireAuth` here would be worse than a
   * gate. It renders `<Navigate to="/login" replace />` with no `state.from` and no
   * `?next=`, so it does not defer the destination, it **destroys** it: the visitor could
   * not reach the report even after signing in, and the token in the URL would be gone.
   *
   * Structural rather than "the path exists", because the page's own tests render it
   * directly and would pass with it nested anywhere at all.
   */
  it('keeps the public shared report outside RequireAuth structurally', () => {
    const topLevel = (router.routes[0].children ?? []).flatMap((route) =>
      route.path ? [route.path] : [],
    )

    expect(topLevel).toContain('/shared/reports/:token')
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
      '/microclimate-invitations/:token',
      // #139 is not a respond route, but it belongs in this list for a stronger reason
      // than any of them: `AdminLayout` is a role-aware rail built from JWT claims, a
      // company-context switcher, a notification bell and a sign-out control. Around an
      // unauthenticated page it would render from whatever token happens to be in the
      // browser — so an administrator checking a share link would see a different page
      // from the board member it was sent to, and every piece of that shell is a way for
      // a company's structure to leak onto the most exposed URL in the product.
      '/shared/reports/:token',
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
    // #137. Same rule again, and this one is an acceptance criterion rather than a
    // convenience: the page must be "reachable by every role". `GET /gdpr/access` with
    // no userId is documented in the handler as "the self-service case and needs no
    // role", and `SubjectAccessWireShapeTests.Any_role_can_ask_what_is_held_about_itself`
    // holds that end for all five. This is the other end — a route with no role gate.
    // It is deliberately NOT in `navSections`, which is role-aware and would hide a
    // person's own privacy page from the employees whose data it is about; the shell's
    // account menu links it instead.
    expect(paths).toContain('/settings/privacy')
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

  /**
   * The tracking module (#125, #126). Its dashboards shipped as an integration
   * layer with no consuming UI at all — `trackingApi.ts` existed, worked, and no
   * user could reach any of it — so "is it routed" is the first acceptance
   * criterion and this is where it is answered.
   *
   * It was then answered wrongly. #125 owned the route table and registered only
   * its own two paths, so #126's four pages and 4034 lines were imported by
   * nothing, tree-shaken out of the bundle entirely, and absent from the product
   * while their own tests passed. The last test in this block is the guard against
   * that specific failure: it reads the pages directory and demands a route for
   * each page, so the next page added without one fails here instead of
   * disappearing quietly.
   */
  describe('the tracking module', () => {
    function shellChildren(): typeof router.routes {
      function directPaths(routes: typeof router.routes): string[] {
        return routes.flatMap((route) => (route.path ? [route.path] : []))
      }
      function find(routes: typeof router.routes): typeof router.routes | null {
        for (const route of routes) {
          const children = (route.children ?? []) as typeof router.routes
          if (children.length === 0) continue
          const paths = directPaths(children)
          if (paths.includes('/dashboard') && paths.includes('/admin/companies')) return children
          const nested = find(children)
          if (nested) return nested
        }
        return null
      }
      const found = find(router.routes)
      expect(found, 'the AdminLayout branch was not found').not.toBeNull()
      return found ?? []
    }

    it('registers every tracking screen inside the admin shell', () => {
      const paths = shellChildren().flatMap((route) => (route.path ? [route.path] : []))
      // #125's two aggregate dashboards.
      expect(paths).toContain('/tracking')
      expect(paths).toContain('/tracking/tablero')
      // #126's three, which were reachable from nowhere until the two slices were
      // reconciled. `/tracking/planes/:id` is the one the tablero and the listing
      // both link to; without it every plan code on either screen reached the error
      // boundary.
      expect(paths).toContain('/tracking/planes')
      expect(paths).toContain('/tracking/planes/:id')
      expect(paths).toContain('/tracking/mis-tareas')
    })

    /**
     * The structural version of the assertion above: not "these five paths exist"
     * but "no page in this feature lacks a path".
     *
     * The two lists are derived from different places — one from the filesystem,
     * one from `router.tsx` — so a page added to `features/tracking/pages/` and
     * never routed fails here. That is the exact shape of the defect this module
     * shipped with, and a hardcoded list of five would not have caught it.
     */
    it('leaves no tracking page unrouted', () => {
      const pagesDir = join(process.cwd(), 'src', 'features', 'tracking', 'pages')
      const pages = globSync('*.tsx', { cwd: pagesDir })
        .filter((file) => !/\.test\.tsx$/.test(file))
        .map((file) => file.replace(/\.tsx$/, ''))

      expect(pages.length, 'no tracking pages found — the glob is wrong').toBeGreaterThan(4)

      const source = readFileSync(join(process.cwd(), 'src', 'app', 'router.tsx'), 'utf8')
      const unrouted = pages.filter(
        (page) => !source.includes(`await import('../features/tracking/pages/${page}')`),
      )

      expect(
        unrouted,
        'These tracking pages are imported by no route, so Rollup tree-shakes them ' +
          'out of the bundle and no user can reach them. Register them in ' +
          '`trackingRoutes` in router.tsx, or delete them.',
      ).toEqual([])
    })

    /**
     * `?nodoId=`, not `/tracking/tablero/:nodoId`, and it is a contract with the
     * endpoint rather than a style choice: `GET /api/tablero-seguimiento` takes
     * `nodoId` as an OPTIONAL query parameter and answers with the caller's own
     * nodo when it is absent. A path parameter would make the id mandatory in the
     * URL for the node leader, who has exactly one board and no reason to know its
     * external id.
     */
    it('addresses a board by query parameter, so a leader needs no id to open theirs', () => {
      const paths = shellChildren().flatMap((route) => (route.path ? [route.path] : []))
      expect(paths.some((path) => path.startsWith('/tracking/tablero/'))).toBe(false)
    })

    /**
     * Both are `lazy`, and nothing outside `features/tracking/` imports them
     * statically. The module exists only where a deployment configured a tracking
     * service, so every other build should carry it as a chunk it never fetches —
     * and a static import at the top of `router.tsx` would put both pages, the
     * semáforo table and the client in the main bundle regardless. The same
     * mechanism, and the same failure mode, as the dev-only chart gallery above.
     */
    it('loads every page lazily and is reached by no static import', () => {
      const src = join(process.cwd(), 'src')
      const source = readFileSync(join(src, 'app', 'router.tsx'), 'utf8')
      const pageNames =
        'ConsolidadoPage|TableroSeguimientoPage|PlanesAccionListPage|PlanDeAccionDetailPage|MisTareasPage'
      expect(source).not.toMatch(new RegExp(`^import .*(${pageNames}).*$`, 'm'))

      const offenders = globSync('**/*.{ts,tsx}', { cwd: src })
        .filter((file) => !file.includes('features/tracking/') && !/\.test\.tsx?$/.test(file))
        .filter((file) =>
          new RegExp(`^\\s*import\\s[^\\n]*(${pageNames})`, 'm').test(
            readFileSync(join(src, file), 'utf8'),
          ),
        )
      expect(offenders).toEqual([])
    })
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
