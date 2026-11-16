import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { TranslationProvider } from '../i18n'
import es from '../i18n/es.json'
import RouteErrorBoundary from './RouteErrorBoundary'
import { installCrashReporting, routePatternFor } from './crashReporter'
import { router } from './router'

let uninstallReporter: () => void = () => undefined

afterEach(() => {
  cleanup()
  uninstallReporter()
  vi.unstubAllGlobals()
})

function Boom(): never {
  throw new Error('render failed')
}

/** The shell's shape, as router.tsx nests it: a layout, a pathless boundary, the pages. */
function renderInShell() {
  const memory = createMemoryRouter(SHELL_ROUTES, { initialEntries: ['/surveys/sv-1'] })
  return render(
    <TranslationProvider initialLocale="es">
      <RouterProvider router={memory} />
    </TranslationProvider>,
  )
}

const SHELL_ROUTES = [
  {
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: (
          <div>
            <nav aria-label="rail">rail</nav>
            <main>
              <Outlet />
            </main>
          </div>
        ),
        children: [
          {
            errorElement: <RouteErrorBoundary placement="shell" />,
            children: [{ path: '/surveys/:id', element: <Boom /> }],
          },
        ],
      },
    ],
  },
]

describe('RouteErrorBoundary', () => {
  it('keeps the shell when a page inside it throws, and offers a retry and a way home', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderInShell()
    // The frame survives: the rail is still there, and the card sits inside <main>.
    expect(screen.getByRole('navigation', { name: 'rail' })).toBeTruthy()
    const alert = within(screen.getByRole('main')).getByRole('alert')
    expect(alert.getAttribute('data-placement')).toBe('shell')
    expect(within(alert).getByText(es.errors.route.title)).toBeTruthy()
    expect(within(alert).getByRole('button', { name: es.ui.state.retry })).toBeTruthy()
    expect(within(alert).getByRole('link', { name: es.errors.route.home }).getAttribute('href')).toBe('/')
  })

  it('reports the crash once, under the route pattern and never the path (#158)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    uninstallReporter = installCrashReporting({
      baseUrl: 'https://api.example.test',
      resolveRoute: (pathname) => routePatternFor(SHELL_ROUTES, pathname),
    })

    renderInShell()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = String(fetchMock.mock.calls[0][1]?.body)
    expect(JSON.parse(body)).toMatchObject({ route: '/surveys/:id', message: 'Error: render failed' })
    expect(body).not.toContain('sv-1')
  })

  it('speaks in usted, as the rest of the interface does', () => {
    // The old copy was "Por favor intenta nuevamente" — tú, and an apology with no way out.
    expect(es.errors.route.body).not.toMatch(/\bintenta\b|\btu\b|\btú\b/i)
  })

  it('is mounted under AdminLayout as a pathless boundary around every shell page', () => {
    // Find the route whose children hold the shell's pages; it must carry an errorElement of
    // its own, or a crash in any of them falls through to the root and drops the frame.
    type R = (typeof router.routes)[number]
    function find(routes: R[]): R | null {
      for (const route of routes) {
        const paths = (route.children ?? []).map((child) => child.path)
        if (paths.includes('/dashboard') && paths.includes('/surveys/:id')) return route
        const nested = find((route.children ?? []) as R[])
        if (nested) return nested
      }
      return null
    }
    const branch = find(router.routes as R[])
    expect(branch, 'the shell pages were not found').not.toBeNull()
    expect(branch!.path).toBeUndefined()
    expect(branch!.errorElement).toBeTruthy()
  })
})
