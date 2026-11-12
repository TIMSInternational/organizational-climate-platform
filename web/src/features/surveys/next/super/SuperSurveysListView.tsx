import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ChevronDown, Download, MoreHorizontal, Plus, Search } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../../i18n'
import { PageHeader } from '../../../../components/layout'
import CompanyContextBar from '../../../../components/layout/CompanyContextBar'
import {
  Alert,
  AlertDescription,
  Button,
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  LoadingRegion,
  NetworkError,
  SegmentedControl,
  SkeletonText,
  Table,
  TableHead,
  type ChipStatusTone,
} from '../../../../components/ui'
import { useCompanyContext, useCompanyScope } from '../../../../company-context'
import { readViewerClaims, useViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { formatMetric } from '../../../../components/charts/formatMetric'
import { calendarDay, calendarDayLong } from '../../../../lib/calendarDay'
import { cn } from '../../../../lib/cn'
import { downloadBlobFile } from '../../../../lib/downloadBlobFile'
import { allResponsesFileName, getAllResponsesWorkbook } from '../../api/responseExport'
import { companyStatusFileName, getDeliveryAuditWorkbook } from '../../api/statusExport'
import { StatusWorkbookButton } from '../StatusWorkbookButton'

/**
 * The API origin, the same way every other caller reads it. An empty string here is not a
 * harmless default: it makes the request a relative path, which resolves against the WEB
 * origin, and the SPA host answers unknown paths with `index.html` and a 200 — so the
 * download succeeds and saves the app shell under an .xlsx name.
 */
const RESPONSE_EXPORT_BASE_URL = import.meta.env.VITE_API_BASE_URL
import { companyShortName } from '../../../../lib/companyShortName'
import { signedReading } from '../../../dashboard/next/derive'
import { statusLabel, typeLabel } from '../../surveyVocabulary'
import { surveyResponseReading } from '../../surveyListView'
import { menuItemsFor, primaryActionFor, sectionOf, visibleFacets, type PrimaryActionKind, type RowCapabilities } from '../list/derive'
import type { SurveyRow, SurveySection, WaveReading } from '../list/model'
import {
  closedNote,
  closedOrdinal,
  companyCount,
  daysLeft,
  draftsNote,
  groupSuperSections,
  sharedOpenWave,
  upcomingKind,
} from './derive'
import { useSuperSurveysListModel, type SuperSurveysListModelState } from './useSuperSurveysListModel'
import { byCount } from '../../../../i18n/plural'

const ACTION_KEY: Record<PrimaryActionKind, string> = {
  distribution: 'surveys.distribution.title',
  results: 'surveys.results',
  open: 'surveys.open',
}

const FACET_KEY: Record<string, string> = {
  '': 'surveys.next.list.facetAll',
  draft: 'surveys.next.list.facetDraft',
  scheduled: 'surveys.next.list.facetScheduled',
  active: 'surveys.next.list.facetActive',
  closed: 'surveys.next.list.facetClosed',
  archived: 'surveys.next.list.facetArchived',
}

// The canvas's `.label` head over the default hairline, as the company administrator's list draws it.
// The header row pads only its bottom: the card's `pt-2` is the board's `padding: 8px 0 0`, and
// the board's header row is `padding: 0 12px 8px` — 31px from the card's edge to the rule.
// The head itself is the `TableHead` primitive — the Apple board's `.tbl th`, 13px semibold in
// sentence case, not the 11px uppercase the type ruling keeps for eyebrows.
const HEAD = 'h-auto pt-0 pb-2 leading-normal border-b border-line-default'

/**
 * A super administrator acts on any tenant's survey: `CanAdminister` short-circuits on
 * `super_admin` before it compares a company (`SurveyEndpoints.cs:55-57`), and the results
 * read goes through the same guard (`SurveyResultsEndpoints.cs:199-202`). So each row's one
 * action is chosen by status alone — Distribución for the open survey, Resultados for a
 * closed one — whatever company is (or is not) chosen in the strip above. Creating is
 * different: `POST /surveys` needs a company to name, so "Nueva encuesta" follows
 * `canAuthorSurveys`, which asks for one (`viewerCapabilities.ts`).
 */
const SUPER_ROW: RowCapabilities = { canAuthorSurveys: true, canOpenResults: () => true }

/**
 * The SuperSurveysList artboard stacks what closed straight under what is open — the wave just
 * read sits under the wave being answered, across tenants — and the drafts after both; the
 * archived block stays last and demoted (`groupSuperSections`). The chip row follows the same
 * reading order.
 */
const FACET_ORDER: readonly string[] = ['active', 'closed', 'draft', 'scheduled', 'archived']

function facetRank(status: string): number {
  const index = FACET_ORDER.indexOf(status)
  return index === -1 ? FACET_ORDER.length : index
}

function waveOrdinal(t: TranslateFn, place: number): string {
  if (place >= 2 && place <= 10) return t(`surveys.next.super.wave${place}`)
  return t('surveys.next.super.waveN', { n: place })
}

/**
 * The super administrator's `/surveys` — the SuperSurveysList artboard of the per-role canvas
 * (10 Sep): the company administrator's redesigned list (sort open first, one primary action
 * per row, "sin lista de invitados" instead of a dash) plus an Empresa column and a company
 * filter, because `GET /surveys` answers this role across every tenant. `SurveysListNextPage`
 * dispatches here by role; nothing of the company administrator's view is restyled.
 */
export default function SuperSurveysListView() {
  const { t, locale } = useTranslation()
  const scope = useCompanyScope()
  const headerCompanyId = scope.status === 'ready' ? (scope.companyId ?? '') : ''
  const capabilities = useViewerCapabilities()
  const model = useSuperSurveysListModel()
  const filesCompany = model.company || headerCompanyId
  const { base } = model
  const sections = groupSuperSections(model.visible)
  const facets = [
    { status: '', count: model.rows.length },
    ...visibleFacets(model.facets, base.statusFilter).sort((a, b) => facetRank(a.status) - facetRank(b.status)),
  ]
  const companies = companyCount(model.rows)

  return (
    <div>
      <CompanyContextBar
        note={scope.status === 'ready' ? t('surveys.next.super.barNoteChosen') : t('surveys.next.super.barNoteUnchosen')}
      />
      <PageHeader
        eyebrow={t('surveys.next.super.eyebrow')}
        title={t('navigation.surveys')}
        description={t('surveys.next.super.description')}
        actions={
          capabilities.canAuthorSurveys || readViewerClaims().role === 'super_admin' ? (
            <>
            {readViewerClaims().role === 'super_admin' && <AllResponsesButton t={t} />}
            {/* Once a company is picked: its status workbook (what the client receives) and the
                delivery audit (what TIMS keeps). A super admin has no company claim, so the
                tenant page's status button never reached the people who send that file. */}
            {/* The table's company filter, or else the header's company: the header said a
                client while these buttons waited for the filter, two notions of "the chosen
                company" on one page (walkthrough, C). */}
            {readViewerClaims().role === 'super_admin' && filesCompany && (
              <CompanyFilesButtons
                companyId={filesCompany}
                companyName={model.companyNames.get(filesCompany) ?? ''}
                t={t}
              />
            )}
            <Button asChild variant="outline"><Link to="/surveys/import">{t('climateWorkbook.title')}</Link></Button>
            </>
          ) : undefined
        }
        primaryAction={
          capabilities.canAuthorSurveys ? (
            <Button asChild variant="primary">
              <Link to="/surveys/new">
                <Plus aria-hidden="true" />
                {t('surveys.newSurvey')}
              </Link>
            </Button>
          ) : undefined
        }
      />

      <form
        role="search"
        data-slot="list-filters"
        className="mb-6 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          base.apply()
        }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-65">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-label" />
            <Input
              type="search"
              aria-label={t('surveys.next.list.searchPlaceholder')}
              placeholder={t('surveys.next.list.searchPlaceholder')}
              value={base.draft.q}
              onChange={(event) => base.setDraft({ ...base.draft, q: event.target.value })}
              className="pl-8"
            />
          </div>
          <FilterSelect
            label={t('surveys.next.super.colCompany')}
            className="sm:w-50"
            value={model.company}
            onChange={model.setCompany}
          >
            <option value="">{t('surveys.next.super.allCompanies')}</option>
            {[...model.companyNames.entries()].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label={t('surveys.typeLabel')}
            className="sm:w-40"
            value={base.draft.type}
            onChange={(type) => base.apply({ ...base.draft, type })}
          >
            <option value="">{t('surveys.next.list.allTypes')}</option>
            {base.availableTypes.map((type) => (
              <option key={type} value={type}>
                {typeLabel(t, type)}
              </option>
            ))}
          </FilterSelect>
          <p data-slot="list-summary" className="m-0 text-sm whitespace-nowrap tabular-nums text-fg-tertiary sm:ml-auto">
            {companies === 1
              ? t('surveys.next.super.summaryOneCompany', { count: model.rows.length })
              : t('surveys.next.super.summary', { count: model.rows.length, companies })}
          </p>
        </div>
        {/* The board's `.seg`: one segmented control over the statuses that exist on the
            platform, in the artboard's reading order. It narrows the rows already read. */}
        <SegmentedControl
          label={t('surveys.filterByStatus')}
          value={base.statusFilter}
          onChange={base.setStatusFilter}
          className="max-w-full self-start flex-wrap"
          options={facets.map((facet) => ({
            value: facet.status,
            label: t('surveys.next.list.chipCount', {
              label: FACET_KEY[facet.status] ? t(FACET_KEY[facet.status]) : statusLabel(t, facet.status),
              count: facet.count,
            }),
          }))}
        />
      </form>

      {base.actionError && (
        <Alert variant="destructive" role="alert" className="mb-6">
          <AlertDescription>{base.actionError}</AlertDescription>
        </Alert>
      )}

      {base.status === 'error' ? (
        <NetworkError title={t('errors.generic')} description={base.error ?? undefined} onRetry={base.reload} retryText={t('common.retry')} />
      ) : (
        <LoadingRegion loading={base.status === 'loading'} label={t('common.loading')}>
          {base.status === 'loading' ? (
            <SkeletonText lines={4} />
          ) : sections.length === 0 ? (
            <EmptyState fill title={t('surveys.noSurveysFound')} description={t('surveys.tryAdjustingFilters')} />
          ) : (
            <div className="flex flex-col gap-6">
              {sections.map(({ section, rows }) => (
                <SectionBlock key={section} section={section} rows={rows} model={model} t={t} locale={locale} />
              ))}
            </div>
          )}
        </LoadingRegion>
      )}
    </div>
  )
}

function FilterSelect({
  label,
  className,
  value,
  onChange,
  children,
}: {
  label: string
  className: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <label className={cn('relative mb-0 w-full', className)}>
      <span className="sr-only">{label}</span>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-fg-label" />
      <select className="mt-0 block w-full appearance-none pr-8" value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  )
}

function sectionNote(
  section: SurveySection,
  rows: SurveyRow[],
  model: SuperSurveysListModelState,
  t: TranslateFn,
  locale: string,
): string | null {
  if (section === 'open') {
    const wave = sharedOpenWave(rows)
    return wave && companyCount(rows) > 1 ? t('surveys.next.super.openNoteWave', { wave }) : t('surveys.next.super.openNote')
  }
  if (section === 'closed') {
    const note = closedNote(rows)
    if (!note) return null
    const parts = [
      ...(note.each !== null ? [t('surveys.next.list.closedNoteEach', { count: note.each })] : []),
      ...(note.noInviteLists ? [t('surveys.next.super.closedNoInvites')] : []),
    ]
    return parts.length > 0 ? parts.join(' · ') : null
  }
  if (section === 'upcoming') {
    const note = draftsNote(rows)
    if (!note) return null
    const full = note.companyId ? model.companyNames.get(note.companyId) : undefined
    // A sentence names the tenant as the canvas does, without its legal form: "Todos de Acme".
    const company = full ? companyShortName(full) : undefined
    const parts = [
      ...(company ? [t('surveys.next.super.draftsSameCompany', { company })] : []),
      ...(note.oneQuestion ? [t('surveys.next.super.draftsOneQuestion')] : []),
      t('surveys.next.super.draftsSince', { date: calendarDayLong(Date.parse(note.since), locale) }),
    ]
    return parts.join(', ')
  }
  return null
}

function SectionBlock({
  section,
  rows,
  model,
  t,
  locale,
}: {
  section: SurveySection
  rows: SurveyRow[]
  model: SuperSurveysListModelState
  t: TranslateFn
  locale: string
}) {
  const archived = section === 'archived'
  const heading =
    section === 'open'
      ? t('surveys.next.super.openHeading')
      : section === 'closed'
        ? t('surveys.next.list.closedHeading')
        : section === 'archived'
          ? t('surveys.next.list.archivedHeading')
          : upcomingKind(rows) === 'drafts'
            ? t('surveys.next.super.draftsHeading')
            : upcomingKind(rows) === 'scheduled'
              ? t('surveys.next.super.scheduledHeading')
              : t('surveys.next.list.upcomingHeading')
  const note = sectionNote(section, rows, model, t, locale)

  return (
    <section
      aria-labelledby={`surveys-super-${section}`}
      data-section={section}
      data-demoted={archived ? 'true' : 'false'}
      className={cn('flex flex-col', archived ? 'gap-2.5' : 'gap-3')}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h2 id={`surveys-super-${section}`} className={cn('m-0', archived ? 'font-sans text-base font-semibold text-fg-label' : 'text-2xl')}>
            {heading}
          </h2>
          <span className="text-sm tabular-nums text-fg-tertiary">{rows.length}</span>
        </div>
        {note && (
          <p data-slot="section-note" className="m-0 text-sm text-fg-tertiary sm:text-right">
            {note}
          </p>
        )}
      </div>
      {/* The board's `.card.flush`: 12px radius, the panel hairline, no shadow. */}
      <div className={cn('overflow-hidden rounded-xl border border-line-panel bg-surface-card', archived ? 'border-dashed' : 'pt-2')}>
        {/* The canvas's grid from xl — `minmax(0,1fr) 170px 96px 110px 160px 104px 140px`, 12px
            between — with each fixed column carrying the gap before it; narrower than that the
            table scrolls inside this card and never pushes the page. */}
        <div className="relative overflow-x-auto">
          <Table className="w-full min-w-268 table-fixed border-collapse">
            <colgroup>
              <col />
              <col className="w-45.5" />
              <col className="w-27" />
              <col className="w-30.5" />
              <col className="w-43" />
              <col className="w-29" />
              <col className="w-38" />
            </colgroup>
            <thead className={archived ? 'sr-only' : undefined}>
              <tr>
                <TableHead className={HEAD}>{t('surveys.next.list.colSurvey')}</TableHead>
                <TableHead className={cn(HEAD, 'pl-0')}>{t('surveys.next.super.colCompany')}</TableHead>
                <TableHead className={cn(HEAD, 'pl-0')}>{t('common.status')}</TableHead>
                <TableHead className={cn(HEAD, 'pl-0')}>{t('surveys.responses')}</TableHead>
                <TableHead className={cn(HEAD, 'pl-0')}>{t('surveys.participation')}</TableHead>
                <TableHead className={cn(HEAD, 'pl-0')}>{t('surveys.next.list.colClose')}</TableHead>
                <TableHead className={cn(HEAD, 'pl-0 text-right')}>
                  <span className="sr-only">{t('common.actions')}</span>
                </TableHead>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <SuperRow key={row.id} row={row} model={model} t={t} locale={locale} />
              ))}
            </tbody>
          </Table>
        </div>
      </div>
      {archived && <p className="m-0 text-sm text-fg-tertiary">{t('surveys.next.list.archivedNote')}</p>}
    </section>
  )
}

/**
 * Status chips are gray except the open survey, which wears the blue live chip (the user's
 * ruling of 11 Nov: green, amber and red are the three result areas and nothing else). The
 * open row was Fortaleza's green and a draft Oportunidad's amber.
 */
function statusTone(section: SurveySection): ChipStatusTone {
  return section === 'open' ? 'live' : 'neutral'
}

function closeLine(
  row: SurveyRow,
  section: SurveySection,
  reading: WaveReading | null,
  model: SuperSurveysListModelState,
  t: TranslateFn,
  locale: string,
): string | null {
  if (section === 'open') {
    const days = daysLeft(row.endDate)
    return days > 0 ? t(byCount(days, 'surveys.next.list.inDaysOne', 'surveys.next.list.inDays'), { count: days }) : null
  }
  if (section === 'upcoming') return t('surveys.next.super.plannedClose')
  if (section !== 'closed') return null
  // Its own company's move when that company's trends were read; its place in the company's
  // series otherwise — a fact of the list, never a sample move.
  if (reading && !reading.first && reading.delta !== null && reading.previousCode) {
    return t('surveys.next.list.vsWave', { delta: signedReading(reading.delta, locale, 2), wave: reading.previousCode })
  }
  const place = closedOrdinal(row, model.base.model.rows)
  return place === 1 ? t('surveys.next.list.firstReading') : waveOrdinal(t, place)
}

function SuperRow({ row, model, t, locale }: { row: SurveyRow; model: SuperSurveysListModelState; t: TranslateFn; locale: string }) {
  const section = sectionOf(row.status)
  const archived = section === 'archived'
  const upcoming = section === 'upcoming'
  const name = row.title ?? t('surveys.untitled')
  const counts = surveyResponseReading(row.responseCount, row.targetAudienceCount)
  const action = primaryActionFor(row, SUPER_ROW)
  const questions =
    row.questionCount === 1 ? t('surveys.next.super.questionOne') : t('surveys.next.super.questionsMany', { count: row.questionCount })
  const language = row.language === 'en' ? t('surveys.next.super.langEn') : row.language === 'es' ? t('surveys.next.super.langEs') : null
  const when =
    section === 'open'
      ? t('surveys.next.list.opened', { date: calendarDay(Date.parse(row.startDate), locale) })
      : section === 'closed'
        ? t('surveys.next.list.closedOn', { date: calendarDay(Date.parse(row.endDate), locale) })
        : upcoming
          ? // "creado el 8 ago" — the draft (el borrador), as the artboard writes it.
            t('surveys.next.super.draftCreatedOn', { date: calendarDay(Date.parse(row.createdAt), locale) })
          : t('surveys.next.list.createdOn', { date: calendarDay(Date.parse(row.createdAt), locale) })
  const meta = [questions, ...(upcoming && language ? [language] : []), when].join(' · ')
  const line = closeLine(row, section, model.readings.get(row.id) ?? null, model, t, locale)
  const ink = archived ? 'text-fg-label' : 'text-fg-primary'
  const company = model.companyNames.get(row.companyId) ?? t('surveys.next.super.otherCompany')
  // Distribución scopes its audience to the company chosen in the strip and refuses until that
  // is the survey's own (`SurveyDistributionPage.tsx`, `scopedToSurvey`), so with nothing — or
  // another tenant — chosen, the row chooses its own company on the way there.
  const { scope: chosen, selectCompany } = useCompanyContext()
  const chooseOwnCompany = () => {
    if (chosen.companyId !== row.companyId) selectCompany(row.companyId)
  }

  return (
    <tr data-survey-id={row.id} data-status={row.status} className="border-b border-line-light last:border-b-0">
      <td className="px-3 py-3">
        <div className="flex min-w-0 flex-col">
          <Link to={`/surveys/${row.id}`} aria-label={t('surveys.openNamed', { title: name })} className={cn('truncate text-base font-semibold', ink)}>
            {name}
          </Link>
          <span data-slot="row-meta" className="truncate text-xs leading-normal text-fg-label">{meta}</span>
        </div>
      </td>
      <td className="py-3 pr-3 pl-0">
        <span data-slot="row-company" className="block truncate text-sm font-medium text-fg-secondary">
          {company}
        </span>
      </td>
      <td className="py-3 pr-3 pl-0">
        <Chip tone={statusTone(section)} label={statusLabel(t, row.status)} />
      </td>
      <td className="py-3 pr-3 pl-0 whitespace-nowrap">
        {upcoming ? (
          <span className="text-sm text-fg-label">{t('surveys.next.super.unpublished')}</span>
        ) : (
          <span className="flex items-baseline gap-1.5">
            <span className={cn('text-lg font-semibold tabular-nums', ink)}>{counts.count}</span>
            {section === 'closed' ? (
              <span className="text-sm text-fg-secondary">{t('surveys.next.list.completedUnit')}</span>
            ) : counts.target !== null ? (
              <span className={cn('text-sm', archived ? 'text-fg-label' : 'text-fg-secondary')}>
                {t('surveys.next.list.ofAudience', { target: counts.target })}
              </span>
            ) : null}
          </span>
        )}
      </td>
      <td className="py-3 pr-3 pl-0">
        {upcoming || (archived && counts.count === 0) ? (
          <span className="text-sm text-fg-label">{t('surveys.next.list.noSubmissions')}</span>
        ) : counts.percent === null ? (
          <span data-slot="no-invite-list" className="text-sm text-fg-label">
            {t('surveys.next.list.noInviteList')}
          </span>
        ) : archived ? (
          <span className="text-sm tabular-nums text-fg-tertiary">{formatMetric(counts.percent, { kind: 'percentage' }, locale)}</span>
        ) : (
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className="h-1.5 w-22.5 shrink-0 overflow-hidden rounded-full bg-surface-fill">
              <span className="block h-full rounded-full bg-accent-blue" style={{ width: `${Math.min(counts.percent, 100)}%` }} />
            </span>
            <span className="text-sm tabular-nums text-fg-secondary">{formatMetric(counts.percent, { kind: 'percentage' }, locale)}</span>
          </span>
        )}
      </td>
      <td className="py-3 pr-3 pl-0 whitespace-nowrap">
        {archived ? (
          <span aria-hidden="true" className="text-base text-fg-label">
            —
          </span>
        ) : (
          <span className="flex flex-col">
            <span className="text-base tabular-nums text-fg-primary">{calendarDay(Date.parse(row.endDate), locale)}</span>
            {line && (
              <span data-slot={section === 'closed' ? 'wave-move' : 'close-note'} className="text-xs leading-normal text-fg-label">
                {line}
              </span>
            )}
          </span>
        )}
      </td>
      <td className="py-3 pr-3 pl-0">
        <div className="flex items-center justify-end gap-2">
          {action && (
            <Button asChild variant="outline">
              <Link
                to={action.to}
                data-action={action.kind}
                aria-label={`${t(ACTION_KEY[action.kind])}: ${name}`}
                onClick={action.kind === 'distribution' ? chooseOwnCompany : undefined}
              >
                {t(ACTION_KEY[action.kind])}
              </Link>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="icon" data-slot="row-menu" aria-label={t('surveys.next.list.moreActions', { title: name })}>
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {menuItemsFor(SUPER_ROW).includes('view') && (
                <DropdownMenuItem asChild>
                  <Link to={`/surveys/${row.id}`}>{t('surveys.next.list.viewSurvey')}</Link>
                </DropdownMenuItem>
              )}
              {menuItemsFor(SUPER_ROW).includes('duplicate') && (
                <DropdownMenuItem disabled={model.base.duplicating !== null} onSelect={() => model.base.duplicate(row.id)}>
                  {t('surveys.duplicate')}
                </DropdownMenuItem>
              )}
              {/* One climate's own responses. The platform-wide button in the header stays:
                  this is the cut TIMS actually works on — one evaluation, one company — and
                  scrolling past 24 other companies' sheets to reach it is not that cut. */}
              {readViewerClaims().role === 'super_admin' && (
                <OneClimateResponsesItem surveyId={row.id} title={row.title ?? ''} t={t} />
              )}
              {/* The same rows without a single answer: the list a client asks for to check
                  demographics before the analysis (Eagle, 2026-11-02). */}
              {readViewerClaims().role === 'super_admin' && (
                <OneClimateResponsesItem surveyId={row.id} title={row.title ?? ''} t={t} demographicsOnly />
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </td>
    </tr>
  )
}

/**
 * One climate's responses, from the row that names it.
 *
 * The failure is shown as the item's own label rather than a toast, and the menu is held open
 * for it: a menu item that closes the menu and does nothing is indistinguishable from a
 * download the browser is still preparing, and the reader would press it again.
 */
function OneClimateResponsesItem({
  surveyId,
  title,
  t,
  demographicsOnly = false,
}: {
  surveyId: string
  title: string
  t: TranslateFn
  demographicsOnly?: boolean
}) {
  const [failed, setFailed] = useState(false)

  async function run() {
    setFailed(false)
    try {
      downloadBlobFile(
        allResponsesFileName(new Date(), title, demographicsOnly ? 'demograficos' : 'respuestas'),
        await getAllResponsesWorkbook(RESPONSE_EXPORT_BASE_URL, surveyId, { answers: !demographicsOnly }),
      )
    } catch {
      setFailed(true)
    }
  }

  return (
    <DropdownMenuItem
      onSelect={(event) => {
        event.preventDefault()
        void run()
      }}
    >
      {failed
        ? t('surveys.next.super.exportFailed')
        : t(demographicsOnly ? 'surveys.next.super.exportOneDemographics' : 'surveys.next.super.exportOne')}
    </DropdownMenuItem>
  )
}

/**
 * The two per-company files, for the company picked in the filter. Each failure is said beside
 * the buttons, as the platform-wide download does: a fetch that rejects gives no sign otherwise.
 */
function CompanyFilesButtons({
  companyId,
  companyName,
  t,
}: {
  companyId: string
  companyName: string
  t: TranslateFn
}) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  // The delivery audit is one file per company with no sheets to choose between, so it stays a
  // single press. Only the status workbook asks which surveys.
  async function downloadAudit() {
    setBusy(true)
    setFailed(false)
    try {
      const blob = await getDeliveryAuditWorkbook(RESPONSE_EXPORT_BASE_URL, companyId)
      downloadBlobFile(companyStatusFileName('auditoria-envios', companyName, new Date()), blob)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {failed && (
        <span className="m-0 text-sm text-accent-red-ink" role="alert">
          {t('surveys.next.super.exportFailed')}
        </span>
      )}
      <StatusWorkbookButton
        companyId={companyId}
        companyName={companyName}
        baseUrl={RESPONSE_EXPORT_BASE_URL}
        label={t('surveys.next.super.companyStatus')}
      />
      <Button type="button" variant="outline" disabled={busy} onClick={() => void downloadAudit()}>
        <Download aria-hidden="true" />
        {busy ? t('surveys.next.super.exportBusy') : t('surveys.next.super.deliveryAudit')}
      </Button>
    </div>
  )
}

/**
 * Downloads every response of every climate as one workbook.
 *
 * Super admin only, and the server says so independently (`ResponseExportEndpoints` returns
 * 403 to anyone else): the control is hidden rather than shown-and-refused, because a button
 * whose only outcome is a permission error teaches the reader nothing.
 *
 * The failure message sits beside the button rather than in a toast. The reader is standing at
 * the control they just pressed, and the one failure mode a download must never have is doing
 * nothing silently — a browser gives no sign that a fetch rejected.
 */
function AllResponsesButton({ t }: { t: TranslateFn }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function download() {
    setBusy(true)
    setFailed(false)
    try {
      downloadBlobFile(allResponsesFileName(new Date()), await getAllResponsesWorkbook(RESPONSE_EXPORT_BASE_URL))
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {failed && (
        <span className="m-0 text-sm text-accent-red-ink" role="alert">
          {t('surveys.next.super.exportFailed')}
        </span>
      )}
      <Button type="button" variant="outline" disabled={busy} onClick={() => void download()}>
        <Download aria-hidden="true" />
        {busy ? t('surveys.next.super.exportBusy') : t('surveys.next.super.exportAll')}
      </Button>
    </div>
  )
}
