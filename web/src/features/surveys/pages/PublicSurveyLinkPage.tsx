import { useParams } from 'react-router'
import { useTranslation } from '../../../i18n'
import { RespondShell } from '../../../components/layout'
import SurveyRespondForm, { RespondSurface } from '../components/SurveyRespondForm'
import { EntryOutcomeCard } from '../next/entry/EntryOutcomeCard'
import { PublicRespondEntryView } from '../next/entry/PublicRespondEntryView'
import { usePublicEntryModel } from '../next/entry/usePublicEntryModel'

/**
 * `/s/:token` — the open share link, as the person who was handed it experiences it.
 *
 * ## What the route is
 *
 * `SurveyAccessTokens.PublicLinkPath` builds `/s/{token}` and
 * `SurveyDistributionEndpoints` stores exactly that string in
 * `survey_distributions.public_url`. `ShareLinkPanel` shows it to an administrator to
 * copy, print on a QR code and mail out, so for most of the people who ever use this
 * product this is the **first screen they see** and quite possibly the only one.
 *
 * ## Why the token has to be resolved rather than used directly
 *
 * The token is opaque by design — 32 bytes of `RandomNumberGenerator`, base64url, with
 * no survey id anywhere in it — precisely so that holding one link tells you nothing
 * about any other. `GET /survey-links/{token}` is the only thing that can turn it into
 * a survey id, and it is also where the server enforces what the link is worth: an
 * unknown token, a revoked one and a survey outside its window all come back as the
 * same 404, and a survey that is not accepting responses does too.
 *
 * ## The seam this page used to be
 *
 * It resolved the token and mounted `SurveyRespondForm`, with the old `LinkOutcome`
 * alert box for the failures. The respond flow was redesigned from the canvas
 * (RespondSurveyPhone, RespondConfirmationPhone, 10 Sep) and this page was not, so a
 * respondent crossed a visible join: an alert-shaped landing into a card-shaped form.
 * The entry is now the PublicRespondEntry artboard and its failures are
 * PublicRespondEntryStates, both drawn out of the same shell, the same caption, the
 * same readings and the same anonymity block the next screen uses. Nothing about the
 * respond flow changed; the two halves are the same design now because the first half
 * is built out of the second half's pieces.
 *
 * ## Why it is outside `RequireAuth` and outside `AdminLayout`
 *
 * The same reason `/survey/:id` is, written out on `PublicSurveyRespondPage` and on
 * `RespondShell`: whoever holds this link has no account, and every piece of the admin
 * shell is a way for a company's structure to appear on a page anybody can open.
 *
 * ## Why the shell is rendered before anything resolves
 *
 * The frame carries the language picker, and a visitor who cannot read the page in
 * their own language is exactly as stuck on "resolving" as on a question. Rendering
 * every state inside the same frame also means the page does not jump as the two loads
 * land.
 */
export default function PublicSurveyLinkPage() {
  const { token } = useParams<{ token: string }>()
  const { t, locale } = useTranslation('surveyRespond')
  const { state, begin } = usePublicEntryModel(token)

  return (
    <RespondShell skipLabel={t('skipToSurvey')} contentId="survey">
      {state.status === 'answering' ? (
        // `publicEntry`: whoever followed this link may hold nothing but the link. It
        // changes what a 401 from the respond endpoint means — closed, or not open to
        // anonymous visitors, and the server deliberately does not say which — and it
        // drops the "back to Home" link from the confirmation, which for this visitor
        // is a round trip through `RequireAuth` to a sign-in form they did not ask for.
        <SurveyRespondForm surveyId={state.surveyId} publicEntry />
      ) : (
        <RespondSurface>
          {state.status === 'waiting' && <ResolvingNotice />}
          {state.status === 'blocked' && (
            <EntryOutcomeCard outcome={state.outcome} serverMessage={state.serverMessage} />
          )}
          {state.status === 'landing' && (
            <PublicRespondEntryView view={state.view} locale={locale} onBegin={begin} />
          )}
        </RespondSurface>
      )}
    </RespondShell>
  )
}

/**
 * Held to the same sentence `SurveyRespondForm` shows while it loads, so the two
 * requests this page makes back to back read as one wait rather than two.
 */
function ResolvingNotice() {
  const { t: tRoot } = useTranslation()

  return <p className="text-base text-fg-secondary">{tRoot('common.loading')}</p>
}
