import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { Alert, AlertDescription, Button, LoadingRegion } from '../../../components/ui'
import SurveyQuestionEditor from '../components/SurveyQuestionEditor'
import {
  getSurveyQuestionAuthoring,
  saveSurveyQuestions,
  type AuthoringQuestion,
  type SurveyQuestionAuthoring,
} from '../api/surveyQuestionAuthoring'

/**
 * Editing a draft survey's questions — the other half of #273.
 *
 * ## Why this defends itself rather than trusting the link that opened it
 *
 * `SurveyDetailPage` only offers the way in when the survey can actually be edited, but
 * this URL is typeable and, more to the point, the second refusal cannot be predicted from
 * a read. The server's rule is
 * `survey.ResponseCount > 0 || db.Responses.AnyAsync(...)`: the counter is a fast path, so
 * `responseCount === 0` in a payload is not a promise that no response rows exist, and
 * somebody can answer while this page is open in any case. So the affordance is a hint and
 * the save is the truth — a 409 arrives here as the server's own sentence and is shown
 * verbatim, because "This survey already has responses; its content can no longer be
 * edited." is the explanation, and any wording of ours would be a worse copy of it.
 *
 * ## Only `questions` is written
 *
 * See `saveSurveyQuestions`. `UpdateSurveyRequest` treats every omitted member as "leave
 * alone", so an editor that restated title, dates and settings would be one that clobbers
 * a change made in another tab.
 */

type PageState =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; authoring: SurveyQuestionAuthoring }

export default function SurveyQuestionsEditPage() {
  const { id } = useParams<{ id: string }>()
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const navigate = useNavigate()

  const [state, setState] = useState<PageState>({ status: 'loading' })
  const [questions, setQuestions] = useState<AuthoringQuestion[]>([])
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setState({ status: 'loading' })
    try {
      const authoring = await getSurveyQuestionAuthoring(baseUrl, id)
      setQuestions(authoring.questions)
      setState({ status: 'ready', authoring })
    } catch (error) {
      setState({
        status: 'failed',
        message: error instanceof Error ? error.message : t('common.error'),
      })
    }
  }, [baseUrl, id, t])

  useEffect(() => {
    void load()
  }, [load])

  if (state.status === 'loading') {
    return <LoadingRegion loading label={t('common.loading')} />
  }

  if (state.status === 'failed') {
    return (
      <Alert variant="destructive">
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    )
  }

  const { authoring } = state
  // Both refusals the server can give, in the order it checks them.
  const editable = authoring.status === 'draft' || authoring.status === 'scheduled'
  const lockedReason = !editable ? t('surveys.questionEditor.lockedByStatus') : null

  async function handleSave() {
    if (!id) return
    setSaving(true)
    setSaveError(null)
    try {
      await saveSurveyQuestions(baseUrl, id, questions)
      void navigate(`/surveys/${id}`)
    } catch (error) {
      // The server's sentence, verbatim. Both 409s explain themselves better than we can.
      setSaveError(error instanceof Error ? error.message : t('common.error'))
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-panel-gap">
      <PageTopBar
        title={t('surveys.questionEditor.title')}
        description={t('surveys.questionEditor.description')}
        breadcrumbs={[
          { label: t('navigation.surveys'), href: '/surveys' },
          { label: authoring.title ?? t('surveys.untitled'), href: `/surveys/${id}` },
          { label: t('surveys.questionEditor.title') },
        ]}
        actions={
          <>
            <Button asChild variant="outline">
              <Link to={`/surveys/${id}`}>{t('common.cancel')}</Link>
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!editable || saving}
              onClick={() => void handleSave()}
            >
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      />

      {lockedReason && (
        <Alert variant="default">
          <AlertDescription>{lockedReason}</AlertDescription>
        </Alert>
      )}

      {saveError && (
        <Alert variant="destructive">
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      )}

      <SurveyQuestionEditor
        questions={questions}
        locales={authoring.locales}
        disabled={!editable || saving}
        onChange={setQuestions}
      />
    </div>
  )
}
