import { useParams } from 'react-router'
import SurveyRespondForm from '../components/SurveyRespondForm'

/**
 * Answering a survey as a signed-in employee.
 *
 * Sits inside `RequireAuth` + `AdminLayout`, unlike its public twin. That is the
 * whole difference and it is deliberate: an employee who follows an emailed link to a
 * survey their company does *not* run anonymously has to sign in, and `RequireAuth`
 * sending them to `/login` and back is a better answer than the API's 401 rendered as
 * "not available".
 *
 * No `PageTopBar`. The respondent's `<h1>` is the survey's own title, which the form
 * already renders from the payload; a second heading above it would give the page two
 * `<h1>`s and name the page after itself rather than after the thing being answered.
 */
export default function SurveyRespondPage() {
  const { id } = useParams<{ id: string }>()
  if (!id) return null

  return <SurveyRespondForm surveyId={id} />
}
