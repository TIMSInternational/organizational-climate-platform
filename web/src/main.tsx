import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/router'
import { initAdminTheme } from './theme/adminTheme'
import { TranslationProvider } from './i18n'
import { Toaster } from './components/ui'
import './index.css'

// Before the first render, so the palette in src/styles/tokens.css is settled
// on <html> and nothing paints in the wrong theme.
initAdminTheme()

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
