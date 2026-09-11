import { useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, CircleAlert, Copy, Download, Lock } from 'lucide-react'
import { PageTopBar } from '../../../components/layout'
import { Alert, AlertDescription, Button, Table } from '../../../components/ui'
import { useTranslation } from '../../../i18n'
import { downloadTextFile } from '../../../lib/downloadTextFile'
import { cn } from '../../../lib/cn'
import { Panel } from '../../org-structure/next/super/parts'
import AccountTabs from './AccountTabs'
import { usePrivacyModel } from './usePrivacyModel'

const TH = 'border-b border-line-default bg-transparent px-3 pb-2 pt-1 text-2xs font-bold uppercase tracking-label whitespace-nowrap text-fg-tertiary'
const HELD = ['account', 'responses', 'demographics', 'notices', 'drafts', 'activity', 'authored'] as const
const CONSENTS = ['essential', 'analytics', 'marketing', 'personalization', 'thirdParties', 'demographics'] as const
const EMAILS = ['emailSurveys', 'emailMicroclimates', 'emailActionPlans', 'emailReminders'] as const
const ERASURE = [
  { key: 'removed', items: ['notices', 'activity', 'drafts', 'demographics', 'invitationDemographics'] },
  { key: 'unlinked', items: ['responses', 'account'] },
  { key: 'overwritten', items: ['surveyInvitations', 'microclimateInvitations', 'platformInvitations'] },
] as const
const DIGEST_PHRASE: Readonly<Record<string, string>> = {
  daily: 'notifications.next.prefs.digestDaily',
  weekly: 'notifications.next.prefs.digestWeekly',
  monthly: 'notifications.next.prefs.digestMonthly',
  never: 'notifications.next.prefs.digestNever',
}

/**
 * `/settings/privacy` — the redesigned *Privacidad* (PrivacySettings artboard, 10 Sep),
 * shared by every role. It replaced `pages/PrivacySettingsPage.tsx` on this route; that page
 * and its panels stay in the tree unrouted as the wiring reference.
 *
 * What the platform holds about the reader and why, the consent their account records, how an
 * erasure is asked for — and one action, "Descargar mis datos", which is the only thing that
 * reads `GET /gdpr/access` (an audited read) and hands the whole export over as a JSON file
 * (fetch + Blob through `downloadTextFile`, never an anchor). Nothing on this page erases:
 * `DELETE /gdpr/erase` is an administrator's action on someone else, never self-service.
 */
export default function PrivacyNextPage() {
  const { t } = useTranslation()
  const state = usePrivacyModel()
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copy, setCopy] = useState<'idle' | 'copied' | 'refused'>('idle')

  async function download() {
    setError(null)
    setDownloading(true)
    try {
      const subjectExport = await state.requestExport()
      // The date, not the instant: a colon is not a legal filename character on Windows.
      downloadTextFile(
        t('privacy.downloadFileName', { date: subjectExport.generatedAt.slice(0, 10) }),
        'application/json',
        JSON.stringify(subjectExport, null, 2),
        { byteOrderMark: false },
      )
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('privacy.next.downloadFailed'))
    } finally {
      setDownloading(false)
    }
  }

  async function copyIdentifiers() {
    if (!state.profile) return
    const { id, email, name } = state.profile
    try {
      await navigator.clipboard.writeText(
        [`${t('privacy.next.request.id')}: ${id}`, `${t('privacy.next.request.email')}: ${email}`, `${t('privacy.next.request.name')}: ${name}`].join('\n'),
      )
      setCopy('copied')
    } catch {
      // Never claim a copy the clipboard refused.
      setCopy('refused')
    }
  }

  const prefs = state.notifications
  const on = prefs ? EMAILS.filter((key) => prefs[key]).length : null

  return (
    <div className="flex flex-col gap-section">
      <div className="-mb-6">
        <PageTopBar
          eyebrow={t('privacy.eyebrow')}
          title={t('privacy.next.title')}
          description={t('privacy.next.description')}
          actions={
            <Button type="button" variant="primary" disabled={downloading} onClick={() => void download()}>
              <Download aria-hidden="true" />
              {downloading ? t('privacy.next.downloading') : t('privacy.next.download')}
            </Button>
          }
        />
      </div>
      <AccountTabs />

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <section aria-labelledby="privacy-held" className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line-default bg-surface-card shadow-sm">
        <div className="flex flex-col gap-1.5 px-4 pt-4 pb-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 id="privacy-held" className="m-0 text-2xl">
              {t('privacy.next.held.heading')}
            </h2>
            <span className="text-xs text-fg-tertiary">{t('privacy.next.held.meta')}</span>
          </div>
          <p className="m-0 max-w-measure text-xs leading-normal text-fg-secondary">{t('privacy.next.held.text')}</p>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[48rem] [&_[data-slot=table-container]]:overflow-visible">
            <Table aria-label={t('privacy.next.held.heading')} className="table-fixed">
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[25%]" />
                <col className="w-[15%]" />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th className={TH}>{t('privacy.next.held.colWhat')}</th>
                  <th className={TH}>{t('privacy.next.held.colLink')}</th>
                  <th className={TH}>{t('privacy.next.held.colBasis')}</th>
                  <th className={TH}>{t('privacy.next.held.colKept')}</th>
                </tr>
              </thead>
              <tbody>
                {HELD.map((key) => (
                  <tr key={key} className="border-b border-line-light last:border-b-0">
                    <td className="px-3 py-3 align-middle">
                      <span className="flex flex-col gap-0.5">
                        <span className="text-sm font-semibold text-fg-primary">{t(`privacy.next.held.${key}.name`)}</span>
                        <span className="text-xs leading-snug text-fg-tertiary">{t(`privacy.next.held.${key}.what`)}</span>
                      </span>
                    </td>
                    <td className="px-3 py-3 align-middle text-sm leading-snug text-fg-secondary">{t(`privacy.next.held.${key}.link`)}</td>
                    <td className="px-3 py-3 align-middle text-sm text-fg-secondary">{t(`privacy.next.held.${key}.basis`)}</td>
                    <td className="px-3 py-3 align-middle text-sm leading-snug text-fg-secondary">{t(`privacy.next.held.${key}.kept`)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </div>
      </section>

      <div data-slot="tracking-note" className="flex items-start gap-2.5 rounded-lg bg-accent-amber-soft px-4 py-3 text-sm leading-normal text-fg-secondary">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-accent-amber-ink" />
        <span>
          <b className="font-semibold text-fg-primary">{t('privacy.next.tracking.lead')}</b> {t('privacy.next.tracking.text')}{' '}
          {state.responsibleFor && state.responsibleFor.length > 0
            ? t('privacy.next.tracking.responsible', { codes: state.responsibleFor.join(', ') })
            : t('privacy.next.tracking.askByHand')}
        </span>
      </div>

      <Panel
        labelledBy="privacy-consent"
        heading={
          <h2 id="privacy-consent" className="m-0 text-2xl">
            {t('privacy.next.consent.heading')}
          </h2>
        }
        meta={t('privacy.next.consent.meta', { count: CONSENTS.length })}
      >
        <dl className="m-0 grid grid-cols-1 gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
          {CONSENTS.map((key) => (
            <div key={key} className="flex items-baseline justify-between gap-3 border-b border-line-light py-2">
              <dt className="text-sm text-fg-primary">{t(`privacy.next.consent.${key}`)}</dt>
              <dd className="m-0 text-xs text-fg-tertiary">{t('privacy.next.consent.inFile')}</dd>
            </div>
          ))}
        </dl>
        <p className="m-0 text-xs leading-normal text-fg-secondary">{t('privacy.next.consent.why')}</p>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-light pt-3">
          <span className="flex flex-wrap items-baseline gap-3">
            <span className="text-2xs font-bold uppercase tracking-label text-fg-tertiary">{t('privacy.next.consent.emailsLabel')}</span>
            <span className="text-sm text-fg-primary">
              {prefs && on !== null
                ? t('privacy.next.consent.emailsValue', {
                    on,
                    total: EMAILS.length,
                    digest: t(DIGEST_PHRASE[prefs.digestFrequency] ?? DIGEST_PHRASE.never),
                  })
                : t('privacy.next.consent.emailsUnknown')}
            </span>
          </span>
          <Link to="/settings/notifications" className="inline-flex items-center gap-1 text-xs text-fg-secondary">
            {t('profile.notificationPreferencesLink')}
            <ArrowRight aria-hidden="true" className="size-3" />
          </Link>
        </div>
      </Panel>

      <Panel
        labelledBy="privacy-erasure"
        heading={
          <h2 id="privacy-erasure" className="m-0 text-2xl">
            {t('privacy.next.erasure.heading')}
          </h2>
        }
        meta={t('privacy.next.erasure.meta')}
      >
        <div className="flex items-start gap-2.5 rounded-lg bg-surface-icon-box px-3.5 py-3 text-sm leading-normal text-fg-secondary">
          <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <b className="font-semibold text-fg-primary">{t('privacy.next.erasure.lead')}</b> {t('privacy.next.erasure.text')}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {ERASURE.map((group) => (
            <div key={group.key} className="flex flex-col gap-1.5">
              <p className="m-0 text-sm font-semibold text-fg-primary">{t(`privacy.next.erasure.${group.key}.title`)}</p>
              <p className="m-0 text-2xs text-fg-tertiary">{t(`privacy.next.erasure.${group.key}.sub`)}</p>
              <ul className="m-0 flex list-disc flex-col gap-1 pl-4 text-sm text-fg-secondary marker:text-fg-tertiary">
                {group.items.map((item) => (
                  <li key={item}>{t(`privacy.next.erasure.${group.key}.${item}`)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="m-0 text-sm text-fg-secondary">{t('privacy.next.erasure.notErased')}</p>
        <div className="flex flex-col gap-2 border-t border-line-light pt-3">
          <p className="m-0 text-2xs font-bold uppercase tracking-label text-fg-tertiary">{t('privacy.next.request.heading')}</p>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <dl className="m-0 grid grid-cols-[10rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-fg-tertiary">{t('privacy.next.request.id')}</dt>
              <dd className="m-0 min-w-0 truncate font-mono text-fg-primary">{state.profile?.id ?? '—'}</dd>
              <dt className="text-fg-tertiary">{t('privacy.next.request.email')}</dt>
              <dd className="m-0 min-w-0 truncate font-mono text-fg-primary">{state.profile?.email ?? '—'}</dd>
              <dt className="text-fg-tertiary">{t('privacy.next.request.name')}</dt>
              <dd className="m-0 min-w-0 truncate text-fg-primary">{state.profile?.name ?? '—'}</dd>
            </dl>
            <span className="flex items-center gap-2">
              {copy !== 'idle' && (
                <span role="status" className={cn('text-xs', copy === 'copied' ? 'text-accent-green-ink' : 'text-accent-red')}>
                  {copy === 'copied' ? t('privacy.next.request.copied') : t('privacy.next.request.copyRefused')}
                </span>
              )}
              <Button type="button" variant="outline" disabled={!state.profile} onClick={() => void copyIdentifiers()}>
                <Copy aria-hidden="true" />
                {t('privacy.next.request.copy')}
              </Button>
            </span>
          </div>
        </div>
      </Panel>
    </div>
  )
}
