import { useId, useState, type ReactNode } from 'react'
import { useParams } from 'react-router'
import { Check, FileText, Upload } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../../i18n'
import { PageTopBar } from '../../../../components/layout'
import { ANONYMITY_FLOOR } from '../../../../components/charts'
import { Button, EmptyState, Input, NetworkError, SkeletonText, Switch } from '../../../../components/ui'
import { readViewerClaims, useViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { updateCompanySettings } from '../../api/companySettings'
import { surveyFrequencyLabelKey } from '../../labels'
import { CanvasChip, CanvasSelect, Field, Panel } from '../super/parts'
import {
  HEX_COLOUR,
  changesOf,
  draftOf,
  retentionOptions,
  timezoneOptions,
  utcOffset,
  type SettingsDraft,
} from './derive'
import { useCompanySettingsModel, type CompanySettingsModel } from './useCompanySettingsModel'

const DASH = '—'
const LANGUAGES = ['es', 'en']
const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly']
const K = 'companySettings.next'

/** The artboard's read-only box: a 32px field that is a reading, not a control. */
function Readout({ children, mono = false }: { children: ReactNode; mono?: boolean }) {
  return (
    <div
      data-slot="settings-readout"
      className={`flex h-control-lg min-w-0 items-center truncate rounded-md border border-line-default bg-surface-input px-2.5 text-base text-fg-primary${mono ? ' font-mono text-sm tabular-nums' : ''}`}
    >
      {children}
    </div>
  )
}

function retentionLabel(t: TranslateFn, locale: string, days: number): string {
  if (days % 365 !== 0) return t(`${K}.retentionDays`, { days: new Intl.NumberFormat(locale).format(days) })
  const years = days / 365
  return years === 1 ? t(`${K}.retentionYear`) : t(`${K}.retentionYears`, { years })
}

/** The key for `count`: its singular when the count is one, the plural otherwise. */
function byCount(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

function frequencyHelpKey(frequency: string): string {
  return FREQUENCIES.includes(frequency) ? `${K}.frequencyHelp.${frequency}` : `${K}.frequencyHelp.other`
}

/**
 * `/admin/companies/:id` for a company administrator — the CompanySettings artboard.
 *
 * What every new survey inherits (language, cadence, anonymity, retention, time zone), the
 * brand its invitations carry, and the company it belongs to, saved together by one button.
 * The language control is the reason this screen exists (triage row "Configuración de
 * empresa", P0): `PUT /admin/companies/{id}/settings` has always accepted `language` and no
 * screen offered it, so a Spanish tenant could not stop its surveys starting in English.
 *
 * Roles, as the server rules them: the settings `PUT` admits `Roles.Admin` on their OWN
 * company (`CompanyEndpoints.cs`, `UpdateSettingsAsync`), which is `canManageOrg` plus the
 * claim naming this company. Anyone else is told so and nothing is requested. Name and country
 * are `PUT /admin/companies/{id}`, super-admin only, so for this viewer they are readings.
 */
export default function CompanySettingsNextView() {
  const { t } = useTranslation()
  const { id = '' } = useParams<{ id: string }>()
  const capabilities = useViewerCapabilities()
  const allowed = capabilities.canManageOrg && readViewerClaims().companyId === id
  const state = useCompanySettingsModel(allowed ? id : null)
  const [saved, setSaved] = useState(false)
  const header = { title: t(`${K}.title`), description: t(`${K}.description`) }
  const crumbs = [{ label: t('navigation.companyAdministration') }, { label: t(`${K}.crumb`) }]

  if (!allowed) {
    return (
      <div>
        <PageTopBar {...header} breadcrumbs={crumbs} />
        <EmptyState title={t(`${K}.notAllowedTitle`)} description={t(`${K}.notAllowedBody`)} />
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div>
        <PageTopBar {...header} breadcrumbs={crumbs} />
        <NetworkError
          title={t(`${K}.loadFailed`)}
          description={state.error ?? undefined}
          onRetry={state.reload}
          retryText={t('common.retry')}
        />
      </div>
    )
  }
  if (!state.model) {
    return (
      <div>
        <PageTopBar {...header} breadcrumbs={crumbs} />
        <SkeletonText lines={8} />
      </div>
    )
  }
  return (
    <SettingsForm
      key={state.version}
      companyId={id}
      model={state.model}
      crumbs={crumbs}
      initialNotice={saved ? 'saved' : null}
      onSaved={(settings) => {
        state.replaceSettings(settings)
        setSaved(true)
      }}
    />
  )
}

function SettingsForm({
  companyId,
  model,
  crumbs,
  initialNotice,
  onSaved,
}: {
  companyId: string
  model: CompanySettingsModel
  crumbs: { label: string }[]
  initialNotice: 'saved' | null
  onSaved: (settings: CompanySettingsModel['settings']) => void
}) {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const ids = useId()
  const initial = draftOf(model.settings)
  const [draft, setDraft] = useState<SettingsDraft>(initial)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<'saved' | 'nothing' | null>(initialNotice)
  const [saveError, setSaveError] = useState<string | null>(null)
  const set = (patch: Partial<SettingsDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setNotice(null)
  }
  const colourValid = HEX_COLOUR.test(draft.primaryColor)
  const logoUrl = model.settings.branding.logoUrl
  const name = model.companyName ?? DASH
  const now = new Date()
  // The artboard's pattern, with the tenant's own survey and how it was really created.
  const anonymityHelp = model.latestSurvey
    ? t(model.latestSurvey.anonymous ? `${K}.anonymityHelpAnonymous` : `${K}.anonymityHelpNamed`, {
        wave: model.latestSurvey.wave,
      })
    : t(`${K}.anonymityHelp`)

  async function save() {
    const changes = changesOf(initial, draft)
    if (Object.keys(changes).length === 0) {
      setNotice('nothing')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const saved = await updateCompanySettings(baseUrl, companyId, changes)
      onSaved(saved)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageTopBar
        breadcrumbs={crumbs}
        tightBreadcrumb
        eyebrow={model.companyName}
        title={t(`${K}.title`)}
        description={t(`${K}.description`)}
        actions={
          <>
            <Button
              variant="outline"
              size="canvas"
              onClick={() => {
                setDraft(initial)
                setNotice(null)
                setSaveError(null)
              }}
            >
              {t(`${K}.discard`)}
            </Button>
            <Button variant="primary" size="canvas" disabled={saving || !colourValid} onClick={() => void save()}>
              <Check aria-hidden="true" />
              {saving ? t(`${K}.saving`) : t(`${K}.save`)}
            </Button>
          </>
        }
      />

      <p role="status" className={notice ? 'm-0 mb-3 text-sm text-accent-green-ink' : 'sr-only'}>
        {notice === 'saved' ? t(`${K}.saved`) : notice === 'nothing' ? t(`${K}.nothingToSave`) : ''}
      </p>
      {saveError && (
        <p role="alert" className="m-0 mb-3 text-sm text-accent-red">
          {saveError}
        </p>
      )}

      <div data-slot="settings-grid" className="-mt-1 grid gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Panel
          labelledBy={`${ids}-surveys`}
          heading={
            <h2 id={`${ids}-surveys`} className="m-0 text-2xl">
              {t(`${K}.surveysHeading`)}
            </h2>
          }
          meta={t(`${K}.surveysMeta`)}
          className="gap-4 pb-5"
        >
          <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
            <Field fieldLabel={t(`${K}.language`)} htmlFor={`${ids}-language`} required helper={t(`${K}.languageHelp`)}>
              <CanvasSelect
                id={`${ids}-language`}
                className="w-full"
                value={draft.language}
                onChange={(event) => set({ language: event.target.value })}
              >
                {(LANGUAGES.includes(draft.language) ? LANGUAGES : [draft.language, ...LANGUAGES]).map((code) => (
                  <option key={code} value={code}>
                    {LANGUAGES.includes(code) ? t(`${K}.languageOption.${code}`) : code}
                  </option>
                ))}
              </CanvasSelect>
            </Field>
            <Field fieldLabel={t(`${K}.frequency`)} htmlFor={`${ids}-frequency`} helper={t(frequencyHelpKey(draft.surveyFrequency))}>
              <CanvasSelect
                id={`${ids}-frequency`}
                className="w-full"
                value={draft.surveyFrequency}
                onChange={(event) => set({ surveyFrequency: event.target.value })}
              >
                {(FREQUENCIES.includes(draft.surveyFrequency) ? FREQUENCIES : [draft.surveyFrequency, ...FREQUENCIES]).map((value) => {
                  const key = surveyFrequencyLabelKey(value)
                  return (
                    <option key={value} value={value}>
                      {key ? t(key) : value}
                    </option>
                  )
                })}
              </CanvasSelect>
            </Field>
            <Field fieldLabel={t(`${K}.anonymity`)} htmlFor={`${ids}-anonymity`} helper={anonymityHelp}>
              <CanvasSelect
                id={`${ids}-anonymity`}
                className="w-full"
                value={draft.anonymousSurveys ? 'anonymous' : 'named'}
                onChange={(event) => set({ anonymousSurveys: event.target.value === 'anonymous' })}
              >
                <option value="anonymous">{t(`${K}.anonymous`)}</option>
                <option value="named">{t(`${K}.named`)}</option>
              </CanvasSelect>
            </Field>
            <Field
              fieldLabel={t(`${K}.retention`)}
              htmlFor={`${ids}-retention`}
              // The period's number and unit never split across the helper's lines ("… cerradas. 7 /
              // años hasta …" on the first shot): the first space becomes a no-break space.
              helper={t(`${K}.retentionHelpPeriod`, {
                period: retentionLabel(t, locale, draft.dataRetentionDays).replace(' ', '\u00a0'),
              })}
            >
              <CanvasSelect
                id={`${ids}-retention`}
                className="w-full"
                value={String(draft.dataRetentionDays)}
                onChange={(event) => set({ dataRetentionDays: Number(event.target.value) })}
              >
                {retentionOptions(draft.dataRetentionDays).map((days) => (
                  <option key={days} value={days}>
                    {retentionLabel(t, locale, days)}
                  </option>
                ))}
              </CanvasSelect>
            </Field>
            <Field fieldLabel={t(`${K}.timezone`)} htmlFor={`${ids}-timezone`} helper={t(`${K}.timezoneHelp`)}>
              <CanvasSelect
                id={`${ids}-timezone`}
                className="w-full"
                value={draft.timezone}
                onChange={(event) => set({ timezone: event.target.value })}
              >
                {timezoneOptions(draft.timezone).map((zone) => {
                  const offset = utcOffset(zone, now)
                  return (
                    <option key={zone} value={zone}>
                      {offset && offset !== zone ? `${zone} (${offset})` : zone}
                    </option>
                  )
                })}
              </CanvasSelect>
            </Field>
            <Field fieldLabel={t(`${K}.floor`)} helper={t(`${K}.floorHelp`, { threshold: ANONYMITY_FLOOR })}>
              <Readout>{t(`${K}.floorValue`, { threshold: ANONYMITY_FLOOR })}</Readout>
            </Field>
            <Field fieldLabel={t(`${K}.microclimates`)} helper={t(`${K}.microclimatesHelp`)}>
              <label className="m-0 flex h-control-lg items-center gap-2 text-sm text-fg-secondary">
                <Switch
                  checked={draft.microclimateEnabled}
                  onCheckedChange={(checked) => set({ microclimateEnabled: checked })}
                  className="data-[state=checked]:bg-accent-green"
                  aria-label={t(`${K}.microclimates`)}
                />
                {draft.microclimateEnabled ? t(`${K}.on`) : t(`${K}.off`)}
              </label>
            </Field>
            <Field fieldLabel={t(`${K}.aiInsights`)} helper={t(`${K}.aiInsightsHelp`)}>
              <label className="m-0 flex h-control-lg items-center gap-2 text-sm text-fg-secondary">
                <Switch
                  checked={draft.aiInsightsEnabled}
                  onCheckedChange={(checked) => set({ aiInsightsEnabled: checked })}
                  className="data-[state=checked]:bg-accent-green"
                  aria-label={t(`${K}.aiInsights`)}
                />
                {draft.aiInsightsEnabled ? t(`${K}.on`) : t(`${K}.off`)}
              </label>
            </Field>
          </div>
        </Panel>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel
            labelledBy={`${ids}-brand`}
            heading={
              <h2 id={`${ids}-brand`} className="m-0 text-2xl">
                {t(`${K}.brandHeading`)}
              </h2>
            }
            meta={t(`${K}.brandMeta`)}
            className="gap-4 pb-5"
          >
            <div className="flex items-start gap-4">
              <div
                data-slot="logo-box"
                className="flex h-24 w-30 shrink-0 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-lg border border-dashed border-line-default text-center text-2xs text-fg-tertiary"
              >
                {logoUrl ? (
                  <img src={logoUrl} alt={t(`${K}.logoAlt`, { company: name })} className="max-h-full max-w-full object-contain" />
                ) : (
                  <>
                    <FileText aria-hidden="true" className="size-4.5 text-fg-tertiary" />
                    {t(`${K}.logo`)}
                    <span className="text-fg-tertiary">{t(`${K}.logoFormats`)}</span>
                  </>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <Field
                  fieldLabel={t(`${K}.colour`)}
                  htmlFor={`${ids}-colour`}
                  helper={colourValid ? t(`${K}.colourHelp`) : <span className="text-accent-red">{t(`${K}.colourInvalid`)}</span>}
                >
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      data-slot="colour-swatch"
                      className="inline-flex size-8 shrink-0 rounded-md border border-line-default"
                      style={{ background: colourValid ? draft.primaryColor : 'transparent' }}
                    />
                    <Input
                      id={`${ids}-colour`}
                      value={draft.primaryColor}
                      aria-invalid={!colourValid}
                      onChange={(event) => set({ primaryColor: event.target.value.trim() })}
                      className="h-control-lg w-30 font-mono text-sm"
                    />
                  </div>
                </Field>
                <Field
                  fieldLabel={t(`${K}.sender`)}
                  helper={
                    // The field keeps the artboard's full width; the sample mark rides on its
                    // helper line, because no endpoint stores a sender name (sampleModel.ts).
                    <span data-slot="sender-helper" className="flex items-start justify-between gap-2">
                      <span className="min-w-0">{t(`${K}.senderHelp`)}</span>
                      <CanvasChip tone="warning" label={t('dashboard.next.sampleChip')} data-slot="sample-chip" />
                    </span>
                  }
                >
                  <Readout>{name}</Readout>
                </Field>
              </div>
            </div>
            <Button variant="outline" disabled title={t(`${K}.uploadUnavailable`)} className="w-full">
              <Upload aria-hidden="true" />
              {t(`${K}.uploadLogo`)}
            </Button>
            <p className="sr-only">{t(`${K}.uploadUnavailable`)}</p>
          </Panel>

          <Panel
            labelledBy={`${ids}-company`}
            heading={
              <h2 id={`${ids}-company`} className="m-0 text-2xl">
                {t(`${K}.companyHeading`)}
              </h2>
            }
            className="gap-4 pb-5"
          >
            <Field fieldLabel={t(`${K}.name`)} required>
              <Readout>{name}</Readout>
            </Field>
            <Field fieldLabel={t(`${K}.country`)}>
              <Readout>{DASH}</Readout>
              {/* No visible line: the artboard draws none. `GET /admin/companies/{id}` is
                  super-admin only (`CompanyEndpoints.cs:113`), so no country reaches this
                  viewer and neither reading can be edited here — said to a screen reader. */}
              <span className="sr-only">{t(`${K}.companyHelp`)}</span>
            </Field>
            <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 border-t border-line-light pt-1 text-xs">
              <dt className="text-fg-tertiary">{t(`${K}.departmentsReading`)}</dt>
              <dd className="m-0 font-mono tabular-nums">
                {model.departments
                  ? `${t(byCount(model.departments.active, `${K}.departmentsActiveOne`, `${K}.departmentsActiveMany`), {
                      count: model.departments.active,
                    })} · ${t(byCount(model.departments.inactive, `${K}.departmentsInactiveOne`, `${K}.departmentsInactiveMany`), {
                      count: model.departments.inactive,
                    })}`
                  : DASH}
              </dd>
              <dt className="text-fg-tertiary">{t(`${K}.peopleReading`)}</dt>
              <dd className="m-0 font-mono tabular-nums">{model.departments ? model.departments.people : DASH}</dd>
              <dt className="text-fg-tertiary">{t(`${K}.surveysReading`)}</dt>
              <dd className="m-0 font-mono tabular-nums">
                {model.surveys
                  ? t(byCount(model.surveys.active, `${K}.surveysValueOne`, `${K}.surveysValue`), {
                      total: model.surveys.total,
                      active: model.surveys.active,
                    })
                  : DASH}
              </dd>
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  )
}
