import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { AlertCircle, ArrowRight, Building2, Check, Clock, FileText, Mail, Plus } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../../i18n'
import { PageTopBar } from '../../../../components/layout'
import { KpiTile } from '../../../../components/charts'
import { Button, Chip, LoadingRegion, NetworkError, SkeletonText, Table } from '../../../../components/ui'
import { useCompanyContext } from '../../../../company-context'
import { calendarDay } from '../../../../lib/calendarDay'
import { cn } from '../../../../lib/cn'
import CompanyContextBar from '../../../org-structure/next/super/CompanyContextBar'
import { IconBox, MiniBar, Panel, SectionHead } from '../../../org-structure/next/super/parts'
import {
  PERSON_COUNT_KEYS,
  STATUS_COUNT_KEYS,
  countText,
  joinNor,
  languageText,
  longDay,
  percentOf,
  type SurveyStatusKey,
} from '../../../org-structure/next/super/labels'
import { ago, latestSuccess, toneOf, worstJob } from './derive'
import type { MissingPart, PlatformAttention, PlatformCompanyRow, PlatformModel } from './model'
import { usePlatformDashboardModel } from './usePlatformDashboardModel'
import type { SystemAggregateStatus, SystemComponentStatus, SystemStatusResponse } from '../../../org-structure/api/systemStatus'

const TH =
  'border-b border-line-default bg-transparent px-3 pb-2 pt-1 text-2xs font-bold uppercase tracking-label whitespace-nowrap text-fg-tertiary'

const MISSING_KEY: Readonly<Record<MissingPart, string>> = {
  sector: 'superadmin.next.dashboard.attention.missingSector',
  country: 'superadmin.next.dashboard.attention.missingCountry',
  plan: 'superadmin.next.dashboard.attention.missingPlan',
  surveys: 'superadmin.next.dashboard.attention.missingSurveys',
}

/** The status mix's bar, in the canvas's order and colours. */
const SEGMENTS: ReadonlyArray<{ key: SurveyStatusKey; className: string }> = [
  { key: 'active', className: 'bg-accent-blue' },
  { key: 'closed', className: 'bg-line-hover' },
  { key: 'draft', className: 'bg-accent-amber' },
  { key: 'archived', className: 'bg-line-light' },
]

const STATUS_KEY: Readonly<Record<string, string>> = {
  ok: 'systemHealth.statusOk',
  slow: 'systemHealth.statusSlow',
  timeout: 'systemHealth.statusTimeout',
  unreachable: 'systemHealth.statusUnreachable',
  backlog: 'systemHealth.statusBacklog',
  'never-run': 'superadmin.next.dashboard.system.neverRun',
  stale: 'systemHealth.statusStale',
  failing: 'systemHealth.statusFailing',
  unknown: 'systemHealth.statusUnknown',
  degraded: 'systemHealth.statusDegraded',
  unhealthy: 'systemHealth.statusUnhealthy',
}

/**
 * The super administrator's `/dashboard` with no tenant chosen — the canvas's *Panel de
 * la plataforma* (`SuperDashboard` artboard). It replaced `SuperAdminDashboardView` on
 * that branch of `DashboardPage`; the old view stays in the tree, unrouted, as the wiring
 * reference.
 *
 * The platform at a glance: four tiles, the tenants by activity, the operator's
 * attention list, and on the right the system, the survey mix and the headcount. The
 * context strip on top is the canvas's tenant switcher: picking a company here (or
 * "Abrir" on a row) sets the same selection the header switcher sets, and
 * `DashboardPage` then draws that company's Panel de Control.
 *
 * Only a `super_admin` with nothing selected is dispatched here, and `GET
 * /dashboard/super-admin` refuses every other role, so every action on this page is one
 * the viewer may take: a new company (`CompanyEndpoints.cs`, super-only), opening a
 * tenant, the system settings.
 */
export default function PlatformDashboardView() {
  const { t } = useTranslation()
  const state = usePlatformDashboardModel()
  const { selectCompany } = useCompanyContext()

  return (
    <div>
      <CompanyContextBar mode="platform" companies={state.model?.rows ?? []} value={null} onChange={selectCompany} />
      <PageTopBar
        eyebrow={t('dashboard.platform')}
        title={t('superadmin.next.dashboard.title')}
        description={t('superadmin.next.dashboard.description')}
        actions={
          <Button asChild variant="primary">
            <Link to="/admin/companies?new=1">
              <Plus aria-hidden="true" />
              {t('superadmin.next.dashboard.newCompany')}
            </Link>
          </Button>
        }
      />
      {state.status === 'error' ? (
        <NetworkError
          title={t('superadmin.next.dashboard.loadFailed')}
          description={state.error ?? undefined}
          onRetry={state.reload}
          retryText={t('common.retry')}
        />
      ) : (
        <LoadingRegion loading={state.status === 'loading'} label={t('common.loading')}>
          {state.model ? <PlatformBody model={state.model} onOpen={selectCompany} /> : <SkeletonText lines={6} />}
        </LoadingRegion>
      )}
    </div>
  )
}

function PlatformBody({ model, onOpen }: { model: PlatformModel; onOpen: (companyId: string) => void }) {
  const { t, locale } = useTranslation()
  const withOpen = model.rows.filter((row) => row.activeSurveyCount > 0).length
  const withoutSurveys = model.missing.surveys ? null : model.rows.filter((row) => row.surveyCount === 0).length
  const responders = [...model.rows]
    .filter((row) => row.completedResponses > 0)
    .sort((a, b) => b.completedResponses - a.completedResponses)
    .slice(0, 2)
  const mix = model.mix

  return (
    // `pt-2`: `PageTopBar` keeps 16px under its rule; the canvas has 24 before the tiles.
    <div className="flex flex-col gap-section pt-2">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          surface="card"
          label={t('superadmin.next.dashboard.tiles.companiesLabel')}
          value={model.companyCount}
          unit={t('superadmin.next.dashboard.tiles.companiesUnit')}
          locale={locale}
          sub={
            <span>
              {withoutSurveys === null
                ? t('superadmin.next.dashboard.tiles.companiesSubOpenOnly', { open: withOpen })
                : t('superadmin.next.dashboard.tiles.companiesSub', { open: withOpen, none: withoutSurveys })}
            </span>
          }
        />
        <KpiTile
          surface="card"
          label={t('superadmin.next.dashboard.tiles.peopleLabel')}
          value={model.userCount}
          unit={t('superadmin.next.dashboard.tiles.peopleUnit')}
          locale={locale}
          sub={
            <span>
              {t('superadmin.next.dashboard.tiles.peopleSub', {
                active: model.activeUserCount,
                orphans: model.peopleWithoutCompany,
              })}
            </span>
          }
        />
        <KpiTile
          surface="card"
          label={t('superadmin.next.dashboard.tiles.openLabel')}
          value={model.activeSurveyCount}
          unit={t('superadmin.next.dashboard.tiles.openUnit', { total: model.surveyCount })}
          locale={locale}
          sub={
            mix ? (
              <span>
                {(['closed', 'draft', 'archived'] as const)
                  .map((status) => countText(t, STATUS_COUNT_KEYS[status], mix[status]))
                  .join(' · ')}
              </span>
            ) : undefined
          }
        />
        <KpiTile
          surface="card"
          label={t('superadmin.next.dashboard.tiles.responsesLabel')}
          value={model.completedResponseCount}
          unit={t('superadmin.next.dashboard.tiles.responsesUnit', { started: model.responseCount })}
          locale={locale}
          sub={
            <span>
              {responders.length > 0
                ? responders
                    .map((row) =>
                      t('superadmin.next.dashboard.tiles.responsesIn', { count: row.completedResponses, company: row.name }),
                    )
                    .join(' · ')
                : t('superadmin.next.dashboard.tiles.responsesNone')}
            </span>
          }
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-section xl:col-span-8">
          <CompaniesSection model={model} onOpen={onOpen} />
          <AttentionSection items={model.attention} onOpen={onOpen} />
        </div>
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-4">
          <SystemPanel system={model.system} />
          <MixPanel model={model} />
          <PeoplePanel model={model} />
        </div>
      </div>
    </div>
  )
}

function CompaniesSection({ model, onOpen }: { model: PlatformModel; onOpen: (companyId: string) => void }) {
  const { t } = useTranslation()
  return (
    <section aria-labelledby="platform-companies" className="flex min-w-0 flex-col gap-3">
      <SectionHead
        id="platform-companies"
        heading={t('superadmin.next.dashboard.companies.heading')}
        count={model.rows.length}
        note={t('superadmin.next.dashboard.companies.note')}
      />
      {model.missing.surveys && (
        <p className="m-0 text-xs text-fg-secondary">{t('superadmin.next.dashboard.companies.surveysUnavailable')}</p>
      )}
      <div className="overflow-hidden rounded-xl border border-line-default bg-surface-card pt-2 shadow-sm">
        <Table aria-label={t('superadmin.next.dashboard.companies.tableLabel')} className="min-w-160 table-fixed">
          <colgroup>
            <col className="w-[27%]" />
            <col />
            <col className="w-32" />
            <col className="w-20" />
            <col className="w-24" />
            <col className="w-20" />
          </colgroup>
          <thead>
            <tr>
              <th className={TH}>{t('superadmin.next.dashboard.companies.colCompany')}</th>
              <th className={TH}>{t('superadmin.next.dashboard.companies.colOpenSurvey')}</th>
              <th className={TH}>{t('superadmin.next.dashboard.companies.colParticipation')}</th>
              <th className={cn(TH, 'text-right')}>{t('superadmin.next.dashboard.companies.colPeople')}</th>
              <th className={cn(TH, 'text-right')}>{t('superadmin.next.dashboard.companies.colResponses')}</th>
              <th className={TH}>
                <span className="sr-only">{t('common.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row) => (
              <CompanyRow key={row.id} row={row} onOpen={onOpen} />
            ))}
          </tbody>
        </Table>
      </div>
    </section>
  )
}

function CompanyRow({ row, onOpen }: { row: PlatformCompanyRow; onOpen: (companyId: string) => void }) {
  const { t, locale } = useTranslation()
  const place = [row.industry, row.country].filter((part): part is string => Boolean(part?.trim())).join(' · ')
  const survey = row.openSurvey

  return (
    <tr data-company-id={row.id}>
      <td className="px-3 py-3">
        <Link
          to={`/admin/companies/${row.id}`}
          className="block truncate font-semibold text-fg-primary no-underline hover:underline"
        >
          {row.name}
        </Link>
        {row.profileKnown && (
          <span className="block truncate text-2xs text-fg-light">
            {place || t('superadmin.next.dashboard.companies.noSectorCountry')}
          </span>
        )}
      </td>
      <td className="px-3 py-3">
        {row.surveyCount === null ? (
          <span aria-hidden="true" className="text-fg-light">
            —
          </span>
        ) : row.surveyCount === 0 ? (
          <span className="text-xs text-fg-light">{t('superadmin.next.dashboard.companies.noSurveys')}</span>
        ) : survey ? (
          <>
            <span className="block truncate font-medium text-fg-primary" title={survey.name ?? undefined}>
              {survey.name ?? survey.code}
            </span>
            <span className="block truncate text-2xs text-fg-tertiary">
              {t('superadmin.next.dashboard.companies.closes', { date: calendarDay(Date.parse(survey.endDate), locale) })}
            </span>
          </>
        ) : (
          <span className="text-xs text-fg-light">{t('superadmin.next.dashboard.companies.noneOpen')}</span>
        )}
      </td>
      <td className="px-3 py-3">
        {survey ? (
          survey.audience !== null && survey.audience > 0 ? (
            <span className="flex items-center gap-1.5">
              <MiniBar percent={percentOf(survey.responses, survey.audience)} />
              <span className="whitespace-nowrap font-mono text-xs tabular-nums text-fg-secondary">
                {t('superadmin.next.dashboard.companies.participation', {
                  responses: survey.responses,
                  audience: survey.audience,
                })}
              </span>
            </span>
          ) : (
            <span className="text-xs text-fg-light">{t('superadmin.next.dashboard.companies.noInviteList')}</span>
          )
        ) : row.surveyCount === null ? (
          <span aria-hidden="true" className="text-fg-light">
            —
          </span>
        ) : (
          <span className="text-xs text-fg-light">{t('superadmin.next.dashboard.companies.noSubmissions')}</span>
        )}
      </td>
      <td className="px-3 py-3 text-right font-mono text-sm tabular-nums text-fg-primary">{row.people}</td>
      <td
        className={cn(
          'px-3 py-3 text-right font-mono text-sm tabular-nums',
          row.completedResponses === 0 ? 'text-fg-light' : 'text-fg-primary',
        )}
      >
        {row.completedResponses}
      </td>
      <td className="px-3 py-3 text-right">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpen(row.id)}
          aria-label={t('superadmin.next.dashboard.companies.openNamed', { name: row.name })}
        >
          {t('superadmin.next.dashboard.companies.open')}
        </Button>
      </td>
    </tr>
  )
}

function AttentionSection({
  items,
  onOpen,
}: {
  items: readonly PlatformAttention[]
  onOpen: (companyId: string) => void
}) {
  const { t } = useTranslation()
  return (
    <section aria-labelledby="platform-attention" className="flex min-w-0 flex-col gap-3">
      <SectionHead id="platform-attention" heading={t('superadmin.next.dashboard.attention.heading')} count={items.length} />
      {items.length === 0 ? (
        <p className="m-0 text-sm text-fg-secondary">{t('superadmin.next.dashboard.attention.empty')}</p>
      ) : (
        <ul className="m-0 list-none overflow-hidden rounded-xl border border-line-default bg-surface-card p-0 shadow-sm">
          {items.map((item, index) => (
            <li
              key={item.kind === 'mail-off' ? 'mail-off' : `${item.kind}-${item.companyId}`}
              data-attention={item.kind}
              className={cn('flex flex-wrap items-center gap-3.5 px-4 py-3 sm:flex-nowrap', index > 0 && 'border-t border-line-light')}
            >
              <AttentionRow item={item} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function AttentionText({ lead, rest, sub }: { lead: ReactNode; rest: ReactNode; sub: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <p className="m-0 text-base text-fg-primary">
        <b className="font-semibold">{lead}</b>
        {rest}
      </p>
      <p className="m-0 text-xs text-fg-tertiary">{sub}</p>
    </div>
  )
}

function AttentionRow({ item, onOpen }: { item: PlatformAttention; onOpen: (companyId: string) => void }) {
  const { t, locale } = useTranslation()
  switch (item.kind) {
    case 'behind-pace':
      return (
        <>
          <IconBox tone="critical">
            <AlertCircle />
          </IconBox>
          <AttentionText
            lead={item.companyName}
            rest={
              <>
                {': '}
                {t('superadmin.next.dashboard.attention.behindPace', {
                  survey: item.survey.name ?? item.survey.code,
                  responses: item.survey.responses,
                  audience: item.survey.audience ?? 0,
                  days: item.daysLeft,
                })}
              </>
            }
            sub={t('superadmin.next.dashboard.attention.behindPaceSub', {
              date: calendarDay(Date.parse(item.survey.startDate), locale),
              company: item.companyName,
            })}
          />
          <Button type="button" variant="outline" onClick={() => onOpen(item.companyId)}>
            {t('superadmin.next.dashboard.attention.openCompany')}
          </Button>
        </>
      )
    case 'mail-off':
      return (
        <>
          <IconBox tone="warning">
            <Mail />
          </IconBox>
          <AttentionText
            lead={t('superadmin.next.dashboard.attention.mailOffLead')}
            rest={<> {t('superadmin.next.dashboard.attention.mailOff')}</>}
            sub={[
              t('superadmin.next.dashboard.attention.mailOffSub'),
              item.unconfigured ? t('superadmin.next.dashboard.attention.mailOffUnconfigured') : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          />
          <Button asChild variant="outline">
            <Link to="/admin/system-settings">{t('superadmin.next.dashboard.attention.viewSettings')}</Link>
          </Button>
        </>
      )
    case 'drafts': {
      const key = item.singleQuestion
        ? item.count === 1
          ? 'superadmin.next.dashboard.attention.draftsSingleQuestionOne'
          : 'superadmin.next.dashboard.attention.draftsSingleQuestionMany'
        : item.count === 1
          ? 'superadmin.next.dashboard.attention.draftsOne'
          : 'superadmin.next.dashboard.attention.draftsMany'
      const language = item.languages.length === 1 ? languageText(t, item.languages[0]) : null
      return (
        <>
          <IconBox>
            <FileText />
          </IconBox>
          <AttentionText
            lead={item.companyName}
            rest={<> {t(key, { count: item.count, date: longDay(item.since, locale) })}</>}
            sub={[
              ...item.names,
              language
                ? t('superadmin.next.dashboard.attention.draftsLanguage', { language: language.toLocaleLowerCase(locale) })
                : null,
              item.closesOn
                ? t('superadmin.next.dashboard.attention.draftsCloses', {
                    date: calendarDay(Date.parse(item.closesOn), locale),
                  })
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          />
          <Button asChild variant="outline">
            <Link to="/surveys">{t('superadmin.next.dashboard.attention.viewSurveys')}</Link>
          </Button>
        </>
      )
    }
    case 'unconfigured':
      return (
        <>
          <IconBox>
            <Building2 />
          </IconBox>
          <AttentionText
            lead={item.companyName}
            rest={
              <>
                {' '}
                {t('superadmin.next.dashboard.attention.unconfigured', {
                  missing: joinNor(
                    t,
                    item.missing.map((part) => t(MISSING_KEY[part])),
                  ),
                })}
              </>
            }
            sub={t('superadmin.next.dashboard.attention.unconfiguredSub', {
              date: calendarDay(Date.parse(item.createdAt), locale),
              people: countText(t, PERSON_COUNT_KEYS, item.people),
            })}
          />
          <Button asChild variant="outline">
            <Link to={`/admin/companies/${item.companyId}`}>{t('superadmin.next.dashboard.attention.openCompany')}</Link>
          </Button>
        </>
      )
  }
}

function statusText(t: TranslateFn, status: SystemComponentStatus | SystemAggregateStatus): string {
  const key = STATUS_KEY[status]
  return key ? t(key) : status
}

function SystemRow({
  name,
  sub,
  status,
}: {
  name: string
  sub: string
  status: SystemComponentStatus | SystemAggregateStatus
}) {
  const { t } = useTranslation()
  const tone = toneOf(status)
  return (
    <li data-system-status={status} className="flex items-center justify-between gap-2.5 border-t border-line-light py-2">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-base font-medium text-fg-primary">{name}</span>
        <span className="text-2xs text-fg-light">{sub}</span>
      </div>
      <Chip
        tone={tone}
        icon={tone === 'good' ? <Check className="size-3" /> : <Clock className="size-3" />}
        label={statusText(t, status)}
      />
    </li>
  )
}

function SystemPanel({ system }: { system: SystemStatusResponse | null }) {
  const { t, locale } = useTranslation()
  const time = system
    ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(system.checkedAt))
    : null
  const jobs = system?.jobs ?? []
  const healthy = jobs.filter((job) => job.status === 'ok').length
  const last = latestSuccess(jobs)

  return (
    <Panel
      labelledBy="platform-system"
      heading={
        <h2 id="platform-system" className="m-0 text-2xl">
          {t('superadmin.next.dashboard.system.heading')}
        </h2>
      }
      meta={time ? t('superadmin.next.dashboard.system.checkedAt', { time }) : undefined}
    >
      {system ? (
        <>
          <ul className="m-0 flex list-none flex-col p-0">
            <SystemRow
              name={t('superadmin.next.dashboard.system.api')}
              sub={t('superadmin.next.dashboard.system.apiSub', { service: system.service, environment: system.environment })}
              status={system.status}
            />
            <SystemRow
              name={t('superadmin.next.dashboard.system.database')}
              sub={t('superadmin.next.dashboard.system.databaseSub', {
                latency: system.database.latencyMs,
                pooler: system.database.usesTransactionPoolerPort
                  ? t('superadmin.next.dashboard.system.poolerTransaction')
                  : t('superadmin.next.dashboard.system.poolerSession'),
                port: system.database.port,
              })}
              status={system.database.status}
            />
            <SystemRow
              name={t('superadmin.next.dashboard.system.queue')}
              sub={t('superadmin.next.dashboard.system.queueSub', {
                pending: system.notificationQueue.pending,
                dead: system.notificationQueue.deadLettered,
              })}
              status={system.notificationQueue.status}
            />
            <SystemRow
              name={t('superadmin.next.dashboard.system.jobs')}
              sub={
                jobs.length === 0 || last === null
                  ? t('superadmin.next.dashboard.system.jobsNone')
                  : t('superadmin.next.dashboard.system.jobsSub', {
                      ok: healthy,
                      total: jobs.length,
                      when: ago(last, system.checkedAt, locale),
                    })
              }
              status={worstJob(jobs) ?? 'unknown'}
            />
            <SystemRow
              name={t('superadmin.next.dashboard.system.dispatcher')}
              sub={
                system.dispatcher.lastDispatchAt === null
                  ? system.notificationQueue.pending === 0
                    ? t('superadmin.next.dashboard.system.dispatcherNeverEmpty')
                    : t('superadmin.next.dashboard.system.dispatcherNeverPending', {
                        pending: system.notificationQueue.pending,
                      })
                  : t('superadmin.next.dashboard.system.dispatcherLast', {
                      when: ago(system.dispatcher.lastDispatchAt, system.checkedAt, locale),
                    })
              }
              status={system.dispatcher.status}
            />
          </ul>
          <Link to="/admin/system" className="inline-flex items-center gap-1 self-start text-xs">
            {t('superadmin.next.dashboard.system.viewSystem')}
            <ArrowRight aria-hidden="true" className="size-3" />
          </Link>
        </>
      ) : (
        <p className="m-0 text-xs text-fg-secondary">{t('superadmin.next.dashboard.system.failed')}</p>
      )}
    </Panel>
  )
}

function MixPanel({ model }: { model: PlatformModel }) {
  const { t, locale } = useTranslation()
  const mix = model.mix
  // The reader's language, never the runtime's: without it a Spanish page read "and".
  const list = (names: readonly string[]) => new Intl.ListFormat(locale, { type: 'conjunction' }).format(names)

  return (
    <Panel
      labelledBy="platform-mix"
      heading={
        <h2 id="platform-mix" className="m-0 text-2xl">
          {t('superadmin.next.dashboard.mix.heading')}
        </h2>
      }
      meta={mix ? t('superadmin.next.dashboard.mix.total', { count: mix.total }) : undefined}
    >
      {mix === null ? (
        <p className="m-0 text-xs text-fg-secondary">{t('superadmin.next.dashboard.mix.unavailable')}</p>
      ) : mix.total === 0 ? (
        <p className="m-0 text-xs text-fg-secondary">{t('superadmin.next.dashboard.mix.empty')}</p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <span aria-hidden="true" className="flex h-2.5 gap-0.5 overflow-hidden rounded-sm">
              {SEGMENTS.filter((segment) => mix[segment.key] > 0).map((segment) => (
                <span
                  key={segment.key}
                  className={segment.className}
                  style={{ width: `${percentOf(mix[segment.key], mix.total)}%` }}
                />
              ))}
            </span>
            <ul className="m-0 flex list-none flex-wrap gap-x-3.5 gap-y-1.5 p-0">
              {SEGMENTS.map((segment) => (
                <li key={segment.key} className="inline-flex items-center gap-1.5 text-2xs text-fg-tertiary">
                  <span aria-hidden="true" className={cn('inline-block size-2.5 rounded-sm', segment.className)} />
                  {countText(t, STATUS_COUNT_KEYS[segment.key], mix[segment.key])}
                </li>
              ))}
            </ul>
          </div>
          {(model.openCompanies.length > 0 || model.draftCompanies.length > 0) && (
            <p className="m-0 text-xs text-fg-tertiary">
              {[
                model.openCompanies.length > 0
                  ? t('superadmin.next.dashboard.mix.openFrom', { companies: list(model.openCompanies) })
                  : null,
                model.draftCompanies.length > 0
                  ? t('superadmin.next.dashboard.mix.draftsFrom', { companies: list(model.draftCompanies) })
                  : null,
              ]
                .filter(Boolean)
                .join(' ')}
            </p>
          )}
        </>
      )}
    </Panel>
  )
}

function PeoplePanel({ model }: { model: PlatformModel }) {
  const { t } = useTranslation()
  const most = Math.max(1, ...model.rows.map((row) => row.people), model.peopleWithoutCompany)
  return (
    <Panel
      labelledBy="platform-people"
      heading={
        <h2 id="platform-people" className="m-0 text-2xl">
          {t('superadmin.next.dashboard.people.heading')}
        </h2>
      }
      meta={t('superadmin.next.dashboard.people.total', { count: model.userCount })}
    >
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {model.rows.map((row) => (
          <li key={row.id} className="grid grid-cols-[8rem_minmax(0,1fr)_2.5rem] items-center gap-2.5 text-xs">
            <span className="truncate text-fg-primary">{row.name}</span>
            <MiniBar percent={percentOf(row.people, most)} className="w-full" />
            <span className="text-right font-mono tabular-nums text-fg-primary">{row.people}</span>
          </li>
        ))}
        {model.peopleWithoutCompany > 0 && (
          <li className="grid grid-cols-[8rem_minmax(0,1fr)_2.5rem] items-center gap-2.5 text-xs">
            <span className="truncate text-fg-tertiary">{t('superadmin.next.dashboard.people.noCompany')}</span>
            <MiniBar percent={percentOf(model.peopleWithoutCompany, most)} muted className="w-full" />
            <span className="text-right font-mono tabular-nums text-fg-tertiary">{model.peopleWithoutCompany}</span>
          </li>
        )}
      </ul>
    </Panel>
  )
}
