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
    expect(paths).toContain('/analytics/benchmarks')
    expect(paths).toContain('/analytics/ai-insights')
    expect(paths).toContain('/admin/companies/:companyId/reports')
    expect(paths).toContain('/admin/companies/:companyId/analytics')
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
