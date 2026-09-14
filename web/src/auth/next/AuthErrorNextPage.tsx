import { useLocation, useSearchParams } from 'react-router'
import { CircleAlert } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { Alert, AlertDescription, Button } from '../../components/ui'
import { toAuthErrorReason } from '../authReason'
import { AuthCanvas, AuthCard, AuthHeadline } from './AuthCanvas'
import { authStateCopy } from './derive'

/**
 * `/auth/error` — the AuthError artboard, which replaced `AuthErrorPage` on this route.
 *
 * ## One frame, one phrase per reason, one button
 *
 * The board's rule, and the reason it is a single artboard rather than four: every way a
 * sign-in can be refused by the *platform* rather than by the credentials gets the same
 * card and differs only in its sentence. `derive.ts` holds that mapping over the closed set
 * `authReason.ts` narrows the query parameter to, so this page cannot render a key path it
 * was handed.
 *
 * The four the board draws are its four producers:
 *
 * - **maintenance** — `SystemSettings.MaintenanceMode`, 503 from
 *   `CheckSystemSettingsGateAsync`, which gates login, signup and google alike.
 * - **login-disabled** — `SystemSettings.LoginEnabled == false`, 403 from the same gate.
 * - **google-signin** — the Google round trip's own failures: a cancelled consent screen,
 *   a `state`/`nonce` this browser did not issue, or `POST /auth/google` refusing the
 *   token.
 * - **session-expired** — a session that outlived `SessionTimeoutMinutes`.
 *
 * `unknown` is the floor, for a direct visit with no reason or an unrecognised one.
 *
 * ## Why there is one button and why it reloads
 *
 * The previous page drew "Retry" and "Back to sign in" side by side, and both went to
 * `/login`. Two controls that do the same thing is a choice the reader has to make for
 * nothing, so the board draws one. It is a document navigation rather than a router one:
 * the condition being reported lives on the server, so the only thing that can change the
 * answer is asking it again with a fresh document.
 *
 * ## The administrator's notice outranks the catalogue
 *
 * `location.state.message` is the server's own sentence. For maintenance it is authored,
 * per-locale content (`LocalizedContent.ResolveText`, #195) and the catalogue cannot do
 * better than paraphrase it; for a disabled sign-in it is the administrator's wording. The
 * board puts it between the phrase and the button, which is where it is read. A direct
 * visit carries no state, and then the catalogue's sentence is the whole answer.
 */
export default function AuthErrorNextPage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const location = useLocation()

  const copy = authStateCopy(toAuthErrorReason(searchParams.get('reason')))
  const state = location.state as { message?: unknown } | null
  const notice = typeof state?.message === 'string' && state.message.trim() !== '' ? state.message : null

  return (
    <AuthCanvas>
      <AuthCard>
        <AuthHeadline
          tile={<CircleAlert aria-hidden="true" />}
          tone="warning"
          eyebrow={t(copy.eyebrowKey)}
          title={t(copy.titleKey)}
          description={t(copy.bodyKey)}
        />

        <div className="flex flex-col gap-3.5">
          {notice && (
            <Alert variant="warning" role="alert" className="px-3.5">
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}

          <Button
            variant="primary"
            size="canvas"
            className="w-full"
            onClick={() => window.location.assign('/login')}
          >
            {t('auth.next.backToSignIn')}
          </Button>
        </div>
      </AuthCard>
    </AuthCanvas>
  )
}
