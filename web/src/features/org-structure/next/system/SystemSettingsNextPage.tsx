import { useId, type ReactNode } from 'react'
import { Check, EyeOff, Info, Mail, Shield, TriangleAlert } from 'lucide-react'
import { RailInsightsIcon } from '../../../../navigation/railIcons'
import { useTranslation, type TranslateFn } from '../../../../i18n'
import { PageHeader } from '../../../../components/layout'
import { ANONYMITY_FLOOR, SINGLE_SEGMENT_FLOOR } from '../../../../components/charts'
import { Alert, AlertDescription, Button, Chip, ErrorState, Input, LoadingState, Note, Switch } from '../../../../components/ui'
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
 * - The privacy floor is stated as ruled (`docs/decisions/privacy-floor-is-three.md`): 3 for a
 *   cross, the whole survey, public links and a leader's own team, and 1 for a single
 *   department or demographic value shown to an administrator. Both numbers come from
 *   `ANONYMITY_FLOOR` and `SINGLE_SEGMENT_FLOOR` rather than the copy, because the floor has
 *   moved once (5 → 3, ruled 2026-10-13). No company setting raises it
 *   (`CompanySettingsDtos.cs` has none).
 * - Verbatim open text leaves in one place, the super-admin response workbook
 *   (`docs/decisions/who-may-see-an-individual-answer.md` §6), and the privacy card says so
 *   rather than "never".
 * - `SessionTimeoutMinutes` IS applied, and this note used to say it was not: it is the
 *   lifetime of every token the API mints (`SessionWindows.Next` →
 *   `AuthEndpoints.IssueTokenForAsync` → `JwtTokenService`), so an idle session ends after
 *   it, and `IdleSessionGuard` warns the reader first. `MaxLoginAttempts` is still stored
 *   and not applied — nothing outside the settings endpoints reads it.
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
      <PageHeader
        eyebrow={t('navigation.systemAdministration')}
        title={t('navigation.systemSettings')}
        description={t('settings.next.description')}
        actions={
          settings && draft ? (
            <Button type="button" variant="outline" onClick={model.discard} disabled={model.saving}>
              {t('settings.next.discard')}
            </Button>
          ) : undefined
        }
        primaryAction={
          settings && draft ? (
            <Button type="submit" variant="primary" disabled={model.saving}>
              <Check aria-hidden="true" />
              {model.saving ? t('common.saving') : t('common.save')}
            </Button>
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
        <LoadingState rows={6} />
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
  const timeoutUnitId = useId()

  return (
    <div className="flex flex-col gap-6">
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel id="settings-availability" heading={t('settings.next.availabilityHeading')} meta={t('settings.next.availabilityMeta')}>
            {/* A grouped list, as a settings pane draws one: each switch on its own row, a
                hairline between rows (HIG `toggles.md` › Best practices). */}
            <div data-slot="settings-list" className="-mx-5 flex flex-col border-y border-line-default">
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
            </div>
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
              // A neutral note with the warning glyph and its title: amber is a result area.
              <Note data-slot="lockout-warning" role="alert" icon={<TriangleAlert />}>
                <p className="m-0 font-semibold">{t('settings.lockoutWarningTitle')}</p>
                <p className="m-0 text-sm text-fg-secondary">{t('settings.lockoutWarningDescription')}</p>
              </Note>
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
                    className="tabular-nums"
                    value={draft.maxLoginAttempts}
                    onChange={(event) => setDraft({ ...draft, maxLoginAttempts: Number(event.target.value) })}
                  />
                )}
              </Field>
              <Field label={t('settings.next.timeout')}>
                {(id) => (
                  // The unit trails the field as its own word, in the body face: the field keeps
                  // its own focus ring, and the unit reaches a screen reader as the description.
                  <span className="flex items-center gap-2.5">
                    <Input
                      id={id}
                      type="number"
                      min={1}
                      aria-describedby={timeoutUnitId}
                      className="min-w-0 flex-1 tabular-nums"
                      value={draft.sessionTimeoutMinutes}
                      onChange={(event) => setDraft({ ...draft, sessionTimeoutMinutes: Number(event.target.value) })}
                    />
                    <span id={timeoutUnitId} data-slot="timeout-unit" className="shrink-0 text-base text-fg-secondary">
                      {t('settings.next.minutesUnit')}
                    </span>
                  </span>
                )}
              </Field>
            </div>
            <Note data-slot="session-note" icon={<Info />} className="text-sm text-fg-secondary">
              {t('settings.next.notEnforced')}
            </Note>
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel id="settings-password" heading={t('settings.next.passwordHeading')} meta={t('settings.next.readOnly')}>
            <dl className="-mx-5 m-0 flex flex-col border-y border-line-default">
              <ListFact label={t('settings.next.minLength')}>
                <span className="text-base tabular-nums text-fg-primary">{t('settings.next.minLengthValue', { count: policy.minLength })}</span>
              </ListFact>
              <PolicyRow t={t} label={t('settings.next.upper')} on={policy.requireUppercase} />
              <PolicyRow t={t} label={t('settings.next.lower')} on={policy.requireLowercase} />
              <PolicyRow t={t} label={t('settings.next.number')} on={policy.requireNumbers} />
              <PolicyRow t={t} label={t('settings.next.special')} on={policy.requireSpecialChars} />
            </dl>
            <p className="m-0 text-sm text-fg-tertiary">{t('settings.next.passwordNote')}</p>
          </Panel>

          <Panel id="settings-mail" heading={t('settings.next.mailHeading')} meta={t('settings.next.readOnly')}>
            <div className="flex flex-wrap items-center gap-2.5">
              {/* A stored switch, not a result: the neutral chip carries the word and the glyph. */}
              <Chip
                tone="neutral"
                icon={<Mail />}
                label={mail.smtpEnabled ? t('settings.next.smtpOn') : t('settings.next.smtpOff')}
              />
              <span className="text-sm text-fg-tertiary">{t('settings.next.mailStoredNote')}</span>
            </div>
            <dl className="-mx-5 m-0 flex flex-col border-y border-line-default">
              <MailRow t={t} label={t('settings.next.fromAddress')} value={mail.fromEmail} />
              <MailRow t={t} label={t('settings.next.smtpServer')} value={mail.smtpHost} />
              <ListFact label={t('settings.next.port')}>
                <span className={mail.smtpPort === null ? 'text-base text-fg-tertiary' : 'text-base tabular-nums text-fg-primary'}>
                  {mail.smtpPort ?? '—'}
                </span>
              </ListFact>
            </dl>
            <p className="m-0 text-sm text-fg-tertiary">{t('settings.next.mailNote')}</p>
          </Panel>
        </div>
      </div>

      <Panel id="settings-privacy" heading={t('settings.next.privacyHeading')} meta={t('settings.next.privacyMeta')}>
        <div className="grid gap-5 md:grid-cols-3">
          {/* The floor as ruled (`docs/decisions/privacy-floor-is-three.md`): 3 for crosses, the
              whole survey, public links and a leader's own team; a single department or value is
              shown to administrators from 1. The old line claimed one floor "for every group". */}
          <PrivacyFact
            icon={<Shield />}
            lead={t('settings.next.floorRuleLead', { floor: ANONYMITY_FLOOR })}
            rest={t('settings.next.floorRuleRest', { floor: ANONYMITY_FLOOR, single: SINGLE_SEGMENT_FLOOR })}
          />
          {/* Verbatim text leaves in one place only, the super-admin response workbook
              (`docs/decisions/who-may-see-an-individual-answer.md` §6); the old line said never. */}
          <PrivacyFact icon={<EyeOff />} lead={t('settings.next.openTextRuleLead')} rest={t('settings.next.openTextRuleRest')} />
          <PrivacyFact icon={<RailInsightsIcon />} lead={t('settings.next.aiLead')} rest={t('settings.next.aiRest')} />
        </div>
      </Panel>

      <p data-slot="settings-footer" className="m-0 flex flex-wrap items-center gap-2 text-sm">
        <span className="tabular-nums text-fg-tertiary">
          {t('settings.next.updatedOn', { date: calendarDayWithYear(Date.parse(settings.updatedAt), locale) })}
        </span>
        <span aria-hidden="true" className="text-fg-tertiary">
          ·
        </span>
        <span className="text-fg-tertiary">{t('settings.next.saveScope')}</span>
        {saved && (
          <span role="status" className="inline-flex items-center gap-1.5 font-semibold text-fg-primary">
            <Check aria-hidden="true" className="size-4 text-accent-blue" />
            {t('settings.savedNote')}
          </span>
        )}
      </p>
    </div>
  )
}

/** One row of a grouped read-only list: the term on the leading edge, the value trailing. */
function ListFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 border-t border-line-default px-5 py-2 first:border-t-0">
      <dt className="text-base text-fg-secondary">{label}</dt>
      <dd className="m-0 min-w-0 text-right">{children}</dd>
    </div>
  )
}

function PolicyRow({ t, label, on }: { t: TranslateFn; label: string; on: boolean }) {
  return (
    <ListFact label={label}>
      {/* Gray chips: a rule that is on is a fact, not a result. The tick and the word say it. */}
      {on ? <Chip tone="neutral" icon={<Check />} label={t('common.yes')} /> : <Chip tone="neutral" label={t('common.no')} />}
    </ListFact>
  )
}

function MailRow({ t, label, value }: { t: TranslateFn; label: string; value: string | null }) {
  return (
    <ListFact label={label}>
      {/* An address and a host are tokens, so they keep the code face. */}
      <span className={value ? 'break-all font-mono text-sm text-fg-primary' : 'text-base text-fg-tertiary'}>
        {value ?? t('settings.next.notConfigured')}
      </span>
    </ListFact>
  )
}

/** The `.card` of `occ.css`: 12px radius, the panel hairline, no shadow, 18px × 20px. */
function Panel({ id, heading, meta, children }: { id: string; heading: string; meta?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3.5 rounded-xl border border-line-panel bg-surface-card px-5 py-4.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={id} className="m-0 text-2xl leading-tight">
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
    <div className="flex min-h-13 items-start justify-between gap-4 border-t border-line-default px-5 py-3 first:border-t-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className="m-0 text-base font-medium text-fg-primary">
          {label}
        </label>
        <span id={`${id}-help`} className="text-sm text-fg-tertiary">
          {help}
        </span>
      </div>
      {/* Blue when on, from the primitive: green is Fortaleza, never a switch. */}
      <Switch id={id} aria-describedby={`${id}-help`} checked={checked} onCheckedChange={onChange} className="mt-0.5" />
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

function PrivacyFact({ icon, lead, rest }: { icon: ReactNode; lead: string; rest: string }) {
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-fill-subtle text-fg-secondary [&_svg]:size-4"
      >
        {icon}
      </span>
      <p className="m-0 text-sm text-fg-secondary">
        <strong className="font-semibold text-fg-primary">{lead}</strong> {rest}
      </p>
    </div>
  )
}
