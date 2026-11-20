import { useState } from 'react'
import { Info } from 'lucide-react'
import { useTranslation } from '../../../../i18n'
import { describeKnownRefusal } from '../../../../api/describeApiError'
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  LoadingState,
  Note,
} from '../../../../components/ui'
import RespondQuestionField from '../../components/RespondQuestionField'
import { enterPaperResponse, getPaperResponseForm, type PaperResponseForm } from '../../api/paperResponses'
import type { SurveyRosterRow } from '../../api/surveys'
import {
  missingRequired,
  missingRequiredComments,
  orderQuestions,
  toAnswerInputs,
  type AnswerMap,
} from '../../respondAnswers'

type FormState =
  | { phase: 'closed' }
  | { phase: 'loading' }
  | { phase: 'failed'; message: string }
  | { phase: 'ready'; form: PaperResponseForm }

/**
 * «Registrar respuesta en papel» (ruled 2026-11-19): a super admin types one person's paper
 * questionnaire from their roster row. The questions are drawn by the respondent's own field
 * (`RespondQuestionField`) from the respond view the server builds for that person, and the
 * answers go through the respondent's own write path -- so a paper response is stored exactly as
 * their own submission would be, their account untouched.
 *
 * Self-contained, so the roster mounts it with one line. After an entry the button gives way to a
 * line saying so; the roster's own status follows on its next load.
 */
export function PaperResponseAction({ surveyId, row }: { surveyId: string; row: SurveyRosterRow }) {
  const { t, locale } = useTranslation()
  const copy = (key: string, vars?: Record<string, string | number>) => t(`surveys.next.roster.paper.${key}`, vars)
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [state, setState] = useState<FormState>({ phase: 'closed' })
  const [answers, setAnswers] = useState<AnswerMap>({})
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set())
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [entered, setEntered] = useState(false)
  const [announcement, setAnnouncement] = useState('')

  async function open() {
    setState({ phase: 'loading' })
    setAnswers({})
    setInvalid(new Set())
    setProblem(null)
    try {
      setState({ phase: 'ready', form: await getPaperResponseForm(baseUrl, surveyId, row.userId, locale) })
    } catch (cause) {
      setState({ phase: 'failed', message: describeKnownRefusal(cause, t) ?? copy('loadError') })
    }
  }

  // The order the paper was printed in: authored order, «Mantener al final» last, never shuffled.
  const questions = state.phase === 'ready' ? orderQuestions(state.form.survey.questions, false, '') : []

  async function submit() {
    if (state.phase !== 'ready') return
    const unanswered = missingRequired(questions, answers)
    const uncommented = missingRequiredComments(questions, answers)
    const positionsOf = (ids: string[]) => ids.map((id) => questions.findIndex((q) => q.id === id) + 1).join(', ')
    if (unanswered.length > 0 || uncommented.length > 0) {
      setInvalid(new Set([...unanswered, ...uncommented]))
      setProblem(
        unanswered.length > 0
          ? copy('missing', { positions: positionsOf(unanswered) })
          : copy('missingComments', { positions: positionsOf(uncommented) }),
      )
      return
    }
    setBusy(true)
    setProblem(null)
    try {
      await enterPaperResponse(baseUrl, surveyId, row.userId, {
        answers: toAnswerInputs(questions, answers),
        language: state.form.survey.resolvedLocale,
      })
      setEntered(true)
      setState({ phase: 'closed' })
    } catch (cause) {
      setProblem(describeKnownRefusal(cause, t) ?? copy('error'))
    } finally {
      setBusy(false)
    }
  }

  if (entered) {
    return (
      <p role="status" className="m-0 text-xs font-medium">
        {copy('done', { name: row.name })}
      </p>
    )
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" aria-label={copy('actionFor', { name: row.name })} onClick={() => void open()}>
        {copy('action')}
      </Button>
      <Dialog open={state.phase !== 'closed'} onOpenChange={(next) => !busy && !next && setState({ phase: 'closed' })}>
        <DialogContent closeLabel={t('common.close')} className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{copy('title', { name: row.name })}</DialogTitle>
            <DialogDescription>{copy('body', { name: row.name })}</DialogDescription>
          </DialogHeader>
          {state.phase === 'loading' ? <LoadingState rows={4} label={t('common.loading')} /> : null}
          {state.phase === 'failed' ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          ) : null}
          {state.phase === 'ready' ? (
            <>
              {state.form.survey.anonymous ? (
                <Note role="note" icon={<Info />} className="px-3 py-2.5 text-sm">
                  {copy('anonymous')}
                </Note>
              ) : null}
              <div className="flex flex-col gap-8" data-testid="paper-questions">
                {questions.map((question, index) => (
                  <RespondQuestionField
                    key={question.id}
                    question={question}
                    position={index + 1}
                    total={questions.length}
                    answer={answers[question.id]}
                    invalid={invalid.has(question.id)}
                    disabled={busy}
                    onChange={(next) => setAnswers((current) => ({ ...current, [question.id]: next }))}
                    onAnnounce={setAnnouncement}
                  />
                ))}
              </div>
              <p aria-live="polite" className="sr-only">
                {announcement}
              </p>
            </>
          ) : null}
          {problem ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{problem}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setState({ phase: 'closed' })}>
              {t('common.cancel')}
            </Button>
            <Button type="button" variant="primary" disabled={busy || state.phase !== 'ready'} onClick={() => void submit()}>
              {busy ? t('common.saving') : copy('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
