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
import type { Profile } from '../api/profile'

/** The wire role vocabulary is snake_case; the catalogue is camelCase. */
const ROLE_LABEL_KEY: Record<string, string> = {
  super_admin: 'users.superAdmin',
  company_admin: 'users.companyAdmin',
  leader: 'users.leader',
  supervisor: 'users.supervisor',
  employee: 'users.employee',
}

export interface ProfileDetailsFormProps {
  profile: Profile
  onSubmit: (name: string) => Promise<void>
}

/**
 * The account card: the person's own name, editable, over the facts they cannot change.
 *
 * ## Why email, role and department are read-only text rather than disabled inputs
 *
 * A disabled input still reads as "a setting, currently locked", which invites the question
 * "locked by what?" and gets no answer. These are not settings at all from here — email is
 * the login credential and the tenant key, role is the authorization claim, department is
 * an org-chart position — so they are rendered as what they are: facts about the account,
 * with a line saying an administrator is who changes them. The API has no field for any of
 * them either, so the page and the endpoint agree.
 */
export default function ProfileDetailsForm({ profile, onSubmit }: ProfileDetailsFormProps) {
  const { t, locale } = useTranslation()
  const [name, setName] = useState(profile.name)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const roleKey = ROLE_LABEL_KEY[profile.role]

  function formatDate(iso: string | null): string {
    if (!iso) return t('profile.never')
    const parsed = new Date(iso)
    // The raw value, not "Invalid Date": whatever the server sent is more useful to
    // whoever has to debug it. Same rule as `formatNotificationTimestamp`.
    if (Number.isNaN(parsed.getTime())) return iso
    return parsed.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaved(false)

    // Checked here as well as on the server. The server rejects a blank name rather than
    // ignoring it, and this turns that into an inline message instead of a round trip.
    if (name.trim() === '') {
      setError(t('profile.nameRequired'))
      return
    }

    setSubmitting(true)
    try {
      await onSubmit(name.trim())
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('profile.accountTitle')}</CardTitle>
        <CardDescription>{t('profile.accountDescription')}</CardDescription>
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
              <AlertDescription>{t('profile.detailsSaved')}</AlertDescription>
            </Alert>
          )}

          <TextField
            label={t('profile.name')}
            value={name}
            required
            maxLength={200}
            onChange={(next) => {
              setSaved(false)
              setName(next)
            }}
          />

          {/* The design's key/value block: labels in one narrow column, values in a
              wider one, the whole thing on the recessed surface so it reads as *given*
              rather than as more fields to fill in. A three-column grid with a 1/2 span
              rather than a fixed label width, which would be a raw length. */}
          <dl className="m-0 grid grid-cols-3 gap-x-inline gap-y-1 rounded-lg border border-line-light bg-surface-icon-box p-3 text-sm">
            <dt className="text-fg-tertiary">{t('profile.email')}</dt>
            <dd className="col-span-2 m-0 break-words font-medium text-fg-primary">
              {profile.email}
            </dd>

            <dt className="text-fg-tertiary">{t('profile.role')}</dt>
            <dd className="col-span-2 m-0 break-words font-medium text-fg-primary">
              {roleKey ? t(roleKey) : profile.role}
            </dd>

            <dt className="text-fg-tertiary">{t('profile.company')}</dt>
            <dd className="col-span-2 m-0 break-words font-medium text-fg-primary">
              {profile.companyName ?? t('common.none')}
            </dd>

            <dt className="text-fg-tertiary">{t('profile.department')}</dt>
            <dd className="col-span-2 m-0 break-words font-medium text-fg-primary">
              {profile.departmentName ?? t('common.none')}
            </dd>

            {/* Both dates are readings, so both are set in the mono face with tabular
                figures — the one typographic rule the redesign applies to every number
                it prints. `common.none`/`profile.never` are words, not readings, and
                the fallback below stays in the sans face for that reason. */}
            <dt className="text-fg-tertiary">{t('profile.memberSince')}</dt>
            <dd className="col-span-2 m-0 font-mono font-medium text-fg-primary tabular-nums">
              {formatDate(profile.createdAt)}
            </dd>

            <dt className="text-fg-tertiary">{t('profile.lastLogin')}</dt>
            <dd
              className={
                profile.lastLoginAt === null
                  ? 'col-span-2 m-0 font-medium text-fg-tertiary'
                  : 'col-span-2 m-0 font-mono font-medium text-fg-primary tabular-nums'
              }
            >
              {formatDate(profile.lastLoginAt)}
            </dd>
          </dl>

          <p className="text-sm text-fg-tertiary">{t('profile.adminManagedNote')}</p>

          <div>
            <Button type="submit" disabled={submitting}>
              {submitting ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
