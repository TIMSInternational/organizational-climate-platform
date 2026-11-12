import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Check } from 'lucide-react'
import { useTranslation, type TranslateFn, type TranslateParams } from '../../../i18n'
import { PageHeader } from '../../../components/layout'
import {
  Button,
  CanvasArrowRightIcon,
  CanvasClockIcon,
  CanvasFileIcon,
  CanvasLinkIcon,
  CanvasPlusIcon,
  Chip,
  EmptyState,
  LoadingRegion,
  NetworkError,
  Progress,
  SkeletonText,
} from '../../../components/ui'
import { ProtectedCell } from '../../../components/charts'
import { useViewerCapabilities } from '../../../auth/viewerCapabilities'
import { RailMicroclimatesIcon } from '../../../navigation/railIcons'
import { cn } from '../../../lib/cn'
import type { Microclimate } from '../api/microclimates'
import { MINIMUM_RESPONDENTS } from '../microclimatePrivacy'
import { statusLabel } from '../microclimateVocabulary'
import {
  JOURNEY,
  type JourneyKey,
  type JourneyState,
  clock,
  dayMonth,
  dayMonthLong,
  fillPercent,
  respondUrl,
  sessionReference,
  type SessionReference,
} from './derive'
import type { FlowStep, InProgressSession, MicroclimatesListNextModel } from './model'
import { JourneySteps } from './JourneyRail'
import { useCopyLink, type CopyOutcome } from './useCopyLink'
import { useMicroclimatesListModel } from './useMicroclimatesListModel'
import { displayZone, zoneNote } from './companyZone'

/** The flow card's four steps, as the artboard numbers and words them. */
const STEPS: readonly { step: FlowStep; titleKey: string; hintKey: string }[] = [
  { step: 1, titleKey: 'microclimates.next.list.stepCreate', hintKey: 'microclimates.next.list.stepCreateHint' },
  { step: 2, titleKey: 'microclimates.next.list.stepShare', hintKey: 'microclimates.next.list.stepShareHint' },
  { step: 3, titleKey: 'microclimates.next.list.stepLive', hintKey: 'microclimates.next.list.stepLiveHint' },
  { step: 4, titleKey: 'microclimates.next.list.stepRead', hintKey: 'microclimates.next.list.stepReadHint' },
]

/** The Apple design's `.card`: 12px corners and the default hairline, no shadow (occ.css). */
const CARD = 'rounded-xl border border-line-default bg-surface-card'

/**
 * `/microclimates` — the redesigned Microclimas, drawn as the MicroclimatesList
 * artboard (10 Sep). It replaced `MicroclimatesListPage` on this route; the old page
 * stays in the tree, unrouted, as the wiring reference.
 *
 * The screen reads as the flow it describes: a card that names the four steps and says
 * where the session in progress stands, then what is in progress (open sessions, then
 * drafts), then what is past. Every figure is the wire's (`useMicroclimatesListModel`):
 * the counts from `GET /microclimates`, the close date, question count and anonymity
 * from `GET /microclimates/{id}` — so nothing here is a sample and nothing wears the chip.
 *
 * Roles: only an administrator is answered by these endpoints (`CanAccessCompany`), so
 * a leader, supervisor or employee who types the URL reads a sentence saying so, and no
 * request is made. "Lanzar un microclima" is `canLaunchMicroclimate`.
 *
 * Privacy: the counts are shown at every size — "0 de 20" identifies nobody and is the
 * number that says whether to keep chasing (`microclimatePrivacy.ts`); what is held
 * back is what people wrote. A past session under the floor offers no results
 * link: `ProtectedCell` draws the hatch in its place.
 */
export default function MicroclimatesListNextPage() {
  const { t } = useTranslation()
  const capabilities = useViewerCapabilities()
  const state = useMicroclimatesListModel()

  return (
    <div>
      <PageHeader
        eyebrow={t('navigation.sectionFollowUp')}
        title={t('navigation.microclimates')}
        description={t('microclimates.next.list.description')}
        primaryAction={
          capabilities.canLaunchMicroclimate ? (
            <Button asChild variant="primary" size="canvas">
              <Link to="/microclimates/new">
                <CanvasPlusIcon />
                {t('microclimates.next.list.launch')}
              </Link>
            </Button>
          ) : undefined
        }
      />

      {state.status === 'forbidden' ? (
        <EmptyState
          fill
          title={t('microclimates.next.noAccessTitle')}
          description={t('microclimates.next.noAccessBody')}
        />
      ) : state.status === 'needs-company' ? (
        <EmptyState
          fill
          title={t('companyContext.chooseACompany')}
          description={t('companyContext.chooseACompanyDescription')}
        />
      ) : state.status === 'no-company' ? (
        <p role="alert">{t('common.noCompanyAssociated')}</p>
      ) : state.status === 'error' ? (
        <NetworkError
          title={t('errors.generic')}
          description={state.error ?? undefined}
          onRetry={state.reload}
          retryText={t('common.retry')}
        />
      ) : (
        <LoadingRegion loading={state.status === 'loading'} label={t('common.loading')}>
          {state.status === 'loading' ? <SkeletonText lines={6} /> : <ListBody model={state.model} timeZone={state.timeZone} />}
        </LoadingRegion>
      )}
    </div>
  )
}

function ListBody({ model, timeZone }: { model: MicroclimatesListNextModel; timeZone: string | null }) {
  const { t, locale } = useTranslation()
  // Every date and time here on the company's clock, or the browser's when it could not be read.
  const zone = displayZone(timeZone)
  const { outcome, copy } = useCopyLink()
  const current = model.current
  const reference = current ? sessionReference(current.row.title ?? t('microclimates.untitled'), locale) : null

  // "…cuando el pulso semanal cierre el 11 de septiembre": only an open session with a
  // readable close date can be named; otherwise the note says it of any microclimate.
  const closing =
    current && current.row.status === 'active' && current.detail
      ? dayMonthLong(current.detail.endTime, locale, zone)
      : null

  return (
    <div className="flex flex-col">
      <FlowCard step={model.step} session={reference} />

      <section aria-labelledby="mc-in-progress" className="mt-6 flex flex-col gap-2.5">
        <SectionHead
          id="mc-in-progress"
          title={t('microclimates.next.list.inProgressHeading')}
          aside={
            model.inProgress.length === 0
              ? t('microclimates.next.list.nothingInProgressCount')
              : sessionCount(t, model.inProgress.length)
          }
        />
        {model.inProgress.length === 0 ? (
          <DashedNote
            icon={<RailMicroclimatesIcon aria-hidden="true" className="size-4" />}
            title={t('microclimates.next.list.nothingInProgressTitle')}
            body={t('microclimates.next.list.nothingInProgressBody')}
          />
        ) : (
          // One card, its rows divided by hairlines: the Apple design's `.list` / `.row`.
          <div data-slot="session-list" className={cn(CARD, 'flex flex-col divide-y divide-line-default')}>
            {model.inProgress.map((session) => (
              <InProgressRow key={session.row.id} session={session} zone={zone} outcome={outcome} onCopy={copy} />
            ))}
          </div>
        )}
        {/* Said once, under the rows, wherever a row prints an hour. */}
        {model.inProgress.some((session) => session.detail !== null) && (
          <p data-testid="microclimate-zone" className="m-0 text-sm text-fg-tertiary">
            {zoneNote(t, timeZone)}
          </p>
        )}
      </section>

      <section aria-labelledby="mc-past" className="mt-6 flex flex-col gap-2.5">
        <SectionHead
          id="mc-past"
          title={t('microclimates.next.list.pastHeading')}
          aside={
            model.past.length === 0 ? (
              t('microclimates.next.list.pastNone')
            ) : (
              <>
                {sessionCount(t, model.past.length)}
                {' · '}
                <Link to="/microclimates/analytics">{t('microclimates.next.list.pastAnalytics')}</Link>
              </>
            )
          }
        />
        {model.past.length === 0 ? (
          <DashedNote
            icon={<CanvasClockIcon strokeWidth={1.8} className="size-4" />}
            title={t('microclimates.next.list.pastEmptyTitle')}
            body={
              closing && reference
                ? pastEmptyNamed(t, reference, closing)
                : t('microclimates.next.list.pastEmptyBody', { minimum: MINIMUM_RESPONDENTS })
            }
          />
        ) : (
          <div data-slot="past-list" className={cn(CARD, 'flex flex-col divide-y divide-line-default')}>
            {model.past.map((row) => (
              <PastRow key={row.id} row={row} locale={locale} zone={zone} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function sessionCount(t: TranslateFn, count: number): string {
  return count === 1
    ? t('microclimates.next.list.sessionCountOne', { count })
    : t('microclimates.next.list.sessionCountOther', { count })
}

/** A section's serif heading with its caption on the right, as every section of the artboard. */
function SectionHead({ id, title, aside }: { id: string; title: string; aside: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <h2 id={id} className="m-0 text-2xl">
        {title}
      </h2>
      <span className="text-sm text-fg-tertiary">{aside}</span>
    </div>
  )
}

/**
 * "el pulso semanal va por el paso 3", as the artboard writes it, when the title starts
 * with a noun whose article is known; "«Check-in del lunes» va por el paso 3" otherwise
 * (`sessionReference`). One literal key per form, so `keysExist.test.ts` checks each.
 */
function flowProgress(t: TranslateFn, session: SessionReference, step: FlowStep): string {
  if (session.kind === 'title') return t('microclimates.next.list.flowProgress', { session: session.title, step })
  return session.gender === 'masculine'
    ? t('microclimates.next.list.flowProgressMasculine', { session: session.phrase, step })
    : t('microclimates.next.list.flowProgressFeminine', { session: session.phrase, step })
}

/** The empty past note for a named session: "…cuando el pulso semanal cierre el 11 de septiembre…". */
function pastEmptyNamed(t: TranslateFn, session: SessionReference, date: string): string {
  const facts = { date, minimum: MINIMUM_RESPONDENTS }
  if (session.kind === 'title') {
    return t('microclimates.next.list.pastEmptyBodyNamed', { ...facts, session: session.title })
  }
  return session.gender === 'masculine'
    ? t('microclimates.next.list.pastEmptyBodyNamedMasculine', { ...facts, session: session.phrase })
    : t('microclimates.next.list.pastEmptyBodyNamedFeminine', { ...facts, session: session.phrase })
}

/**
 * Where the session in progress stands, as the journey rail's states: the steps before it
 * done, its own step current, the rest pending. No session in progress: nothing is current.
 */
function flowStates(step: FlowStep | null): Record<JourneyKey, JourneyState> {
  const states = {} as Record<JourneyKey, JourneyState>
  JOURNEY.forEach((key, index) => {
    const n = index + 1
    states[key] = step === null || n > step ? 'pending' : n === step ? 'current' : 'done'
  })
  return states
}

/**
 * "Un microclima es un flujo corto": the four steps, and where the session in progress
 * stands. Drawn with the same steps as the Crear and Detalle rail (`JourneySteps`): a step
 * passed is a check, the current one the blue pill, a pending one a numbered gray disc.
 */
function FlowCard({ step, session }: { step: FlowStep | null; session: SessionReference | null }) {
  const { t } = useTranslation()
  const titles = {} as Record<JourneyKey, string>
  const notes = {} as Record<JourneyKey, string>
  STEPS.forEach(({ titleKey, hintKey }, index) => {
    const key = JOURNEY[index] as JourneyKey
    titles[key] = t(titleKey)
    notes[key] = t(hintKey, { minimum: MINIMUM_RESPONDENTS })
  })

  return (
    <section aria-labelledby="mc-flow" className={cn(CARD, 'flex flex-col gap-3 px-5 pt-4 pb-4.5')}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="mc-flow" className="m-0 text-2xl">
          {t('microclimates.next.list.flowTitle')}
        </h2>
        {step !== null && session !== null && (
          <span className="text-sm text-fg-tertiary">
            {flowProgress(t, session, step)}
          </span>
        )}
      </div>
      <JourneySteps states={flowStates(step)} notes={notes} titles={titles} />
    </section>
  )
}

/** A dashed note in place of an empty list — the artboard's "Todavía no hay sesiones cerradas". */
function DashedNote({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div
      data-slot="dashed-note"
      className="flex items-center gap-3.5 rounded-xl border border-dashed border-line-default px-5 py-4.5"
    >
      <span className="inline-flex size-9 flex-none items-center justify-center rounded-lg bg-surface-icon-box text-fg-tertiary">
        {icon}
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="text-base font-semibold text-fg-primary">{title}</span>
        <span className="max-w-measure text-sm text-fg-tertiary">{body}</span>
      </div>
    </div>
  )
}

/**
 * A row of the list card (occ.css `.row`): the icon, the text, the actions — the actions drop
 * under the text below md. The card draws the hairline between rows.
 */
const ROW =
  'grid min-h-13 grid-cols-1 items-center gap-x-3.5 gap-y-3 px-4 py-3.5 sm:grid-cols-[1.75rem_minmax(0,1fr)] sm:px-5 md:grid-cols-[1.75rem_minmax(0,1fr)_auto]'

function InProgressRow({
  session,
  zone,
  outcome,
  onCopy,
}: {
  session: InProgressSession
  zone: string
  outcome: CopyOutcome | null
  onCopy: (key: string, text: string) => Promise<void>
}) {
  const { t, locale } = useTranslation()
  const { row, detail } = session
  const title = row.title ?? t('microclimates.untitled')
  const isOpen = row.status === 'active'
  const fill = fillPercent(row.responseCount, row.targetParticipantCount)
  const link = respondUrl(window.location.origin, row.id)
  // The link is offered where the old live page offered it: an open, anonymous session.
  // A named one is answered from each person's own invitation, signed in.
  const canShare = isOpen && detail?.anonymousResponses === true
  const copied = outcome?.key === row.id ? outcome : null

  return (
    <div data-slot="session-row" className={ROW}>
      <span
        aria-hidden="true"
        className={cn(
          'hidden size-7 items-center justify-center rounded-lg sm:inline-flex',
          isOpen ? 'bg-accent-blue-soft text-accent-blue-ink' : 'bg-surface-icon-box text-fg-tertiary',
        )}
      >
        <RailMicroclimatesIcon className="size-4" />
      </span>

      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/microclimates/${row.id}`}
            className="min-w-0 break-words text-lg font-semibold text-fg-primary hover:text-fg-primary"
          >
            {title}
          </Link>
          <Chip
            tone={isOpen ? 'live' : 'neutral'}
            label={isOpen ? t('microclimates.next.chipLive') : statusLabel(t, row.status)}
          />
        </div>
        <SessionMeta session={session} locale={locale} zone={zone} />
        {fill !== null && (
          <Progress
            value={fill}
            className="max-w-80"
            aria-label={t('microclimates.liveParticipationLabel', { session: title })}
          />
        )}
        {copied && !copied.ok && (
          <p role="status" className="m-0 text-sm text-fg-secondary">
            {t('microclimates.next.list.copyFallback')}{' '}
            <span className="select-all break-all font-mono">{link}</span>
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 md:col-span-1 md:justify-end">
        {canShare && (
          <Button type="button" variant="outline" size="canvas" onClick={() => void onCopy(row.id, link)}>
            {copied?.ok ? <Check aria-hidden="true" /> : <CanvasLinkIcon />}
            {copied?.ok ? t('microclimates.next.list.linkCopied') : t('microclimates.next.list.share')}
          </Button>
        )}
        <Button asChild variant="outline" size="canvas">
          <Link to={isOpen ? `/microclimates/${row.id}/live` : `/microclimates/${row.id}`}>
            <CanvasArrowRightIcon />
            {isOpen ? t('microclimates.next.list.viewLive') : t('microclimates.next.list.openDraft')}
          </Link>
        </Button>
      </div>
    </div>
  )
}

/**
 * A sentence whose numbers are set in tabular figures of the UI face (the Apple design's
 * `.num`), each wrapped so a column of them lines up; the prose around them is untouched.
 * The numbers are formatted in the reader's locale. A `\u0000` marker splits the sentence, so
 * the catalogue decides where each number sits.
 */
const MARK = '\u0000'
function Readings({ t, messageKey, params, locale }: { t: TranslateFn; messageKey: string; params: TranslateParams; locale: string }) {
  const readings: string[] = []
  const marked: TranslateParams = {}
  for (const [name, value] of Object.entries(params)) {
    if (typeof value === 'number') {
      marked[name] = `${MARK}${readings.length}${MARK}`
      readings.push(value.toLocaleString(locale))
    } else {
      marked[name] = value
    }
  }
  return (
    <span>
      {t(messageKey, marked)
        .split(MARK)
        .map((piece, index) =>
          index % 2 === 1 ? (
            <span key={index} data-slot="reading" className="tabular-nums">
              {readings[Number(piece)]}
            </span>
          ) : (
            piece
          ),
        )}
    </span>
  )
}

/**
 * "0 de 20 respuestas · abierto hasta el 11 sept a las 21:06 · 2 preguntas · anónimo ·
 * palabras protegidas hasta 5". The counts are readings, in tabular figures; the rest is prose. The
 * three facts from the detail read are left off when that read failed.
 */
function SessionMeta({ session, locale, zone }: { session: InProgressSession; locale: string; zone: string }) {
  const { t } = useTranslation()
  const { row, detail } = session
  const pieces: ReactNode[] = [
    row.targetParticipantCount > 0 ? (
      <Readings
        key="responses"
        t={t}
        messageKey="microclimates.next.list.responsesOf"
        params={{ responses: row.responseCount, target: row.targetParticipantCount }}
        locale={locale}
      />
    ) : (
      <Readings
        key="responses"
        t={t}
        messageKey="microclimates.next.list.responsesNoTarget"
        params={{ responses: row.responseCount }}
        locale={locale}
      />
    ),
  ]

  if (detail) {
    const instant = row.status === 'active' ? detail.endTime : detail.startTime
    const date = dayMonth(instant, locale, zone)
    const time = clock(instant, locale, zone)
    if (date && time) {
      pieces.push(
        row.status === 'active'
          ? t('microclimates.next.list.openUntil', { date, time })
          : t('microclimates.next.list.opensOn', { date, time }),
      )
    }
    const questions = detail.questions.length
    pieces.push(
      questions === 1
        ? t('microclimates.next.list.questionCountOne', { count: questions })
        : t('microclimates.next.list.questionCountOther', { count: questions }),
    )
    pieces.push(
      detail.anonymousResponses ? t('microclimates.next.list.anonymous') : t('microclimates.next.list.identified'),
    )
  }
  pieces.push(t('microclimates.next.list.wordsProtected', { minimum: MINIMUM_RESPONDENTS }))

  return (
    <span data-slot="session-meta" className="text-sm text-fg-tertiary">
      {pieces.map((piece, index) => (
        <Fragment key={index}>
          {index > 0 && ' · '}
          {piece}
        </Fragment>
      ))}
    </span>
  )
}

/**
 * A closed session. Its results link sits behind the floor: under it the
 * results page could only say that the words are withheld, so the hatch stands where
 * the link would be — the same predicate and arguments `ProtectedCell` consults, so the
 * link and the hatch can never both appear.
 */
function PastRow({ row, locale, zone }: { row: Microclimate; locale: string; zone: string }) {
  const { t } = useTranslation()
  const title = row.title ?? t('microclimates.untitled')
  const created = dayMonth(row.createdAt, locale, zone)

  return (
    <div data-slot="past-row" className={ROW}>
      <span
        aria-hidden="true"
        className="hidden size-7 items-center justify-center rounded-lg bg-surface-icon-box text-fg-tertiary sm:inline-flex"
      >
        <RailMicroclimatesIcon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/microclimates/${row.id}`}
            className="min-w-0 break-words text-lg font-semibold text-fg-primary hover:text-fg-primary"
          >
            {title}
          </Link>
          <Chip tone="neutral" label={statusLabel(t, row.status)} />
        </div>
        <span className="text-sm text-fg-tertiary">
          {row.targetParticipantCount > 0 ? (
            <Readings
              t={t}
              messageKey="microclimates.next.list.responsesOf"
              params={{ responses: row.responseCount, target: row.targetParticipantCount }}
              locale={locale}
            />
          ) : (
            <Readings
              t={t}
              messageKey="microclimates.next.list.responsesNoTarget"
              params={{ responses: row.responseCount }}
              locale={locale}
            />
          )}
          {created && (
            <>
              {' · '}
              {t('microclimates.next.list.createdOn', { date: created })}
            </>
          )}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 md:col-span-1 md:justify-end">
        <ProtectedCell
          responses={row.responseCount}
          threshold={MINIMUM_RESPONDENTS}
          description={title}
          suppressedClassName="h-control-canvas w-9"
        >
          <Button asChild variant="outline" size="canvas">
            <Link to={`/microclimates/${row.id}/results`}>
              <CanvasFileIcon />
              {t('microclimates.next.list.results')}
            </Link>
          </Button>
        </ProtectedCell>
      </div>
    </div>
  )
}
