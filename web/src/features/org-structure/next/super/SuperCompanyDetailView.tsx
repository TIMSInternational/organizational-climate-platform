import { Fragment, useId, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { BarChart3, Calendar, Check, FileText, Filter, Mail, Network, Users } from 'lucide-react'
import { useTranslation } from '../../../../i18n'
import { PageTopBar } from '../../../../components/layout'
import { ANONYMITY_FLOOR, DEFAULT_RESULT_BANDS } from '../../../../components/charts'
import { Alert, AlertDescription, Button, Input, LiveRegion, NetworkError, SkeletonText } from '../../../../components/ui'
import { useCompanyContext } from '../../../../company-context'
import { calendarDay } from '../../../../lib/calendarDay'
import { cn } from '../../../../lib/cn'
import { updateCompany } from '../../api/companies'
import { updateCompanySettings, type UpdateCompanySettingsInput } from '../../api/companySettings'
import { CompanyValidation } from '../../components/companyValidation'
import { countryOptions } from './countries'
import { statusMix } from '../../../dashboard/next/super/derive'
import {
  departmentSummary,
  foldCommonPrefix,
  reportWave,
  draftProblems,
  peopleReading,
  profileChanges,
  profileDraftOf,
  type ProfileDraft,
} from './companyDetail'
import { HEX_COLOUR, changesOf, draftOf, logoValid, timezoneOptions, utcOffset, type SettingsDraft } from '../settings/derive'
import { STATUS_COUNT_KEYS, countText, dayWithYear, languageText, sizeText, tierText } from './labels'
import { CanvasSelect, Field, IconBox, LinkCard, Panel } from './parts'
import CompanyServiceLicensesPanel from './CompanyServiceLicensesPanel'
import { useSuperCompanyDetailModel, type SuperCompanyDetailModel } from './useSuperCompanyDetailModel'
import ResultBandsCard from '../settings/ResultBandsCard'
import CredentialModeCard from '../settings/CredentialModeCard'
import { bandsChanged, bandsDraftOf, bandsOut, judgeBands, type BandsDraft } from '../settings/bandsDraft'
import { fromWire, toWire } from '../../../result-bands/api'
import { rememberResultBands } from '../../../result-bands/useResultBands'

const LANGUAGES = ['es', 'en']
/** Configuración de empresa's keys: the two screens make the same statements in the same words. */
const CA = 'companySettings.next'

/**
 * `/admin/companies/:id` for a super administrator — the canvas's *Detalle de empresa
 * (tenant abierto)* (`SuperCompanyDetail` artboard). `CompanyDetailPage` dispatches here
 * for this role and keeps drawing the company administrator's page otherwise.
 *
 * One form, saved at the end: the tenant's profile (`PUT /admin/companies/{id}`,
 * super-only) and what every new survey inherits (`PUT …/settings`) — the content
 * language the triage's P0 row asked for among them. The settings it edits are exactly
 * Configuración de empresa's — language, time zone, sign-in mode, result bands, colour and
 * logo path — through the same draft (`settings/derive.ts`); anonymity and retention are
 * stated, because no code reads the company's value for either (audit gap G18). *Descartar* puts the form back;
 * *Guardar cambios* sends only what changed, profile first, as two requests. The
 * company's result bands ride the settings request, judged by the same rules as on
 * Configuración de empresa, and hold *Guardar cambios* while they are not a whole scale.
 * Beside it,
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
  const initialSettings = settings ? draftOf(settings) : null
  const [profile, setProfile] = useState<ProfileDraft>(initialProfile)
  const [draft, setDraft] = useState<SettingsDraft | null>(initialSettings)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [nothing, setNothing] = useState(false)
  // The result bands: a draft of their own, saved with the settings. An API older than the
  // bands sends none — and a failed settings read sends nothing — so no card is drawn.
  const savedBands = settings?.resultBands ? fromWire(settings.resultBands) : null
  const initialBands = savedBands ? bandsDraftOf(savedBands, t, locale) : null
  const defaultBands = bandsDraftOf(DEFAULT_RESULT_BANDS, t, locale)
  const [bands, setBands] = useState<BandsDraft | null>(initialBands)

  const profileDiff = profileChanges(initialProfile, profile)
  const settingsDiff: UpdateCompanySettingsInput = initialSettings && draft ? changesOf(initialSettings, draft) : {}
  if (savedBands && bands && bandsChanged(savedBands, bands, t)) {
    const next = bandsOut(bands, t)
    if (next) settingsDiff.resultBands = toWire(next)
  }
  const dirty = Object.keys(profileDiff).length > 0 || Object.keys(settingsDiff).length > 0
  const blocked = draftProblems(profile, draft) || (bands !== null && !judgeBands(bands).ok)

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
      if (Object.keys(settingsDiff).length > 0) {
        const written = await updateCompanySettings(baseUrl, company.id, settingsDiff)
        // Every banded screen read after this one reads the scale just written.
        if (written.resultBands) rememberResultBands(company.id, fromWire(written.resultBands))
      }
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
    setBands(initialBands)
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

      <CompanyServiceLicensesPanel companyId={company.id} />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-7">
          <SurveysCard draft={draft} setDraft={setDraft} />
          {initialSettings && draft && (
            <CredentialModeCard
              saved={initialSettings.credentialMode}
              value={draft.credentialMode}
              disabled={saving}
              onChange={(credentialMode) => {
                setNothing(false)
                setDraft({ ...draft, credentialMode })
              }}
            />
          )}
          {savedBands && bands && (
            <ResultBandsCard
              draft={bands}
              saved={savedBands}
              defaults={defaultBands}
              onChange={(next) => {
                setNothing(false)
                setBands(next)
              }}
            />
          )}
          <DepartmentsCard model={model} />
        </div>
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-5">
          <CompanyCard model={model} profile={profile} setProfile={setProfile} locale={locale} />
          <BrandCard companyName={company.name} draft={draft} setDraft={setDraft} />
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

/** A statement in a control's place: what the platform does, which no company value changes. */
function Statement({ children }: { children: ReactNode }) {
  return (
    <div
      data-slot="settings-statement"
      className="flex h-control-lg min-w-0 items-center truncate rounded-md border border-line-default bg-surface-icon-box px-2.5 text-fg-primary"
    >
      {children}
    </div>
  )
}

function SurveysCard({ draft, setDraft }: { draft: SettingsDraft | null; setDraft: (draft: SettingsDraft) => void }) {
  const { t } = useTranslation()
  const ids = { language: useId(), timezone: useId() }
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

  const languages = LANGUAGES.includes(draft.language) ? LANGUAGES : [draft.language, ...LANGUAGES]
  const set = (patch: Partial<SettingsDraft>) => setDraft({ ...draft, ...patch })
  const now = new Date()

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
        {/* The time zone Configuración de empresa edits, which this role could not (audit gap
            G19): the same select, the same zones, the same PUT. */}
        <Field fieldLabel={t(`${CA}.timezone`)} htmlFor={ids.timezone} helper={t(`${CA}.timezoneHelp`)}>
          <CanvasSelect id={ids.timezone} className="w-full" value={draft.timezone} onChange={(event) => set({ timezone: event.target.value })}>
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
        <Field
          fieldLabel={t('superadmin.next.companyDetail.surveys.floor')}
          helper={t('superadmin.next.companyDetail.surveys.floorHelper', { floor: ANONYMITY_FLOOR })}
        >
          <div className="flex h-control-lg items-center gap-2 rounded-md border border-line-default bg-surface-icon-box px-2.5">
            <span className="font-mono tabular-nums text-fg-primary">{ANONYMITY_FLOOR}</span>
            <span className="text-fg-tertiary">{t('superadmin.next.companyDetail.surveys.floorValue')}</span>
          </div>
        </Field>
        {/* Statements where a default-anonymity select, a retention input, a frequency select
            and a microclimate switch stood (audit gap G18): each wrote a company value that no
            code reads. Every new survey is anonymous (`NewSurveyDefaults.Apply`); the retention
            sweep runs fixed periods (`RetentionCleanupJob`, `SurveyDraftRetention`). The AI flag
            is read — by this role's Analítica — and no control here ever offered it. */}
        <Field fieldLabel={t(`${CA}.anonymityInEffect`)} helper={t(`${CA}.anonymityAlwaysHelp`)}>
          <Statement>{t(`${CA}.anonymityAlwaysValue`)}</Statement>
        </Field>
        <Field fieldLabel={t(`${CA}.retentionInEffect`)} helper={t(`${CA}.retentionFixedHelp`)}>
          <Statement>{t(`${CA}.retentionFixedValue`)}</Statement>
        </Field>
      </div>
    </Panel>
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
  companyName,
  draft,
  setDraft,
}: {
  companyName: string
  draft: SettingsDraft | null
  setDraft: (draft: SettingsDraft) => void
}) {
  const { t } = useTranslation()
  const colourId = useId()
  const logoId = useId()
  const colourValid = draft ? HEX_COLOUR.test(draft.primaryColor) : false
  const logoOk = draft ? logoValid(draft.logoUrl) : false
  // The draft, as on Configuración de empresa: the box previews what the field now says, and
  // only when the field holds a value the API would accept.
  const logoUrl = draft && logoOk && draft.logoUrl.trim() !== '' ? draft.logoUrl.trim() : null

  return (
    <Panel
      labelledBy="detail-brand"
      heading={
        <h2 id="detail-brand" className="m-0 text-2xl">
          {t('superadmin.next.companyDetail.brand.heading')}
        </h2>
      }
      meta={t(`${CA}.brandMetaInEffect`)}
      className="gap-4 pb-5"
    >
      {draft === null ? (
        <p className="m-0 text-xs text-fg-secondary">{t('companySettings.settingsUnavailable')}</p>
      ) : (
        <div className="flex flex-wrap items-start gap-4 sm:flex-nowrap">
          <div
            data-slot="logo-box"
            className="flex h-22 w-28 shrink-0 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border border-dashed border-line-default text-center text-2xs text-fg-tertiary"
          >
            {logoUrl ? (
              <img src={logoUrl} alt={t(`${CA}.logoAlt`, { company: companyName })} className="max-h-full max-w-full object-contain" />
            ) : (
              <>
                <FileText aria-hidden="true" className="size-4 text-fg-tertiary" />
                {t('superadmin.next.companyDetail.brand.logo')}
                <span className="text-fg-tertiary">{t(`${CA}.logoFormats`)}</span>
              </>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <Field
              fieldLabel={t('superadmin.next.companyDetail.brand.primaryColor')}
              htmlFor={colourId}
              helper={colourValid ? t(`${CA}.colourEmailHelp`) : <span className="text-accent-red">{t(`${CA}.colourInvalid`)}</span>}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-flex size-8 shrink-0 rounded-md border border-line-default"
                  style={{ background: colourValid ? draft.primaryColor : 'transparent' }}
                />
                <Input
                  id={colourId}
                  value={draft.primaryColor}
                  aria-invalid={!colourValid}
                  onChange={(event) => setDraft({ ...draft, primaryColor: event.target.value.trim() })}
                  className={cn('w-32 font-mono', !colourValid && 'border-accent-red')}
                />
              </div>
            </Field>
            {/* The logo path Configuración de empresa edits, which this role could only see as
                "cargado" (audit gap G19). Set the way it is set today: the file is published on
                this site and chosen here by its path; there is no upload. */}
            <Field
              fieldLabel={t(`${CA}.logoPath`)}
              htmlFor={logoId}
              helper={logoOk ? t(`${CA}.logoPathHelpPublished`) : <span className="text-accent-red">{t(`${CA}.logoPathInvalid`)}</span>}
            >
              <Input
                id={logoId}
                value={draft.logoUrl}
                aria-invalid={!logoOk}
                onChange={(event) => setDraft({ ...draft, logoUrl: event.target.value })}
                className={cn('w-full font-mono text-sm', !logoOk && 'border-accent-red')}
              />
            </Field>
            <p className="m-0 text-xs text-fg-tertiary">{t('superadmin.next.companyDetail.brand.senderNote')}</p>
          </div>
        </div>
      )}
    </Panel>
  )
}
