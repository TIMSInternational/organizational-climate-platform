import { useParams } from 'react-router'
import { useTranslation } from '../../../i18n'
import { RespondShell } from '../../../components/layout'
import SurveyRespondForm from '../components/SurveyRespondForm'

/**
 * Answering a survey as a signed-in employee.
 *
 * ## Behind `RequireAuth`, outside `AdminLayout`
 *
 * The gate stays: an employee who follows an emailed link to a survey their company
 * does *not* run anonymously has to sign in, and `RequireAuth` sending them to
 * `/login` and back is a better answer than the API's 401 rendered as "not
 * available". `app/router.test.ts` pins that — this route is deliberately not a
 * top-level one beside `/survey/:id`.
 *
 * The **shell** does not stay, and that is the change. `AdminLayout` is the
 * administrator's frame: a role-aware rail, a company-context switcher, a
 * notification bell, a command palette and a sign-out control. A respondent is
 * answering a survey, not administering anything, and this is the one screen an
 * ordinary employee ever sees — so it renders `RespondShell`, the same standalone
 * centred frame as its public twin and as `/microclimates/:id/respond`. The three
 * respond flows are one surface and now look like it.
 *
 * No `PageTopBar`. The respondent's `<h1>` is the survey's own title, which the form
 * already renders from the payload; a second heading above it would give the page two
 * `<h1>`s and name the page after itself rather than after the thing being answered.
 */
export default function SurveyRespondPage() {
  const { id } = useParams<{ id: string }>()
  const { t } = useTranslation('surveyRespond')

  if (!id) return null

  return (
    <RespondShell skipLabel={t('skipToSurvey')} contentId="survey">
      <SurveyRespondForm surveyId={id} />
    </RespondShell>
  )
}
