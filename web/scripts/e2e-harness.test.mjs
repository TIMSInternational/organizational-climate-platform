import { describe, expect, it } from 'vitest'
// `?raw` so the parser is measured against the router exactly as authored — the same
// mechanism src/styles/tokens.test.ts uses, and the reason vite.config.ts sets `css: true`.
import routerSource from '../src/app/router.tsx?raw'
import {
  assertRouterShape,
  deriveMatrix,
  fillParams,
  isSignificantConsoleError,
  parseRouterPaths,
  resolveIds,
} from './e2e-harness.mjs'

describe('parseRouterPaths', () => {
  it('finds every quoted path property', () => {
    const source = `
      { path: '/dashboard', element: <A /> },
      { path: '/surveys/:id', element: <B /> },
    `
    expect(parseRouterPaths(source)).toEqual(['/dashboard', '/surveys/:id'])
  })

  it('de-duplicates and sorts, so the matrix is stable across edits', () => {
    const source = "path: '/b'\npath: '/a'\npath: '/b'"
    expect(parseRouterPaths(source)).toEqual(['/a', '/b'])
  })
})

describe('assertRouterShape', () => {
  it('passes on the shape the parser assumes', () => {
    expect(assertRouterShape("{ path: '/a' }, { path: '/b/:id' }")).toEqual([])
  })

  // Both of these would be SILENTLY under-covered rather than reported, which is the
  // failure mode this whole file exists to prevent.
  it('rejects an index route, which declares no path at all', () => {
    expect(assertRouterShape('{ index: true, element: <A /> }')).toHaveLength(1)
  })

  it('rejects a relative path, which resolves against a parent the parser never reads', () => {
    expect(assertRouterShape("{ path: 'nested' }")[0]).toMatch(/relative path/)
  })
})

describe('deriveMatrix', () => {
  it('reports a router path the coverage table forgot — the failure that fails a run', () => {
    const matrix = deriveMatrix(['/a', '/b'], { '/a': {} })
    expect(matrix.missing).toEqual(['/b'])
  })

  it('reports a coverage entry the router no longer declares', () => {
    const matrix = deriveMatrix(['/a'], { '/a': {}, '/gone': {} })
    expect(matrix.unknown).toEqual(['/gone'])
    expect(matrix.missing).toEqual([])
  })
})

describe('fillParams', () => {
  it('leaves a static path alone', () => {
    expect(fillParams('/dashboard', {})).toBe('/dashboard')
  })

  it('substitutes every parameter', () => {
    expect(fillParams('/admin/companies/:companyId/users', { companyId: 'c1' }))
      .toBe('/admin/companies/c1/users')
  })

  // Navigating to a literal '/surveys/:id' renders a REAL screen that fetches a survey
  // named ":id", 404s, and shows an error state — which would pass a naive "did it
  // render" check while proving nothing.
  it('returns null rather than navigating to an unsubstituted parameter', () => {
    expect(fillParams('/surveys/:id/results', {})).toBeNull()
    expect(fillParams('/surveys/:id/results', { id: '' })).toBeNull()
  })
})

describe('isSignificantConsoleError', () => {
  it('keeps an application error', () => {
    expect(isSignificantConsoleError('TypeError: x is not a function')).toBe(true)
  })

  it('drops the known dev-server and devtools noise', () => {
    expect(isSignificantConsoleError('Download the React DevTools for a better experience')).toBe(false)
    expect(isSignificantConsoleError('[vite] connecting...')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The instrument, measured against the real router.
// ---------------------------------------------------------------------------
describe('the real src/app/router.tsx', () => {
  const source = routerSource

  it('has the shape parseRouterPaths assumes', () => {
    expect(assertRouterShape(source)).toEqual([])
  })

  /**
   * A constant where variation is expected is a bug — the lesson the screenshot harness
   * taught this repository by capturing one viewport on every screen for months. If this
   * parser ever returns a suspiciously small number it has stopped reading the router,
   * and every "all routes passed" report after that would be a lie.
   */
  it('yields a plausible number of routes, so a broken parser cannot report success', () => {
    const paths = parseRouterPaths(source)
    expect(paths.length).toBeGreaterThan(40)
    expect(paths).toContain('/dashboard')
    expect(paths).toContain('/surveys/:id/results')
    expect(paths.every((path) => path.startsWith('/'))).toBe(true)
  })
})

describe('resolveIds', () => {
  const discovered = {
    survey: 's1', microclimate: 'm1', actionPlan: 'ap1',
    company: 'c1', template: 't1', plan: 'p1', companyId: 'c1', surveyId: 's1',
  }

  it('routes :id to the entity the prefix names', () => {
    expect(resolveIds('/surveys/:id', discovered).id).toBe('s1')
    expect(resolveIds('/microclimates/:id', discovered).id).toBe('m1')
    expect(resolveIds('/action-plans/:id', discovered).id).toBe('ap1')
    expect(resolveIds('/admin/companies/:id', discovered).id).toBe('c1')
    expect(resolveIds('/tracking/planes/:id', discovered).id).toBe('p1')
  })

  // The whole reason this function exists: a survey id sent to the template route 404s
  // and renders a healthy-looking "not found" screen — a false pass.
  it('prefers the longer prefix, so a template is not given a survey id', () => {
    expect(resolveIds('/surveys/templates/:id', discovered).id).toBe('t1')
  })

  it('leaves an already-unambiguous parameter alone', () => {
    expect(resolveIds('/surveys/:surveyId/distribution', discovered).surveyId).toBe('s1')
  })

  it('yields undefined — and so a skip, not a guess — for an unmapped prefix', () => {
    expect(resolveIds('/something/:id', discovered).id).toBeUndefined()
  })
})

describe('isSignificantConsoleError, on the browser HTTP echo', () => {
  // Chrome logs this for every non-2xx, including refusals a screen handles by design.
  // The response classifier already judges those, so counting them here would double
  // every expected refusal.
  it('drops the browser status echo, which the response classifier already judges', () => {
    expect(isSignificantConsoleError(
      'Failed to load resource: the server responded with a status of 403 (Forbidden)',
    )).toBe(false)
  })

  it('still keeps an error the application itself logged', () => {
    expect(isSignificantConsoleError('Uncaught TypeError: cannot read properties of null')).toBe(true)
  })
})
