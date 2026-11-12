import { Link } from 'react-router'
import { BarChart3, Check, ChevronRight, Copy, Shield } from 'lucide-react'
import { RailInsightsIcon } from '../../../../navigation/railIcons'
import { useTranslation, type TranslateFn } from '../../../../i18n'
import { PageHeader } from '../../../../components/layout'
import CompanyContextBar from '../../../../components/layout/CompanyContextBar'
import { Button, Chip, EmptyState, ErrorState, KpiCard, LoadingState, Note, SkeletonText } from '../../../../components/ui'
import { useCompanyContext, useCompanyScope } from '../../../../company-context'
import { calendarDay } from '../../../../lib/calendarDay'
import { calendarDayWithYear } from '../../../../lib/calendarDayWithYear'
import { cn } from '../../../../lib/cn'
import { insightPriorityLabel, insightTypeLabel } from '../../insightVocabulary'
import { pickLine, tallyInsights, type PickLine } from './insightsDerive'
import { CARD, GeneratedChip, GeneratedNote, SectionHeading } from '../parts'
import type { CompanyPick, InsightRow, InsightsTally } from './insightsModel'
import { useAIInsightsModel, type AIInsightsModelState } from './useAIInsightsModel'

/** Stands in for the score inside a translated sentence, so the figure can be its own span. */
const SCORE_SLOT = '\u0001'

/**
 * The sentence with its score in a span of its own (`confianza <span>82</span> %`), set in the
 * sans at tabular figures — the Apple design's `.num`, not a third typeface.
 */
function withScore(sentence: string, value: string) {
  const [before, ...rest] = sentence.split(SCORE_SLOT)
  if (rest.length === 0) return sentence
  return (
    <>
      {before}
      <span data-slot="score" className="tabular-nums">
        {value}
      </span>
      {rest.join(value)}
    </>
  )
}

/**
 * `/analytics/ai-insights` — the redesigned Información de IA, which replaced
 * `AIInsightsPage` on this route (the old page stays in the tree, unrouted, as the wiring
 * reference), drawn as the per-role canvas's two boards of it (10 Sep): SuperAIInsights —
 * the choose-a-company state a super administrator lands on with nothing selected — and
 * SuperAIInsightsSelected — a tenant chosen, its findings listed, one read in the panel.
 *
 * Roles (`useAIInsightsModel`'s `mode`): a super administrator chooses a company in the
 * page's own "Contexto de empresa" strip or on the card; a company administrator reads their
 * own tenant with no strip; a leader, supervisor or employee is told the page is for
 * administrators and no request is made (`AIInsightEndpoints.cs:48-50`). Acknowledgement is
 * the one verb the endpoint offers and the only one here, in the panel of an open finding.
 *
 * The canvas's "Redactado en inglés" and its floor sentence are not printed: the DTO names
 * no language for an insight (`AIInsightDtos.cs:31-35`), and nothing on the create path
 * checks the privacy floor (`AIInsightValidation.cs`; the generator, #92, does not exist) —
 * a guarantee the server does not keep is not one this page states.
 *
 * Apple design (11 Nov): `PageHeader`, `KpiCard`, bordered cards with no shadow, and every
 * chip neutral — a priority and "Revisado" are not result areas, and green, amber and red mean
 * only those. The cards lose their red and amber rails for the same reason; the priority word
 * and the sort carry the order. Findings are machine-authored, so the list and the panel say
 * so (HIG `generative-ai.md` › Transparency, and › Inputs on possible errors).
 */
export default function SuperAIInsightsView() {
  const { t } = useTranslation()
  const scope = useCompanyScope()
  const model = useAIInsightsModel()
  const companyId = scope.companyId

  return (
    <div>
      <CompanyContextBar
        note={scope.status === 'ready' ? t('insights.next.barNoteChosen') : t('insights.next.barNoteUnchosen')}
      />
      <PageHeader
        eyebrow={t('navigation.analytics')}
        title={t('navigation.aiInsights')}
        description={t('insights.next.findingsDescription')}
        actions={
          model.mode === 'insights' && companyId ? (
            <Button asChild variant="outline">
              <Link to={`/admin/companies/${companyId}/analytics`}>
                <BarChart3 aria-hidden="true" />
                {t('insights.next.openAnalytics')}
              </Link>
            </Button>
          ) : undefined
        }
      />
      <InsightsBody model={model} />
    </div>
  )
}

function InsightsBody({ model }: { model: AIInsightsModelState }) {
  const { t } = useTranslation()
  switch (model.mode) {
    case 'choose':
      return <ChooseCompany picks={model.picks} error={model.picksError} />
    case 'no-company':
      return <p role="alert">{t('common.noCompanyAssociated')}</p>
    case 'not-allowed':
      return <EmptyState title={t('insights.next.notForRole')} description={t('insights.next.notForRoleDescription')} />
    case 'insights':
      break
  }
  if (model.loading) return <LoadingState rows={6} label={t('common.loading')} />
  if (model.error !== null) {
    return (
      <ErrorState
        title={t('insights.loadFailed')}
        description={model.error}
        action={
          <Button variant="outline" onClick={model.reload}>
            {t('common.retry')}
          </Button>
        }
      />
    )
  }
  if (model.rows.length === 0) {
    return <EmptyState title={t('insights.noInsights')} description={t('insights.noInsightsDescription')} />
  }
  return <InsightsList model={model} />
}

function ChooseCompany({ picks, error }: { picks: readonly CompanyPick[] | null; error: string | null }) {
  const { t, locale } = useTranslation()
  const { selectCompany } = useCompanyContext()
  return (
    <section
      aria-labelledby="insights-choose"
      data-slot="choose-company"
      className={`${CARD} grid items-center gap-8 p-6 lg:grid-cols-[minmax(0,1fr)_420px]`}
    >
      <div className="flex flex-col items-start gap-2.5">
        <span
          aria-hidden="true"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-icon-box text-fg-secondary [&_svg]:size-5"
        >
          <RailInsightsIcon />
        </span>
        <h2 id="insights-choose" className="m-0 text-2xl">
          {t('insights.next.chooseTitle')}
        </h2>
        {/* The artboard's own measure (`max-width: 52ch`, ~410px at 13px): it wraps after "Elígela". */}
        <p data-slot="choose-body" className="m-0 max-w-[52ch] text-base text-fg-secondary">{t('insights.next.chooseBody')}</p>
        <p className="m-0 text-sm text-fg-label">{t('insights.next.chooseNote')}</p>
      </div>
      <div className="flex flex-col">
        {error !== null ? (
          <p role="alert" className="m-0 text-sm text-fg-secondary">
            {t('insights.next.chooseFailed')}
          </p>
        ) : picks === null ? (
          <SkeletonText lines={3} />
        ) : (
          picks.map((pick, index) => (
            <div
              key={pick.id}
              data-company-id={pick.id}
              className={cn('flex items-center gap-3 py-2.5', index > 0 && 'border-t border-line-light')}
            >
              <span
                aria-hidden="true"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-icon-box text-fg-secondary [&_svg]:size-4"
              >
                <Copy />
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-base font-semibold text-fg-primary">{pick.name}</span>
                <span data-slot="pick-line" className="text-sm text-fg-tertiary">
                  {pickText(t, pickLine(pick), locale)}
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                aria-label={t('insights.next.chooseNamed', { name: pick.name })}
                onClick={() => selectCompany(pick.id)}
              >
                {t('insights.next.choose')}
              </Button>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

function pickText(t: TranslateFn, line: PickLine, locale: string): string {
  switch (line.kind) {
    case 'unreadable':
      return t('insights.next.pickUnreadable')
    case 'nothing':
      return t('insights.next.pickNothing')
    case 'no-insights':
      return t('insights.next.pickNoInsights')
    case 'all-acknowledged': {
      // Undated when a detail could not be read: "reviewed", never a date it was not given.
      if (line.on === null) {
        return line.total === 1
          ? t('insights.next.pickAllOne')
          : t(line.total === 2 ? 'insights.next.pickAllTwo' : 'insights.next.pickAll', { total: line.total })
      }
      const date = calendarDay(Date.parse(line.on), locale)
      if (line.total === 1) return t('insights.next.pickAllOneOn', { date })
      if (line.sameDay) return t(line.total === 2 ? 'insights.next.pickAllTwoOn' : 'insights.next.pickAllOn', { total: line.total, date })
      return t(line.total === 2 ? 'insights.next.pickAllTwoLatest' : 'insights.next.pickAllLatest', { total: line.total, date })
    }
    case 'none-acknowledged':
      return line.total === 1 ? t('insights.next.pickNoneOne') : t('insights.next.pickNone', { total: line.total })
    case 'some-acknowledged':
      return t('insights.next.pickSome', { total: line.total, acknowledged: line.acknowledged })
  }
}

function InsightsList({ model }: { model: AIInsightsModelState }) {
  const { t, locale } = useTranslation()
  const tally = tallyInsights(model.rows)
  const selected = model.rows.find((row) => row.item.id === model.selectedId) ?? null

  return (
    <div className="flex flex-col gap-6">
      <div data-slot="insight-tiles" className="grid gap-3 md:grid-cols-3">
        <KpiCard
          label={t('insights.next.tileOpen')}
          value={tally.open.toLocaleString(locale)}
          unit={t('insights.next.ofTotal', { total: tally.total })}
          footnote={openSub(t, tally)}
        />
        <KpiCard
          label={t('insights.next.tileHigh')}
          value={tally.high.toLocaleString(locale)}
          unit={t('insights.next.ofTotal', { total: tally.total })}
          footnote={
            tally.critical === 0
              ? t('insights.next.criticalNone')
              : tally.critical === 1
                ? t('insights.next.criticalOne')
                : t('insights.next.criticalSome', { count: tally.critical })
          }
        />
        <KpiCard
          label={t('insights.next.tileAcknowledged')}
          value={tally.acknowledged.toLocaleString(locale)}
          unit={t('insights.next.ofTotal', { total: tally.total })}
          footnote={acknowledgedSub(t, locale, tally, model.names)}
        />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section aria-labelledby="insights-list" className="flex min-w-0 flex-col gap-2">
          <SectionHeading
            id="insights-list"
            className="mb-1"
            title={t('insights.next.listHeading')}
            count={model.rows.length}
            aside={t('insights.next.listNote')}
          />
          <GeneratedNote className="mb-1" />
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {model.rows.map((row) => (
              <li key={row.item.id} className="mb-0">
                <InsightCard
                  row={row}
                  selected={row.item.id === model.selectedId}
                  onSelect={() => model.select(row.item.id)}
                  t={t}
                  locale={locale}
                />
              </li>
            ))}
          </ul>
        </section>

        {selected && <InsightPanel row={selected} model={model} />}
      </div>

      <Note data-slot="insights-note" icon={<Shield />}>
        {t('insights.next.privacyNote')}
      </Note>
    </div>
  )
}

function openSub(t: TranslateFn, tally: InsightsTally): string {
  if (tally.open === 0) {
    if (tally.total === 1) return t('insights.next.openNoneOne')
    return t(tally.total === 2 ? 'insights.next.openNoneTwo' : 'insights.next.openNoneAll')
  }
  return tally.open === 1 ? t('insights.next.openOne') : t('insights.next.openSome', { count: tally.open })
}

function acknowledgedSub(
  t: TranslateFn,
  locale: string,
  tally: InsightsTally,
  names: ReadonlyMap<string, string | null>,
): string {
  if (tally.acknowledged === 0) return t('insights.next.ackNone')
  if (tally.latest === null) return t('insights.next.ackUndated')
  const who = (tally.latest.by ? names.get(tally.latest.by) : null) ?? t('insights.unknownUser')
  const date = calendarDay(Date.parse(tally.latest.at), locale)
  return t(tally.oneAcknowledger ? 'insights.next.ackBy' : 'insights.next.ackLatestBy', { who, date })
}

/** Every chip neutral: a priority, a type and "Revisado" are none of the three result areas. */
function InsightChips({ row, t }: { row: InsightRow; t: TranslateFn }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      <Chip tone="neutral" label={insightPriorityLabel(t, row.item.priority)} />
      <Chip tone="neutral" label={insightTypeLabel(t, row.item.type)} />
      {row.item.isAcknowledged && <Chip tone="neutral" icon={<Check />} label={t('insights.acknowledged')} />}
    </span>
  )
}

function InsightCard({
  row,
  selected,
  onSelect,
  t,
  locale,
}: {
  row: InsightRow
  selected: boolean
  onSelect: () => void
  t: TranslateFn
  locale: string
}) {
  const detail = row.detail
  const meta = [
    detail && detail.affectedSegments.length > 0 ? detail.affectedSegments.join(', ') : null,
    detail ? t('insights.next.confidence', { score: detail.confidenceScore }) : null,
    detail?.acknowledgedAt ? t('insights.next.reviewedOn', { date: calendarDay(Date.parse(detail.acknowledgedAt), locale) }) : null,
  ].filter((part): part is string => part !== null)

  return (
    // A bare <button> styled whole, so `index.css`'s carded button never shows — the rail,
    // the border and the fill are this card's own (the old `InsightList`'s approach).
    <button
      type="button"
      data-slot="insight-card"
      data-insight-id={row.item.id}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'group relative flex h-auto w-full items-stretch overflow-hidden rounded-xl border p-0 text-left font-normal shadow-none',
        selected
          ? 'border-accent-blue bg-accent-blue-soft hover:border-accent-blue'
          : 'border-line-panel bg-surface-card hover:border-line-hover hover:bg-surface-card',
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
        <span
          aria-hidden="true"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-icon-box text-fg-secondary [&_svg]:size-4"
        >
          <RailInsightsIcon />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <InsightChips row={row} t={t} />
          {/* Machine-authored prose in whatever language it was generated in (#92); the page
              does not claim which. */}
          <span className="text-base font-semibold text-fg-primary">{row.item.title}</span>
          {meta.length > 0 && <span className="text-sm leading-normal tabular-nums text-fg-tertiary">{meta.join(' · ')}</span>}
        </span>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-label" />
      </span>
    </button>
  )
}

function InsightPanel({ row, model }: { row: InsightRow; model: AIInsightsModelState }) {
  const { t, locale } = useTranslation()
  const detail = row.detail
  const acknowledgerName = detail?.acknowledgedBy ? (model.names.get(detail.acknowledgedBy) ?? null) : null

  return (
    <section
      aria-labelledby="insight-selected"
      data-slot="insight-panel"
      className={`${CARD} flex flex-col gap-3 px-5 pt-4 pb-4.5`}
    >
      <span className="text-2xs font-semibold uppercase leading-normal tracking-eyebrow text-fg-label">{t('insights.selectedInsight')}</span>
      <h2 id="insight-selected" className="m-0 text-2xl">
        {row.item.title}
      </h2>
      <span className="flex flex-wrap items-center gap-1.5">
        <InsightChips row={row} t={t} />
        <GeneratedChip />
      </span>
      {detail === null ? (
        <SkeletonText lines={3} />
      ) : (
        <>
          <p className="m-0 text-base text-fg-secondary">{detail.description}</p>
          <span data-slot="insight-confidence" className="text-sm leading-normal text-fg-tertiary">
            {withScore(t('insights.next.confidence', { score: SCORE_SLOT }), String(detail.confidenceScore))}
          </span>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-2xs font-semibold uppercase leading-normal tracking-eyebrow text-fg-label">{t('insights.next.evidence')}</span>
              {detail.surveyId ? (
                <Link to={`/surveys/${detail.surveyId}`} className="text-sm">
                  {model.surveyTitles.get(detail.surveyId) || t('insights.next.linkedSurvey')}
                </Link>
              ) : (
                <span className="text-sm text-fg-tertiary">{t('insights.next.noSurvey')}</span>
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-2xs font-semibold uppercase leading-normal tracking-eyebrow text-fg-label">{t('insights.affectedSegments')}</span>
              {detail.affectedSegments.length > 0 ? (
                <span className="flex flex-wrap items-center gap-1.5">
                  {detail.affectedSegments.map((segment) => (
                    <Chip key={segment} tone="neutral" label={segment} />
                  ))}
                </span>
              ) : (
                <span className="text-sm text-fg-tertiary">—</span>
              )}
            </div>
          </div>
          {detail.recommendedActions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-2xs font-semibold uppercase leading-normal tracking-eyebrow text-fg-label">{t('insights.recommendedActions')}</span>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {detail.recommendedActions.map((action) => (
                  <li key={action} className="mb-0 flex items-start gap-2 text-sm text-fg-secondary">
                    <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-fg-primary" />
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-line-light pt-2.5">
            {detail.isAcknowledged ? (
              <span data-slot="acknowledged-line" className="flex items-center gap-2 text-sm text-fg-secondary">
                <Check aria-hidden="true" className="size-3.5 shrink-0" />
                {detail.acknowledgedAt
                  ? t('insights.acknowledgedByOn', {
                      who: acknowledgerName ?? t('insights.unknownUser'),
                      when: calendarDayWithYear(Date.parse(detail.acknowledgedAt), locale),
                    })
                  : t('insights.acknowledgedUnattributed')}
              </span>
            ) : (
              <Button type="button" variant="primary" onClick={model.acknowledge} disabled={model.acknowledging}>
                <Check aria-hidden="true" />
                {model.acknowledging ? t('insights.acknowledging') : t('insights.acknowledge')}
              </Button>
            )}
            {model.actionError !== null && (
              <p role="alert" className="m-0 w-full text-sm text-accent-red-ink">
                {model.actionError}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  )
}
