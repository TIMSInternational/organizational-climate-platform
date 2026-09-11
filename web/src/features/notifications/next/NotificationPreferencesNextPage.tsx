import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router'
import { Check, Clock, Inbox, Lock, Mail, Smartphone } from 'lucide-react'
import { PageTopBar } from '../../../components/layout'
import { Alert, AlertDescription, Button, LoadingRegion, NetworkError, SkeletonText, Switch } from '../../../components/ui'
import { useTranslation, type TranslateFn } from '../../../i18n'
import { cn } from '../../../lib/cn'
import { CanvasChip, CanvasSelect, IconBox, Panel } from '../../org-structure/next/super/parts'
import AccountTabs from '../../profile/next/AccountTabs'
import { DIGEST_FREQUENCIES, type DigestFrequency, type NotificationPreferences } from '../api/notificationPreferences'
import { useNotificationPreferencesModel } from './useNotificationPreferencesModel'

type EmailKey = 'emailSurveys' | 'emailMicroclimates' | 'emailActionPlans' | 'emailReminders'
const EMAILS: readonly { key: EmailKey; name: string; description: string }[] = [
  { key: 'emailSurveys', name: 'notifications.next.prefs.surveys', description: 'notifications.preferences.emailSurveysDescription' },
  { key: 'emailMicroclimates', name: 'notifications.next.prefs.microclimates', description: 'notifications.preferences.emailMicroclimatesDescription' },
  { key: 'emailActionPlans', name: 'notifications.next.prefs.actionPlans', description: 'notifications.preferences.emailActionPlansDescription' },
  { key: 'emailReminders', name: 'notifications.next.prefs.reminders', description: 'notifications.preferences.emailRemindersDescription' },
]
const DIGEST_KEY: Readonly<Record<DigestFrequency, string>> = {
  daily: 'notifications.preferences.digestDaily',
  weekly: 'notifications.preferences.digestWeekly',
  monthly: 'notifications.preferences.digestMonthly',
  never: 'notifications.preferences.digestNever',
}
const DIGEST_PHRASE: Readonly<Record<DigestFrequency, string>> = {
  daily: 'notifications.next.prefs.digestDaily',
  weekly: 'notifications.next.prefs.digestWeekly',
  monthly: 'notifications.next.prefs.digestMonthly',
  never: 'notifications.next.prefs.digestNever',
}

const same = (a: NotificationPreferences, b: NotificationPreferences) =>
  EMAILS.every(({ key }) => a[key] === b[key]) && a.digestFrequency === b.digestFrequency

/** "los 4 correos configurables activados y resumen semanal", from what the account holds. */
export function savedSummary(t: TranslateFn, saved: NotificationPreferences): string {
  const on = EMAILS.filter(({ key }) => saved[key]).length
  const emails =
    on === EMAILS.length
      ? t('notifications.next.prefs.allOn', { count: on })
      : on === 0
        ? t('notifications.next.prefs.allOff')
        : t('notifications.next.prefs.someOn', { on, total: EMAILS.length })
  return t('notifications.next.prefs.summary', { emails, digest: t(DIGEST_PHRASE[saved.digestFrequency]) })
}

/**
 * `/settings/notifications` — the redesigned *Preferencias de notificaciones*
 * (NotificationPreferences artboard, 10 Sep), shared by every role. It replaced
 * `pages/NotificationPreferencesPage.tsx` on this route; that page stays unrouted as the
 * wiring reference.
 *
 * Channel × event as one compact table: the four configurable emails with their switch, the
 * in-app inbox beside each as the thing that never turns off, the account and security mail
 * that is always sent, and the digest frequency — with one "Guardar" (and "Descartar") that
 * only wake when something differs from what the account holds. Nothing is pre-filled from a
 * default: the table waits for the saved values. The platform sends no push and no SMS, so no
 * control offers them.
 */
export default function NotificationPreferencesNextPage() {
  const { t } = useTranslation()
  const state = useNotificationPreferencesModel()
  const [draft, setDraft] = useState<NotificationPreferences | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  useEffect(() => {
    if (state.saved && draft === null) setDraft(state.saved)
  }, [state.saved, draft])

  const dirty = state.saved !== null && draft !== null && !same(state.saved, draft)

  async function save() {
    if (!draft) return
    setSaving(true)
    setSaveError(null)
    setJustSaved(false)
    try {
      setDraft(await state.save(draft))
      setJustSaved(true)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSaving(false)
    }
  }

  function update(patch: Partial<NotificationPreferences>) {
    setJustSaved(false)
    setDraft((current) => (current ? { ...current, ...patch } : current))
  }

  return (
    <div className="flex flex-col gap-section">
      <div className="-mb-6">
        <PageTopBar
          eyebrow={t('notifications.preferences.eyebrow')}
          title={t('notifications.preferences.title')}
          description={t('notifications.next.prefs.description')}
          actions={
            state.status === 'ready' ? (
              <>
                <Button type="button" variant="outline" disabled={!dirty || saving} onClick={() => setDraft(state.saved)}>
                  {t('notifications.next.prefs.discard')}
                </Button>
                <Button type="button" variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
                  <Check aria-hidden="true" />
                  {t('notifications.next.prefs.save')}
                </Button>
              </>
            ) : undefined
          }
        />
      </div>
      <AccountTabs />
      {state.status === 'error' ? (
        <NetworkError title={t('notifications.preferences.loadError')} description={state.error ?? undefined} onRetry={state.retry} retryText={t('common.retry')} />
      ) : (
        <LoadingRegion loading={state.status === 'loading' || draft === null} label={t('common.loading')}>
          {state.saved === null || draft === null ? (
            <SkeletonText lines={6} />
          ) : (
            <div className="flex flex-col gap-4">
              {saveError && (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{saveError}</AlertDescription>
                </Alert>
              )}
              <p className="m-0 flex items-start gap-2 text-sm text-fg-secondary" data-slot="saved-state">
                <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-green-ink" />
                <span>
                  {justSaved ? t('notifications.preferences.saved') : null}
                  {justSaved ? ' ' : null}
                  {t('notifications.next.prefs.savedLine', { summary: savedSummary(t, state.saved) })}
                  {dirty ? ` ${t('notifications.next.prefs.unsaved')}` : ` ${t('notifications.next.prefs.nothingChanges')}`}
                </span>
              </p>
              <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_23.5rem]">
                <PreferencesTable draft={draft} onChange={update} />
                <HowItIsDecided />
              </div>
            </div>
          )}
        </LoadingRegion>
      )}
    </div>
  )
}

const TH = 'border-b border-line-default px-4 pb-2 pt-1 text-left text-2xs font-bold uppercase tracking-label whitespace-nowrap text-fg-tertiary'

function InApp() {
  const { t } = useTranslation()
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-fg-tertiary">
      <Inbox aria-hidden="true" className="size-3.5" />
      {t('notifications.next.prefs.inAppAlways')}
    </span>
  )
}

function PreferencesTable({ draft, onChange }: { draft: NotificationPreferences; onChange: (patch: Partial<NotificationPreferences>) => void }) {
  const { t } = useTranslation()
  const digestId = useId()
  return (
    <section aria-labelledby="prefs-table" className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line-default bg-surface-card shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pt-4 pb-2">
        <h2 id="prefs-table" className="m-0 text-2xl">
          {t('notifications.next.prefs.tableHeading')}
        </h2>
        <span className="text-xs text-fg-tertiary">{t('notifications.next.prefs.tableMeta')}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse">
          <thead>
            <tr>
              <th className={TH}>{t('notifications.next.prefs.colAviso')}</th>
              <th className={cn(TH, 'w-40')}>{t('notifications.next.prefs.colEmail')}</th>
              <th className={cn(TH, 'w-36')}>{t('notifications.next.prefs.colInApp')}</th>
            </tr>
          </thead>
          <tbody>
            {EMAILS.map(({ key, name, description }) => {
              const switchId = `pref-${key}`
              return (
                <tr key={key} data-pref={key} className="border-b border-line-light">
                  <td className="px-4 py-3 align-middle">
                    <label htmlFor={switchId} className="m-0 flex flex-col gap-0.5">
                      <span className="text-sm font-semibold text-fg-primary">{t(name)}</span>
                      <span className="text-xs leading-snug text-fg-tertiary">{t(description)}</span>
                    </label>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <span className="inline-flex items-center gap-2 text-sm text-fg-secondary">
                      <Switch
                        id={switchId}
                        checked={draft[key]}
                        onCheckedChange={(checked) => onChange({ [key]: checked })}
                        className="data-[state=checked]:bg-accent-green"
                      />
                      {draft[key] ? t('notifications.next.prefs.receives') : t('notifications.next.prefs.doesNotReceive')}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <InApp />
                  </td>
                </tr>
              )
            })}
            <tr className="border-b border-line-light">
              <td className="px-4 py-3 align-middle">
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-fg-primary">{t('notifications.next.prefs.systemName')}</span>
                  <span className="text-xs leading-snug text-fg-tertiary">{t('notifications.next.prefs.systemDescription')}</span>
                </span>
              </td>
              <td className="px-4 py-3 align-middle">
                <CanvasChip tone="neutral" icon={<Lock className="size-3" />} label={t('notifications.next.prefs.alwaysSent')} />
              </td>
              <td className="px-4 py-3 align-middle">
                <InApp />
              </td>
            </tr>
            <tr className="bg-surface-icon-box/60">
              <td className="px-4 py-3 align-middle">
                <label htmlFor={digestId} className="m-0 flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-fg-primary">{t('notifications.preferences.digestTitle')}</span>
                  <span className="text-xs leading-snug text-fg-tertiary">{t('notifications.preferences.digestDescription')}</span>
                </label>
              </td>
              <td className="px-4 py-3 align-middle" colSpan={2}>
                <CanvasSelect
                  id={digestId}
                  className="w-36"
                  value={draft.digestFrequency}
                  onChange={(event) => onChange({ digestFrequency: event.target.value as DigestFrequency })}
                >
                  {DIGEST_FREQUENCIES.map((frequency) => (
                    <option key={frequency} value={frequency}>
                      {t(DIGEST_KEY[frequency])}
                    </option>
                  ))}
                </CanvasSelect>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

function HowItIsDecided() {
  const { t } = useTranslation()
  const items = [
    { key: 'send', icon: <Clock />, lead: t('notifications.next.prefs.howSendLead'), text: t('notifications.next.prefs.howSendText') },
    { key: 'one', icon: <Mail />, lead: t('notifications.next.prefs.howOneLead'), text: '' },
    { key: 'inbox', icon: <Inbox />, lead: t('notifications.next.prefs.howInboxLead'), text: t('notifications.next.prefs.howInboxText') },
    { key: 'push', icon: <Smartphone />, lead: t('notifications.next.prefs.howPushLead'), text: t('notifications.next.prefs.howPushText') },
  ]
  return (
    <Panel
      labelledBy="prefs-how"
      heading={
        <h2 id="prefs-how" className="m-0 text-2xl">
          {t('notifications.next.prefs.howHeading')}
        </h2>
      }
    >
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {items.map((item) => (
          <li key={item.key} className="m-0 flex items-start gap-3">
            <IconBox size="sm">{item.icon}</IconBox>
            <p className="m-0 text-sm leading-snug text-fg-secondary">
              <b className="font-semibold text-fg-primary">{item.lead}</b>
              {item.text && ` ${item.text}`}
            </p>
          </li>
        ))}
      </ul>
      <p className="m-0 border-t border-line-light pt-3 text-sm text-fg-secondary">
        {t('notifications.next.prefs.howConsent')} <Link to="/settings/privacy">{t('profile.next.tabs.privacy')}</Link>.
      </p>
    </Panel>
  )
}
