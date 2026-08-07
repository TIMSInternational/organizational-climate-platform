import { AuthShell } from './AuthShell'
import { useTranslation } from '../i18n'
import { Spinner } from '../components/ui'

/**
 * The interstitial an auth page shows while a request is in flight (#81).
 *
 * ## Why this is a component and not a route
 *
 * #81 lists "loading" among the missing auth states, and the criterion it
 * attaches is "Google sign-in shows the loading interstitial". **There is no
 * Google sign-in in this app.** `POST /auth/google` exists on the server, but a
 * sweep of `web/src` for `google` or `idToken` returns nothing: no button, no
 * SDK, no client id. A `/auth/loading` route would therefore be a page nothing
 * can navigate to, and an unreachable page is the "empty shell" this work is
 * explicitly not allowed to ship.
 *
 * What *is* real is the gap this covers: signing in and signing up both make a
 * network call, and until now the only feedback was a disabled button. On a slow
 * connection that reads as a dead click. So the state ships wired to the two
 * producers that actually exist, in the shell every other auth page uses, and it
 * is a drop-in for the whole page rather than an inline spinner because the form
 * behind it must not be re-submittable while the first submit is outstanding.
 *
 * If Google sign-in is built later, this is what its callback renders — no new
 * component, just a route in front of it.
 */
export function AuthPending({ label }: { label?: string }) {
  const { t } = useTranslation()

  return (
    <AuthShell title={label ?? t('common.loading')} description={t('auth.pendingDetail')}>
      {/* `status` + `aria-live` so the wait is announced; the spinner itself is
          `aria-hidden` and carries nothing on its own. */}
      <div role="status" aria-live="polite" className="flex items-center gap-inline text-fg-secondary">
        <Spinner size="lg" />
        <span>{t('auth.pendingHint')}</span>
      </div>
    </AuthShell>
  )
}
