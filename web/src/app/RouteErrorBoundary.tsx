import { useEffect } from 'react'
import { Link, useLocation, useRouteError } from 'react-router'
import { useTranslation } from '../i18n'
import { Button, ErrorState } from '../components/ui'
import { reportCrash } from './crashReporter'

// Safe to use translations here: TranslationProvider wraps RouterProvider in
// main.tsx, so it sits above every route element including this errorElement.
//
// #76 asked that the legacy error-handling primitives integrate with this
// boundary rather than duplicate it, so this renders ErrorState instead of
// growing its own markup, and the legacy LoadingErrorBoundary class is not
// ported — the router's errorElement already is that boundary.
//
// ## Two placements, one component
//
// `router.tsx` mounts it twice. The root route's `errorElement` catches a crash on a
// public, respond or auth screen — there is no shell there to keep, so it draws the
// card on the bare page (`placement="page"`). A pathless route directly under
// `AdminLayout` carries the second one (`placement="shell"`): react-router renders an
// `errorElement` in place of the route that holds it, so a page that throws inside the
// shell now loses only its own content — the navy frame, the rail, the bar and the
// rounded box stay, and with them every way out. Before, the one root boundary took
// the whole screen, and an administrator was left on a blank card with no navigation.
//
// ## A way forward, always
//
// HIG `feedback.md`: say what happened and offer what to do about it. "Reintentar"
// reloads, because a render error leaves nothing in memory worth retrying from, and
// "Volver al inicio" goes to `/`, which `HomeRedirect` sends to the right home for the
// role (or to the sign-in page when there is no session) — never a destination this
// viewer may not open. Navigating away clears the boundary: react-router resets an
// errorElement on the next navigation.
//
// ## And somebody is told
//
// Until #158 this card was the only trace a crash left. It now hands the error to
// `crashReporter`, which sends the matched ROUTE PATTERN — never this pathname, which on a
// respondent's screen is their access token — and nothing else that names a person. Once per
// error and route: StrictMode's second render and a re-render of the card send nothing new.
export default function RouteErrorBoundary({ placement = 'page' }: { placement?: 'page' | 'shell' }) {
  const { t } = useTranslation()
  const error = useRouteError()
  const { pathname } = useLocation()

  useEffect(() => {
    reportCrash(error, pathname)
  }, [error, pathname])

  const card = (
    <ErrorState
      fill={placement === 'shell'}
      data-placement={placement}
      title={t('errors.route.title')}
      description={t('errors.route.body')}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" variant="primary" onClick={() => window.location.reload()}>
            {t('ui.state.retry')}
          </Button>
          <Button asChild>
            <Link to="/" className="no-underline hover:no-underline">
              {t('errors.route.home')}
            </Link>
          </Button>
        </div>
      }
    />
  )

  // Inside the shell the content box already pads its page; on the bare page there is
  // no box, so the card takes the section gap the page would have had.
  return placement === 'shell' ? card : <div style={{ padding: 'var(--admin-size-section-gap)' }}>{card}</div>
}
