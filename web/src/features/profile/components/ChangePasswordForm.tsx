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
 * 4. **The reader is told their other devices will be signed out** — always, before they
 *    submit, not only in a success message. See below.
 *
 * ## Other sessions are signed out. Issue #284.
 *
 * The API rotates the account's security stamp on a password change, so every token minted
 * before it — every other device, and anyone holding a stolen session — is refused from that
 * moment. This form's own session is replaced by the token the response carries; `ProfilePage`
 * stores it.
 *
 * Somebody changing their password on this form is quite likely doing it *because* they think
 * they were compromised, and whether the act ends that compromise is the single most useful
 * thing to know before submitting. So the disclosure stayed, with the fact reversed:
 * `profile.passwordOtherSessionsNote` said the opposite and was removed from both locales in
 * #284, and `profile.passwordSignsOutOtherDevices` replaced it in the same place.
 *
 * ## Resolved here, in the merge, which is the only place it was ever wrong
 *
 * This was a genuine cross-branch defect and both sides had predicted it. `#284` landed on
 * `main`; the redesign of this card happened on the UI integration branch, where the old
 * 24-hour behaviour was still the code and the old sentence was still true. **Neither side
 * was wrong on its own and no test failed on either.**
 *
 * The merge is where it bites, and in two ways at once. The sentence becomes a lie — telling
 * a possibly-compromised person their other devices are still signed in, when #284 has just
 * signed them out, is the worst direction for this particular error to point. And the key the
 * redesigned JSX rendered, `profile.passwordOtherSessionsNote`, was DELETED from both
 * catalogues by #284, so keeping the redesign's markup would have rendered a missing key.
 *
 * Resolution: `main`'s key and `main`'s fact, in the redesign's recessed surface — minus the
 * amber left rule, which the redesign chose while this was a caveat. It is reassurance now,
 * and a warning tone would argue with the sentence it frames.

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

              The redesign gives it the recessed surface so it reads as a standing property
              of this action rather than as a caption — but it is not an `Alert`, because
              nothing has gone wrong and an alert that is always on screen is one nobody
              reads.

              The amber left rule the redesign paired with this is deliberately NOT here.
              That accent was chosen while the sentence was a caveat ("your other devices
              stay signed in"). #284 reversed the fact, so the sentence is now reassurance,
              and a warning tone would argue with the words inside it. */}
          <p className="mb-0 rounded-lg border border-line-light bg-surface-icon-box p-3 text-sm text-fg-secondary">
            {t('profile.passwordSignsOutOtherDevices')}
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
