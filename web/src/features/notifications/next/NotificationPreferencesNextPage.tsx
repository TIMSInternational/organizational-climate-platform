import { useEffect, useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Check, Clock, Inbox, Lock, Mail, Smartphone } from 'lucide-react'
import { PageHeader } from '../../../components/layout'
import { Alert, AlertDescription, Button, Chip, LoadingRegion, LoadingState, NetworkError, Switch } from '../../../components/ui'
import { useTranslation, type TranslateFn } from '../../../i18n'
import { CanvasSelect, IconBox, Panel } from '../../org-structure/next/super/parts'
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

/** The board's link inside a sentence: the sentence's own ink, underlined on hover or focus. */
const PROSE_LINK = 'text-fg-secondary hover:text-fg-primary hover:underline focus-visible:underline'

const same = (a: NotificationPreferences, b: NotificationPreferences) =>
  EMAILS.every(({ key }) => a[key] === b[key]) && a.digestFrequency === b.digestFrequency

/** "los 4 correos configurables activados y resumen semanal", from what the account holds. */
function savedSummary(t: TranslateFn, saved: NotificationPreferences): string {
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
 * that is always sent, and the digest frequency — with one "Guardar" and "Descartar" in the
 * list's own footer (as every block of Tu perfil saves in its own), live as the artboard draws them: "Guardar" sends the table as it stands (the saved values again when
 * nothing moved, which the server stores unchanged), "Descartar" puts back what the account
 * holds, and the line under the tabs says whether anything is unsaved. Nothing is pre-filled
 * from a default: the table waits for the saved values. The platform sends no push and no SMS,
 * so no control offers them.
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
      {/* One title for the three account pages (Tu perfil · Notificaciones · Privacidad), so
          switching tabs moves neither the title nor the actions; the tab says which page. */}
      <PageHeader className="mb-0" title={t('profile.next.tabs.label')} description={t('notifications.next.prefs.description')} />
      <AccountTabs />
      {state.status === 'error' ? (
        <NetworkError title={t('notifications.preferences.loadError')} description={state.error ?? undefined} onRetry={state.retry} retryText={t('common.retry')} />
      ) : (
        <LoadingRegion loading={state.status === 'loading' || draft === null} label={t('common.loading')}>
          {state.saved === null || draft === null ? (
            <LoadingState rows={6} />
          ) : (
            <div className="flex flex-col gap-4">
              {saveError && (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{saveError}</AlertDescription>
                </Alert>
              )}
              <p className="m-0 flex items-start gap-2 text-sm text-fg-secondary" data-slot="saved-state">
                <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-blue" />
                <span>
                  {justSaved ? t('notifications.preferences.saved') : null}
                  {justSaved ? ' ' : null}
                  {t('notifications.next.prefs.savedLine', { summary: savedSummary(t, state.saved) })}
                  {dirty ? ` ${t('notifications.next.prefs.unsaved')}` : ` ${t('notifications.next.prefs.nothingChanges')}`}
                </span>
              </p>
              <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_23.5rem]">
                <PreferencesTable
                  draft={draft}
                  onChange={update}
                  footer={
                    // Saved in the card's footer, as each block of Tu perfil is: the save
                    // belongs to the list it saves, not to the page header.
                    <>
                      <Button type="button" variant="ghost" disabled={saving} onClick={() => setDraft(state.saved)}>
                        {t('notifications.next.prefs.discard')}
                      </Button>
                      <Button type="button" variant="outline" disabled={saving} onClick={() => void save()}>
                        <Check aria-hidden="true" />
                        {t('notifications.next.prefs.save')}
                      </Button>
                    </>
                  }
                />
                <HowItIsDecided />
              </div>
            </div>
          )}
        </LoadingRegion>
      )}
    </div>
  )
}

/** One row of the grouped list: the notice and what it covers, its control trailing. */
function ListRow({ pref, children, control }: { pref?: string; children: ReactNode; control: ReactNode }) {
  return (
    <li
      data-pref={pref}
      className="m-0 flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line-default px-5 py-3 first:border-t-0"
    >
      <div className="flex min-w-0 flex-1 basis-60 flex-col gap-0.5">{children}</div>
      <div className="flex shrink-0 items-center gap-2.5">{control}</div>
    </li>
  )
}

/**
 * The email notices as a settings pane draws them — a grouped list, one row per notice, its
 * switch on the trailing edge with the word that says what it does (HIG `toggles.md` › Best
 * practices; `lists-and-tables.md`). The in-app column of the old table said the same thing on
 * every row ("No se apaga"), so it is said once, under the list.
 */
function PreferencesTable({
  draft,
  onChange,
  footer,
}: {
  draft: NotificationPreferences
  onChange: (patch: Partial<NotificationPreferences>) => void
  footer: ReactNode
}) {
  const { t } = useTranslation()
  const digestId = useId()
  return (
    <section aria-labelledby="prefs-table" className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line-panel bg-surface-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-5 pt-4.5 pb-3">
        <h2 id="prefs-table" className="m-0 text-2xl leading-tight">
          {t('notifications.next.prefs.tableHeading')}
        </h2>
        <span className="text-sm text-fg-tertiary">{t('notifications.next.prefs.tableMeta')}</span>
      </div>
      <ul data-slot="prefs-list" className="m-0 list-none border-y border-line-default p-0">
        {EMAILS.map(({ key, name, description }) => {
          const switchId = `pref-${key}`
          return (
            <ListRow
              key={key}
              pref={key}
              control={
                <>
                  <span className="text-sm text-fg-secondary">
                    {draft[key] ? t('notifications.next.prefs.receives') : t('notifications.next.prefs.doesNotReceive')}
                  </span>
                  {/* Blue when on, from the primitive: green is Fortaleza, never a switch. */}
                  <Switch id={switchId} checked={draft[key]} onCheckedChange={(checked) => onChange({ [key]: checked })} />
                </>
              }
            >
              <label htmlFor={switchId} className="m-0 flex flex-col gap-0.5 font-normal">
                <span className="text-base font-medium text-fg-primary">{t(name)}</span>
                <span className="text-sm leading-snug text-fg-tertiary">{t(description)}</span>
              </label>
            </ListRow>
          )
        })}
        <ListRow
          control={<Chip tone="neutral" icon={<Lock />} label={t('notifications.next.prefs.alwaysSent')} />}
        >
          <span className="text-base font-medium text-fg-primary">{t('notifications.next.prefs.systemName')}</span>
          <span className="text-sm leading-snug text-fg-tertiary">{t('notifications.next.prefs.systemDescription')}</span>
        </ListRow>
        <ListRow
          control={
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
          }
        >
          <label htmlFor={digestId} className="m-0 flex flex-col gap-0.5 font-normal">
            <span className="text-base font-medium text-fg-primary">{t('notifications.preferences.digestTitle')}</span>
            <span className="text-sm leading-snug text-fg-tertiary">{t('notifications.preferences.digestDescription')}</span>
          </label>
        </ListRow>
      </ul>
      <p data-slot="in-app-note" className="m-0 flex items-start gap-2 px-5 py-3 text-sm text-fg-tertiary">
        <Inbox aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {t('notifications.next.prefs.inAppFooter')}
      </p>
      <div data-slot="prefs-actions" className="flex flex-wrap justify-end gap-2 border-t border-line-light px-5 py-3">
        {footer}
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
      className="border-line-panel shadow-none py-4.5"
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
        {t('notifications.next.prefs.howConsent')}{' '}
        <Link to="/settings/privacy" className={PROSE_LINK}>
          {t('profile.next.tabs.privacy')}
        </Link>
        .
      </p>
    </Panel>
  )
}
