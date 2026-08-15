import { useParams } from 'react-router'
import { useTranslation } from '../../../i18n'
import { RespondShell } from '../../../components/layout'
import SurveyRespondForm from '../components/SurveyRespondForm'

/**
 * Answering a survey without an account: the one genuinely public page in this app.
 *
 * ## Why it is not `AdminLayout`
 *
 * The shell is built for a tenant member. It reads the JWT claims, builds a
 * role-aware nav, mounts the company-context provider, the notification bell and a
 * sign-out control. A respondent on this route has none of those things and is
 * entitled to none of them, and every one of them is a way for a company's structure
 * to leak onto a page anybody holding a link can open. So this route renders
 * `RespondShell` — a heading, a language picker, a theme picker, the form — and
 * nothing that reads a claim.
 *
 * The only tenant data reachable from here is what
 * `GET /surveys/{id}/respond` returns, which is the reduced respondent view: no
 * company id, no author, no response count, no department targets, no user list.
 *
 * ## What moved into `RespondShell`
 *
 * The frame, and only the frame. `/surveys/:id/respond` and
 * `/microclimates/:id/respond` are the same surface answered by the same people,
 * and this page was the only one of the three that had ever been given a layout —
 * so the layout became a component rather than three divergent copies of one idea.
 * The reasoning for offering the language picker here, which used to live in this
 * file, is written out on `RespondShell` itself.
 */
export default function PublicSurveyRespondPage() {
  const { id } = useParams<{ id: string }>()
  const { t } = useTranslation('surveyRespond')

  return (
    <RespondShell skipLabel={t('skipToSurvey')} contentId="survey">
      {id ? <SurveyRespondForm surveyId={id} publicEntry /> : null}
    </RespondShell>
  )
}
