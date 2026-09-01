import { useParams } from 'react-router'
import { useTranslation } from '../../../i18n'
import { RespondShell } from '../../../components/layout'
import MicroclimatePulseForm from '../components/MicroclimatePulseForm'

/**
 * `/microclimates/:id/respond` — a live pulse, answered by anybody holding its GUID.
 *
 * ## What is left here, and what moved
 *
 * The shell, the skip target, and the route parameter. Everything else — the questions,
 * the scales, the anonymity footnote, the four page states — is
 * `components/MicroclimatePulseForm`, unchanged in the move and documented there.
 *
 * The split happened because a second route now answers the same session:
 * `/microclimate-invitations/:token` (#130) puts a landing card in front of the questions
 * and needs its own `RespondShell` up before the microclimate has even resolved, so it can
 * draw a dead-link message inside the same frame. Two routes each owning a shell and
 * sharing a form is the shape the survey side already has, where `SurveyRespondForm` is
 * mounted by both `/surveys/:id/respond` and `/survey-invitations/:token`.
 *
 * ## This route stays anonymous-by-GUID, and that is not the same thing as invited
 *
 * Nothing here knows who is answering, and the server does not either: `GET
 * /microclimates/{id}` serves an unauthenticated caller only when the session is both
 * configured for anonymous responses AND currently active, and `POST
 * /microclimates/{id}/responses` folds the answers into an aggregate with no respondent
 * attached. The invitation route resolves a per-person token first and records an
 * invitation ladder against it — a different act, on a row this route has never heard of,
 * and bounded by the anonymity ceiling in `MicroclimateInvitationStatuses`.
 */
export default function MicroclimateRespondPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()

  return (
    <RespondShell skipLabel={t('microclimates.respondSkip')} contentId="questions">
      <MicroclimatePulseForm microclimateId={id} />
    </RespondShell>
  )
}
