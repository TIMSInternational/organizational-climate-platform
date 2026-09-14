import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Check, CircleAlert, Clock, Lock, LogOut } from 'lucide-react'
import { PageTopBar } from '../../../components/layout'
import { Alert, AlertDescription, Button, ErrorState, Input, LoadingRegion, SkeletonText, Table } from '../../../components/ui'
import { LOCALES, isLocale, useTranslation, type TranslateFn } from '../../../i18n'
import { setAdminThemeMode } from '../../../theme/adminTheme'
import { calendarDay } from '../../../lib/calendarDay'
import { cn } from '../../../lib/cn'
import { CanvasChip, CanvasSelect, Field, Panel } from '../../org-structure/next/super/parts'
import { roleText } from '../../org-structure/next/super/labels'
import { PROFILE_THEMES, type Profile, type ProfileActivityEntry, type ProfileDisplayPreferences, type ProfileTheme } from '../api/profile'
import AccountTabs from './AccountTabs'
import { useProfileModel } from './useProfileModel'

const TH = 'border-b border-line-default bg-transparent px-3 pb-2 pt-1 text-2xs font-bold uppercase tracking-label whitespace-nowrap text-fg-tertiary'

/** Each language by its own name, as the artboard's picker and note write it: «English», «Español». */
const LANGUAGE_NAME: Readonly<Record<string, string>> = {
  en: 'profile.next.preferences.languageName.en',
  es: 'profile.next.preferences.languageName.es',
}
/** The same language as a noun inside a sentence of the screen's own language: «en español», «en inglés». */
const LANGUAGE_NOUN: Readonly<Record<string, string>> = {
  en: 'profile.next.preferences.languageNoun.en',
  es: 'profile.next.preferences.languageNoun.es',
}
/** The board's link inside a sentence: the sentence's own ink, underlined on hover or focus. */
const PROSE_LINK = 'text-fg-secondary hover:text-fg-primary hover:underline focus-visible:underline'
const THEME_KEY: Readonly<Record<ProfileTheme, string>> = {
  light: 'profile.next.preferences.themeLight',
  dark: 'profile.next.preferences.themeDark',
  system: 'profile.next.preferences.themeSystem',
}
const ACTIVITY_KEY: Readonly<Record<string, string>> = {
  'profile.update': 'profile.activityProfileUpdate',
  'profile.password_change': 'profile.activityPasswordChange',
  'profile.preferences_update': 'profile.activityPreferencesUpdate',
}

const isTheme = (value: string): value is ProfileTheme => (PROFILE_THEMES as readonly string[]).includes(value)

/** A day with its year and, when asked, the time — "10 sept 2026, 15:31". */
function stamp(iso: string, locale: string, withTime: boolean): string {
  const at = Date.parse(iso)
  // `now` at the epoch: the year is always printed, as the artboard does for these facts.
  const day = calendarDay(at, locale, 0)
  if (!withTime) return day
  const time = new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })
  return `${day}, ${time}`
}

/**
 * `/profile` — the redesigned *Tu perfil* (Profile artboard, 10 Sep), shared by every role:
 * every endpoint behind it resolves the caller from their own token and takes no user id.
 * It replaced `pages/ProfilePage.tsx` on this route; that page stays unrouted as the wiring
 * reference, and `useProfileModel` makes exactly its reads and writes.
 *
 * Four blocks, each saved on its own: the name (the one detail a person changes here, beside
 * the read-only facts an administrator manages), the display preferences (applied to this
 * screen only after the server accepts them), the password (hidden for an account with none)
 * and the account's own activity.
 */
export default function ProfileNextPage() {
  const { t } = useTranslation()
  const state = useProfileModel()

  return (
    <div className="flex flex-col gap-section">
      <div className="-mb-6">
        <PageTopBar eyebrow={t('profile.eyebrow')} title={t('profile.title')} description={t('profile.next.description')} />
      </div>
      <AccountTabs />
      {state.status === 'error' ? (
        <ErrorState title={t('profile.loadError')} description={state.error || undefined} />
      ) : (
        <LoadingRegion loading={state.status === 'loading'} label={t('common.loading')}>
          {state.profile === null ? (
            <SkeletonText lines={6} />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
                <DetailsCard profile={state.profile} onSave={state.saveName} />
                {state.preferences && (
                  <PreferencesCard preferences={state.preferences.display} onSave={state.saveDisplay} />
                )}
              </div>
              {state.profile.hasPassword && <PasswordCard onSave={state.savePassword} />}
              {state.activity && <ActivityCard entries={state.activity} />}
            </div>
          )}
        </LoadingRegion>
      )}
    </div>
  )
}

function Heading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="m-0 text-2xl">
      {children}
    </h2>
  )
}

function Fact({ term, children, mono = false, muted = false }: { term: string; children: ReactNode; mono?: boolean; muted?: boolean }) {
  return (
    <div className="grid grid-cols-[10rem_minmax(0,1fr)] items-baseline gap-3 py-1">
      <dt className="text-sm text-fg-tertiary">{term}</dt>
      <dd className={cn('m-0 min-w-0 truncate text-sm', mono && 'font-mono tabular-nums', muted ? 'text-fg-tertiary' : 'text-fg-primary')}>
        {children}
      </dd>
    </div>
  )
}

function DetailsCard({ profile, onSave }: { profile: Profile; onSave: (name: string) => Promise<void> }) {
  const { t, locale } = useTranslation()
  const [name, setName] = useState(profile.name)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const nameId = useId()
  const role = roleText(t, profile.role)
  const shown = name.trim() || profile.name

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaved(false)
    // Same rule as the old form: a whitespace-only name never reaches the API.
    if (!name.trim()) {
      setError(t('profile.nameRequired'))
      return
    }
    setError(null)
    setSaving(true)
    try {
      await onSave(name.trim())
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel labelledBy="profile-details" heading={<Heading id="profile-details">{t('profile.accountTitle')}</Heading>} meta={t('profile.next.details.meta')}>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3.5" noValidate>
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {saved && (
          <Alert variant="success">
            <AlertDescription>{t('profile.detailsSaved')}</AlertDescription>
          </Alert>
        )}
        <Field fieldLabel={t('profile.name')} htmlFor={nameId} required>
          <Input id={nameId} value={name} onChange={(event) => setName(event.target.value)} className="w-full" />
        </Field>
        <div className="grid grid-cols-1 items-center gap-3 rounded-lg border border-line-light bg-surface-icon-box p-3 sm:grid-cols-[minmax(0,1fr)_15.5rem]">
          <p className="m-0 text-xs leading-normal text-fg-secondary">{t('profile.next.details.preview')}</p>
          <div data-slot="sidebar-preview" aria-hidden="true" className="flex items-center gap-2.5 rounded-md bg-surface-shell px-3 py-2.5">
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-fg-on-accent/15 text-2xs font-semibold text-fg-on-accent">
              {shown.charAt(0).toUpperCase()}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold text-fg-on-accent">{shown}</span>
              <span className="truncate text-2xs text-fg-on-accent/70">{role}</span>
            </span>
          </div>
        </div>
        <dl className="m-0 flex flex-col">
          <Fact term={t('profile.email')} mono>
            {profile.email}
          </Fact>
          <Fact term={t('profile.role')}>{role}</Fact>
          {profile.companyName && <Fact term={t('profile.company')}>{profile.companyName}</Fact>}
          <Fact term={t('profile.department')} muted={!profile.departmentName}>
            {profile.departmentName ?? t('profile.next.details.noDepartment')}
          </Fact>
          <Fact term={t('profile.memberSince')} mono>
            {stamp(profile.createdAt, locale, false)}
          </Fact>
          {profile.lastLoginAt ? (
            <Fact term={t('profile.lastLogin')} mono>
              {stamp(profile.lastLoginAt, locale, true)}
            </Fact>
          ) : (
            <Fact term={t('profile.lastLogin')} muted>
              {t('profile.never')}
            </Fact>
          )}
        </dl>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-light pt-3">
          <span className="text-xs text-fg-tertiary">{t('profile.adminManagedNote')}</span>
          <Button type="submit" variant="outline" disabled={saving}>
            <Check aria-hidden="true" />
            {t('profile.next.save')}
          </Button>
        </div>
      </form>
    </Panel>
  )
}

function PreferencesCard({
  preferences,
  onSave,
}: {
  preferences: ProfileDisplayPreferences
  onSave: (values: ProfileDisplayPreferences) => Promise<void>
}) {
  const { t, locale, setLocale } = useTranslation()
  const [values, setValues] = useState(preferences)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const ids = { language: useId(), theme: useId(), timezone: useId() }
  const storedName = LANGUAGE_NAME[preferences.language] ? t(LANGUAGE_NAME[preferences.language]) : preferences.language
  const storedNoun = LANGUAGE_NOUN[preferences.language] ? t(LANGUAGE_NOUN[preferences.language]) : preferences.language
  const screenNoun = LANGUAGE_NOUN[locale] ? t(LANGUAGE_NOUN[locale]) : locale

  function update(patch: Partial<ProfileDisplayPreferences>) {
    setSaved(false)
    setValues((current) => ({ ...current, ...patch }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaved(false)
    setSaving(true)
    try {
      await onSave(values)
      setSaved(true)
      // Only after the server has accepted them, as the old form: applying first would leave
      // the app in a language the stored preference disagrees with if the save then failed.
      if (isLocale(values.language)) setLocale(values.language)
      if (isTheme(values.theme)) setAdminThemeMode(values.theme)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel labelledBy="profile-preferences" heading={<Heading id="profile-preferences">{t('profile.preferencesTitle')}</Heading>} meta={t('profile.next.preferences.meta')}>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3.5">
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {saved && (
          <Alert variant="success">
            <AlertDescription>{t('profile.preferencesSaved')}</AlertDescription>
          </Alert>
        )}
        <Field fieldLabel={t('profile.language')} htmlFor={ids.language} helper={t('profile.next.preferences.languageHelper')}>
          <CanvasSelect id={ids.language} className="w-full" value={values.language} onChange={(event) => update({ language: event.target.value })}>
            {LOCALES.map((code) => (
              <option key={code} value={code}>
                {LANGUAGE_NAME[code] ? t(LANGUAGE_NAME[code]) : code}
              </option>
            ))}
          </CanvasSelect>
        </Field>
        <div className="grid grid-cols-1 items-start gap-x-4 gap-y-3 sm:grid-cols-2">
          <Field fieldLabel={t('profile.next.preferences.theme')} htmlFor={ids.theme}>
            <CanvasSelect id={ids.theme} className="w-full" value={values.theme} onChange={(event) => update({ theme: event.target.value })}>
              {PROFILE_THEMES.map((theme) => (
                <option key={theme} value={theme}>
                  {t(THEME_KEY[theme])}
                </option>
              ))}
            </CanvasSelect>
          </Field>
          <Field fieldLabel={t('profile.timezone')} htmlFor={ids.timezone} helper={t('profile.next.preferences.timezoneHelper')}>
            <Input id={ids.timezone} value={values.timezone} onChange={(event) => update({ timezone: event.target.value })} className="w-full" />
          </Field>
        </div>
        {preferences.language !== locale && (
          <div data-slot="stored-preferences" className="flex items-start gap-2.5 rounded-lg bg-accent-amber-soft px-3.5 py-3 text-xs leading-normal text-fg-secondary">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-accent-amber-ink" />
            <span>
              <b className="font-semibold text-fg-primary">
                {t('profile.next.preferences.storedLead', { language: storedName, timezone: preferences.timezone })}
              </b>{' '}
              {t('profile.next.preferences.storedDiffers', { screen: screenNoun, language: storedNoun })}
            </span>
          </div>
        )}
        <p className="m-0 text-xs text-fg-secondary">
          <Link to="/settings/notifications" className={PROSE_LINK}>
            {t('profile.notificationPreferencesLink')}
          </Link>{' '}
          {t('profile.notificationPreferencesNote')}
        </p>
        <div className="flex justify-end border-t border-line-light pt-3">
          <Button type="submit" variant="outline" disabled={saving}>
            <Check aria-hidden="true" />
            {t('profile.next.save')}
          </Button>
        </div>
      </form>
    </Panel>
  )
}

function PasswordCard({ onSave }: { onSave: (currentPassword: string, newPassword: string) => Promise<void> }) {
  const { t } = useTranslation()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const ids = { current: useId(), next: useId(), confirm: useId() }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaved(false)
    if (next !== confirm) {
      setError(t('profile.passwordMismatch'))
      return
    }
    setError(null)
    setSaving(true)
    try {
      await onSave(current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      setSaved(true)
    } catch (err) {
      // The server's own words — it says which rule the new password broke.
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel labelledBy="profile-password" heading={<Heading id="profile-password">{t('profile.passwordTitle')}</Heading>} meta={t('profile.next.password.meta')}>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3.5">
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {saved && (
          <Alert variant="success">
            <AlertDescription>{t('profile.passwordSaved')}</AlertDescription>
          </Alert>
        )}
        <div className="grid grid-cols-1 items-start gap-x-4 gap-y-3 md:grid-cols-3">
          <Field fieldLabel={t('profile.currentPassword')} htmlFor={ids.current} required>
            <Input id={ids.current} type="password" autoComplete="current-password" required value={current} onChange={(event) => setCurrent(event.target.value)} className="w-full" />
          </Field>
          <Field fieldLabel={t('profile.newPassword')} htmlFor={ids.next} required>
            <Input id={ids.next} type="password" autoComplete="new-password" required value={next} onChange={(event) => setNext(event.target.value)} className="w-full" />
          </Field>
          <Field fieldLabel={t('profile.confirmPassword')} htmlFor={ids.confirm} required>
            <Input id={ids.confirm} type="password" autoComplete="new-password" required value={confirm} onChange={(event) => setConfirm(event.target.value)} className="w-full" />
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-light pt-3">
          <span className="inline-flex items-center gap-2 text-xs text-fg-secondary">
            <LogOut aria-hidden="true" className="size-3.5 shrink-0 text-fg-tertiary" />
            {t('profile.next.password.signsOut')}
          </span>
          <Button type="submit" variant="outline" disabled={saving}>
            <Lock aria-hidden="true" />
            {t('profile.changePassword')}
          </Button>
        </div>
      </form>
    </Panel>
  )
}

function eventLabel(t: TranslateFn, entry: ProfileActivityEntry): string {
  const key = ACTIVITY_KEY[entry.action]
  return key ? t(key) : entry.action
}

function ActivityCard({ entries }: { entries: readonly ProfileActivityEntry[] }) {
  const { t, locale } = useTranslation()
  return (
    <section aria-labelledby="profile-activity" className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line-default bg-surface-card shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pt-4 pb-2">
        <Heading id="profile-activity">{t('profile.activityTitle')}</Heading>
        <span className="text-xs text-fg-tertiary">{t('profile.next.activity.meta')}</span>
      </div>
      <div className="overflow-x-auto">
        <Table aria-label={t('profile.activityTitle')}>
          <thead>
            <tr>
              <th className={cn(TH, 'w-56')}>{t('profile.activityWhen')}</th>
              <th className={TH}>{t('profile.activityWhat')}</th>
              <th className={cn(TH, 'w-32 text-right')}>{t('profile.activityResult')}</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-3">
                  <span className="flex items-start gap-2 text-sm text-fg-secondary">
                    <Clock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-fg-tertiary" />
                    {t('profile.next.activity.empty')}
                  </span>
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="min-w-0 px-3 py-2.5 font-mono text-xs tabular-nums text-fg-secondary">{stamp(entry.timestamp, locale, true)}</td>
                  <td className="px-3 py-2.5 text-sm text-fg-primary">{eventLabel(t, entry)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <CanvasChip
                      tone={entry.success ? 'good' : 'critical'}
                      label={entry.success ? t('profile.activitySucceeded') : t('profile.activityFailed')}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </div>
    </section>
  )
}
