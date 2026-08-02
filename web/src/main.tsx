import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/router'
import { initAdminTheme } from './theme/adminTheme'
import './index.css'

// Before the first render, so the palette in src/styles/tokens.css is settled
// on <html> and nothing paints in the wrong theme.
initAdminTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
