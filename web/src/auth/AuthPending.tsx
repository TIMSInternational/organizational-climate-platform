import { AuthShell } from './AuthShell'
import { useTranslation } from '../i18n'
import { Spinner } from '../components/ui'

/**
 * The interstitial an auth page shows while a request is in flight (#81).
 *
 * ## Three producers, one of which is a route
 *
 * `LoginPage` and `RegisterPage` render this in place of their form while their
 * own request is outstanding: it is a drop-in for the whole page rather than an
 * inline spinner because the form behind it must not be re-submittable while the
 * first submit is running.
 *
 * The third is `AuthLoadingPage`, at `/auth/loading` — the `redirect_uri` Google
 * sends the browser back to. That is the "loading" state #81 lists among the
 * missing pages, and the one its fourth criterion is about ("Google sign-in shows
 * the loading interstitial").
 *
 * This component was originally shipped without that route, on the reasoning that
 * `POST /auth/google` had no caller anywhere in `web/src` so nothing could ever
 * navigate to it. True at the time, and the honest response was to build the
 * missing producer rather than to keep documenting its absence — see
 * `googleOAuth.ts`.
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
