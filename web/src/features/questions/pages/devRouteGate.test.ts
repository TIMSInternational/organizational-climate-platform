import { describe, it, expect } from 'vitest'
import { readFileSync, globSync } from 'node:fs'
import { join } from 'node:path'
import { router } from '../../../app/router'

/**
 * The screenshot page for the shared picker must exist in development and be absent
 * from a production build — it renders a dialog outside `RequireAuth`.
 *
 * The same two-halves shape `router.test.ts` uses for the #79 chart gallery, and for
 * the same reason: the production half cannot be observed from inside a dev-mode
 * test run, so what is asserted instead is the invariant that makes it true. Move
 * the import to the top of `router.tsx` and the route still disappears in production
 * while the CHUNK ships — the regression that would otherwise go unnoticed.
 */
describe('the dev-only question-library screenshot page', () => {
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
      expect(allPaths()).toContain('/dev/question-library')
    } else {
      expect(allPaths()).not.toContain('/dev/question-library')
    }
  })

  it('is reached only by a dynamic import inside the DEV branch', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'app', 'router.tsx'), 'utf8')

    expect(source).toContain(
      "await import('../features/questions/pages/QuestionLibraryDevPage')",
    )
    expect(source).not.toMatch(/^import .*QuestionLibraryDevPage.*$/m)

    const gate = source.indexOf('import.meta.env.DEV')
    const dynamicImport = source.indexOf(
      "import('../features/questions/pages/QuestionLibraryDevPage')",
    )
    expect(gate).toBeGreaterThan(-1)
    expect(dynamicImport).toBeGreaterThan(gate)
  })

  it('is statically imported by nothing in the production graph', () => {
    const src = join(process.cwd(), 'src')
    const offenders = globSync('**/*.{ts,tsx}', { cwd: src })
      .filter((file) => !/\.test\.tsx?$/.test(file))
      .filter((file) =>
        /^\s*import\s[^\n]*QuestionLibraryDevPage/m.test(readFileSync(join(src, file), 'utf8')),
      )

    expect(
      offenders,
      'A static import puts the dev page in the production bundle even though the ' +
        'route is gated. Import it dynamically inside the import.meta.env.DEV branch.',
    ).toEqual([])
  })
})
