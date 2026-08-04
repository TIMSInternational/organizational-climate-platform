import { lazy, Suspense } from 'react'

/**
 * Route wrapper that code-splits the #79 chart gallery.
 *
 * The `lazy()` call lives here rather than in `app/router.tsx` for a narrow but
 * real reason: `web/` lints with `oxlint --max-warnings 10` and sits at exactly 10,
 * so any new warning fails CI. Declaring a lazy component inside `router.tsx` — a
 * file whose only export is the non-component `router` — adds a second
 * `react(only-export-components)` warning to the one already there. Here, the
 * file's single export *is* a component, so the rule is satisfied and the router
 * imports an ordinary component.
 *
 * The split itself is what matters: the gallery and its sample data land in their
 * own chunk, so the main bundle carries none of it unless someone visits the URL.
 */
const ChartGalleryPage = lazy(() => import('./ChartGalleryPage'))

export default function ChartGalleryRoute() {
  return (
    <Suspense fallback={null}>
      <ChartGalleryPage />
    </Suspense>
  )
}
