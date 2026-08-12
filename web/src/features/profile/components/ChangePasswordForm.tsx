import { useState, type FormEvent } from 'react'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  TextField,
} from '../../../components/ui'
import { useTranslation } from '../../../i18n'

export interface ChangePasswordFormProps {
  onSubmit: (currentPassword: string, newPassword: string) => Promise<void>
}

/**
 * The caller's own password change.
 *
 * ## Four properties this form must keep
 *
 * 1. **The current password is asked for, always.** It is what stops an unattended session
 *    from becoming a permanent account takeover, and it is verified server-side — this
 *    field is not a formality the client could skip.
 * 2. **Confirmation is checked here, not on the server.** A mistyped new password is a typo,
 *    not a policy violation, and the server has no way to tell the two apart: it receives
 *    one string. Catching it in the browser is the only place it can be caught at all.
 *    Emptiness, by contrast, is left to the inputs' own `required` — the browser blocks
 *    submission and says so in the reader's language, so a duplicate check here would be a
 *    branch nothing could reach.
 * 3. **Every field is cleared on success.** Leaving a password sitting in an input after the
 *    save has completed serves nothing and survives a screen share.
 * 4. **The reader is told this does not sign their other devices out** — always, before they
 *    submit, not only in a success message. See below.
 *
 * ## Other sessions ARE signed out. Issue #284, which has landed.
 *
 * This comment used to say the opposite, and so did the copy: the API had no revocation, so
 * a password change left every other session — including an attacker's — working for up to
 * 24 hours. That was true when this card was written and it is now false. `#284` (426431d,
 * PR #301) added `User.SecurityStamp`, rotates it in `PUT /profile/password`
 * (`ProfileEndpoints.cs`, "The revocation itself (#284)"), and `SecurityStampValidation`
 * refuses any token carrying a stale stamp. Every token minted before the change stops
 * validating immediately.
 *
 * Somebody changing their password on this form is quite likely doing it *because* they
 * think they were compromised, so the sentence stays — but as the reassurance it now is
 * rather than the warning it was. Telling that person their other devices are still signed
 * in, when they are not, is the worst direction for this particular error to point.
 *
 * **This is a cross-branch claim.** `#284` is on `main`; it is not on the UI integration
 * branch this card was redesigned on, where the old 24-hour behaviour is still the code. So
 * neither side was wrong on its own and nothing failed — the sentence only becomes a lie in
 * the merge. **This card must not ship to an API without `#284`.**
 *
 * The server's own rejection text (wrong current password, policy failures) is rendered
 * verbatim rather than replaced with a generic message: "Password must be at least 12
 * characters long, contain a number" is actionable and a translated "Invalid password" is
 * not. The policy is administrator-configurable, so the client cannot restate it.
 */
export default function ChangePasswordForm({ onSubmit }: ChangePasswordFormProps) {
  const { t } = useTranslation()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaved(false)

    // No empty-field check here: all three inputs are `required`, so the browser blocks
    // submission before this runs and shows its own message in the reader's language. A
    // second, unreachable check would be a branch no test could exercise honestly.
    if (newPassword !== confirmPassword) {
      setError(t('profile.passwordMismatch'))
      return
    }

    setSubmitting(true)
    try {
      await onSubmit(currentPassword, newPassword)
      setSaved(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('profile.passwordTitle')}</CardTitle>
        <CardDescription>{t('profile.passwordDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-panel-gap">
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {saved && (
            <Alert role="status">
              <AlertDescription>{t('profile.passwordSaved')}</AlertDescription>
            </Alert>
          )}

          <TextField
            label={t('profile.currentPassword')}
            type="password"
            value={currentPassword}
            required
            onChange={(next) => {
              setSaved(false)
              setCurrentPassword(next)
            }}
          />
          <TextField
            label={t('profile.newPassword')}
            type="password"
            value={newPassword}
            required
            onChange={(next) => {
              setSaved(false)
              setNewPassword(next)
            }}
          />
          <TextField
            label={t('profile.confirmPassword')}
            type="password"
            value={confirmPassword}
            required
            onChange={(next) => {
              setSaved(false)
              setConfirmPassword(next)
            }}
          />

          {/* Unconditional, and above the button rather than in the success alert: it is
              something to know before choosing to submit, not afterwards.

              The redesign gives it the recessed surface and a left rule in the warning
              tone so it reads as a standing property of this action rather than as a
              caption — but it is not an `Alert`, because nothing has gone wrong and an
              alert that is always on screen is one nobody reads. The wording itself is
              unchanged and must stay that way until #284 actually lands; see the note on
              this component. */}
          {/* `border-y border-r border-l-4` rather than `border border-l-4`: the
              shorthand sets all four widths at once and whether it or the left-only
              width wins would depend on the order Tailwind happens to emit them in.
              Naming the three plain sides separately leaves no property set twice. */}
          <p className="mb-0 rounded-lg border-y border-r border-l-4 border-line-light border-l-accent-amber bg-surface-icon-box p-3 text-sm text-fg-secondary">
            {t('profile.passwordOtherSessionsNote')}
          </p>

          <div>
            <Button type="submit" disabled={submitting}>
              {submitting ? t('common.saving') : t('profile.changePassword')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
