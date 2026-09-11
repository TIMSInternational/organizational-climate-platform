import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Check, Clock, Copy, File, Lock } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Chip,
  ConfirmationDialog,
  EmptyState,
  LoadingRegion,
  NetworkError,
  Progress,
  SkeletonText,
} from '../../../components/ui'
import { PROTECTED_HATCH } from '../../../components/charts/suppression'
import { cn } from '../../../lib/cn'
import type { LiveResults, MicroclimateDetail } from '../api/microclimates'
import { MINIMUM_RESPONDENTS } from '../microclimatePrivacy'
import { statusLabel } from '../microclimateVocabulary'
import { qrModules, qrPathData } from '../../surveys/components/ShareLinkQr'
import {
  clock,
  clockSeconds,
  dayMonthLong,
  displayLink,
  fillPercent,
  questionKinds,
  respondUrl,
  stamp,
  wordBars,
} from './derive'
import type { MicroclimateLiveNextModel } from './model'
import { useCopyLink } from './useCopyLink'
import { useMicroclimateLiveModel } from './useMicroclimateLiveModel'

/** The artboard's `.card`, with its 16/20/18 padding and 12px between blocks. */
const CARD = 'flex min-w-0 flex-col gap-3 rounded-xl border border-line-default bg-surface-card px-5 pt-4 pb-4.5 shadow-sm'

/**
 * `/microclimates/:id/live` — the redesigned live session, drawn as the MicroclimateLive
 * artboard (10 Sep). It replaced `MicroclimateLivePage` on this route; the old page
 * stays in the tree, unrouted, as the wiring reference.
 *
 * One figure that moves: the response count, at display size in the figure face, read
 * from `/live-results` every four seconds while the session is open
 * (`useMicroclimateLiveModel`), with the time of the last good read beside the panel
 * heading — and, when a read fails, the last good figure kept and the stamp saying so.
 * Beside it, what a person needs to hand the session to a room: the link, a QR of it,
 * and the session's fixed facts.
 *
 * Removed with the redesign, deliberately: the sentiment block (`sentimentScore` is
 * hardcoded to 0 on every submission, so it could only ever say nothing), the four KPI
 * tiles that restated one count four ways, and the trend chart.
 *
 * ## What people wrote
 *
 * Word frequencies, never text: each bar is a word and how many times it was written
 * (`wordBars`, which applies both floors of `microclimatePrivacy.ts`). Under 5 responses
 * the panel is the hatch and a sentence naming the floor — never the count of words
 * held back, never how far the session is from the floor, because either inverts in one
 * step into the sub-floor count the floor exists to hide. The response count itself is
 * shown at every size: it identifies nobody.
 *
 * Roles: only an administrator is answered here (`CanAccessCompany`); anyone else reads
 * a sentence and no request is made. "Cerrar la sesión" is drawn only for a viewer the
 * server lets close it, and only while the session is open.
 */
export default function MicroclimateLiveNextPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const state = useMicroclimateLiveModel(id)
  const [confirming, setConfirming] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)

  if (state.status === 'not-found') {
    return <p role="alert">{t('errors.notFound')}</p>
  }

  if (state.status === 'forbidden') {
    return (
      <div>
        <PageTopBar title={t('microclimates.next.live.crumb')} />
        <EmptyState
          fill
          title={t('microclimates.next.noAccessTitle')}
          description={t('microclimates.next.noAccessBody')}
        />
      </div>
    )
  }

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

  if (!state.model) {
    return (
      <LoadingRegion loading label={t('common.loading')}>
        <SkeletonText lines={6} />
      </LoadingRegion>
    )
  }

  const model = state.model
  const { detail } = model
  const title = detail.title ?? t('microclimates.untitled')

  return (
    <div>
      <PageTopBar
        eyebrow={t('microclimates.next.live.eyebrow', { section: t('navigation.sectionWorkspace') })}
        title={title}
        description={t('microclimates.next.live.description', { minimum: MINIMUM_RESPONDENTS })}
        breadcrumbs={[
          { label: t('navigation.microclimates'), href: '/microclimates' },
          { label: title, href: `/microclimates/${detail.id}` },
          { label: t('microclimates.next.live.crumb') },
        ]}
        tightBreadcrumb
        meta={<SessionLine detail={detail} />}
        metaClassName="mt-1 gap-2"
        actions={
          <>
            <Button asChild variant="outline" size="canvas">
              <Link to={`/microclimates/${detail.id}/results`}>
                <File aria-hidden="true" />
                {t('microclimates.next.live.results')}
              </Link>
            </Button>
            {state.mayClose && (
              <Button type="button" variant="outline" size="canvas" onClick={() => setConfirming(true)}>
                <Clock aria-hidden="true" />
                {t('microclimates.next.live.close')}
              </Button>
            )}
          </>
        }
      />

      {closeError && (
        <Alert variant="destructive" role="alert" className="mb-4">
          <AlertTitle>{t('microclimates.next.live.closeFailed')}</AlertTitle>
          <AlertDescription>{closeError}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <ArrivalsCard model={model} />
        <RespondCard detail={detail} />
      </div>

      <ConfirmationDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('microclimates.next.live.closeConfirmTitle')}
        description={t('microclimates.next.live.closeConfirmBody')}
        confirmText={t('microclimates.next.live.close')}
        cancelText={t('common.cancel')}
        variant="destructive"
        onConfirm={async () => {
          setCloseError(null)
          try {
            await state.close()
          } catch (err) {
            setCloseError(err instanceof Error ? err.message : t('errors.generic'))
          }
        }}
      />
    </div>
  )
}

/** "En vivo · abierta hasta el 11 de septiembre a las 21:06", under the description. */
function SessionLine({ detail }: { detail: MicroclimateDetail }) {
  const { t, locale } = useTranslation()
  const isOpen = detail.status === 'active'
  const instant = detail.status === 'draft' ? detail.startTime : detail.endTime
  const date = dayMonthLong(instant, locale)
  const time = clock(instant, locale)
  const key =
    detail.status === 'draft'
      ? 'microclimates.next.live.opensOn'
      : detail.status === 'closed'
        ? 'microclimates.next.live.closedOn'
        : 'microclimates.next.live.openUntil'

  return (
    <>
      <Chip
        tone={isOpen ? 'good' : 'neutral'}
        label={isOpen ? t('microclimates.next.chipLive') : statusLabel(t, detail.status)}
      />
      {date && time && <span className="text-sm text-fg-tertiary">{t(key, { date, time })}</span>}
    </>
  )
}

/**
 * "Respuestas conforme llegan": the figure, the bar to the target with the floor named
 * on its scale, and what people wrote under it.
 *
 * The figure is the latest poll's; before the first poll lands it is the detail's own
 * count, which is the same reading fetched a moment earlier, never a placeholder zero.
 */
function ArrivalsCard({ model }: { model: MicroclimateLiveNextModel }) {
  const { t, locale } = useTranslation()
  const { detail, live } = model
  const isOpen = detail.status === 'active'
  const responses = live?.responseCount ?? detail.responseCount
  const target = live?.targetParticipantCount ?? detail.targetParticipantCount
  const fill = fillPercent(responses, target)
  const note =
    detail.status === 'draft'
      ? t('microclimates.next.live.notYetOpen')
      : detail.status === 'closed'
        ? t('microclimates.next.live.closedFigure')
        : t('microclimates.next.live.listening')

  return (
    <section aria-labelledby="mc-arrivals" className={CARD}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="mc-arrivals" className="m-0 text-2xl">
          {t('microclimates.next.live.arrivalsTitle')}
        </h2>
        {isOpen && <LiveStamp lastUpdatedAt={model.lastUpdatedAt} isStale={model.isStale} />}
      </div>

      <div className="flex flex-wrap items-end gap-x-5 gap-y-2 pt-2 pb-1">
        <span
          data-slot="live-figure"
          className="flex-none whitespace-nowrap font-mono text-[4.5rem] leading-none tabular-nums text-fg-primary"
        >
          {responses.toLocaleString(locale)}
        </span>
        <div className="flex min-w-0 flex-col gap-1 pb-2">
          <span className="text-[0.9375rem] text-fg-primary">
            {fill !== null
              ? t('microclimates.next.live.expected', { target: target.toLocaleString(locale) })
              : t('microclimates.next.live.noTarget')}
          </span>
          <span className="text-sm text-fg-tertiary">{note}</span>
        </div>
      </div>

      {/* No target, no bar and no scale: a rate over an invented denominator states a
          participation nobody supplied (`participationPercent`). */}
      {fill !== null && (
        <>
          <Progress
            value={Math.round(fill)}
            className="h-2"
            aria-label={t('charts.participationProgress', {
              current: responses.toLocaleString(locale),
              target: target.toLocaleString(locale),
            })}
          />
          <div data-slot="live-scale" className="flex justify-between gap-3 font-mono text-xs text-fg-tertiary">
            <span>{(0).toLocaleString(locale)}</span>
            <span>{t('microclimates.next.live.scaleFloor', { minimum: MINIMUM_RESPONDENTS })}</span>
            <span>{target.toLocaleString(locale)}</span>
          </div>
        </>
      )}

      <WordsBlock live={live} responses={responses} />
    </section>
  )
}

/** "● En vivo · actualizado a las 21:50:42" — or, after a failed read, when the figure was last good. */
function LiveStamp({ lastUpdatedAt, isStale }: { lastUpdatedAt: Date | null; isStale: boolean }) {
  const { t, locale } = useTranslation()
  const time = lastUpdatedAt ? clockSeconds(lastUpdatedAt, locale) : null

  if (isStale && time) {
    return (
      <span data-slot="live-stamp" className="inline-flex items-center gap-1.5 text-sm text-accent-amber-ink">
        <span aria-hidden="true" className="size-2 rounded-full bg-accent-amber" />
        {t('microclimates.next.live.stalled', { time })}
      </span>
    )
  }

  return (
    <span data-slot="live-stamp" className="inline-flex items-center gap-1.5 text-sm text-accent-green-ink">
      <span aria-hidden="true" className="size-2 rounded-full bg-accent-green" />
      {time ? t('microclimates.next.live.updatedAt', { time }) : t('microclimates.next.live.connecting')}
    </span>
  )
}

/**
 * "Lo que la gente escribió". Under the floor, the hatch — the chip and the sentence say
 * what is held back and why, and nothing in this block carries a number but the
 * published floor itself. Above it, one bar per word, its length against the most
 * frequent one and its count in the figure face.
 */
function WordsBlock({ live, responses }: { live: LiveResults | null; responses: number }) {
  const { t, locale } = useTranslation()
  const words = wordBars(live?.wordCloud ?? [], responses)

  return (
    <div data-slot="live-words" className="mt-2 flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 text-base font-semibold text-fg-primary">{t('microclimates.next.live.wordsTitle')}</h3>
        {words.isSuppressed && (
          <Chip
            tone="neutral"
            icon={<Lock />}
            label={t('microclimates.next.live.protectedChip', { minimum: MINIMUM_RESPONDENTS })}
          />
        )}
      </div>

      {words.isSuppressed ? (
        <div
          data-slot="words-hatch"
          // `bg-surface-icon-box`, `ProtectedCell`'s ground: `--admin-hatch-stripe` is
          // measured against it in both themes (`protectedHatch.test.ts`). The artboard's
          // #f8f7fb is the outer ground, which in dark is far from the stripe's pair and
          // turned the hatch into a loud texture.
          className={cn(
            'flex h-42 flex-col items-center justify-center gap-1.5 rounded-lg bg-surface-icon-box px-4 text-center',
            PROTECTED_HATCH,
          )}
        >
          <Lock aria-hidden="true" className="size-4.5 text-fg-tertiary" />
          <span className="text-sm text-fg-tertiary">
            {t('microclimates.next.live.hatchNote', { minimum: MINIMUM_RESPONDENTS })}
          </span>
        </div>
      ) : words.bars.length === 0 ? (
        <div className="flex h-42 items-center justify-center rounded-lg border border-dashed border-line-default px-4 text-center text-sm text-fg-tertiary">
          {t('microclimates.next.live.wordsEmpty')}
        </div>
      ) : (
        <ol data-slot="word-bars" className="m-0 flex min-h-42 list-none flex-col justify-center gap-2 p-0">
          {words.bars.map((bar) => (
            <li
              key={`${bar.language}:${bar.text}`}
              className="m-0 grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_2.5rem] items-center gap-3"
            >
              <span className="truncate text-base text-fg-primary">{bar.text}</span>
              <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-surface-icon-box">
                <span className="block h-full rounded-full bg-accent-blue" style={{ width: `${bar.share * 100}%` }} />
              </span>
              <span className="text-right font-mono text-sm tabular-nums text-fg-secondary">
                {bar.value.toLocaleString(locale)}
              </span>
            </li>
          ))}
        </ol>
      )}

      {!words.isSuppressed && words.withheldCount > 0 && (
        <p className="m-0 text-sm text-fg-secondary">
          {words.withheldCount === 1
            ? t('microclimates.next.live.wordsWithheldOne', { count: words.withheldCount })
            : t('microclimates.next.live.wordsWithheldOther', { count: words.withheldCount })}
        </p>
      )}

      <p className="m-0 max-w-measure text-sm text-fg-tertiary">
        {t('microclimates.next.live.wordsNote', { minimum: MINIMUM_RESPONDENTS })}
      </p>
    </div>
  )
}

/**
 * "Para responder": the link, its QR, and the facts that do not move.
 *
 * The link and the QR are drawn for an open, anonymous session only, as the old live
 * page drew the link: a named session is answered from each person's own invitation,
 * and a draft or closed one refuses answers. The QR is the real code of the real link,
 * drawn with `ShareLinkQr`'s helpers and its fixed pair (modules on white paper in both
 * themes, so a camera reads it the same in dark mode) — this screen is the one meant to
 * be projected, so it is shown, not hidden behind a reveal.
 */
function RespondCard({ detail }: { detail: MicroclimateDetail }) {
  const { t, locale } = useTranslation()
  const { outcome, copy } = useCopyLink()
  const origin = window.location.origin
  const link = respondUrl(origin, detail.id)
  const shareable = detail.status === 'active' && detail.anonymousResponses
  const copied = outcome?.key === detail.id ? outcome : null
  const opensDate = dayMonthLong(detail.startTime, locale)
  const opensTime = clock(detail.startTime, locale)

  return (
    <section aria-labelledby="mc-respond" className={CARD}>
      <h2 id="mc-respond" className="m-0 text-2xl">
        {t('microclimates.next.live.respondTitle')}
      </h2>

      {shareable ? (
        <>
          <div className="flex flex-col gap-1.5">
            <span id="mc-link-label" className="text-2xs font-bold uppercase tracking-label text-fg-label">
              {t('microclimates.next.live.linkLabel')}
            </span>
            <div className="flex gap-2">
              <span
                data-slot="respond-link"
                aria-labelledby="mc-link-label"
                title={link}
                className="block h-control-canvas min-w-0 flex-1 truncate rounded-md border border-line-default bg-surface-outer px-2.5 font-mono text-xs leading-8 text-fg-secondary select-all"
              >
                {displayLink(origin, detail.id)}
              </span>
              <Button type="button" variant="outline" size="canvas" onClick={() => void copy(detail.id, link)}>
                {copied?.ok ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copied?.ok ? t('microclimates.next.live.copied') : t('microclimates.next.live.copy')}
              </Button>
            </div>
            {copied && !copied.ok && (
              <p role="status" className="m-0 text-sm text-fg-secondary">
                {t('microclimates.next.live.copyFailed')}{' '}
                <span className="select-all break-all font-mono">{link}</span>
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <QrPlate url={link} label={t('microclimates.next.live.qrLabel')} />
            <p className="m-0 min-w-0 flex-1 basis-40 text-sm text-fg-tertiary">{t('microclimates.next.live.qrHint')}</p>
          </div>
        </>
      ) : (
        <p data-slot="respond-unavailable" className="m-0 text-sm text-fg-tertiary">
          {detail.status === 'draft' && opensDate && opensTime
            ? t('microclimates.next.live.draftLinkHint', { date: opensDate, time: opensTime })
            : detail.status === 'closed'
              ? t('microclimates.next.live.closedLinkHint')
              : t('microclimates.next.live.identifiedHint')}
        </p>
      )}

      <Facts detail={detail} t={t} locale={locale} />
    </section>
  )
}

function QrPlate({ url, label }: { url: string; label: string }) {
  const modules = useMemo(() => qrModules(url), [url])
  // The four-module quiet zone `qrPathData` leaves on every side.
  const size = modules.length + 8

  return (
    <div
      data-slot="respond-qr"
      className="flex size-37 flex-none items-center justify-center rounded-lg border border-dashed border-line-default p-2"
    >
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${size} ${size}`}
        shapeRendering="crispEdges"
        className="size-full text-accent-blue-fill"
      >
        <rect width={size} height={size} className="fill-fg-on-accent" />
        <path d={qrPathData(modules)} fill="currentColor" />
      </svg>
    </div>
  )
}

/** Apertura, Cierre, Preguntas, Responden — a definition list, so the pairing is real markup. */
function Facts({ detail, t, locale }: { detail: MicroclimateDetail; t: TranslateFn; locale: string }) {
  const kinds = questionKinds(detail.questions)
    .map(({ kindKey, count, optional }) => {
      const kind = t(kindKey, { count })
      return optional ? t('microclimates.next.live.kindOptional', { kind }) : kind
    })
    .join(', ')
  const count = detail.questions.length.toLocaleString(locale)

  return (
    <dl className="m-0 grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-t border-line-light pt-1 text-base">
      <dt className="text-fg-tertiary">{t('microclimates.next.live.factOpens')}</dt>
      <dd className="m-0 font-mono tabular-nums">{stamp(detail.startTime, locale)}</dd>
      <dt className="text-fg-tertiary">{t('microclimates.next.live.factCloses')}</dt>
      <dd className="m-0 font-mono tabular-nums">{stamp(detail.endTime, locale)}</dd>
      <dt className="text-fg-tertiary">{t('microclimates.next.live.factQuestions')}</dt>
      <dd className="m-0">
        {kinds ? t('microclimates.next.live.questionsValue', { count, kinds }) : count}
      </dd>
      <dt className="text-fg-tertiary">{t('microclimates.next.live.factResponders')}</dt>
      <dd className="m-0">
        {detail.anonymousResponses
          ? t('microclimates.next.live.respondersAnonymous', { minimum: MINIMUM_RESPONDENTS })
          : t('microclimates.next.live.respondersNamed', { minimum: MINIMUM_RESPONDENTS })}
      </dd>
    </dl>
  )
}
