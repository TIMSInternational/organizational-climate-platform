import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { EyeOff, Info, ShieldCheck } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import { RespondCaption, RespondReading, RespondShell } from '../../../components/layout'
import { Alert, AlertDescription, AlertTitle, Button } from '../../../components/ui'
import { calendarDay } from '../../../lib/calendarDay'
import { getToken } from '../../../auth/token'
import MicroclimatePulseForm from '../components/MicroclimatePulseForm'
import { microclimateInvitationFailureCopy } from '../microclimateLinkFailure'
import {
  MicroclimateLinkError,
  getMicroclimateInvitation,
  recordMicroclimateInvitationStep,
  type MicroclimateInvitationTokenDetail,
} from '../api/microclimateLinks'

/**
 * `/microclimate-invitations/:token` — the personal invitation link, as its invitee
 * experiences it (#130).
 *
 * ## What was missing
 *
 * A microclimate could not be distributed at all. `MicroclimateInvitation` had been a table
 * with a token column since July and nothing wrote a row to it, so the only way to put a
 * pulse in front of anyone was to hand them `/microclimates/{guid}/respond` — a URL that
 * names no person, expires never, and cannot be revoked. This route is the other half of
 * that: one link per invitee, opaque, expiring, revocable, and tracked as far as the
 * anonymity boundary allows.
 *
 * ## Outside `RequireAuth`, which is the requirement and not a shortcut
 *
 * The issue says so in as many words — "routed **outside** `RequireAuth` — an invitee may
 * not have an account" — and the API agrees: the whole `/microclimate-invitations` group
 * takes no `ClaimsPrincipal` and carries no `RequireAuthorization()`. The token in the path
 * is the credential. A gate here would send every invitee to a login form they cannot pass,
 * and `RequireAuth` redirects with no `state.from`, so it would not even defer the
 * destination — it would destroy it.
 *
 * ## Why there is a landing card at all, rather than the questions straight away
 *
 * `/microclimates/:id/respond` goes directly into the questions, and that is right for a
 * link pasted into a team channel. This one is different in two ways that both argue for a
 * page in front of them.
 *
 * **It is addressed to one person, and it can be dead in ways they are entitled to
 * understand.** Revoked, expired, unknown and already-answered are four different sentences
 * here — see `microclimateLinkFailure.ts` — where the GUID route has only "not currently
 * available".
 *
 * **And `started` has to mean something.** The ladder's whole value to an administrator is
 * telling apart "they saw it" from "they began". Recording both at the same instant, on page
 * load, would make `opened` and `started` two names for one event, and the funnel a straight
 * line by construction. So `opened` is recorded when the card renders and `started` when the
 * respondent presses the button — which is what those two words already mean.
 *
 * ## What the tracking is allowed to cost
 *
 * Nothing. All three writes are fired and their failures swallowed: they are telemetry about
 * an invitation, not a precondition for answering, and a respondent blocked from a pulse
 * because a counter would not increment is a product that has confused whose page this is.
 * The server is idempotent (`MicroclimateInvitationStatuses.Advances` is strictly
 * monotonic), so a lost ping costs one row's precision and a repeated one costs nothing.
 *
 * ## Anonymity is the server's to enforce, not this page's
 *
 * `started` and `completed` are posted whether or not the session is anonymous — and for a
 * microclimate the default IS anonymous, so on most sessions both are refused. That is the
 * server's own instruction: the later states "are accepted by the API (the respondent's
 * client should not have to branch on anonymity) and deliberately not persisted". One
 * implementation of the ceiling, in the one place that owns the rows. A client that decided
 * for itself would be a second copy of the boundary, and the two would eventually disagree.
 *
 * What this page *does* read from the payload is `anonymity.anonymous`, and only to draw the
 * chip and the notice — a description of how a response is stored, never a decision about
 * what to send.
 */
export default function MicroclimateInvitationPage() {
  const { token } = useParams<{ token: string }>()
  const { t, locale } = useTranslation('microclimates')
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const [state, setState] = useState<InvitationState>({ status: 'loading' })

  // The token the respondent has already begun answering under, or null.
  //
  // A ref rather than state because the resolve effect has to READ it without being re-run
  // by it: making it a dependency would restore the very teardown it exists to prevent. It
  // holds the token rather than a bare boolean so that a genuinely different invitation —
  // the same component, a new `:token` — still resolves from scratch.
  const begunToken = useRef<string | null>(null)

  // Cleared when the token changes, and only then.
  //
  // The guard above is keyed on the token, which makes A -> B resolve correctly. It does not
  // make B -> A resolve, because the ref still holds A: the effect early-returns on a token
  // it was begun under long ago, leaving invitation B's questions mounted at invitation A's
  // URL while A's ladder is advanced. `[token]` and not `[token, locale]` is the whole
  // point: a cleanup that also ran on a language change would reopen the blocker exactly as
  // if the guard were not here.
  useEffect(() => {
    return () => {
      begunToken.current = null
    }
  }, [token])

  useEffect(() => {
    if (!token) return

    // Once the questions are on screen, this effect is the only thing that could take them
    // away, and on a language change that is exactly what it would do: `setState` below
    // replaces `answering` with `loading`, React unmounts the form, and a remounted form
    // starts with an empty answer map. On the one route in this product whose visitor has no
    // account and no draft, that is a respondent silently losing their answers.
    if (begunToken.current === token) return

    let cancelled = false
    setState({ status: 'loading' })

    getMicroclimateInvitation(baseUrl, token, { lang: locale })
      .then((detail) => {
        if (cancelled) return
        setState({ status: 'landing', detail })
        // Recorded here rather than in an effect of its own, so it fires exactly once per
        // successful resolve and never for a dead token — an invitation the server has just
        // refused has not been "opened" by anybody.
        void recordMicroclimateInvitationStep(baseUrl, token, 'opened').catch(ignoreTrackingFailure)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState({
          status: 'dead',
          error: error instanceof MicroclimateLinkError ? error : null,
        })
      })

    return () => {
      cancelled = true
    }
    // `locale` is a dependency because the card renders the session's own title and
    // description and they have to come back in the language the reader switched to.
    // Re-resolving is free while the card is what is on screen: these routes increment no
    // counter, and `opened` cannot move once it is set.
  }, [baseUrl, token, locale])

  function begin(): void {
    if (state.status !== 'landing' || !token) return
    // Set before the state change, not after: from here on a language switch must find the
    // guard already closed.
    begunToken.current = token
    void recordMicroclimateInvitationStep(baseUrl, token, 'started').catch(ignoreTrackingFailure)
    // Not awaited. The respondent pressed a button to answer a two-minute pulse; making them
    // wait on a round trip that only an administrator will ever read would be charging them
    // for somebody else's analytics.
    setState({ status: 'answering', detail: state.detail })
  }

  function reportCompleted(): void {
    if (!token) return
    void recordMicroclimateInvitationStep(baseUrl, token, 'completed').catch(ignoreTrackingFailure)
  }

  // False until the payload says otherwise, and false again for a dead token. The chip in
  // the header is a promise about how a response is stored, and a page that has not resolved
  // the invitation yet has no basis for making it — `RespondShell` defaults it off for
  // exactly this reason.
  const resolved = state.status === 'landing' || state.status === 'answering'
  const anonymous = resolved && state.detail.anonymity.anonymous

  return (
    <RespondShell skipLabel={t('respondSkip')} contentId="questions" anonymous={anonymous}>
      {state.status === 'answering' ? (
        <MicroclimatePulseForm
          microclimateId={state.detail.microclimateId}
          onSubmitted={reportCompleted}
        />
      ) : (
        <div className="flex flex-1 flex-col gap-panel-gap rounded-xl border border-line-panel bg-surface-panel p-panel">
          {state.status === 'loading' && <LoadingNotice />}
          {state.status === 'dead' && <DeadLink error={state.error} />}
          {state.status === 'landing' && <Landing detail={state.detail} onBegin={begin} />}
        </div>
      )}
    </RespondShell>
  )
}

type InvitationState =
  | { status: 'loading' }
  | { status: 'landing'; detail: MicroclimateInvitationTokenDetail }
  | { status: 'answering'; detail: MicroclimateInvitationTokenDetail }
  | { status: 'dead'; error: MicroclimateLinkError | null }

/**
 * The card between the mail and the questions.
 *
 * It answers, in order, the three things somebody who has just clicked a link out of an
 * email actually wants to know: what this is, how long they have, and whether it can come
 * back to them. Then it offers the one action.
 *
 * The two readings are the invitation's own dates and not a guess: `endTime` is when the
 * session stops accepting answers and `expiresAt` is when this person's token stops working,
 * and they are different numbers — an invitation can be issued with a shorter life than its
 * session. Showing only one of them would leave whichever respondent the other applied to
 * with a wrong deadline.
 *
 * ## The sign-in note, and why it is not optional
 *
 * A microclimate that is not anonymous refuses an unauthenticated respondent — `GET
 * /microclimates/{id}` serves an anonymous caller only when the session is BOTH anonymous and
 * active, and `POST .../responses` answers 401 on the same rule. Without the note below, an
 * invitee following a mail link to an identified session presses the button and meets "this
 * microclimate is not currently available": a sentence about the session's availability, for
 * a problem that is about their browser. They would reasonably read it as the link being
 * broken and stop.
 *
 * So the case is named before it happens, with the one action that resolves it. The button is
 * still offered — the server is the authority on what this browser may do, and a session in
 * another tab is a real case — and the note is drawn only when there is no stored token at
 * all, so a signed-in reader is not told to sign in.
 *
 * An earlier version of this file argued the note did not belong here because a microclimate
 * invitee is answering inside a session their account already reaches. That was backwards: it
 * is precisely BECAUSE they have an account that /login is a useful destination, and the
 * survey card had it right.
 */
function Landing({
  detail,
  onBegin,
}: {
  detail: MicroclimateInvitationTokenDetail
  onBegin: () => void
}) {
  const { t, locale } = useTranslation('microclimates')

  // Checked, not assumed. `GET /microclimates/{id}` serves an unauthenticated caller only
  // while the session is active, and a token can outlive its session's close: an invitation
  // minted at 09:00 for a pulse that ended at 09:30 still resolves at 09:29 and is useless
  // at 09:31. Saying so here beats letting them press the button and meet a bare "not
  // currently available".
  const closed = detail.microclimateStatus !== 'active'

  // The other half of the same check, and the same server rule: an identified session refuses
  // an anonymous caller outright. `getToken() === null` and not "is the token valid" — this
  // page has no way to ask, and the note is advice rather than a gate.
  const willNeedSignIn = !detail.anonymity.anonymous && getToken() === null

  return (
    <>
      <RespondCaption
        eyebrow={t('invitationEyebrow')}
        title={detail.microclimateTitle ?? t('respondUntitled')}
        description={detail.microclimateDescription}
      />

      {/* `calendarDay` rather than a local formatter: both of these are days, and it is the
          one function in this app that renders a day in UTC so that a reader west of UTC is
          not told a deadline that is a day early. */}
      <section
        aria-label={t('invitationPanelLabel')}
        className="grid gap-panel-gap sm:grid-flow-col sm:auto-cols-fr"
      >
        <RespondReading
          label={t('invitationClosesReading')}
          value={calendarDay(Date.parse(detail.endTime), locale)}
        />
        <RespondReading
          label={t('invitationExpiresReading')}
          value={calendarDay(Date.parse(detail.expiresAt), locale)}
        />
      </section>

      <AnonymityNotice anonymous={detail.anonymity.anonymous} />

      {willNeedSignIn && !closed && (
        <p className="max-w-prose text-sm text-fg-secondary">
          {t('invitationSignInNote')} <Link to="/login">{t('invitationSignIn')}</Link>
        </p>
      )}

      {closed ? (
        <Alert variant="warning" role="status">
          <Info aria-hidden="true" />
          <AlertTitle>{t('respondClosedTitle')}</AlertTitle>
          <AlertDescription>{t('notAcceptingResponses')}</AlertDescription>
        </Alert>
      ) : (
        <p>
          <Button type="button" variant="primary" onClick={onBegin}>
            {t('invitationBegin')}
          </Button>
        </p>
      )}
    </>
  )
}

/**
 * What is recorded about this person, said before they answer rather than after.
 *
 * The wording is the payload's `anonymous` flag and nothing else — this is the one fact the
 * server publishes about how the response will be stored, and the copy states exactly that
 * much. On an anonymous session the invitation ladder stops at `opened`, so "we know you
 * looked and we will not know whether you answered" is literally true; on an identified one
 * the full ladder is recorded and the copy says so instead of hedging.
 */
function AnonymityNotice({ anonymous }: { anonymous: boolean }) {
  const { t } = useTranslation('microclimates')

  return (
    <Alert variant={anonymous ? 'success' : 'info'} role="status">
      {anonymous ? <EyeOff aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
      <AlertTitle>
        {anonymous ? t('invitationAnonymousTitle') : t('invitationIdentifiedTitle')}
      </AlertTitle>
      <AlertDescription>
        {anonymous ? t('invitationAnonymousBody') : t('invitationIdentifiedBody')}
      </AlertDescription>
    </Alert>
  )
}

/**
 * The end of a link that did not open a pulse.
 *
 * The tone comes from the mapping, not from the fact that a promise rejected:
 * `already_completed` arrives as a 409 and is not a problem, so it renders in the success
 * treatment. Nothing here offers a retry or a link into the app — a revoked token stays
 * revoked, an expired one stays expired, and the visitor may never have been a user of this
 * product. The one action that ever helps is naming who to ask, which the copy does.
 */
function DeadLink({ error }: { error: MicroclimateLinkError | null }) {
  const { t } = useTranslation('microclimates')
  const { t: tRoot } = useTranslation()

  const copy = microclimateInvitationFailureCopy(error)
  const success = copy.tone === 'success'
  const description =
    copy.bodyKey === null ? (error?.message ?? '') || tRoot('errors.generic') : t(copy.bodyKey)

  return (
    <Alert
      variant={success ? 'success' : 'warning'}
      // `alert` interrupts, `status` waits its turn. A dead link is the reason the page
      // exists and the respondent needs it now; an already-answered pulse is a confirmation.
      role={success ? 'status' : 'alert'}
    >
      {success ? <ShieldCheck aria-hidden="true" /> : <Info aria-hidden="true" />}
      <AlertTitle>{t(copy.titleKey)}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  )
}

function LoadingNotice() {
  const { t: tRoot } = useTranslation()

  return <p className="text-base text-fg-secondary">{tRoot('common.loading')}</p>
}

/**
 * The invitation ladder is an administrator's view of a link, and this page belongs to the
 * person answering. A failed ping is dropped rather than surfaced, retried or logged: there
 * is nothing the respondent could do about it, nothing they would want to do about it, and a
 * toast about a tracking call is a way of telling somebody their pulse went wrong when it
 * did not.
 */
function ignoreTrackingFailure(): void {
  // Intentionally empty; see above.
}
