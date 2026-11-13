import type { ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { Calendar, Check, CircleAlert, Lock, Search, ShieldCheck } from 'lucide-react'
import { useTranslation } from '../../../../i18n'
import { RespondCaption, RespondReading, RespondShell } from '../../../../components/layout'
import {
  Button,
  CanvasArrowRightIcon,
  CanvasClockIcon,
  CanvasLockIcon,
  LoadingState,
} from '../../../../components/ui'
import { returnTo } from '../../../../auth/returnPath'
import { cn } from '../../../../lib/cn'
import MicroclimatePulseForm from '../../components/MicroclimatePulseForm'
import { MINIMUM_RESPONDENTS } from '../../microclimatePrivacy'
import type { MicroclimateInvitationTokenDetail } from '../../api/microclimateLinks'
import { dayMonth, dayMonthLong } from '../derive'
import { deadCopy, respondUntil, type DeadKind, type InvitationView } from './derive'
import { useMicroclimateInvitationModel } from './useMicroclimateInvitationModel'

/** The Apple design's `.card`: 12px corners, the panel hairline, no shadow. */
const CARD = 'rounded-xl border border-line-panel bg-surface-card'

/**
 * `/microclimate-invitations/:token` — the personal invitation link as its invitee meets
 * it, drawn as the MicroclimateInvitation and MicroclimateInvitationStates artboards
 * (10 Sep). It replaced `MicroclimateInvitationPage` on this route; the old page stays in
 * the tree, unrouted, as the wiring reference.
 *
 * ## Outside `RequireAuth`, which is the requirement and not a shortcut
 *
 * The whole `/microclimate-invitations` group on the API takes no `ClaimsPrincipal` and
 * carries no `RequireAuthorization()`: the token in the path IS the credential. A gate
 * here would send every invitee to a login form they cannot pass, and `RequireAuth`
 * redirects with no destination at all, so it would not defer the page — it would destroy
 * it.
 *
 * ## What the redesign changed
 *
 * **Six states, each one the whole page.** The states artboard says it in as many words —
 * "Una frase por caso, en el lugar de la invitación" — so a closed pulse, a caducada,
 * anulada, no encontrada or ya usada invitation, and an identified pulse opened without a
 * session, each replace the landing card rather than appearing under it. Which one is
 * `invitationView`'s decision, not this file's.
 *
 * **One deadline instead of two.** The shipped page printed `endTime` and `expiresAt` side
 * by side. The artboard prints one reading — "Puede responder hasta … la fecha que llegue
 * antes" — which is `respondUntil`.
 *
 * **The sign-in case became an action.** It used to be a sentence under a button that
 * would have taken the respondent to a 401; it is now the page, with the one button that
 * resolves it, and that button carries this invitation as its return destination
 * (`auth/returnPath.ts`) so the label "y volver aquí" is true.
 *
 * ## Privacy
 *
 * Nothing about the session is named on any dead branch: `invitationView` settles a
 * refused token from the error alone, so a title, a description or a date cannot reach a
 * page opened with a stranger's link. The foot of the landing card states the floor of
 * five out loud, because a respondent about to type a word is the person entitled to know
 * it will never be published as their text — `MINIMUM_RESPONDENTS`, not a literal, so the
 * sentence and the rule cannot drift.
 */
export default function MicroclimateInvitationNextPage() {
  const { token } = useParams<{ token: string }>()
  const { t } = useTranslation('microclimates')
  const model = useMicroclimateInvitationModel(token)

  const detail = model.view.kind === 'landing' ? model.view.detail : null

  // No anonymity chip on the shell: the landing card's notice, then the pulse's own
  // block, make the promise once, under the strip — the canvas's RespondMicroclimatePhone
  // draws no chip in it. See `RespondShell`.
  return (
    <RespondShell skipLabel={t('respondSkip')} contentId="questions">
      {model.answering && detail ? (
        <MicroclimatePulseForm
          microclimateId={detail.microclimateId}
          onSubmitted={model.reportCompleted}
          // The token's own close, which the form's payload does not carry: the foot
          // prints "Abierta hasta el …" from this and from nothing else.
          closesAt={detail.endTime}
        />
      ) : (
        <InvitationBody view={model.view} onBegin={model.begin} />
      )}
    </RespondShell>
  )
}

function InvitationBody({ view, onBegin }: { view: InvitationView; onBegin: () => void }) {
  const { t, locale } = useTranslation('microclimates')
  const { t: tRoot } = useTranslation()

  if (view.kind === 'loading') {
    return <LoadingState label={tRoot('common.loading')} />
  }

  if (view.kind === 'landing') return <Landing detail={view.detail} onBegin={onBegin} />

  if (view.kind === 'signIn') return <SignInState />

  if (view.kind === 'closed') {
    const day = dayMonthLong(view.closesAt, locale)
    return (
      <StateCard
        label={t('next.invitation.closedLabel')}
        title={t('next.invitation.closedTitle')}
        // A date that will not parse prints no date rather than "Invalid Date": the
        // sentence without it is still true and still useful.
        body={
          day
            ? t('next.invitation.closedBody', { date: day })
            : t('next.invitation.closedBodyUndated')
        }
        icon={<Calendar aria-hidden="true" className="size-icon" />}
        tone="neutral"
        live="alert"
      />
    )
  }

  return <DeadState dead={view.dead} />
}

/**
 * The card between the mail and the questions.
 *
 * It answers, in order, the three things somebody who has just clicked a link out of an
 * email actually wants to know: what this is, how long they have, and whether it can come
 * back to them. Then it offers the one action, and closes on the rule that governs what
 * they are about to write.
 */
function Landing({
  detail,
  onBegin,
}: {
  detail: MicroclimateInvitationTokenDetail
  onBegin: () => void
}) {
  const { t, locale } = useTranslation('microclimates')
  const until = respondUntil(detail.endTime, detail.expiresAt)
  const untilDay = until === null ? null : dayMonth(until, locale)

  return (
    <div className="flex flex-col gap-panel-gap">
      <RespondCaption
        eyebrow={t('next.invitation.eyebrow')}
        title={detail.microclimateTitle ?? t('respondUntitled')}
        description={detail.microclimateDescription}
      />

      {untilDay && (
        <RespondReading
          label={t('next.invitation.untilLabel')}
          value={untilDay}
          sub={t('next.invitation.untilSub')}
        />
      )}

      <AnonymityNotice anonymous={detail.anonymity.anonymous} />

      <Button type="button" variant="primary" size="lg" className="w-full" onClick={onBegin}>
        {t('next.invitation.begin')}
        <CanvasArrowRightIcon strokeWidth={2} />
      </Button>

      <p className="text-center text-sm text-fg-secondary">
        {t('next.invitation.wordsNote', { minimum: MINIMUM_RESPONDENTS })}
      </p>
    </div>
  )
}

/**
 * What is recorded about this person, said before they answer rather than after.
 *
 * The wording is the payload's `anonymous` flag and nothing else — this is the one fact
 * the server publishes about how the response will be stored, and the copy states exactly
 * that much. On an anonymous session the invitation ladder stops at `opened`, so "we know
 * you looked and we will not know whether you answered" is literally true.
 *
 * Drawn in the survey's promise box (`surveys/components/AnonymityNotice`): the card
 * hairline, 16px across and 14px down, the blue padlock, the small uppercase label, and
 * the body at the respond step (15px). It was an `Alert` at 13px with an 8px gap, beside a
 * survey invitation whose promise was 15px with a 16px gap (12 Nov review): one promise,
 * two shapes. The words stay the pulse's own: "No se asocia a usted" and "Este pulso
 * registra quién participa" say what this payload's flag means for a pulse, which the
 * survey's "Anónima" does not.
 */
function AnonymityNotice({ anonymous }: { anonymous: boolean }) {
  const { t } = useTranslation('microclimates')

  return (
    <section
      role="status"
      data-slot="anonymity-notice"
      data-anonymous={anonymous}
      className="flex gap-2.5 rounded-xl border border-line-panel bg-surface-card px-4 py-3.5"
    >
      {anonymous ? (
        <Lock aria-hidden="true" className="mt-px size-icon shrink-0 text-accent-blue-ink" />
      ) : (
        <ShieldCheck aria-hidden="true" className="mt-px size-icon shrink-0 text-accent-blue-ink" />
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-2xs font-semibold uppercase tracking-eyebrow text-fg-secondary">
          {anonymous ? t('next.invitation.anonymousTitle') : t('next.invitation.identifiedTitle')}
        </span>
        <p className="m-0 text-respond text-fg-secondary">
          {anonymous ? t('next.invitation.anonymousBody') : t('next.invitation.identifiedBody')}
        </p>
      </div>
    </section>
  )
}

/**
 * The identified pulse, opened by a browser holding no session.
 *
 * The button is the whole card, and it carries this invitation back: `LoginPage` reads
 * `location.state` through `safeReturnPath` and lands the respondent here rather than on
 * `/dashboard`. Without that the label would be a promise the product does not keep.
 */
function SignInState() {
  const { t } = useTranslation('microclimates')
  const location = useLocation()

  return (
    <StateCard
      label={t('next.invitation.signInLabel')}
      title={t('next.invitation.signInTitle')}
      body={t('next.invitation.signInBody')}
      icon={<CanvasLockIcon strokeWidth={1.8} className="size-icon" />}
      tone="neutral"
      live="status"
      action={
        <Button asChild variant="primary" size="lg" className="w-full">
          <Link to="/login" state={returnTo(`${location.pathname}${location.search}`)}>
            {t('next.invitation.signInAction')}
          </Link>
        </Button>
      }
    />
  )
}

/**
 * The end of a link that did not open a pulse.
 *
 * The tone comes from the mapping, not from the fact that a promise rejected: `used`
 * arrives as a 409 and is not a problem, so it reads as a confirmation. Nothing here
 * offers a retry or a link into the app — a revoked token stays revoked, an expired one
 * stays expired, and the visitor may never have been a user of this product. The one
 * action that ever helps is naming who to ask, which the copy does.
 */
function DeadState({ dead }: { dead: DeadKind }) {
  const { t } = useTranslation('microclimates')

  const copy = deadCopy(dead)
  const shape = DEAD_SHAPE[dead]

  return (
    <StateCard
      label={t(copy.labelKey)}
      title={t(copy.titleKey)}
      // `unknown` has no sentence in `deadCopy`: a status this client has no copy for is in
      // practice a 429 from the token rate limiter, a 5xx, or a network failure that
      // produced no response at all. It reads `unknownBody` — never the server's own
      // message, which is fixed English and reached Spanish respondents here before (audit
      // 2026-10-22, R1). Never a blank.
      body={t(copy.bodyKey ?? 'next.invitation.unknownBody')}
      icon={shape.icon}
      tone={shape.tone}
      // `alert` interrupts, `status` waits its turn. A dead link is the reason the page
      // exists and the respondent needs it now; an already-answered pulse is a
      // confirmation.
      live={dead === 'used' ? 'status' : 'alert'}
    />
  )
}

const DEAD_SHAPE: Readonly<Record<DeadKind, { icon: ReactNode; tone: StateTone }>> = {
  notFound: { icon: <Search aria-hidden="true" className="size-icon" />, tone: 'neutral' },
  revoked: { icon: <CircleAlert aria-hidden="true" className="size-icon" />, tone: 'amber' },
  expired: { icon: <CanvasClockIcon strokeWidth={1.8} className="size-icon" />, tone: 'amber' },
  used: { icon: <Check aria-hidden="true" className="size-icon" />, tone: 'green' },
  unknown: { icon: <CircleAlert aria-hidden="true" className="size-icon" />, tone: 'amber' },
}

type StateTone = 'neutral' | 'amber' | 'green'

const TONE_CLASS: Readonly<Record<StateTone, string>> = {
  // The tone names survive as the states' classification; their colours do not. Amber and
  // green are result areas only (Apple-design ruling, 11 Nov): a revoked link is not
  // «Oportunidad». The sentence beside the tile carries the state.
  neutral: 'bg-surface-fill-subtle text-fg-secondary',
  amber: 'bg-surface-fill-subtle text-fg-secondary',
  green: 'bg-accent-blue-soft text-accent-blue-ink',
}

/**
 * One state of the invitation, as the states artboard draws every card: the case named in
 * a small label, then a tinted 32px glyph tile beside the sentence and its explanation.
 *
 * The title is the page's `<h1>` because on these branches it is the only heading there
 * is — the landing card's `<h1>` is the pulse's own title, and exactly one of the two is
 * ever on screen.
 */
function StateCard({
  label,
  title,
  body,
  icon,
  tone,
  live,
  action,
}: {
  /** Already-translated. */
  label: string
  /** Already-translated. */
  title: string
  /** Already-translated. */
  body: string
  icon: ReactNode
  tone: StateTone
  live: 'alert' | 'status'
  action?: ReactNode
}) {
  return (
    <section role={live} className={cn(CARD, 'flex flex-col gap-2.5 p-panel')}>
      <span className="text-2xs font-semibold uppercase tracking-eyebrow text-fg-label">
        {label}
      </span>
      <div className="grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-3">
        <span
          className={cn('grid size-8 shrink-0 place-items-center rounded-lg', TONE_CLASS[tone])}
        >
          {icon}
        </span>
        <div className="grid min-w-0 gap-0.5">
          {/* `font-sans` and `font-semibold` against the element defaults, which put every
              bare `h1` in the storefront serif at 24px (`index.css`). That is right for the
              page titles this app draws with an `h1` — including the landing card's, which
              is the pulse's own name — and wrong here: the states artboard sets each card's
              sentence at 14px semibold in the system sans, and an old-style serif at that
              size reads as decoration rather than as the answer to "what happened to my
              link". Measured: without these two the closed card's line rendered in Goudy. */}
          <h1 className="font-sans text-lg font-semibold text-fg-primary">{title}</h1>
          <p className="text-sm text-fg-secondary">{body}</p>
        </div>
      </div>
      {action}
    </section>
  )
}
