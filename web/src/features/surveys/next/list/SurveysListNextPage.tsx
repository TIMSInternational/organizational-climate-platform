import { Link } from 'react-router'
import { Plus } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../../i18n'
import { PageTopBar } from '../../../../components/layout'
import { Button, EmptyState, Input, LoadingRegion, NetworkError, SkeletonText, Table } from '../../../../components/ui'
import { useViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { formatMetric } from '../../../../components/charts/formatMetric'
import { calendarDay } from '../../../../lib/calendarDay'
import { cn } from '../../../../lib/cn'
import { daysBetween } from '../../../dashboard/next/derive'
import { statusLabel, typeLabel } from '../../surveyVocabulary'
import { surveyResponseReading } from '../../surveyListView'
import { groupBySection, primaryActionFor, sectionOf, type PrimaryActionKind } from './derive'
import type { SurveyRow, SurveySection } from './model'
import { useSurveysListModel } from './useSurveysListModel'

const HEAD =
  'bg-surface-icon-box text-2xs font-semibold uppercase tracking-label text-fg-secondary whitespace-nowrap'

const ACTION_KEY: Record<PrimaryActionKind, string> = {
  distribution: 'surveys.distribution.title',
  results: 'surveys.results',
  open: 'surveys.open',
}

const SECTION_KEY: Record<SurveySection, string> = {
  open: 'surveys.next.list.openHeading',
  upcoming: 'surveys.next.list.upcomingHeading',
  closed: 'surveys.next.list.closedHeading',
  archived: 'surveys.next.list.archivedHeading',
}

/**
 * `/surveys` — the redesigned Todas las Encuestas, which replaced `SurveysListPage` on
 * this route (the old page stays in the tree, unrouted, as the wiring reference).
 *
 * Same request and same scoping as `SurveysListPage` (`useSurveysListModel`); what
 * changes is the reading: the open survey first, then what is coming, then what
 * closed newest-first, and the archived rows last and demoted; one primary action
 * per row, by status and by what the viewer may do (`derive.ts`); "no invitation
 * list" where the old table printed an em dash; every filter in one row.
 *
 * Roles: `canAuthorSurveys` draws "New survey" and the Distribution action;
 * `canOpenResults(row)` draws Results — a `company_admin` for their own tenant's
 * rows, a `super_admin` for any. A leader gets the list the server scopes for them,
 * with "Open" as the one action, which is what today's list already offers them.
 */
export default function SurveysListNextPage() {
  const { t, locale } = useTranslation()
  const capabilities = useViewerCapabilities()
  const state = useSurveysListModel()
  const sections = groupBySection(state.visible)

  return (
    <div>
      <PageTopBar
        eyebrow={state.model.companyName}
        title={t('navigation.surveys')}
        description={t('surveys.next.list.description')}
        actions={
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
        className="mb-panel-gap flex flex-wrap items-center gap-inline"
        onSubmit={(event) => {
          event.preventDefault()
          state.apply()
        }}
      >
        <Input
          type="search"
          aria-label={t('surveys.next.list.searchPlaceholder')}
          placeholder={t('surveys.next.list.searchPlaceholder')}
          value={state.draft.q}
          onChange={(event) => state.setDraft({ ...state.draft, q: event.target.value })}
          className="w-full sm:w-72"
        />
        <label className="mb-0">
          <span className="sr-only">{t('surveys.typeLabel')}</span>
          <select
            value={state.draft.type}
            onChange={(event) => {
              const next = { ...state.draft, type: event.target.value }
              state.setDraft(next)
            }}
          >
            <option value="">{t('surveys.next.list.allTypes')}</option>
            {state.availableTypes.map((type) => (
              <option key={type} value={type}>
                {typeLabel(t, type)}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" size="sm" variant="outline" disabled={state.status === 'loading'}>
          {t('common.search')}
        </Button>
        <div role="group" aria-label={t('surveys.filterByStatus')} className="flex flex-wrap gap-1">
          {[{ status: '', count: state.model.rows.length }, ...state.facets].map((facet) => {
            const selected = state.statusFilter === facet.status
            return (
              <Button
                key={facet.status}
                type="button"
                size="sm"
                variant={selected ? 'default' : 'ghost'}
                aria-pressed={selected}
                onClick={() => state.setStatusFilter(facet.status)}
              >
                {t('surveys.next.list.chipCount', {
                  label: facet.status === '' ? t('common.all') : statusLabel(t, facet.status),
                  count: facet.count,
                })}
              </Button>
            )
          })}
        </div>
        <p className="m-0 ml-auto text-xs text-fg-secondary">
          {t('surveys.next.list.countSummary', { count: state.model.rows.length })}
        </p>
      </form>

      {state.status === 'error' ? (
        <NetworkError
          title={t('errors.generic')}
          description={state.error ?? undefined}
          onRetry={state.reload}
          retryText={t('common.retry')}
        />
      ) : (
        <LoadingRegion loading={state.status === 'loading'} label={t('common.loading')}>
          {state.status === 'loading' ? (
            <SkeletonText lines={4} />
          ) : sections.length === 0 ? (
            <EmptyState fill title={t('surveys.noSurveysFound')} description={t('surveys.tryAdjustingFilters')} />
          ) : (
            <div className="flex flex-col gap-section">
              {sections.map(({ section, rows }) => (
                <section
                  key={section}
                  aria-labelledby={`surveys-next-${section}`}
                  data-section={section}
                  data-demoted={section === 'archived' ? 'true' : 'false'}
                  className={cn(section === 'archived' && 'opacity-80')}
                >
                  <div className="mb-inline flex flex-wrap items-baseline justify-between gap-inline">
                    <h2 id={`surveys-next-${section}`} className={cn('m-0', section === 'archived' ? 'text-sm text-fg-secondary' : 'text-base')}>
                      {t(SECTION_KEY[section])}{' '}
                      <span className="font-mono text-xs font-normal text-fg-label tabular-nums">{rows.length}</span>
                    </h2>
                    {section === 'open' && <p className="m-0 text-xs text-fg-secondary">{t('surveys.next.list.openNote')}</p>}
                    {section === 'archived' && <p className="m-0 text-xs text-fg-secondary">{t('surveys.next.list.archivedNote')}</p>}
                  </div>
                  <div className="overflow-hidden rounded-xl border border-line-light">
                    <Table>
                      <thead>
                        <tr>
                          <th className={HEAD}>{t('surveys.next.list.colSurvey')}</th>
                          <th className={HEAD}>{t('common.status')}</th>
                          <th className={HEAD}>{t('surveys.responses')}</th>
                          <th className={HEAD}>{t('surveys.participation')}</th>
                          <th className={HEAD}>{t('surveys.next.list.colClose')}</th>
                          <th className={cn(HEAD, 'text-right')}>
                            <span className="sr-only">{t('common.actions')}</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <SurveyTableRow key={row.id} row={row} t={t} locale={locale} capabilities={capabilities} />
                        ))}
                      </tbody>
                    </Table>
                  </div>
                </section>
              ))}
            </div>
          )}
        </LoadingRegion>
      )}
    </div>
  )
}

function SurveyTableRow({
  row,
  t,
  locale,
  capabilities,
}: {
  row: SurveyRow
  t: TranslateFn
  locale: string
  capabilities: ReturnType<typeof useViewerCapabilities>
}) {
  const section = sectionOf(row.status)
  const name = row.title ?? t('surveys.untitled')
  const reading = surveyResponseReading(row.responseCount, row.targetAudienceCount)
  const action = primaryActionFor(row, capabilities)
  const running = row.status === 'active'
  const daysLeft = running ? daysBetween(new Date().toISOString(), row.endDate) : null
  const datePhrase =
    section === 'open'
      ? t('surveys.next.list.opened', { date: calendarDay(Date.parse(row.startDate), locale) })
      : section === 'upcoming'
        ? t('surveys.next.list.opens', { date: calendarDay(Date.parse(row.startDate), locale) })
        : t('surveys.next.list.closedOn', { date: calendarDay(Date.parse(row.endDate), locale) })

  return (
    <tr data-survey-id={row.id} data-status={row.status}>
      <td>
        <Link
          to={`/surveys/${row.id}`}
          aria-label={t('surveys.openNamed', { title: name })}
          className={cn('block wrap-anywhere font-semibold', section === 'archived' ? 'text-fg-secondary' : 'text-fg-primary')}
        >
          {name}
        </Link>
        <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-fg-secondary">
          <span>{typeLabel(t, row.type)}</span>
          <span aria-hidden="true">·</span>
          <span>{t('surveys.reviewQuestionCount', { count: row.questionCount })}</span>
          <span aria-hidden="true">·</span>
          <span>{datePhrase}</span>
        </span>
      </td>
      <td>
        <span
          className={cn(
            'inline-flex h-5 w-fit items-center gap-1 rounded-lg border px-2 text-xs font-semibold',
            running
              ? 'border-accent-green-ring bg-accent-green-soft text-fg-primary'
              : 'border-line-light bg-surface-icon-box text-fg-secondary',
          )}
        >
          {running && <span aria-hidden="true" className="size-1.5 rounded-full bg-accent-green" />}
          {statusLabel(t, row.status)}
        </span>
      </td>
      <td className="whitespace-nowrap font-mono tabular-nums">
        {section === 'closed'
          ? t('surveys.next.list.completed', { count: reading.count })
          : reading.target === null
            ? reading.count
            : t('surveys.responseProgress', { count: reading.count, target: reading.target })}
      </td>
      <td>
        {reading.percent === null ? (
          <span data-slot="no-invite-list" className="text-xs text-fg-secondary">
            {section === 'archived' && reading.count === 0
              ? t('surveys.next.list.noSubmissions')
              : t('surveys.next.list.noInviteList')}
          </span>
        ) : (
          <span className="flex items-center gap-inline">
            <span aria-hidden="true" className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-line-light">
              <span className="block h-full rounded-full bg-accent-blue" style={{ width: `${Math.min(reading.percent, 100)}%` }} />
            </span>
            <span className="font-mono tabular-nums text-fg-secondary">
              {formatMetric(reading.percent, { kind: 'percentage' }, locale)}
            </span>
          </span>
        )}
      </td>
      <td className="whitespace-nowrap font-mono tabular-nums text-fg-secondary">
        {section === 'archived' ? (
          <span aria-hidden="true">—</span>
        ) : (
          <span className="flex flex-col">
            <span>{calendarDay(Date.parse(row.endDate), locale)}</span>
            {daysLeft !== null && daysLeft > 0 && (
              <span className="font-sans text-xs">{t('surveys.next.list.inDays', { count: daysLeft })}</span>
            )}
          </span>
        )}
      </td>
      <td className="text-right">
        {action && (
          <Button asChild size="sm" variant={action.kind === 'open' ? 'ghost' : 'outline'}>
            <Link to={action.to} data-action={action.kind} aria-label={`${t(ACTION_KEY[action.kind])}: ${name}`}>
              {t(ACTION_KEY[action.kind])}
            </Link>
          </Button>
        )}
      </td>
    </tr>
  )
}
