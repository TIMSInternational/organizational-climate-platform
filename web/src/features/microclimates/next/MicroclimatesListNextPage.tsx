import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Check, Clock, File, Link as LinkIcon, Plus } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import {
  Button,
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
import { MonoReadings } from '../../dashboard/components/dashboardGrammar'
import type { Microclimate } from '../api/microclimates'
import { MINIMUM_RESPONDENTS } from '../microclimatePrivacy'
import { statusLabel } from '../microclimateVocabulary'
import { clock, dayMonth, dayMonthLong, fillPercent, respondUrl, shortTitle } from './derive'
import type { FlowStep, InProgressSession, MicroclimatesListNextModel } from './model'
import { useCopyLink, type CopyOutcome } from './useCopyLink'
import { useMicroclimatesListModel } from './useMicroclimatesListModel'

/** The flow card's four steps, as the artboard numbers and words them. */
const STEPS: readonly { step: FlowStep; titleKey: string; hintKey: string }[] = [
  { step: 1, titleKey: 'microclimates.next.list.stepCreate', hintKey: 'microclimates.next.list.stepCreateHint' },
  { step: 2, titleKey: 'microclimates.next.list.stepShare', hintKey: 'microclimates.next.list.stepShareHint' },
  { step: 3, titleKey: 'microclimates.next.list.stepLive', hintKey: 'microclimates.next.list.stepLiveHint' },
  { step: 4, titleKey: 'microclimates.next.list.stepRead', hintKey: 'microclimates.next.list.stepReadHint' },
]

/** The artboard's `.card`: 8px, the default hairline, the faint shadow. */
const CARD = 'rounded-xl border border-line-default bg-surface-card shadow-sm'

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
 * back is what people wrote. A past session under the floor of 5 offers no results
 * link: `ProtectedCell` draws the hatch in its place.
 */
export default function MicroclimatesListNextPage() {
  const { t } = useTranslation()
  const capabilities = useViewerCapabilities()
  const state = useMicroclimatesListModel()

  return (
    <div>
      <PageTopBar
        title={t('navigation.microclimates')}
        description={t('microclimates.next.list.description')}
        actions={
          capabilities.canLaunchMicroclimate ? (
            <Button asChild variant="primary" size="canvas">
              <Link to="/microclimates/new">
                <Plus aria-hidden="true" />
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
          {state.status === 'loading' ? <SkeletonText lines={6} /> : <ListBody model={state.model} />}
        </LoadingRegion>
      )}
    </div>
  )
}

function ListBody({ model }: { model: MicroclimatesListNextModel }) {
  const { t, locale } = useTranslation()
  const { outcome, copy } = useCopyLink()
  const current = model.current
  const currentTitle = current ? shortTitle(current.row.title ?? t('microclimates.untitled')) : null

  // "…cuando «Pulso semanal» cierre el 11 de septiembre": only an open session with a
  // readable close date can be named; otherwise the note says it of any microclimate.
  const closing =
    current && current.row.status === 'active' && current.detail
      ? dayMonthLong(current.detail.endTime, locale)
      : null

  return (
    <div className="flex flex-col">
      <FlowCard step={model.step} session={currentTitle} />

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
          model.inProgress.map((session) => (
            <InProgressRow key={session.row.id} session={session} outcome={outcome} onCopy={copy} />
          ))
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
            icon={<Clock aria-hidden="true" className="size-4" />}
            title={t('microclimates.next.list.pastEmptyTitle')}
            body={
              closing && currentTitle
                ? t('microclimates.next.list.pastEmptyBodyNamed', {
                    session: currentTitle,
                    date: closing,
                    minimum: MINIMUM_RESPONDENTS,
                  })
                : t('microclimates.next.list.pastEmptyBody', { minimum: MINIMUM_RESPONDENTS })
            }
          />
        ) : (
          model.past.map((row) => <PastRow key={row.id} row={row} locale={locale} />)
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
 * "Un microclima es un flujo corto": the four steps, and where the session in progress
 * stands. A step reached is filled; the rule after it is solid up to the current step
 * and dashed past it, as the artboard draws 1 — 2 — 3 ┄ 4 for a session at step 3.
 */
function FlowCard({ step, session }: { step: FlowStep | null; session: string | null }) {
  const { t } = useTranslation()
  const reached = step ?? 0

  return (
    // `-mt-1`: the artboard sets its first section 20px under the header's rule, and
    // `PageTopBar` keeps 24px below itself for every screen.
    <section aria-labelledby="mc-flow" className={cn(CARD, '-mt-1 flex flex-col gap-3 px-5 pt-4 pb-4.5')}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="mc-flow" className="m-0 text-2xl">
          {t('microclimates.next.list.flowTitle')}
        </h2>
        {step !== null && session !== null && (
          <span className="text-sm text-fg-tertiary">
            {t('microclimates.next.list.flowProgress', { session, step })}
          </span>
        )}
      </div>
      <ol className="m-0 grid list-none grid-cols-2 gap-y-4 p-0 lg:grid-cols-4 lg:gap-y-0">
        {STEPS.map(({ step: n, titleKey, hintKey }) => (
          <li
            key={n}
            data-slot="flow-step"
            data-reached={n <= reached ? 'true' : 'false'}
            aria-current={n === step ? 'step' : undefined}
            className="m-0 flex min-w-0 flex-col gap-2"
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  'inline-flex size-6 flex-none items-center justify-center rounded-full border font-mono text-xs tabular-nums',
                  n <= reached
                    ? 'border-accent-blue bg-accent-blue text-fg-on-accent'
                    : 'border-line-default bg-surface-card text-fg-tertiary',
                )}
              >
                {n}
              </span>
              {n < 4 ? (
                <span
                  aria-hidden="true"
                  data-slot="flow-rule"
                  className={cn('flex-1 border-t', n < reached ? 'border-solid border-accent-blue' : 'border-dashed border-line-hover')}
                />
              ) : (
                <span aria-hidden="true" className="flex-1" />
              )}
            </div>
            <div className="flex flex-col gap-0.5 pr-4">
              <span className="text-base font-semibold text-fg-primary">{t(titleKey)}</span>
              <span className="text-sm text-fg-tertiary">{t(hintKey, { minimum: MINIMUM_RESPONDENTS })}</span>
            </div>
          </li>
        ))}
      </ol>
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
      <span className="inline-flex size-9 flex-none items-center justify-center rounded-lg bg-surface-icon-box text-fg-light">
        {icon}
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="text-base font-semibold text-fg-primary">{title}</span>
        <span className="max-w-measure text-sm text-fg-tertiary">{body}</span>
      </div>
    </div>
  )
}

/** The row's grid: the icon, the text, the actions — the actions drop under the text below md. */
const ROW = cn(
  CARD,
  'grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-x-3.5 gap-y-3 px-5 py-3.5 md:grid-cols-[1.75rem_minmax(0,1fr)_auto]',
)

function InProgressRow({
  session,
  outcome,
  onCopy,
}: {
  session: InProgressSession
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
          'inline-flex size-7 items-center justify-center rounded-lg',
          isOpen ? 'bg-accent-green-soft text-accent-green-ink' : 'bg-surface-icon-box text-fg-tertiary',
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
            tone={isOpen ? 'good' : 'neutral'}
            label={isOpen ? t('microclimates.next.chipLive') : statusLabel(t, row.status)}
          />
        </div>
        <SessionMeta session={session} locale={locale} />
        {fill !== null && (
          <Progress
            value={Math.round(fill)}
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

      <div className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-1 md:justify-end">
        {canShare && (
          <Button type="button" variant="outline" size="canvas" onClick={() => void onCopy(row.id, link)}>
            {copied?.ok ? <Check aria-hidden="true" /> : <LinkIcon aria-hidden="true" />}
            {copied?.ok ? t('microclimates.next.list.linkCopied') : t('microclimates.next.list.share')}
          </Button>
        )}
        <Button asChild variant="outline" size="canvas">
          <Link to={isOpen ? `/microclimates/${row.id}/live` : `/microclimates/${row.id}`}>
            <ArrowRight aria-hidden="true" />
            {isOpen ? t('microclimates.next.list.viewLive') : t('microclimates.next.list.openDraft')}
          </Link>
        </Button>
      </div>
    </div>
  )
}

/**
 * "0 de 20 respuestas · abierto hasta el 11 sept a las 21:06 · 2 preguntas · anónimo ·
 * palabras protegidas hasta 5". The counts are readings, so mono; the rest is prose. The
 * three facts from the detail read are left off when that read failed.
 */
function SessionMeta({ session, locale }: { session: InProgressSession; locale: string }) {
  const { t } = useTranslation()
  const { row, detail } = session
  const pieces: ReactNode[] = [
    row.targetParticipantCount > 0 ? (
      <MonoReadings
        key="responses"
        t={t}
        messageKey="microclimates.next.list.responsesOf"
        params={{ responses: row.responseCount, target: row.targetParticipantCount }}
        locale={locale}
      />
    ) : (
      <MonoReadings
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
    const date = dayMonth(instant, locale)
    const time = clock(instant, locale)
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
 * A closed session. Its results link sits behind the floor: under 5 responses the
 * results page could only say that the words are withheld, so the hatch stands where
 * the link would be — the same predicate and arguments `ProtectedCell` consults, so the
 * link and the hatch can never both appear.
 */
function PastRow({ row, locale }: { row: Microclimate; locale: string }) {
  const { t } = useTranslation()
  const title = row.title ?? t('microclimates.untitled')
  const created = dayMonth(row.createdAt, locale)

  return (
    <div data-slot="past-row" className={ROW}>
      <span
        aria-hidden="true"
        className="inline-flex size-7 items-center justify-center rounded-lg bg-surface-icon-box text-fg-tertiary"
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
            <MonoReadings
              t={t}
              messageKey="microclimates.next.list.responsesOf"
              params={{ responses: row.responseCount, target: row.targetParticipantCount }}
              locale={locale}
            />
          ) : (
            <MonoReadings
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
      <div className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-1 md:justify-end">
        <ProtectedCell
          responses={row.responseCount}
          threshold={MINIMUM_RESPONDENTS}
          description={title}
          suppressedClassName="h-control-canvas w-9"
        >
          <Button asChild variant="outline" size="canvas">
            <Link to={`/microclimates/${row.id}/results`}>
              <File aria-hidden="true" />
              {t('microclimates.next.list.results')}
            </Link>
          </Button>
        </ProtectedCell>
      </div>
    </div>
  )
}
