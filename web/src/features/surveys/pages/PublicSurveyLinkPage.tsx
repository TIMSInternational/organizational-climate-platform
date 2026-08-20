import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { useTranslation } from '../../../i18n'
import { RespondShell } from '../../../components/layout'
import SurveyRespondForm, { RespondSurface } from '../components/SurveyRespondForm'
import { LinkOutcome } from '../components/LinkOutcome'
import { publicLinkFailureCopy } from '../linkFailure'
import {
  SurveyLinkError,
  resolveSurveyPublicLink,
  type SurveyPublicLinkDetail,
} from '../api/surveyLinks'

/**
 * `/s/:token` — the open share link, as the person who was handed it experiences it.
 *
 * ## What was broken
 *
 * `SurveyAccessTokens.PublicLinkPath` builds `/s/{token}` and
 * `SurveyDistributionEndpoints` stores exactly that string in
 * `survey_distributions.public_url`. `ShareLinkPanel` then shows it to an administrator
 * to copy, print on a QR code and mail out. The web app routed no `/s/` path at all, so
 * every one of those links landed on the router's error boundary. This is the route.
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
 * So this page is two steps, and the second is the existing one: resolve, then hand the
 * survey id to `SurveyRespondForm` — the same component `/survey/:id` and
 * `/surveys/:id/respond` render. A third respond surface for share-link visitors would
 * be a third place for the anonymity notice to be forgotten.
 *
 * ## Why it is outside `RequireAuth` and outside `AdminLayout`
 *
 * The same reason `/survey/:id` is, written out on `PublicSurveyRespondPage` and on
 * `RespondShell`: whoever holds this link has no account, and every piece of the admin
 * shell is a way for a company's structure to appear on a page anybody can open.
 *
 * ## Why the shell is rendered before the token resolves
 *
 * The frame carries the language picker, and a visitor who cannot read the page in
 * their own language is exactly as stuck on "resolving" as on a question. Rendering the
 * outcome inside the same frame also means the page does not jump when the resolve
 * lands.
 */
export default function PublicSurveyLinkPage() {
  const { token } = useParams<{ token: string }>()
  const { t } = useTranslation('surveyRespond')
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const [state, setState] = useState<ResolveState>({ status: 'resolving' })

  useEffect(() => {
    if (!token) return

    let cancelled = false
    setState({ status: 'resolving' })

    // No `lang` and no dependency on the locale, deliberately. This request is a token
    // lookup — the localized title it also returns is never rendered here, because the
    // respond payload carries its own — and it is the request that increments
    // `survey_distributions.total_accesses`. Re-issuing it every time somebody switched
    // language would report one respondent as several in the only access figure an
    // administrator has.
    resolveSurveyPublicLink(baseUrl, token)
      .then((detail) => {
        if (!cancelled) setState({ status: 'open', detail })
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
  }, [baseUrl, token])

  return (
    <RespondShell skipLabel={t('skipToSurvey')} contentId="survey">
      {state.status === 'open' ? (
        // `publicEntry`: whoever followed this link may hold nothing but the link. It
        // changes what a 401 from the respond endpoint means — closed, or not open to
        // anonymous visitors, and the server deliberately does not say which — and it
        // drops the "back to Home" link from the confirmation, which for this visitor
        // is a round trip through `RequireAuth` to a sign-in form they did not ask for.
        <SurveyRespondForm surveyId={state.detail.surveyId} publicEntry />
      ) : (
        <RespondSurface>
          {state.status === 'resolving' ? (
            <ResolvingNotice />
          ) : (
            <LinkOutcome
              copy={publicLinkFailureCopy(state.error)}
              serverMessage={state.error?.message ?? ''}
            />
          )}
        </RespondSurface>
      )}
    </RespondShell>
  )
}

/**
 * `open` rather than `ready`: the resolve says the link is live and the survey is
 * accepting answers, and the form's own load is a separate thing that can still fail.
 */
type ResolveState =
  | { status: 'resolving' }
  | { status: 'open'; detail: SurveyPublicLinkDetail }
  | { status: 'dead'; error: SurveyLinkError | null }

/**
 * Held to the same sentence `SurveyRespondForm` shows while it loads, so the two
 * requests this page makes back to back read as one wait rather than two.
 */
function ResolvingNotice() {
  const { t: tRoot } = useTranslation()

  return <p className="text-base text-fg-secondary">{tRoot('common.loading')}</p>
}
