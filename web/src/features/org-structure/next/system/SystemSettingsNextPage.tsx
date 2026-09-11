import { useId, type ReactNode } from 'react'
import { Check, EyeOff, Mail, Shield, Sparkles, TriangleAlert } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../../i18n'
import { PageTopBar } from '../../../../components/layout'
import { ANONYMITY_FLOOR } from '../../../../components/charts'
import { Alert, AlertDescription, AlertTitle, Button, Chip, ErrorState, Input, SkeletonText, Switch } from '../../../../components/ui'
import { useHeaderSwitcherStandDown } from '../../../../company-context/useHeaderSwitcherStandDown'
import { calendarDayWithYear } from '../../../../lib/calendarDayWithYear'
import type { SystemSettingsData } from '../../api/systemSettings'
import { locksUsersOut, type SettingsDraft } from './settingsDerive'
import { useSystemSettingsModel } from './useSystemSettingsModel'

/**
 * `/admin/system-settings` — the redesigned Configuración del Sistema, which replaced
 * `SystemSettingsPage` on this route (the old page and its `SystemSettingsForm` stay in the
 * tree, unrouted, as the wiring reference), drawn as the SystemSettings artboard of the
 * per-role canvas (10 Sep).
 *
 * Grouped by concern: availability and session — the two groups Guardar writes, exactly the
 * five fields the old form wrote — then the password policy and the stored mail settings,
 * read-only, and the privacy facts stated as facts. One primary "Guardar", and "Descartar"
 * beside it to return the draft to what the server holds.
 *
 * Where the canvas's copy claimed more than the code does, the page says what the code does,
 * each claim measured:
 *
 * - The password policy is stored in system settings and enforced at sign-up, invitation
 *   acceptance and password change (`PasswordPolicies.cs:14-17`; `AuthEndpoints.cs:120`,
 *   `InvitationAcceptEndpoints.cs:62`, `ProfileEndpoints.cs:335`) — not "changed in the
 *   deployment". This screen does not edit it.
 * - The mail block is what the settings row stores; the transport reads the deployment's
 *   `Email:Provider` (`Program.cs:338-346`, `EmailOptions.cs`) and nothing reads
 *   `SystemEmailSettings` to send. So the page does not say "nothing goes out by email".
 * - The privacy floor is `SurveyResultsPrivacy.MinimumRespondents` (5) for every company;
 *   no company setting raises it (`CompanySettingsDtos.cs` has none).
 * - Attempts and timeout are stored and not applied — nothing outside the settings
 *   endpoints reads `MaxLoginAttempts` or `SessionTimeoutMinutes`.
 *
 * `super_admin` only on the server; a platform page no company scopes, so the header's
 * company switcher stands down while it is mounted.
 */
export default function SystemSettingsNextPage() {
  const { t } = useTranslation()
  const model = useSystemSettingsModel()
  useHeaderSwitcherStandDown()
  const { draft, settings } = model

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        model.save()
      }}
    >
      <PageTopBar
        eyebrow={t('navigation.systemAdministration')}
        title={t('navigation.systemSettings')}
        description={t('settings.next.description')}
        actions={
          settings && draft ? (
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={model.discard} disabled={model.saving}>
                {t('settings.next.discard')}
              </Button>
              <Button type="submit" variant="primary" disabled={model.saving}>
                <Check aria-hidden="true" />
                {model.saving ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          ) : undefined
        }
      />

      {model.loadError !== null ? (
        <ErrorState
          fill
          title={t('settings.loadError')}
          description={model.loadError || undefined}
          action={
            <Button type="button" onClick={model.reload}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : !settings || !draft ? (
        <SkeletonText lines={6} />
      ) : (
        <SettingsBody settings={settings} draft={draft} setDraft={model.setDraft} saved={model.saved} />
      )}

      {model.saveError !== null && (
        <Alert variant="destructive" role="alert" className="mt-6">
          <AlertDescription>{model.saveError || t('errors.generic')}</AlertDescription>
        </Alert>
      )}
    </form>
  )
}

function SettingsBody({
  settings,
  draft,
  setDraft,
  saved,
}: {
  settings: SystemSettingsData
  draft: SettingsDraft
  setDraft: (next: SettingsDraft) => void
  saved: boolean
}) {
  const { t, locale } = useTranslation()
  const policy = settings.passwordPolicy
  const mail = settings.emailSettings

  return (
    <div className="flex flex-col gap-6">
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel id="settings-availability" heading={t('settings.next.availabilityHeading')} meta={t('settings.next.availabilityMeta')}>
            <ToggleRow
              label={t('settings.next.loginEnabled')}
              help={t('settings.next.loginEnabledHelp')}
              checked={draft.loginEnabled}
              onChange={(value) => setDraft({ ...draft, loginEnabled: value })}
            />
            <ToggleRow
              label={t('settings.next.maintenanceMode')}
              help={t('settings.next.maintenanceModeHelp')}
              checked={draft.maintenanceMode}
              onChange={(value) => setDraft({ ...draft, maintenanceMode: value })}
            />
            <Field label={t('settings.next.maintenanceMessage')} help={t('settings.next.maintenanceMessageHelp')}>
              {(id, describedBy) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={draft.maintenanceMessage}
                  placeholder={t('settings.next.notSet')}
                  onChange={(event) => setDraft({ ...draft, maintenanceMessage: event.target.value })}
                />
              )}
            </Field>
            {locksUsersOut(draft) && (
              // The pending position, not the saved one: the warning appears while the
              // operator is deciding (the old form's rule, `SystemSettingsForm.tsx:71-73`).
              <Alert variant="warning" data-slot="lockout-warning">
                <TriangleAlert aria-hidden="true" />
                <AlertTitle>{t('settings.lockoutWarningTitle')}</AlertTitle>
                <AlertDescription>{t('settings.lockoutWarningDescription')}</AlertDescription>
              </Alert>
            )}
          </Panel>

          <Panel id="settings-session" heading={t('settings.next.sessionHeading')}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('settings.next.maxAttempts')}>
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    min={1}
                    className="font-mono"
                    value={draft.maxLoginAttempts}
                    onChange={(event) => setDraft({ ...draft, maxLoginAttempts: Number(event.target.value) })}
                  />
                )}
              </Field>
              <Field label={t('settings.next.timeout')}>
                {(id) => (
                  <span className="relative block">
                    <Input
                      id={id}
                      type="number"
                      min={1}
                      className="pr-20 font-mono"
                      value={draft.sessionTimeoutMinutes}
                      onChange={(event) => setDraft({ ...draft, sessionTimeoutMinutes: Number(event.target.value) })}
                    />
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 font-mono text-base text-fg-secondary"
                    >
                      {t('settings.next.minutesUnit')}
                    </span>
                  </span>
                )}
              </Field>
            </div>
            <WarningNote>{t('settings.next.notEnforced')}</WarningNote>
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel id="settings-password" heading={t('settings.next.passwordHeading')} meta={t('settings.next.readOnly')}>
            <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 text-sm">
              <dt className="text-fg-tertiary">{t('settings.next.minLength')}</dt>
              <dd className="m-0 font-mono text-sm text-fg-primary">
                {t('settings.next.minLengthValue', { count: policy.minLength })}
              </dd>
              <PolicyRow t={t} label={t('settings.next.upper')} on={policy.requireUppercase} />
              <PolicyRow t={t} label={t('settings.next.lower')} on={policy.requireLowercase} />
              <PolicyRow t={t} label={t('settings.next.number')} on={policy.requireNumbers} />
              <PolicyRow t={t} label={t('settings.next.special')} on={policy.requireSpecialChars} />
            </dl>
            <p className="m-0 text-xs text-fg-label">{t('settings.next.passwordNote')}</p>
          </Panel>

          <Panel id="settings-mail" heading={t('settings.next.mailHeading')} meta={t('settings.next.readOnly')}>
            <div className="flex flex-wrap items-center gap-2.5">
              <Chip
                tone={mail.smtpEnabled ? 'good' : 'warning'}
                icon={<Mail className="size-3" />}
                label={mail.smtpEnabled ? t('settings.next.smtpOn') : t('settings.next.smtpOff')}
              />
              <span className="text-sm text-fg-tertiary">{t('settings.next.mailStoredNote')}</span>
            </div>
            <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 text-sm">
              <MailRow t={t} label={t('settings.next.fromAddress')} value={mail.fromEmail} />
              <MailRow t={t} label={t('settings.next.smtpServer')} value={mail.smtpHost} />
              <dt className="text-fg-tertiary">{t('settings.next.port')}</dt>
              <dd className={mail.smtpPort === null ? 'm-0 text-fg-label' : 'm-0 font-mono text-fg-primary'}>
                {mail.smtpPort ?? '—'}
              </dd>
            </dl>
            <p className="m-0 text-xs text-fg-label">{t('settings.next.mailNote')}</p>
          </Panel>
        </div>
      </div>

      <Panel id="settings-privacy" heading={t('settings.next.privacyHeading')} meta={t('settings.next.privacyMeta')}>
        <div className="grid gap-5 md:grid-cols-3">
          <PrivacyFact icon={<Shield />} lead={t('settings.next.floorLead', { floor: ANONYMITY_FLOOR })} rest={t('settings.next.floorRest')} />
          <PrivacyFact icon={<EyeOff />} lead={t('settings.next.openTextLead')} rest={t('settings.next.openTextRest')} />
          <PrivacyFact icon={<Sparkles />} lead={t('settings.next.aiLead')} rest={t('settings.next.aiRest')} />
        </div>
      </Panel>

      <p data-slot="settings-footer" className="m-0 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-fg-tertiary">
          {t('settings.next.updatedOn', { date: calendarDayWithYear(Date.parse(settings.updatedAt), locale) })}
        </span>
        <span aria-hidden="true" className="text-fg-label">
          ·
        </span>
        <span className="text-fg-label">{t('settings.next.saveScope')}</span>
        {saved && (
          <span role="status" className="text-accent-green-ink">
            {t('settings.savedNote')}
          </span>
        )}
      </p>
    </div>
  )
}

function PolicyRow({ t, label, on }: { t: TranslateFn; label: string; on: boolean }) {
  return (
    <>
      <dt className="text-fg-tertiary">{label}</dt>
      <dd className="m-0">
        {on ? (
          <Chip tone="good" icon={<Check className="size-3" />} label={t('common.yes')} />
        ) : (
          <Chip tone="neutral" label={t('common.no')} />
        )}
      </dd>
    </>
  )
}

function MailRow({ t, label, value }: { t: TranslateFn; label: string; value: string | null }) {
  return (
    <>
      <dt className="text-fg-tertiary">{label}</dt>
      <dd className={value ? 'm-0 font-mono text-fg-primary' : 'm-0 text-fg-label'}>{value ?? t('settings.next.notConfigured')}</dd>
    </>
  )
}

function Panel({ id, heading, meta, children }: { id: string; heading: string; meta?: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby={id}
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-line-default bg-surface-card px-5 pt-4 pb-4.5 shadow-xs"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id={id} className="m-0 text-2xl">
          {heading}
        </h2>
        {meta && <span className="text-sm text-fg-tertiary">{meta}</span>}
      </div>
      {children}
    </section>
  )
}

function ToggleRow({
  label,
  help,
  checked,
  onChange,
}: {
  label: string
  help: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className="m-0 text-base font-semibold text-fg-primary">
          {label}
        </label>
        <span id={`${id}-help`} className="text-sm text-fg-tertiary">
          {help}
        </span>
      </div>
      {/* The canvas draws the enabled switch green. */}
      <Switch
        id={id}
        aria-describedby={`${id}-help`}
        checked={checked}
        onCheckedChange={onChange}
        className="mt-0.5 data-[state=checked]:bg-accent-green"
      />
    </div>
  )
}

function Field({
  label,
  help,
  children,
}: {
  label: string
  help?: string
  children: (id: string, describedBy: string | undefined) => ReactNode
}) {
  const id = useId()
  const helpId = help ? `${id}-help` : undefined
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="m-0 text-sm font-semibold text-fg-secondary">
        {label}
      </label>
      {children(id, helpId)}
      {help && (
        <span id={helpId} className="text-sm leading-snug text-fg-tertiary">
          {help}
        </span>
      )}
    </div>
  )
}

function WarningNote({ children }: { children: ReactNode }) {
  return (
    <div
      data-slot="warning-note"
      className="flex items-start gap-2.5 rounded-lg bg-accent-amber-soft px-3.5 py-3 text-sm leading-normal text-fg-secondary"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-accent-amber-ink" />
      <span>{children}</span>
    </div>
  )
}

function PrivacyFact({ icon, lead, rest }: { icon: ReactNode; lead: string; rest: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        aria-hidden="true"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-icon-box text-fg-secondary [&_svg]:size-4"
      >
        {icon}
      </span>
      <p className="m-0 text-sm text-fg-secondary">
        <strong className="font-semibold">{lead}</strong>
        {rest}
      </p>
    </div>
  )
}
