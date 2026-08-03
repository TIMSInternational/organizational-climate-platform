import { describe, it, expect } from 'vitest'
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
  })

  it('has an error element so a thrown render does not blank the page', () => {
    expect(router.routes[0]?.errorElement ?? router.routes[0]?.ErrorBoundary).toBeTruthy()
  })
})
