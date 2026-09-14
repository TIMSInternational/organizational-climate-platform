import { Waves } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { AuthCanvas, AuthCard, AuthHeadline } from './AuthCanvas'

/**
 * "Un momento…" — the AuthTransition artboard.
 *
 * ## Its three producers, and why they share one card
 *
 * `/auth/loading` is the route: the `redirect_uri` Google sends the browser back to, where
 * the wait between `accounts.google.com` and our own API happens. The sign-in and register
 * forms render the same card in place of themselves while their request is outstanding —
 * a whole-page replacement rather than an inline spinner, because the form behind it must
 * not be re-submittable while the first submit runs.
 *
 * `detail` is the one thing that differs, and it has to: "we are finishing your Google
 * sign-in" is a lie on the password path, and the artboard's own sentence is the Google
 * one because `/auth/loading` is the board it drew.
 *
 * ## The bar is decorative and says so
 *
 * Nothing here knows a percentage — there is one request outstanding and it is either done
 * or not — so a bar with a number on it would be invented. The artboard draws a track with
 * a segment in it, and that is what this is: `aria-hidden`, with `role="status"` and
 * `aria-live="polite"` on the wrapper so what is actually announced is the sentence under
 * it. `animate-pulse` is the one concession to it being a *wait*: a bar frozen at 38%
 * reads as a stuck upload.
 */
export function AuthTransitionCard({ detail }: { detail: string }) {
  const { t } = useTranslation()

  return (
    <AuthCanvas>
      <AuthCard>
        <AuthHeadline
          tile={<Waves aria-hidden="true" />}
          eyebrow={t('auth.next.transitionEyebrow')}
          title={t('auth.next.transitionTitle')}
          description={detail}
        />
        <div className="flex flex-col gap-3.5">
          <div role="status" aria-live="polite" className="flex flex-col gap-2">
            <span aria-hidden="true" className="flex h-1 overflow-hidden rounded-sm bg-surface-icon-box">
              {/* The segment's two percentages are geometry, not tokens — the same reason
                  `parts.tsx`'s `MiniBar` writes its width as a style rather than a class. */}
              <span
                className="block h-full animate-pulse rounded-sm bg-accent-blue"
                style={{ marginInlineStart: '22%', width: '38%' }}
              />
            </span>
            <span className="text-sm text-fg-tertiary">{t('auth.pendingHint')}</span>
          </div>
          <p className="m-0 text-sm text-fg-tertiary">{t('auth.next.transitionNote')}</p>
        </div>
      </AuthCard>
    </AuthCanvas>
  )
}
