import { useEffect, useState } from 'react'
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
 * `completed`. Nothing in the web app called any of them. The token is minted per
 * invitee, the notification sender resolves it into the mail body, and the link then
 * arrived at the router's error boundary — so the state columns on
 * `survey_invitations` could only ever hold what an administrator's own actions put
 * there, and the distribution screen's funnel was structurally empty.
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

  useEffect(() => {
    if (!token) return

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
    // Re-resolving is free on this route: unlike the share link, it increments nothing,
    // and `opened` cannot move once it is set.
  }, [baseUrl, token, locale])

  function begin(): void {
    if (state.status !== 'landing' || !token) return
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
