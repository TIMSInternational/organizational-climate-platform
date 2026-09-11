import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowRight, ChevronRight, Clock, Copy, Ellipsis, EyeOff, Link2, Mail, Plus, Send } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../../i18n'
import { PageTopBar } from '../../../../components/layout'
import { CanvasCard, FactList, IconBox, NoteBand, PageMeta, PageMetaSentences } from '../../../../components/canvas'
import {
  Alert,
  AlertDescription,
  Button,
  Chip,
  ConfirmationDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  LoadingRegion,
  NetworkError,
  SkeletonText,
} from '../../../../components/ui'
import { useViewerCapabilities } from '../../../../auth/viewerCapabilities'
// The Después card's boxes carry the board's own glyphs, which are the rail's: the waves of
// Microclimas for "Ver en vivo" and the three bars of Analítica for "Resultados".
import { RailAnalyticsIcon, RailMicroclimatesIcon } from '../../../../navigation/railIcons'
import type { MicroclimateDetail } from '../../api/microclimates'
import type { MicroclimateInvitationList } from '../../api/microclimateInvitations'
import { JourneyRail } from '../JourneyRail'
import { MicroclimateGate } from '../MicroclimateGate'
import { FLOOR, invitationLadder, journeyStates, type JourneyKey, type JourneyState } from '../derive'
import { clock, longDay, shortDay, shortDayYear } from '../format'
import { canvasTypeLabel, rungLabel, sessionStatusLabel, sessionStatusTone } from '../vocabulary'
import { InviteDialog } from './InviteDialog'
import { SessionQr } from './SessionQr'
import { useMicroclimateDetailModel, type MicroclimateDetailState, type Settled } from './useMicroclimateDetailModel'

/**
 * `/microclimates/:id` — the redesigned Detalle de microclima, drawn as the MicroclimateDetail
 * board of 10 Sep: the "share" step — status, the link and its QR, the invitations, then the
 * ways on to the live session and the results. It replaced `MicroclimateDetailPage` on this
 * route; that page stays in the tree, unrouted, as the wiring reference.
 *
 * Every action is offered only to a viewer the server would let take it
 * (`canManageMicroclimate`: `Roles.Admin` and the session's own company). A draft's one
 * primary action is "Lanzar"; a live session's is "Copiar enlace", as the board draws it.
 */
export default function MicroclimateDetailNextPage() {
  return (
    <MicroclimateGate needsCompany={false}>
      <DetailScreen />
    </MicroclimateGate>
  )
}

function DetailScreen() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const state = useMicroclimateDetailModel(id)
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
  if (state.status === 'loading' || !state.detail) {
    return (
      <LoadingRegion loading label={t('common.loading')}>
        <SkeletonText lines={6} />
      </LoadingRegion>
    )
  }
  return <DetailView state={state} detail={state.detail} />
}

/** "9 sept 2026, 21:06". */
function instant(t: TranslateFn, iso: string, locale: string): string {
  return t('microclimates.next.sheet.instant', { date: shortDayYear(iso, locale), time: clock(iso, locale) })
}

function journeyNotes(t: TranslateFn, detail: MicroclimateDetail, locale: string): Record<JourneyKey, string> {
  const states: Record<JourneyKey, JourneyState> = journeyStates(detail.status)
  const count = detail.responseCount
  const target = detail.targetParticipantCount
  const tally =
    target > 0
      ? t('microclimates.next.journey.tally', { count, target })
      : t('microclimates.next.journey.tallyNoTarget', { count })
  return {
    create:
      states.create === 'done'
        ? t('microclimates.next.journey.createdAt', { date: shortDay(detail.startTime, locale), time: clock(detail.startTime, locale) })
        : states.create === 'current'
          ? t('microclimates.next.journey.createDraft')
          : t('microclimates.next.journey.createNote'),
    share:
      states.share === 'current'
        ? t('microclimates.next.journey.shareNow')
        : states.share === 'done'
          ? t('microclimates.next.journey.shareDone')
          : t('microclimates.next.journey.shareNote'),
    live:
      states.live === 'done'
        ? tally
        : detail.status === 'active'
          ? t('microclimates.next.journey.liveSoFar', { tally })
          : t('microclimates.next.journey.liveNote'),
    read:
      states.read === 'current'
        ? t('microclimates.next.journey.readNow')
        : t('microclimates.next.journey.readOn', { date: shortDay(detail.endTime, locale) }),
  }
}

function DetailView({ state, detail }: { state: MicroclimateDetailState; detail: MicroclimateDetail }) {
  const { t, locale } = useTranslation()
  const capabilities = useViewerCapabilities()
  const manages = capabilities.canManageMicroclimate(detail)
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [confirmClose, setConfirmClose] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const title = detail.title ?? t('microclimates.untitled')
  const isDraft = detail.status === 'draft'
  const isLive = detail.status === 'active'
  const isClosed = detail.status === 'closed'
  const path = `/microclimates/${detail.id}/respond`
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const host = typeof window === 'undefined' ? '' : window.location.host
  const url = `${origin}${path}`

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url)
      setCopied('copied')
    } catch {
      setCopied('failed')
    }
  }

  const when =
    isLive
      ? t('microclimates.next.detail.metaActive', { date: longDay(detail.endTime, locale), time: clock(detail.endTime, locale) })
      : isClosed
        ? t('microclimates.next.detail.metaClosed', { date: longDay(detail.endTime, locale), time: clock(detail.endTime, locale) })
        : t('microclimates.next.detail.metaDraft', { date: longDay(detail.endTime, locale), time: clock(detail.endTime, locale) })
  const tally =
    detail.targetParticipantCount > 0
      ? t('microclimates.next.detail.metaTally', { count: detail.responseCount, target: detail.targetParticipantCount })
      : t('microclimates.next.detail.metaTallyNoTarget', { count: detail.responseCount })

  return (
    <div>
      <PageTopBar
        compact
        title={title}
        eyebrow={t('microclimates.next.detail.eyebrow')}
        description={t('microclimates.next.detail.description')}
        breadcrumbs={[{ label: t('navigation.microclimates'), href: '/microclimates' }, { label: title }]}
        meta={
          <PageMeta>
            <Chip className="self-start" label={sessionStatusLabel(t, detail.status)} tone={sessionStatusTone(detail.status)} />
            <PageMetaSentences
              sentences={[
                { id: 'when', text: when },
                { id: 'tally', text: tally, muted: true },
              ]}
            />
          </PageMeta>
        }
        actions={
          <>
            {isDraft && manages && (
              <Button variant="primary" size="canvas" disabled={state.pending !== null} onClick={state.launch}>
                <Send aria-hidden="true" />
                {t('microclimates.next.detail.launch')}
              </Button>
            )}
            {isLive && (
              <Button asChild variant="outline" size="canvas">
                <Link to={`/microclimates/${detail.id}/live`}>
                  <ArrowRight aria-hidden="true" />
                  {t('microclimates.next.viewLive')}
                </Link>
              </Button>
            )}
            <Button asChild variant="outline" size="canvas">
              <Link to={`/microclimates/${detail.id}/results`}>
                <RailAnalyticsIcon strokeWidth={2} />
                {t('microclimates.results')}
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon-canvas" aria-label={t('microclimates.next.detail.moreActions')}>
                  <Ellipsis aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void copyLink()}>{t('microclimates.next.detail.copyLink')}</DropdownMenuItem>
                {isLive && manages && (
                  <DropdownMenuItem onSelect={() => setConfirmClose(true)}>{t('microclimates.next.detail.closeNow')}</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div className="flex flex-col gap-5">
        {state.launchError && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{t('microclimates.next.detail.launchFailed', { reason: state.launchError })}</AlertDescription>
          </Alert>
        )}
        {state.actionError && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{state.actionError}</AlertDescription>
          </Alert>
        )}

        <JourneyRail states={journeyStates(detail.status)} notes={journeyNotes(t, detail, locale)} />

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_350px]">
          <div className="flex min-w-0 flex-col gap-4">
            <CanvasCard title={t('microclimates.next.detail.linkTitle')}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-8 min-w-0 flex-1 basis-64 items-center gap-2 rounded-md border border-line-default bg-surface-card px-2.5">
                  <Link2 aria-hidden="true" className="size-3.5 shrink-0 text-fg-tertiary" />
                  <span className="truncate font-mono text-base text-fg-primary">{`${host}${path}`}</span>
                </span>
                <Button variant={isDraft ? 'outline' : 'primary'} size="canvas" onClick={() => void copyLink()}>
                  <Copy aria-hidden="true" />
                  {t('microclimates.next.detail.copyLink')}
                </Button>
              </div>
              {copied !== 'idle' && (
                <span role="status" className="text-sm text-fg-tertiary">
                  {copied === 'copied' ? t('microclimates.next.detail.copied') : t('microclimates.next.detail.copyFailed', { url })}
                </span>
              )}
              <SessionQr url={url} microclimateId={detail.id}>
                <span className="text-base leading-normal text-fg-secondary">
                  {detail.anonymousResponses ? t('microclimates.next.detail.qrAnonymous') : t('microclimates.next.detail.qrIdentified')}
                </span>
                {!isLive && (
                  <span className="text-sm text-fg-tertiary">
                    {isDraft ? t('microclimates.next.detail.linkDraft') : t('microclimates.next.detail.linkClosed')}
                  </span>
                )}
              </SessionQr>
            </CanvasCard>

            <InvitationsCard
              invitations={state.invitations}
              canInvite={manages && !isClosed}
              onInvite={() => setInviteOpen(true)}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <CanvasCard title={t('microclimates.next.sheet.title')} inset="side">
              <FactList
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
                    id: 'expected',
                    term: t('microclimates.next.sheet.expected'),
                    value: <span className="font-mono tabular-nums">{detail.targetParticipantCount}</span>,
                  },
                  ...(detail.description
                    ? [
                        {
                          id: 'description',
                          term: t('microclimates.next.sheet.description'),
                          value: <span className="text-fg-secondary">{detail.description}</span>,
                        },
                      ]
                    : []),
                ]}
              />
            </CanvasCard>

            <CanvasCard title={t('microclimates.next.detail.questionsTitle')} count={detail.questions.length} inset="side">
              <ol className="m-0 flex list-none flex-col p-0">
                {[...detail.questions]
                  .sort((a, b) => a.order - b.order)
                  .map((question, index) => (
                    <li key={question.id} className="flex items-start gap-2.5 border-t border-line-light py-2">
                      <span className="inline-flex size-5.5 shrink-0 items-center justify-center rounded-full bg-surface-icon-box font-mono text-xs font-semibold tabular-nums text-fg-secondary">
                        {index + 1}
                      </span>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-base text-fg-primary">{question.text ?? t('microclimates.untitled')}</span>
                        <span className="text-sm text-fg-tertiary">
                          {t('microclimates.next.detail.questionMeta', {
                            type: canvasTypeLabel(t, question.type),
                            required: (question.required ? t('microclimates.next.create.required') : t('microclimates.next.create.optional')).toLocaleLowerCase(locale),
                          })}
                        </span>
                      </span>
                    </li>
                  ))}
              </ol>
            </CanvasCard>

            <CanvasCard title={t('microclimates.next.detail.afterTitle')} inset="side">
              <ul className="m-0 flex list-none flex-col p-0">
                {isLive && (
                  <AfterRow
                    to={`/microclimates/${detail.id}/live`}
                    icon={<RailMicroclimatesIcon strokeWidth={1.8} />}
                    title={t('microclimates.next.viewLive')}
                    note={t('microclimates.next.detail.afterLive', { floor: FLOOR })}
                  />
                )}
                <AfterRow
                  to={`/microclimates/${detail.id}/results`}
                  icon={<RailAnalyticsIcon strokeWidth={1.8} />}
                  title={t('microclimates.results')}
                  note={
                    isClosed
                      ? t('microclimates.next.detail.afterResultsClosed')
                      : t('microclimates.next.detail.afterResults', { date: shortDay(detail.endTime, locale) })
                  }
                />
              </ul>
              {isLive && manages && (
                <div className="flex flex-col gap-1.5 border-t border-line-light pt-2.5">
                  <span className="self-start">
                    <Button variant="outline" size="canvas" disabled={state.pending !== null} onClick={() => setConfirmClose(true)}>
                      <Clock aria-hidden="true" />
                      {t('microclimates.next.detail.closeNow')}
                    </Button>
                  </span>
                  <span className="text-xs text-fg-tertiary">{t('microclimates.next.detail.closeNote')}</span>
                </div>
              )}
            </CanvasCard>
          </div>
        </div>
      </div>

      {manages && (
        <>
          <ConfirmationDialog
            open={confirmClose}
            onOpenChange={setConfirmClose}
            title={t('microclimates.next.detail.closeConfirmTitle')}
            description={t('microclimates.next.detail.closeConfirmBody')}
            confirmText={t('microclimates.next.detail.closeNow')}
            cancelText={t('common.cancel')}
            variant="destructive"
            onConfirm={async () => {
              await state.close()
              setConfirmClose(false)
            }}
          />
          <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} companyId={detail.companyId} onInvite={state.invite} />
        </>
      )}
    </div>
  )
}

function AfterRow({ to, icon, title, note }: { to: string; icon: React.ReactNode; title: string; note: string }) {
  return (
    <li className="border-t border-line-light">
      <Link to={to} className="flex items-center gap-3 py-2.5 text-fg-primary hover:no-underline">
        <IconBox>{icon}</IconBox>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-base font-semibold">{title}</span>
          <span className="text-sm text-fg-tertiary">{note}</span>
        </span>
        <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-fg-tertiary" />
      </Link>
    </li>
  )
}

function InvitationsCard({
  invitations,
  canInvite,
  onInvite,
}: {
  invitations: Settled<MicroclimateInvitationList>
  canInvite: boolean
  onInvite: () => void
}) {
  const { t } = useTranslation()
  const list = invitations.status === 'ready' ? invitations.value : null
  const summary = list?.summary
  return (
    <CanvasCard
      title={t('microclimates.next.detail.invitationsTitle')}
      count={summary?.total}
      aside={
        summary
          ? t('microclimates.next.detail.invitationsAside', { pending: summary.pending, sent: summary.sent, opened: summary.opened })
          : undefined
      }
    >
      {invitations.status === 'loading' && <p className="m-0 text-sm text-fg-tertiary">{t('microclimates.next.detail.invitationsLoading')}</p>}
      {invitations.status === 'failed' && <p className="m-0 text-sm text-fg-tertiary">{t('microclimates.next.detail.invitationsFailed')}</p>}
      {list && list.invitations.length === 0 && (
        <div className="flex items-start gap-3.5 rounded-xl border border-dashed border-line-default p-3.5">
          <IconBox>
            <Mail />
          </IconBox>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-base font-semibold text-fg-primary">{t('microclimates.next.detail.invitationsEmptyTitle')}</span>
            <span className="text-sm leading-normal text-fg-secondary">{t('microclimates.next.detail.invitationsEmptyBody')}</span>
            {canInvite && (
              <span className="mt-1 self-start">
                <Button variant="outline" size="canvas" onClick={onInvite}>
                  <Plus aria-hidden="true" />
                  {t('microclimates.next.detail.invite')}
                </Button>
              </span>
            )}
          </div>
        </div>
      )}
      {list && list.invitations.length > 0 && (
        <>
          <ul className="m-0 flex list-none flex-col p-0">
            {list.invitations.slice(0, 8).map((invitation) => (
              <li key={invitation.id} className="flex items-center justify-between gap-3 border-t border-line-light py-2">
                <span className="truncate text-base text-fg-primary">{invitation.email}</span>
                <Chip label={rungLabel(t, invitation.status)} />
              </li>
            ))}
          </ul>
          {list.invitations.length > 8 && (
            <span className="text-sm text-fg-tertiary">{t('microclimates.next.detail.invitationsMore', { count: list.invitations.length - 8 })}</span>
          )}
          {canInvite && (
            <span className="self-start">
              <Button variant="outline" size="canvas" onClick={onInvite}>
                <Plus aria-hidden="true" />
                {t('microclimates.next.detail.inviteMore')}
              </Button>
            </span>
          )}
        </>
      )}
      {list && <Ladder list={list} />}
    </CanvasCard>
  )
}

function Ladder({ list }: { list: MicroclimateInvitationList }) {
  const { t } = useTranslation()
  const ladder = invitationLadder(list.anonymity)
  return (
    <>
      <div className="flex flex-col gap-2">
        <span className="text-2xs font-bold uppercase tracking-label text-fg-label">{t('microclimates.next.detail.ladderTitle')}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {ladder.recorded.map((state, index) => (
            <span key={state} className="inline-flex items-center gap-1.5">
              {index > 0 && <ChevronRight aria-hidden="true" className="size-3 text-fg-tertiary" />}
              <Chip label={rungLabel(t, state)} />
            </span>
          ))}
          {ladder.suppressed.length > 0 && (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-fg-tertiary">
              <ChevronRight aria-hidden="true" className="size-3" />
              <EyeOff aria-hidden="true" className="size-3.25" />
              {ladder.suppressed.map((state, index) => (
                <span key={state}>
                  {index > 0 && ' · '}
                  <s>{rungLabel(t, state)}</s>
                </span>
              ))}
              <span>{t('microclimates.next.detail.ladderNotRecorded')}</span>
            </span>
          )}
        </div>
      </div>
      <NoteBand>
        {list.anonymity.anonymous ? t('microclimates.next.detail.anonymityNote') : t('microclimates.next.detail.identifiedNote')}
      </NoteBand>
    </>
  )
}
