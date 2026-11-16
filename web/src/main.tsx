import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { router } from './app/router'
import { installCrashReporting, routePatternFor } from './app/crashReporter'
import { initAdminTheme } from './theme/adminTheme'
import { TranslationProvider } from './i18n'
import { Toaster } from './components/ui'
import './index.css'

// Before the first render, so the palette in src/styles/tokens.css is settled
// on <html> and nothing paints in the wrong theme.
initAdminTheme()

// Crash reports to the API (#158) — uncaught errors, unhandled rejections, and what
// RouteErrorBoundary catches. Installed before the first render so a crash while rendering it
// is reported too. The route is resolved against the router's own table, so a report names
// `/s/:token` and never the token. See crashReporter.ts for everything a report may not carry.
installCrashReporting({
  baseUrl: import.meta.env.VITE_API_BASE_URL as string | undefined,
  resolveRoute: (pathname) => routePatternFor(router.routes, pathname),
})

// The provider wraps the router, not a layout, so the public routes — login,
// accept-invitation, and the anonymous microclimate respond page — are translated
// too. #78 asked for this in App.tsx, but App.tsx is the leftover Vite scaffold
// and is imported nowhere; main.tsx is the actual root.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TranslationProvider>
      <RouterProvider router={router} />
      {/* One Toaster for the whole app. #76 asked for App.tsx; that file is the
          dead Vite scaffold (see the note above), so it mounts here beside the
          router, which is what "app-level" means in this app. */}
      <Toaster />
    </TranslationProvider>
  </StrictMode>,
)
