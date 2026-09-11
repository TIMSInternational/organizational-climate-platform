import { Link, useParams } from 'react-router'
import { ArrowRight, Download } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../../i18n'
import { PageTopBar } from '../../../../components/layout'
import { CanvasCard, CanvasSectionHead, FactList, HatchField, HatchPill, NoteBand, PageMeta } from '../../../../components/canvas'
import { Alert, AlertDescription, Button, Chip, LoadingRegion, NetworkError, SkeletonText } from '../../../../components/ui'
import { useViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { cn } from '../../../../lib/cn'
import type { LiveResults, MicroclimateDetail, Question } from '../../api/microclimates'
import { MicroclimateGate } from '../MicroclimateGate'
import { FLOOR, barPosition, belowFloor, figureKind, outstanding, wordBars } from '../derive'
import { clock, longDay, shortDayYear } from '../format'
import { canvasTypeLabel, sessionStatusLabel, sessionStatusTone } from '../vocabulary'
import { useMicroclimateResultsModel } from './useMicroclimateResultsModel'

/**
 * `/microclimates/:id/results` — the redesigned Resultados de microclima, drawn as the
 * MicroclimateResults board of 10 Sep: the "read" step of create, share, watch, read. It
 * replaced `MicroclimateResultsPage` on this route; that page stays in the tree, unrouted, as
 * the wiring reference.
 *
 * ## What the board draws that no endpoint returns
 *
 * "Una cifra por pregunta". A microclimate keeps no answer per question — the count, the
 * target and a word map are all it stores (`derive.ts` carries the measurement) — so each
 * scale question's figure is hatched under the floor, as the board draws it, and at or over
 * the floor says the figure is not kept instead of drawing one. The board's amber
 * "Propuesta" chip stays on those figures: they are a proposal until something stores them.
 *
 * ## The words
 *
 * The one per-session content that exists, shown only as frequencies and only through
 * `wordBars` (`suppressWordCloud`'s two floors): nothing under 5 responses, and never a word
 * said once. Below the floor the payload's words are not even passed to the view.
 *
 * ## Removed by ruling
 *
 * The sentiment banner the old page ended with (triage row 15: "the results page ends with
 * the same sentiment banner the runbook tells the presenter to avoid").
 */
export default function MicroclimateResultsNextPage() {
  return (
    <MicroclimateGate needsCompany={false}>
      <ResultsScreen />
    </MicroclimateGate>
  )
}

function ResultsScreen() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const state = useMicroclimateResultsModel(id)

  if (state.status === 'error') {
    return (
      <NetworkError
        title={t('microclimates.errorLoadingMicroclimate')}
        description={state.error ?? undefined}
        onRetry={state.reload}
        retryText={t('common.retry')}
      />
    )
  }
  if (state.status === 'loading' || !state.detail || !state.live) {
    return (
      <LoadingRegion loading label={t('common.loading')}>
        <SkeletonText lines={6} />
      </LoadingRegion>
    )
  }
  return (
    <ResultsView
      detail={state.detail}
      live={state.live}
      exporting={state.exporting}
      exportError={state.exportError}
      onExport={state.exportCsv}
    />
  )
}

function ResultsView({
  detail,
  live,
  exporting,
  exportError,
  onExport,
}: {
  detail: MicroclimateDetail
  live: LiveResults
  exporting: boolean
  exportError: string | null
  onExport: () => void
}) {
  const { t, locale } = useTranslation()
  const capabilities = useViewerCapabilities()
  const title = detail.title ?? t('microclimates.untitled')
  const responses = live.responseCount
  const target = live.targetParticipantCount
  const protectedSession = belowFloor(responses)
  const questions = [...detail.questions].sort((a, b) => a.order - b.order)
  const openQuestions = questions.filter((question) => figureKind(question.type) === 'words').length
  // Below the floor the words never reach the view: `wordBars` returns none, and the
  // payload's own list is not handed down.
  const words = wordBars(live.wordCloud, responses)

  const meta =
    detail.status === 'active'
      ? t('microclimates.next.results.metaActive', { date: longDay(detail.endTime, locale), time: clock(detail.endTime, locale) })
      : detail.status === 'closed'
        ? t('microclimates.next.results.metaClosed', { date: longDay(detail.endTime, locale), time: clock(detail.endTime, locale) })
        : t('microclimates.next.results.metaDraft')

  return (
    <div>
      <PageTopBar
        compact
        title={title}
        eyebrow={t('microclimates.next.results.eyebrow')}
        description={t('microclimates.next.results.description', { floor: FLOOR })}
        breadcrumbs={[
          { label: t('navigation.microclimates'), href: '/microclimates' },
          { label: title, href: `/microclimates/${detail.id}` },
          { label: t('microclimates.results') },
        ]}
        meta={
          <PageMeta>
            <Chip label={sessionStatusLabel(t, detail.status)} tone={sessionStatusTone(detail.status)} />
            <span>{meta}</span>
          </PageMeta>
        }
        actions={
          detail.status === 'active' ? (
            <Button asChild variant="outline" size="canvas">
              <Link to={`/microclimates/${detail.id}/live`}>
                <ArrowRight aria-hidden="true" />
                {t('microclimates.next.viewLive')}
              </Link>
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="flex min-w-0 flex-col gap-4">
          <CanvasCard
            title={t('microclimates.next.results.whoTitle')}
            aside={
              detail.status === 'active'
                ? t('microclimates.next.results.whoAsideActive')
                : detail.status === 'closed'
                  ? t('microclimates.next.results.whoAsideClosed')
                  : undefined
            }
          >
            <div className="flex items-end gap-5">
              <span className="shrink-0 font-mono text-[2.75rem] leading-none tabular-nums text-fg-primary">{responses}</span>
              <div className="flex min-w-0 flex-col gap-1 pb-1">
                <span className="text-base text-fg-secondary">
                  {target > 0
                    ? t('microclimates.next.results.ofExpected', { target, outstanding: outstanding(responses, target) })
                    : t('microclimates.next.results.noTarget')}
                </span>
                <span className="text-sm text-fg-tertiary">
                  {protectedSession
                    ? t('microclimates.next.results.opensAt', { floor: FLOOR })
                    : t('microclimates.next.results.opened', { floor: FLOOR })}
                </span>
              </div>
            </div>
            {target > 0 && <ResponsesBar responses={responses} target={target} />}
          </CanvasCard>

          <CanvasSectionHead
            title={t('microclimates.next.results.byQuestion')}
            count={questions.length}
            aside={t('microclimates.next.results.byQuestionAside', { floor: FLOOR })}
          />

          {questions.length === 0 ? (
            <p className="m-0 text-base text-fg-tertiary">{t('microclimates.resultsNoQuestions')}</p>
          ) : (
            questions.map((question, index) => (
              <QuestionCard
                key={question.id}
                question={question}
                order={index + 1}
                protectedSession={protectedSession}
                words={words}
                openQuestions={openQuestions}
              />
            ))
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {capabilities.canManageMicroclimate(detail) && (
            <CanvasCard title={t('microclimates.next.results.exportTitle')} inset="side">
              <span className="text-sm text-fg-secondary">{t('microclimates.next.results.exportBody')}</span>
              <span className="self-start">
                <Button variant="outline" size="canvas" disabled={exporting} onClick={onExport}>
                  <Download aria-hidden="true" />
                  {t('microclimates.exportCsv')}
                </Button>
              </span>
              {exportError && (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{exportError}</AlertDescription>
                </Alert>
              )}
            </CanvasCard>
          )}
          <CanvasCard title={t('microclimates.next.sheet.title')} inset="side">
            <FactList
              termWidth="sm"
              facts={[
                {
                  id: 'status',
                  term: t('microclimates.next.sheet.status'),
                  value: <Chip label={sessionStatusLabel(t, detail.status)} tone={sessionStatusTone(detail.status)} />,
                },
                {
                  id: 'opens',
                  term: t('microclimates.next.sheet.opens'),
                  value: <span className="font-mono tabular-nums">{instant(t, detail.startTime, locale)}</span>,
                },
                {
                  id: 'closes',
                  term: t('microclimates.next.sheet.closes'),
                  value: <span className="font-mono tabular-nums">{instant(t, detail.endTime, locale)}</span>,
                },
                {
                  id: 'answer',
                  term: t('microclimates.next.sheet.answer'),
                  value: t('microclimates.next.sheet.answerValue', {
                    mode: detail.anonymousResponses ? t('microclimates.anonymousShort') : t('microclimates.identifiedShort'),
                    floor: FLOOR,
                  }),
                },
                {
                  id: 'questions',
                  term: t('microclimates.next.sheet.questions'),
                  value: <span className="font-mono tabular-nums">{questions.length}</span>,
                },
              ]}
            />
          </CanvasCard>
          <NoteBand>{t('microclimates.next.results.note')}</NoteBand>
        </div>
      </div>
    </div>
  )
}

/** "9 sept 2026, 21:06". */
function instant(t: TranslateFn, iso: string, locale: string): string {
  return t('microclimates.next.sheet.instant', { date: shortDayYear(iso, locale), time: clock(iso, locale) })
}

function ResponsesBar({ responses, target }: { responses: number; target: number }) {
  const { t } = useTranslation()
  const fill = barPosition(responses, target) ?? 0
  const floorAt = barPosition(FLOOR, target) ?? 100
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative h-2.5 rounded-full bg-line-light">
        <div className="absolute inset-y-0 left-0 rounded-full bg-accent-blue" style={{ width: `${fill}%` }} />
        <div
          aria-hidden="true"
          className="absolute -top-1.25 h-5 border-l-2 border-dashed border-line-hover"
          style={{ left: `${floorAt}%` }}
        />
      </div>
      <div className="grid text-xs text-fg-tertiary" style={{ gridTemplateColumns: `${floorAt}% minmax(0, 1fr) auto` }}>
        <span className="font-mono tabular-nums">0</span>
        <span>{t('microclimates.next.results.floorMark', { floor: FLOOR })}</span>
        <span className="font-mono tabular-nums">{target}</span>
      </div>
    </div>
  )
}

const CAPTION_KEY: Record<string, string> = {
  likert: 'microclimates.next.results.captionScale',
  rating: 'microclimates.next.results.captionScale',
  yes_no: 'microclimates.next.results.captionYesNo',
  multiple_choice: 'microclimates.next.results.captionChoice',
  emoji_rating: 'microclimates.next.results.captionEmoji',
}

function columnsOf(t: TranslateFn, question: Question): string[] {
  if (question.type === 'yes_no') return [t('common.yes'), t('common.no')]
  if (question.type === 'multiple_choice') return (question.options ?? []).map((option) => option.label ?? option.value)
  if (question.type === 'emoji_rating') return (question.emojiOptions ?? []).map((face) => face.label ?? face.emoji)
  return ['1', '2', '3', '4', '5']
}

function QuestionCard({
  question,
  order,
  protectedSession,
  words,
  openQuestions,
}: {
  question: Question
  order: number
  protectedSession: boolean
  words: ReturnType<typeof wordBars>
  openQuestions: number
}) {
  const { t } = useTranslation()
  const kind = figureKind(question.type)
  return (
    <section
      aria-label={question.text ?? t('microclimates.untitled')}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-line-default bg-surface-card px-5 pt-4 pb-4.5 shadow-xs"
    >
      <div className="flex items-start gap-2.5">
        <span className="inline-flex size-5.5 shrink-0 items-center justify-center rounded-full bg-surface-icon-box font-mono text-xs font-semibold tabular-nums text-fg-secondary">
          {order}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-lg font-semibold text-fg-primary">{question.text ?? t('microclimates.untitled')}</span>
          <div className="flex flex-wrap gap-1.5">
            <Chip label={canvasTypeLabel(t, question.type)} />
            <Chip label={question.required ? t('microclimates.next.create.required') : t('microclimates.next.create.optional')} />
          </div>
        </div>
        {kind !== 'words' && (
          <Chip label={t('microclimates.next.proposed')} tone="warning" title={t('microclimates.next.results.proposedHint')} />
        )}
      </div>

      {kind === 'words' ? (
        <>
          {protectedSession ? (
            <HatchField className="flex min-h-[130px] items-center justify-center p-3">
              <HatchPill label={t('microclimates.next.results.wordsProtected', { floor: FLOOR })} />
            </HatchField>
          ) : words.words.length === 0 ? (
            <p className="m-0 rounded-lg border border-dashed border-line-default p-3 text-base text-fg-tertiary">
              {t('microclimates.next.results.wordsNone')}
            </p>
          ) : (
            <WordBarList words={words.words} />
          )}
          <span className="text-sm text-fg-tertiary">
            {t('microclimates.next.results.wordsRule')}
            {!protectedSession && words.withheld > 0 && <> {t('microclimates.wordCloudWithheld', { count: words.withheld })}</>}
            {openQuestions > 1 && <> {t('microclimates.next.results.wordsShared', { count: openQuestions })}</>}
          </span>
        </>
      ) : (
        <>
          <div className="grid">
            <div className="col-start-1 row-start-1 flex gap-3">
              {columnsOf(t, question).map((label, index) => (
                <div key={`${label}-${index}`} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                  {protectedSession ? (
                    <HatchField className="h-[110px] w-full" />
                  ) : (
                    <span className="block h-[110px] w-full rounded-lg border border-dashed border-line-default" />
                  )}
                  <span className="max-w-full truncate font-mono text-xs tabular-nums text-fg-tertiary">{label}</span>
                </div>
              ))}
            </div>
            <div className="col-start-1 row-start-1 flex items-start justify-center pt-10">
              <HatchPill
                label={
                  protectedSession
                    ? t('microclimates.next.results.figureProtected', { floor: FLOOR })
                    : t('microclimates.next.results.figureNotKept')
                }
              />
            </div>
          </div>
          <div className="flex flex-wrap justify-between gap-2 text-sm text-fg-tertiary">
            <span>
              {t('microclimates.next.results.average')}{' '}
              <span className="text-fg-tertiary">
                {protectedSession ? t('microclimates.next.results.averageProtected') : t('microclimates.next.results.averageNotKept')}
              </span>
            </span>
            <span>{t(CAPTION_KEY[question.type] ?? 'microclimates.next.results.captionScale')}</span>
          </div>
        </>
      )}
    </section>
  )
}

function WordBarList({ words }: { words: ReturnType<typeof wordBars>['words'] }) {
  const { t } = useTranslation()
  const max = Math.max(...words.map((word) => word.value))
  return (
    <ol aria-label={t('microclimates.resultsWordsTitle')} className="m-0 flex list-none flex-col gap-1.5 p-0">
      {words.map((word) => (
        <li key={`${word.language}-${word.text}`} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_2.5rem] items-center gap-3">
          <span className="truncate text-base text-fg-primary">{word.text}</span>
          <span className="h-3 rounded-sm bg-line-light">
            <span className={cn('block h-full rounded-sm bg-accent-blue')} style={{ width: `${(word.value / max) * 100}%` }} />
          </span>
          <span className="text-right font-mono text-sm tabular-nums text-fg-secondary">{word.value}</span>
        </li>
      ))}
    </ol>
  )
}
