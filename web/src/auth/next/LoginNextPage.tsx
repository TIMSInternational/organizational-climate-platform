import { CircleAlert } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { Alert, AlertDescription, AlertTitle, Button, Input } from '../../components/ui'
import { beginGoogleSignIn, googleClientId } from '../googleOAuth'
import { AuthCanvas, AuthCard, AuthDivider, AuthField, AuthHeadline } from './AuthCanvas'
import { AuthTransitionCard } from './AuthTransitionCard'
import { useSignInModel } from './useSignInModel'

/**
 * `/login` — the Login artboard, which replaced `LoginPage` on this route (the old page
 * stays in the tree, unrouted, with its own tests, as the wiring reference).
 *
 * What the redesign changes, board by board:
 *
 * - **One frame.** The page is the canvas's: the lockup-and-pickers strip, one 440px card
 *   on the ground, the serif heading at 24px over one line of what this screen is for.
 *   The previous page wore the storefront language, which nothing else in the redesign
 *   speaks.
 * - **A refusal that says why it is vague.** A 401 is answered identically by the server
 *   for a wrong password and for a deactivated account, on purpose, so that nobody can
 *   find out which addresses have accounts. The card now says exactly that, above the
 *   first field, with what was typed still in the form — instead of echoing the server's
 *   "Invalid email or password" as though it had diagnosed one of the two.
 * - **Password help stays copy, not a control.** There is no password-reset endpoint in
 *   this API: `/auth` is login, signup, google, refresh and the admin-only
 *   reset-credentials. A "forgot your password?" link would point at a route that cannot
 *   exist, so the board prints the true sentence under the field instead.
 * - **"Continue with Google" is drawn only where it can work.** `VITE_GOOGLE_CLIENT_ID`
 *   absent means the button could only ever come back `invalid_client`, and a button that
 *   always fails is worse than no button. Same rule the previous page had; the artboard
 *   records it.
 *
 * ## 2026-09-21: dark
 *
 * Federico's call. This screen alone is drawn dark whatever the reader's stored theme is.
 *
 * **Why dark only here.** It is the threshold. Everything past it — the admin surfaces and
 * the respond flow — is light by default and stays that way; making the one screen reached
 * without a session a different weight says "outside" and "inside" without a word of copy.
 * The pin never touches the reader's stored preference (`useForcedDarkTheme`), so the app
 * they land in is still the one they chose, and the theme picker is dropped from the strip
 * rather than left there doing nothing.
 *
 * A drifting dot lattice rode on this ground for part of 21 Sep — one mark per person, no
 * mark picked out. Federico ruled it out the same day. The ground is flat dark now, and
 * the anonymity line under the card carries that idea on its own, in words.
 *
 * There is no "create an account" link, and that is not an omission: `POST /auth/signup`
 * derives the company from the email domain and refuses an address whose domain no company
 * has registered, which is most of the people who reach this page. `/register` is still
 * routed and still linked from itself; this page simply does not advertise it as the way
 * in.
 */
export default function LoginNextPage() {
  const { t } = useTranslation()
  const model = useSignInModel()
  const googleClient = googleClientId()

  if (model.submitting) {
    return <AuthTransitionCard detail={t('auth.next.transitionSignIn')} />
  }

  return (
    <AuthCanvas ground="dark">
      <AuthCard>
        <AuthHeadline
          eyebrow={t('auth.next.eyebrow')}
          title={t('auth.next.signIn')}
          description={t('auth.next.signInDetail')}
        />

        <form className="flex flex-col gap-3.5" onSubmit={model.submit}>
          {/* Above the first field, which is where the artboard puts it and where the
              next thing to do is. `role="alert"` because the reader caused it. */}
          {model.error && (
            <Alert variant="destructive" role="alert" className="px-3.5">
              <CircleAlert aria-hidden="true" />
              {model.error.kind === 'form' ? (
                <>
                  <AlertTitle className="text-base font-semibold text-fg-primary">
                    {t(model.error.titleKey)}
                  </AlertTitle>
                  <AlertDescription>{t(model.error.bodyKey)}</AlertDescription>
                </>
              ) : (
                <AlertDescription>{model.error.message}</AlertDescription>
              )}
            </Alert>
          )}

          <AuthField htmlFor="auth-email" fieldLabel={t('auth.next.emailLabel')} required>
            <Input
              id="auth-email"
              type="email"
              autoComplete="email"
              required
              value={model.email}
              placeholder={t('auth.next.emailPlaceholder')}
              onChange={(event) => model.setEmail(event.target.value)}
            />
          </AuthField>

          <AuthField
            htmlFor="auth-password"
            fieldLabel={t('auth.next.passwordLabel')}
            required
            helper={t('auth.next.passwordHelp')}
          >
            <Input
              id="auth-password"
              type="password"
              autoComplete="current-password"
              required
              value={model.password}
              placeholder={t('auth.next.passwordPlaceholder')}
              onChange={(event) => model.setPassword(event.target.value)}
            />
          </AuthField>

          {/* `size="canvas"` is the artboard's 34px control; `variant="primary"` is its red
              (`--admin-accent-blue-fill` is #dd0c15 — the identity fill, recoloured for
              this canvas). `outline` is deliberately untouched: index.css gives every
              button its focus ring in `@layer base`, and setting it here removes it. */}
          <Button type="submit" variant="primary" size="canvas" className="w-full">
            {t('auth.next.signIn')}
          </Button>

          {googleClient && (
            <>
              <AuthDivider label={t('auth.or')} />
              {/* A full-page navigation, not a router one: this leaves the app for
                  accounts.google.com and comes back to /auth/loading as a fresh document.
                  `beginGoogleSignIn` stores the state/nonce the return trip is checked
                  against. */}
              <Button
                type="button"
                variant="outline"
                size="canvas"
                className="w-full"
                onClick={() => window.location.assign(beginGoogleSignIn(googleClient, window.location.origin))}
              >
                {t('auth.continueWithGoogle')}
              </Button>
            </>
          )}
        </form>
      </AuthCard>

    </AuthCanvas>
  )
}
