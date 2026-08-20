import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useTranslation } from '../../../i18n'
import { RespondCaption, RespondReading, RespondShell } from '../../../components/layout'
import { Button } from '../../../components/ui'
import { calendarDay } from '../../../lib/calendarDay'
import { getToken } from '../../../auth/token'
import SurveyRespondForm, {
  AnonymityNotice,
  RespondSurface,
} from '../components/SurveyRespondForm'
import { LinkOutcome } from '../components/LinkOutcome'
import { invitationFailureCopy } from '../linkFailure'
import {
  SurveyLinkError,
  getSurveyInvitation,
  recordSurveyInvitationStep,
  type SurveyInvitationTokenDetail,
} from '../api/surveyLinks'

/**
 * `/survey-invitations/:token` — the personal invitation link, as its invitee
 * experiences it.
 *
 * ## What was broken
 *
 * `SurveyDistributionEndpoints` maps four routes under `/survey-invitations/{token}`:
 * one that resolves the token and three that record `opened`, `started` and
 * `completed`. Nothing in the web app called any of them, so a token that reached a
 * browser arrived at the router's error boundary — the state columns on
 * `survey_invitations` could only ever hold what an administrator's own actions put
 * there, and the distribution screen's funnel was structurally empty.
 *
 * ## Nothing hands this link out yet, and that is on purpose here
 *
 * Grep for the writer, not the reader: `SurveyInvitation.InvitationToken` is minted in
 * `SurveyDistributionEndpoints` (create, and again on regenerate) and read back only by
 * the four routes above. **No mailer composes it into a message and no admin screen
 * reveals it.** `SurveyInvitationDetail` — the row behind the distribution table —
 * deliberately omits the token, and says why: "an admin who can list tokens can open any
 * employee's survey as them, which is a privilege the admin role does not otherwise
 * carry and which no screen needs." `InvitationTable` enforces the same rule from the
 * other end.
 *
 * So this route is reachable today only by pasting a token, and surfacing one in the
 * admin UI the way `ShareableLinkPanel` surfaces a user-invitation link is not the same
 * cheap move: that panel prints a link the API returns to its creator, whereas this
 * would mean adding a bearer credential for somebody else's identity to a list view. The
 * share link `/s/:token` does have a producer — `SurveyDistributionDetail.PublicLink`,
 * drawn masked by `ShareLinkPanel` — because the API chose to expose that one. The
 * missing producer for this route is the invitation mail, which another slice owns.
 *
 * ## Why there is a landing card at all, rather than the questions straight away
 *
 * `/s/:token` goes directly into the form, and that is right for a link handed to a
 * whole company. This one is different in two ways that both argue for a page in front
 * of the questions.
 *
 * **It is addressed to one person, and it can be dead in ways they are entitled to
 * understand.** Revoked, expired and already-answered are three different sentences
 * here, where the share link deliberately gives one — see `linkFailure.ts`.
 *
 * **And `started` has to mean something.** The invitation ladder's whole value to an
 * administrator is telling apart "they saw it" from "they began". Recording both at the
 * same instant, on page load, would make `opened` and `started` two names for one
 * event, and the funnel a straight line by construction. So `opened` is recorded when
 * the card renders and `started` when the respondent presses the button — which is what
 * those two words already mean.
 *
 * ## What the tracking is allowed to cost
 *
 * Nothing. All three writes are fired and their failures swallowed: they are telemetry
 * about an invitation, not a precondition for answering, and a respondent blocked from
 * a survey because a counter would not increment is a product that has confused whose
 * page this is. The server is idempotent (`SurveyInvitationStatuses.Advances` is
 * strictly monotonic), so a lost ping costs one row's precision and a repeated one
 * costs nothing at all.
 *
 * ## Anonymity is the server's to enforce, not this page's
 *
 * `started` and `completed` are posted whether or not the survey is anonymous.
 * `SurveyInvitationStatuses` says so in as many words — the later states "are accepted
 * by the API (the respondent's client should not have to branch on anonymity) and
 * deliberately not persisted" — and it is the right call: one implementation of the
 * ceiling, in the one place that owns the rows. A client that decided for itself would
 * be a second copy of the anonymity boundary, and the two would eventually disagree.
 */
export default function SurveyInvitationPage() {
  const { token } = useParams<{ token: string }>()
  const { t, locale } = useTranslation('surveyRespond')
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const [state, setState] = useState<InvitationState>({ status: 'loading' })

  // The token the respondent has already begun answering under, or null.
  //
  // A ref rather than state because the resolve effect has to READ it without being
  // re-run by it: making it a dependency would restore the very teardown it exists to
  // prevent. It holds the token rather than a bare boolean so that a genuinely different
  // invitation — the same component, a new `:token` — still resolves from scratch.
  const begunToken = useRef<string | null>(null)

  // Cleared when the token changes, and only then.
  //
  // The guard above is keyed on the token, which makes A -> B resolve correctly. It does
  // not make B -> A resolve, because the ref still holds A: the effect early-returns on a
  // token it was begun under long ago, leaving invitation B's questions mounted at
  // invitation A's URL while A's ladder is advanced. That is a worse bug than the one the
  // guard fixes -- the respondent answers the wrong survey under someone else's
  // invitation -- and it did not exist before the guard.
  //
  // `[token]` and not `[token, locale]` is the whole point: a cleanup that also ran on a
  // language change would reopen the blocker exactly as if the guard were not here.
  useEffect(() => {
    return () => {
      begunToken.current = null
    }
  }, [token])

  useEffect(() => {
    if (!token) return

    // Once the questions are on screen, this effect is the only thing that could take
    // them away, and on a language change that is exactly what it did: `setState` below
    // replaces `answering` with `loading`, React unmounts `SurveyRespondForm`, and a
    // remounted form starts with an empty answer map. The respondent was dropped back on
    // the landing card having lost every answer, with nothing said about it — on the one
    // route in this product whose visitor has no account, no draft and no way back.
    //
    // Nothing is lost by stopping here. The card this effect feeds is no longer rendered,
    // and the form owns its own language switch: it re-reads the question text in the new
    // locale and guards re-hydration behind a ref precisely so the answers survive it.
    if (begunToken.current === token) return

    let cancelled = false
    setState({ status: 'loading' })

    getSurveyInvitation(baseUrl, token, { lang: locale })
      .then((detail) => {
        if (cancelled) return
        setState({ status: 'landing', detail })
        // Recorded here rather than in an effect of its own, so it fires exactly once
        // per successful resolve and never for a dead token — an invitation the server
        // has just refused has not been "opened" by anybody.
        void recordSurveyInvitationStep(baseUrl, token, 'opened').catch(ignoreTrackingFailure)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState({
          status: 'dead',
          error: error instanceof SurveyLinkError ? error : null,
        })
      })

    return () => {
      cancelled = true
    }
    // `locale` is a dependency because the card renders the survey's own title and
    // description and they have to come back in the language the reader switched to.
    // Re-resolving is free while the card is what is on screen: unlike the share link it
    // increments nothing, and `opened` cannot move once it is set. It stops being free
    // the moment there are answers behind it, which is what the guard above is for.
  }, [baseUrl, token, locale])

  function begin(): void {
    if (state.status !== 'landing' || !token) return
    // Set before the state change, not after: from here on a language switch must find
    // the guard already closed.
    begunToken.current = token
    void recordSurveyInvitationStep(baseUrl, token, 'started').catch(ignoreTrackingFailure)
    // Not awaited. The respondent pressed a button to answer a survey; making them wait
    // on a round trip that only an administrator will ever read would be charging them
    // for somebody else's analytics.
    setState({ status: 'answering', detail: state.detail })
  }

  function reportCompleted(): void {
    if (!token) return
    void recordSurveyInvitationStep(baseUrl, token, 'completed').catch(ignoreTrackingFailure)
  }

  // False until the payload says otherwise, and false again for a dead token. The chip
  // in the header is a promise about how a response is stored, and a page that has not
  // resolved the invitation yet has no basis for making it — `RespondShell` defaults it
  // off for exactly this reason.
  const resolved = state.status === 'landing' || state.status === 'answering'
  const anonymous = resolved && state.detail.anonymity.anonymous

  return (
    <RespondShell skipLabel={t('skipToSurvey')} contentId="survey" anonymous={anonymous}>
      {state.status === 'answering' ? (
        // `publicEntry`, even though this visitor is named: it describes what the
        // browser holds, not what the server knows. Somebody who followed a link out of
        // an email has no session, so a 401 here means the survey is closed or not open
        // to anonymous respondents rather than "your token went stale", and there is no
        // Home for the confirmation to send them to.
        <SurveyRespondForm
          surveyId={state.detail.surveyId}
          publicEntry
          onSubmitted={reportCompleted}
        />
      ) : (
        <RespondSurface>
          {state.status === 'loading' && <LoadingNotice />}
          {state.status === 'dead' && (
            <LinkOutcome
              copy={invitationFailureCopy(state.error)}
              serverMessage={state.error?.message ?? ''}
            />
          )}
          {state.status === 'landing' && (
            <Landing detail={state.detail} locale={locale} onBegin={begin} />
          )}
        </RespondSurface>
      )}
    </RespondShell>
  )
}

type InvitationState =
  | { status: 'loading' }
  | { status: 'landing'; detail: SurveyInvitationTokenDetail }
  | { status: 'answering'; detail: SurveyInvitationTokenDetail }
  | { status: 'dead'; error: SurveyLinkError | null }

/**
 * The card between the mail and the questions.
 *
 * It answers, in order, the three things somebody who has just clicked a link out of an
 * email actually wants to know: what this is, whether it can come back to them, and how
 * long they have. Then it offers the one action.
 *
 * The two readings are the invitation's own dates and not a guess: `surveyEndDate` is
 * when the survey stops accepting answers and `expiresAt` is when this person's token
 * stops working, and they are different numbers — an invitation can be issued with a
 * shorter life than its survey. Showing only one of them would leave whichever
 * respondent the other applied to with a wrong deadline.
 */
function Landing({
  detail,
  locale,
  onBegin,
}: {
  detail: SurveyInvitationTokenDetail
  locale: string
  onBegin: () => void
}) {
  const { t } = useTranslation('surveyRespond')

  // Checked, not assumed: `GET /surveys/{id}/respond` serves an unauthenticated caller
  // only when the survey is anonymous AND open (`ResolveRespondentAsync`), so an invitee
  // to a named survey who is not signed in is about to be refused. Saying so here beats
  // letting them press the button and meet a 401 they will read as the link being
  // broken. The button is still offered — the server is the authority on what this
  // browser may do, and a session in another tab is a real case.
  const willNeedSignIn = !detail.anonymity.anonymous && getToken() === null

  return (
    <>
      <RespondCaption
        eyebrow={t('invitationEyebrow')}
        title={detail.surveyTitle ?? t('untitledSurvey')}
        description={detail.surveyDescription}
      />

      {/* `calendarDay` rather than a local formatter: both of these are days, and it is
          the one function in this app that renders a day in UTC so that a reader west of
          UTC is not told a deadline that is a day early. */}
      <section
        aria-label={t('panelLabel')}
        className="grid gap-panel-gap sm:grid-flow-col sm:auto-cols-fr"
      >
        <RespondReading
          label={t('closesReading')}
          value={calendarDay(Date.parse(detail.surveyEndDate), locale)}
        />
        <RespondReading
          label={t('invitationExpiresReading')}
          value={calendarDay(Date.parse(detail.expiresAt), locale)}
        />
      </section>

      <AnonymityNotice anonymous={detail.anonymity.anonymous} />

      {willNeedSignIn && (
        <p className="max-w-prose text-sm text-fg-secondary">
          {t('invitationSignInNote')} <Link to="/login">{t('signIn')}</Link>
        </p>
      )}

      <p>
        <Button type="button" variant="primary" onClick={onBegin}>
          {t('beginSurvey')}
        </Button>
      </p>
    </>
  )
}

function LoadingNotice() {
  const { t: tRoot } = useTranslation()

  return <p className="text-base text-fg-secondary">{tRoot('common.loading')}</p>
}

/**
 * The invitation ladder is an administrator's view of a link, and this page belongs to
 * the person answering. A failed ping is dropped rather than surfaced, retried or
 * logged: there is nothing the respondent could do about it, nothing they would want to
 * do about it, and a toast about a tracking call is a way of telling somebody their
 * survey went wrong when it did not.
 */
function ignoreTrackingFailure(): void {
  // Intentionally empty; see above.
}
