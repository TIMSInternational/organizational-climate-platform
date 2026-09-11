import { Fragment, useId, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { BarChart3, Calendar, Check, Clock, FileText, Filter, Mail, Network, Upload, Users } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../../i18n'
import { PageTopBar } from '../../../../components/layout'
import { ANONYMITY_FLOOR } from '../../../../components/charts'
import { Alert, AlertDescription, Button, Input, LiveRegion, NetworkError, SkeletonText, Switch } from '../../../../components/ui'
import { useCompanyContext } from '../../../../company-context'
import { calendarDay } from '../../../../lib/calendarDay'
import { cn } from '../../../../lib/cn'
import { updateCompany } from '../../api/companies'
import { updateCompanySettings } from '../../api/companySettings'
import { CompanyValidation } from '../../components/companyValidation'
import { surveyFrequencyLabelKey } from '../../labels'
import { countryOptions } from './countries'
import { plainTitle, statusMix, waveOf } from '../../../dashboard/next/super/derive'
import {
  HEX_COLOUR,
  departmentSummary,
  foldCommonPrefix,
  reportWave,
  draftProblems,
  parseRetention,
  peopleReading,
  profileChanges,
  profileDraftOf,
  retentionYears,
  settingsChanges,
  settingsDraftOf,
  wavesByMonth,
  type ProfileDraft,
  type SettingsDraft,
} from './companyDetail'
import { STATUS_COUNT_KEYS, countText, dayWithYear, languageText, sizeText, tierText } from './labels'
import { CanvasSelect, Field, IconBox, LinkCard, Panel } from './parts'
import { useSuperCompanyDetailModel, type SuperCompanyDetailModel } from './useSuperCompanyDetailModel'

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly']
const LANGUAGES = ['es', 'en']
const CADENCE_KEY: Readonly<Record<string, string>> = {
  daily: 'superadmin.next.companyDetail.surveys.daily',
  weekly: 'superadmin.next.companyDetail.surveys.weekly',
  monthly: 'superadmin.next.companyDetail.surveys.monthly',
  quarterly: 'superadmin.next.companyDetail.surveys.quarterly',
}

/**
 * `/admin/companies/:id` for a super administrator — the canvas's *Detalle de empresa
 * (tenant abierto)* (`SuperCompanyDetail` artboard). `CompanyDetailPage` dispatches here
 * for this role and keeps drawing the company administrator's page otherwise.
 *
 * One form, saved at the end: the tenant's profile (`PUT /admin/companies/{id}`,
 * super-only) and what every new survey inherits (`PUT …/settings`) — the content
 * language the triage's P0 row asked for among them. *Descartar* puts the form back;
 * *Guardar cambios* sends only what changed, profile first, as two requests. Beside it,
 * the four pages this role reaches only from here (`navSections.ts`), each with a reading
 * of its own, and the readings of the tenant that no form edits.
 */
export default function SuperCompanyDetailView() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const state = useSuperCompanyDetailModel(id)

  if (state.status === 'error') {
    return (
      <div>
        <PageTopBar
          eyebrow={t('navigation.systemAdministration')}
          title={t('superadmin.next.companyDetail.title')}
          breadcrumbs={[{ label: t('navigation.companies'), href: '/admin/companies' }, { label: t('superadmin.next.companyDetail.title') }]}
        />
        <NetworkError
          title={t('superadmin.next.companyDetail.loadFailed')}
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
        <PageTopBar eyebrow={t('navigation.systemAdministration')} title={t('superadmin.next.companyDetail.title')} />
        <SkeletonText lines={8} />
      </div>
    )
  }
  // Keyed on the load, so a save's reload re-seeds the form from what the server kept.
  return <DetailForm key={state.version} model={state.model} onSaved={state.reload} />
}

function DetailForm({ model, onSaved }: { model: SuperCompanyDetailModel; onSaved: () => void }) {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const { company, settings } = model
  const initialProfile = profileDraftOf(company)
  const initialSettings = settings ? settingsDraftOf(settings) : null
  const [profile, setProfile] = useState<ProfileDraft>(initialProfile)
  const [draft, setDraft] = useState<SettingsDraft | null>(initialSettings)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [nothing, setNothing] = useState(false)

  const profileDiff = profileChanges(initialProfile, profile)
  const settingsDiff = initialSettings && draft ? settingsChanges(initialSettings, draft) : {}
  const dirty = Object.keys(profileDiff).length > 0 || Object.keys(settingsDiff).length > 0
  const blocked = draftProblems(profile, draft)

  async function save() {
    // Both actions are always offered, as the canvas draws them; a save with nothing
    // changed sends nothing and says so, rather than a PUT that rewrites the same values.
    if (!dirty) {
      setSaved(false)
      setNothing(true)
      return
    }
    setNothing(false)
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      if (Object.keys(profileDiff).length > 0) await updateCompany(baseUrl, company.id, profileDiff)
      if (Object.keys(settingsDiff).length > 0) await updateCompanySettings(baseUrl, company.id, settingsDiff)
      setSaved(true)
      onSaved()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t('superadmin.next.companyDetail.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  function discard() {
    setNothing(false)
    setProfile(initialProfile)
    setDraft(initialSettings)
    setSaveError(null)
  }

  return (
    <div className="flex flex-col gap-section">
      <PageTopBar
        eyebrow={t('navigation.systemAdministration')}
        title={t('superadmin.next.companyDetail.title')}
        description={t('superadmin.next.companyDetail.description')}
        breadcrumbs={[{ label: t('navigation.companies'), href: '/admin/companies' }, { label: company.name }]}
        actions={
          <>
            <Button type="button" variant="outline" onClick={discard} disabled={saving}>
              {t('superadmin.next.companyDetail.discard')}
            </Button>
            <Button type="button" variant="primary" onClick={() => void save()} disabled={blocked || saving}>
              <Check aria-hidden="true" />
              {saving ? t('superadmin.next.companyDetail.saving') : t('superadmin.next.companyDetail.save')}
            </Button>
          </>
        }
      />
      <LiveRegion>
        {saved
          ? t('superadmin.next.companyDetail.saved')
          : nothing && !dirty
            ? t('superadmin.next.companyDetail.nothingToSave')
            : ''}
      </LiveRegion>
      {nothing && !dirty && <p className="m-0 -mt-4 text-xs text-fg-tertiary">{t('superadmin.next.companyDetail.nothingToSave')}</p>}
      {saveError && (
        <Alert variant="destructive">
          <AlertDescription>
            {t('superadmin.next.companyDetail.saveFailed')}: {saveError}
          </AlertDescription>
        </Alert>
      )}

      <OnlyFromHere model={model} />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-7">
          <SurveysCard model={model} draft={draft} setDraft={setDraft} />
          <DepartmentsCard model={model} />
        </div>
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-5">
          <CompanyCard model={model} profile={profile} setProfile={setProfile} locale={locale} />
          <BrandCard model={model} draft={draft} setDraft={setDraft} />
        </div>
      </div>
    </div>
  )
}

function OnlyFromHere({ model }: { model: SuperCompanyDetailModel }) {
  const { t, locale } = useTranslation()
  const id = model.company.id
  const people = model.users ? peopleReading(model.users) : null
  const latestReport = model.reports?.map((report) => report.createdAt).sort().at(-1)
  // "2 informes de T3" when every report is of one quarter; one report keeps its date.
  const wave = model.reports && model.reports.length > 1 ? reportWave(model.reports) : null
  const unread = t('superadmin.next.unavailable')

  return (
    // `-mt-6`: `PageTopBar` keeps 24px under its rule and the page column adds its 24px gap;
    // the canvas has 24 in all between the rule and this strip.
    <section aria-labelledby="detail-only-here" className="-mt-6 flex flex-col gap-2">
      <p id="detail-only-here" className="m-0 text-xs text-fg-tertiary">
        <span className="font-semibold">{t('superadmin.next.companyDetail.onlyHereLead')}</span>{' '}
        {t('superadmin.next.companyDetail.onlyHereNote')}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <LinkCard
          to={`/admin/companies/${id}/users`}
          icon={<Users />}
          name={t('navigation.users')}
          sub={people ? t('superadmin.next.companyDetail.links.usersSub', { people: people.total, leaders: people.leaders }) : unread}
        />
        <LinkCard
          to={`/admin/companies/${id}/demographic-fields`}
          icon={<Filter />}
          name={t('navigation.demographicFields')}
          sub={
            model.demographicFields === null
              ? unread
              : model.demographicFields.length === 0
                ? t('superadmin.next.companyDetail.links.demographicsNone')
                : t('superadmin.next.companyDetail.links.demographicsSome', { count: model.demographicFields.length })
          }
        />
        <LinkCard
          to={`/admin/companies/${id}/reports`}
          icon={<FileText />}
          name={t('navigation.reports')}
          sub={
            model.reports === null
              ? unread
              : wave
                ? t('superadmin.next.companyDetail.links.reportsOfWave', {
                    count: model.reports.length,
                    code: wave,
                  })
                : latestReport
                ? t('superadmin.next.companyDetail.links.reportsSome', {
                    count: model.reports.length,
                    date: calendarDay(Date.parse(latestReport), locale),
                  })
                : t('superadmin.next.companyDetail.links.reportsNone')
          }
        />
        <LinkCard
          to={`/admin/companies/${id}/analytics`}
          icon={<BarChart3 />}
          name={t('navigation.analytics')}
          sub={
            model.ownBenchmarks === null
              ? unread
              : t('superadmin.next.companyDetail.links.analyticsSub', { count: model.ownBenchmarks.length })
          }
        />
      </div>
    </section>
  )
}

function cadenceHelper(t: TranslateFn, frequency: string, model: SuperCompanyDetailModel, locale: string): string | null {
  const key = CADENCE_KEY[frequency.trim().toLowerCase()]
  if (!key) return null
  const cadence = t(key)
  const waves = model.surveys ? wavesByMonth(model.surveys, locale) : []
  if (waves.length === 0) return t('superadmin.next.companyDetail.surveys.cadenceOnly', { cadence })
  const list = waves.map((wave) => t('superadmin.next.companyDetail.surveys.waveMonth', wave)).join(', ')
  return t('superadmin.next.companyDetail.surveys.wavesSeen', { cadence, list })
}

function SurveysCard({
  model,
  draft,
  setDraft,
}: {
  model: SuperCompanyDetailModel
  draft: SettingsDraft | null
  setDraft: (draft: SettingsDraft) => void
}) {
  const { t, locale } = useTranslation()
  const ids = {
    language: useId(),
    frequency: useId(),
    anonymity: useId(),
    retention: useId(),
    microclimates: useId(),
  }
  const heading = (
    <h2 id="detail-surveys" className="m-0 text-2xl">
      {t('superadmin.next.companyDetail.surveys.heading')}
    </h2>
  )

  if (!draft) {
    return (
      <Panel labelledBy="detail-surveys" heading={heading} meta={t('superadmin.next.companyDetail.surveys.meta')}>
        <p className="m-0 text-xs text-fg-secondary">{t('companySettings.settingsUnavailable')}</p>
      </Panel>
    )
  }

  const retention = parseRetention(draft.dataRetentionDays)
  const frequencies = FREQUENCIES.includes(draft.surveyFrequency) ? FREQUENCIES : [draft.surveyFrequency, ...FREQUENCIES]
  const languages = LANGUAGES.includes(draft.language) ? LANGUAGES : [draft.language, ...LANGUAGES]
  const set = (patch: Partial<SettingsDraft>) => setDraft({ ...draft, ...patch })

  return (
    <Panel labelledBy="detail-surveys" heading={heading} meta={t('superadmin.next.companyDetail.surveys.meta')} className="gap-4 pb-5">
      <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2">
        <Field
          fieldLabel={t('superadmin.next.companyDetail.surveys.language')}
          htmlFor={ids.language}
          required
          helper={t('superadmin.next.companyDetail.surveys.languageHelper')}
        >
          <CanvasSelect id={ids.language} className="w-full" value={draft.language} onChange={(event) => set({ language: event.target.value })}>
            {languages.map((language) => (
              <option key={language} value={language}>
                {languageText(t, language)}
              </option>
            ))}
          </CanvasSelect>
        </Field>
        <Field
          fieldLabel={t('superadmin.next.companyDetail.surveys.frequency')}
          htmlFor={ids.frequency}
          helper={cadenceHelper(t, draft.surveyFrequency, model, locale) ?? undefined}
        >
          <CanvasSelect
            id={ids.frequency}
            className="w-full"
            value={draft.surveyFrequency}
            onChange={(event) => set({ surveyFrequency: event.target.value })}
          >
            {frequencies.map((frequency) => {
              const key = surveyFrequencyLabelKey(frequency)
              return (
                <option key={frequency} value={frequency}>
                  {key ? t(key) : frequency}
                </option>
              )
            })}
          </CanvasSelect>
        </Field>
        <Field
          fieldLabel={t('superadmin.next.companyDetail.surveys.anonymity')}
          htmlFor={ids.anonymity}
          helper={
            model.openSurvey
              ? t('superadmin.next.companyDetail.surveys.anonymityHelperOpen', {
                  code: waveOf(model.openSurvey.title) ?? plainTitle(model.openSurvey.title) ?? '',
                  state: model.openSurvey.anonymous
                    ? t('superadmin.next.companyDetail.surveys.stateAnonymous')
                    : t('superadmin.next.companyDetail.surveys.stateNamed'),
                })
              : t('superadmin.next.companyDetail.surveys.anonymityHelper')
          }
        >
          <CanvasSelect
            id={ids.anonymity}
            className="w-full"
            value={draft.anonymousSurveys ? 'yes' : 'no'}
            onChange={(event) => set({ anonymousSurveys: event.target.value === 'yes' })}
          >
            <option value="yes">{t('superadmin.next.companyDetail.surveys.anonymous')}</option>
            <option value="no">{t('superadmin.next.companyDetail.surveys.identified')}</option>
          </CanvasSelect>
        </Field>
        <Field
          fieldLabel={t('superadmin.next.companyDetail.surveys.retention')}
          htmlFor={ids.retention}
          helper={
            retention === null
              ? undefined
              : t('superadmin.next.companyDetail.surveys.retentionHelper', {
                  days: retention,
                  years: retentionYears(retention, locale),
                })
          }
        >
          <InputAffix icon={<Clock />} suffix={t('superadmin.next.companyDetail.surveys.retentionUnit')}>
            <Input
              id={ids.retention}
              inputMode="numeric"
              value={draft.dataRetentionDays}
              aria-invalid={retention === null}
              onChange={(event) => set({ dataRetentionDays: event.target.value })}
              style={{ width: `${Math.max(String(draft.dataRetentionDays).length, 1)}ch` }}
              className="w-auto min-w-0 flex-none border-0 bg-transparent px-0 font-mono tabular-nums shadow-none"
            />
          </InputAffix>
        </Field>
        <Field
          fieldLabel={t('superadmin.next.companyDetail.surveys.floor')}
          helper={t('superadmin.next.companyDetail.surveys.floorHelper', { floor: ANONYMITY_FLOOR })}
        >
          <div className="flex h-control-lg items-center gap-2 rounded-md border border-line-default bg-surface-icon-box px-2.5">
            <span className="font-mono tabular-nums text-fg-primary">{ANONYMITY_FLOOR}</span>
            <span className="text-fg-tertiary">{t('superadmin.next.companyDetail.surveys.floorValue')}</span>
          </div>
        </Field>
        <Field
          fieldLabel={t('superadmin.next.companyDetail.surveys.microclimates')}
          htmlFor={ids.microclimates}
          helper={t('superadmin.next.companyDetail.surveys.microclimatesHelper')}
        >
          <ToggleRow
            id={ids.microclimates}
            checked={draft.microclimateEnabled}
            onChange={(microclimateEnabled) => set({ microclimateEnabled })}
            text={draft.microclimateEnabled ? t('superadmin.next.companyDetail.surveys.on') : t('superadmin.next.companyDetail.surveys.off')}
          />
        </Field>
      </div>
    </Panel>
  )
}

/** A switch that reads as the canvas's: green when on, with its state in words beside it. */
function ToggleRow({
  id,
  checked,
  onChange,
  text,
}: {
  id: string
  checked: boolean
  onChange: (checked: boolean) => void
  text: string
}) {
  return (
    <div className="flex h-control-lg items-center gap-2 text-xs text-fg-secondary">
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        className="data-[state=checked]:bg-accent-green"
      />
      <span>{text}</span>
    </div>
  )
}

/** An input with an icon before it and a unit after it, drawn as one control. */
function InputAffix({ icon, suffix, children }: { icon?: ReactNode; suffix?: string; children: ReactNode }) {
  return (
    <div className="flex h-control-lg items-center gap-2 rounded-md border border-line-default bg-surface-input px-2.5 focus-within:border-line-hover">
      {icon && (
        <span aria-hidden="true" className="inline-flex shrink-0 text-fg-tertiary [&_svg]:size-3.5">
          {icon}
        </span>
      )}
      {children}
      {suffix && <span className="shrink-0 font-mono text-fg-primary">{suffix}</span>}
    </div>
  )
}

function DepartmentsCard({ model }: { model: SuperCompanyDetailModel }) {
  const { t, locale } = useTranslation()
  const { selectCompany } = useCompanyContext()
  const navigate = useNavigate()
  const summary = model.departments ? departmentSummary(model.departments) : null

  return (
    <section aria-labelledby="detail-departments" className="flex flex-wrap items-center gap-3.5 rounded-xl border border-line-default bg-surface-card px-4 py-3 shadow-sm sm:flex-nowrap">
      <IconBox>
        <Network />
      </IconBox>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 id="detail-departments" className="m-0 font-sans text-base font-semibold">
          {t('navigation.departments')}
        </h2>
        <p className="m-0 text-xs text-fg-tertiary">
          {summary === null ? (
            t('superadmin.next.unavailable')
          ) : summary.active.length === 0 && summary.inactive.length === 0 ? (
            t('superadmin.next.companyDetail.departments.none')
          ) : (
            <>
              {summary.active.map((department, index) => (
                <Fragment key={department.id}>
                  {index > 0 && ' · '}
                  {department.name} <span className="font-mono tabular-nums">{department.employeeCount}</span>
                </Fragment>
              ))}
              {summary.active.length > 0 && '. '}
              {summary.inactive.length > 0 &&
                t(
                  summary.inactiveHavePeople
                    ? 'superadmin.next.companyDetail.departments.inactiveWithPeople'
                    : 'superadmin.next.companyDetail.departments.inactiveEmpty',
                  {
                    count: summary.inactive.length,
                    names: new Intl.ListFormat(locale, { type: 'conjunction' }).format(
                      foldCommonPrefix(summary.inactive.map((department) => department.name)),
                    ),
                  },
                )}
            </>
          )}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          // `/departments` reads the active company, so this tenant becomes it first.
          selectCompany(model.company.id)
          navigate('/departments')
        }}
      >
        <Network aria-hidden="true" />
        {t('superadmin.next.companyDetail.departments.view')}
      </Button>
    </section>
  )
}

function CompanyCard({
  model,
  profile,
  setProfile,
  locale,
}: {
  model: SuperCompanyDetailModel
  profile: ProfileDraft
  setProfile: (profile: ProfileDraft) => void
  locale: string
}) {
  const { t } = useTranslation()
  const ids = { name: useId(), domain: useId(), sector: useId(), size: useId(), country: useId(), plan: useId() }
  const set = (patch: Partial<ProfileDraft>) => setProfile({ ...profile, ...patch })
  const sizes = CompanyValidation.sizes.includes(profile.size) || profile.size === '' ? CompanyValidation.sizes : [profile.size, ...CompanyValidation.sizes]
  const tiers = CompanyValidation.subscriptionTiers
  const summary = model.departments ? departmentSummary(model.departments) : null
  const people = model.users ? peopleReading(model.users) : null
  const mix = model.surveys ? statusMix(model.surveys) : null
  const unread = t('superadmin.next.unavailable')

  const readings: Array<{ key: string; name: string; value: string }> = [
    {
      key: 'departments',
      name: t('superadmin.next.companyDetail.company.readDepartments'),
      value: summary
        ? t('superadmin.next.companyDetail.company.readDepartmentsValue', { active: summary.active.length, inactive: summary.inactive.length })
        : unread,
    },
    {
      key: 'people',
      name: t('superadmin.next.companyDetail.company.readPeople'),
      value: people
        ? people.active === people.total
          ? t('superadmin.next.companyDetail.company.readPeopleAll', { total: people.total })
          : t('superadmin.next.companyDetail.company.readPeopleSome', { total: people.total, active: people.active })
        : unread,
    },
    {
      key: 'surveys',
      name: t('superadmin.next.companyDetail.company.readSurveys'),
      value: mix
        ? [
            String(mix.total),
            ...(['active', 'closed', 'draft', 'archived'] as const)
              .filter((status) => mix[status] > 0)
              .map((status) => countText(t, STATUS_COUNT_KEYS[status], mix[status])),
          ].join(' · ')
        : unread,
    },
    {
      key: 'plans',
      name: t('superadmin.next.companyDetail.company.readPlans'),
      value: model.dashboard
        ? model.dashboard.overdueActionPlanCount === 0
          ? t('superadmin.next.companyDetail.company.readPlansNoneOverdue', { open: model.dashboard.openActionPlanCount })
          : t('superadmin.next.companyDetail.company.readPlansOverdue', {
              open: model.dashboard.openActionPlanCount,
              overdue: model.dashboard.overdueActionPlanCount,
            })
        : unread,
    },
  ]

  return (
    <Panel
      labelledBy="detail-company"
      heading={
        <h2 id="detail-company" className="m-0 text-2xl">
          {t('superadmin.next.companyDetail.company.heading')}
        </h2>
      }
      meta={t('superadmin.next.companyDetail.company.meta')}
      className="gap-3.5 pb-5"
    >
      <Field fieldLabel={t('superadmin.next.companyDetail.company.name')} htmlFor={ids.name} required>
        <Input id={ids.name} value={profile.name} required aria-invalid={!profile.name.trim()} onChange={(event) => set({ name: event.target.value })} className="w-full" />
      </Field>
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <Field fieldLabel={t('superadmin.next.companyDetail.company.domain')} htmlFor={ids.domain}>
          <InputAffix icon={<Mail />}>
            <Input
              id={ids.domain}
              value={profile.emailDomain}
              onChange={(event) => set({ emailDomain: event.target.value })}
              className="w-full border-0 bg-transparent px-0 font-mono shadow-none"
            />
          </InputAffix>
        </Field>
        <Field fieldLabel={t('superadmin.next.companyDetail.company.sector')} htmlFor={ids.sector}>
          <Input id={ids.sector} value={profile.industry} onChange={(event) => set({ industry: event.target.value })} className="w-full" />
        </Field>
        <Field fieldLabel={t('superadmin.next.companyDetail.company.size')} htmlFor={ids.size}>
          <CanvasSelect id={ids.size} className="w-full" value={profile.size} onChange={(event) => set({ size: event.target.value })}>
            {profile.size === '' && <option value="">{t('superadmin.next.companyDetail.company.selectSize')}</option>}
            {sizes.map((size) => (
              <option key={size} value={size}>
                {sizeText(t, size)}
              </option>
            ))}
          </CanvasSelect>
        </Field>
        <Field fieldLabel={t('superadmin.next.companyDetail.company.country')} htmlFor={ids.country}>
          <CanvasSelect id={ids.country} className="w-full" value={profile.country} onChange={(event) => set({ country: event.target.value })}>
            {profile.country === '' && <option value="">{t('superadmin.next.companyDetail.company.selectCountry')}</option>}
            {countryOptions(locale, profile.country).map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </CanvasSelect>
        </Field>
        <Field fieldLabel={t('superadmin.next.companyDetail.company.plan')} htmlFor={ids.plan}>
          <CanvasSelect id={ids.plan} className="w-full" value={profile.subscriptionTier} onChange={(event) => set({ subscriptionTier: event.target.value })}>
            {profile.subscriptionTier === '' && <option value="">{t('superadmin.next.companies.noPlan')}</option>}
            {(tiers.includes(profile.subscriptionTier) || profile.subscriptionTier === '' ? tiers : [profile.subscriptionTier, ...tiers]).map((tier) => (
              <option key={tier} value={tier}>
                {tierText(t, tier)}
              </option>
            ))}
          </CanvasSelect>
        </Field>
        <Field fieldLabel={t('superadmin.next.companyDetail.company.added')}>
          <div className="flex h-control-lg items-center gap-2 rounded-md border border-line-default bg-surface-input px-2.5">
            <Calendar aria-hidden="true" className="size-3.5 text-fg-tertiary" />
            <span className="font-mono tabular-nums text-fg-primary">{dayWithYear(model.company.createdAt, locale)}</span>
          </div>
        </Field>
      </div>
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 border-t border-line-light pt-2.5 text-xs">
        {readings.map((reading) => (
          <Fragment key={reading.key}>
            <dt className="text-fg-tertiary">{reading.name}</dt>
            <dd className="m-0 min-w-0 font-mono tabular-nums text-fg-primary">{reading.value}</dd>
          </Fragment>
        ))}
      </dl>
    </Panel>
  )
}

function BrandCard({
  model,
  draft,
  setDraft,
}: {
  model: SuperCompanyDetailModel
  draft: SettingsDraft | null
  setDraft: (draft: SettingsDraft) => void
}) {
  const { t } = useTranslation()
  const colourId = useId()
  const logo = model.settings?.branding.logoUrl ?? null
  const valid = draft ? HEX_COLOUR.test(draft.primaryColor) : false

  return (
    <Panel
      labelledBy="detail-brand"
      heading={
        <h2 id="detail-brand" className="m-0 text-2xl">
          {t('superadmin.next.companyDetail.brand.heading')}
        </h2>
      }
      meta={t('superadmin.next.companyDetail.brand.meta')}
      className="gap-4 pb-5"
    >
      {draft === null ? (
        <p className="m-0 text-xs text-fg-secondary">{t('companySettings.settingsUnavailable')}</p>
      ) : (
        <div className="flex flex-wrap items-start gap-4 sm:flex-nowrap">
          <div className="flex h-22 w-28 shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-default text-center text-2xs text-fg-tertiary">
            <Upload aria-hidden="true" className="size-4 text-fg-secondary" />
            {t('superadmin.next.companyDetail.brand.logo')}
            <span className="text-fg-tertiary">
              {logo ? t('superadmin.next.companyDetail.brand.logoSet') : t('superadmin.next.companyDetail.brand.logoNone')}
            </span>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <Field
              fieldLabel={t('superadmin.next.companyDetail.brand.primaryColor')}
              htmlFor={colourId}
              helper={t('superadmin.next.companyDetail.brand.colorHelper')}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-flex size-8 shrink-0 rounded-md border border-line-default"
                  style={{ background: valid ? draft.primaryColor : 'transparent' }}
                />
                <Input
                  id={colourId}
                  value={draft.primaryColor}
                  aria-invalid={!valid}
                  onChange={(event) => setDraft({ ...draft, primaryColor: event.target.value })}
                  className={cn('w-32 font-mono', !valid && 'border-accent-red')}
                />
              </div>
            </Field>
            <p className="m-0 text-xs text-fg-tertiary">{t('superadmin.next.companyDetail.brand.senderNote')}</p>
          </div>
        </div>
      )}
    </Panel>
  )
}
