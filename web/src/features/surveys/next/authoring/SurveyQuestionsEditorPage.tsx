import { useCallback, useEffect, useState } from 'react'
import { Check, CircleAlert, Copy, GripVertical, Lock, MoreHorizontal, Plus } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import { PageHeader } from '../../../../components/layout'
import { Alert, AlertDescription, Button, Chip, ErrorState, Input, LoadingState, Switch, Textarea } from '../../../../components/ui'
import { readViewerClaims, useViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { useFollowCompany } from '../../../../company-context'
import { QuestionLibraryBrowser } from '../../../../components/questions'
import { useTranslation, type Locale } from '../../../../i18n'
import { cn } from '../../../../lib/cn'
import { getSurveyQuestionAuthoring, saveSurveyQuestions, type AuthoringQuestion, type SurveyQuestionAuthoring } from '../../api/surveyQuestionAuthoring'
import { duplicateSurvey, getSurvey, type SurveyDetail } from '../../api/surveys'
import { dimensionLabel } from '../../dimensionLabel'
import { needsScaleLabels, statusLabel, SUGGESTED_DIMENSION_KEYS, SURVEY_QUESTION_TYPES, typeLabel } from '../../surveyVocabulary'
import { Eyebrow, IconBox, Segmented } from '../../../shared-next/parts'
import { Panel, PanelHeading } from './parts'
import {
  applyAnswerLabels,
  authoredLocales,
  blankQuestion,
  canLabelAnswers,
  compatibleScaleTypes,
  dimensionsWithout,
  hasAnswerLabels,
  isEditable,
  moveQuestion,
  questionFromLibraryItem,
  questionsMissingAnswerLabels,
  removeQuestion,
  scaleName,
  setAnswerLabel,
  summarise,
  withAnswerLabels,
  withoutAnswerLabels,
} from './model'
import { byCount } from '../../../../i18n/plural'
import { describeApiError } from '../../../../api/describeApiError'

/**
 * Editar preguntas, redesigned — both states of one route (canvas boards
 * "SurveyQuestionsEditor" and "SurveyQuestionsEditorLocked").
 *
 * Draft: the builder's right pane as the page body — the question list left (drag or
 * Subir/Bajar to reorder, a dimension per question, both languages), the respondent's view
 * of the open question right. Locked, once the survey has left draft or received a response:
 * the same list read-only, a banner saying why, and one primary "Duplicar y editar".
 *
 * The payload is the previous page's (`pages/SurveyQuestionsEditPage.tsx`, kept as the wiring
 * reference): `saveSurveyQuestions` sends only `questions`, every option with its stored
 * `value`. The server's 409 is shown verbatim — it is the truth the read can only hint at.
 */

type Load = { status: 'loading' } | { status: 'failed'; message: string } | { status: 'ready'; authoring: SurveyQuestionAuthoring; detail: SurveyDetail }

function useSurveyQuestionsModel(id: string | undefined) {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [state, setState] = useState<Load>({ status: 'loading' })
  const load = useCallback(async () => {
    if (!id) return
    setState({ status: 'loading' })
    try {
      const [authoring, detail] = await Promise.all([getSurveyQuestionAuthoring(baseUrl, id), getSurvey(baseUrl, id, locale)])
      setState({ status: 'ready', authoring, detail })
    } catch (error) {
      setState({ status: 'failed', message: describeApiError(error, t, 'common.error') })
    }
  }, [baseUrl, id, locale, t])
  useEffect(() => {
    void load()
  }, [load])
  return { state, reload: load }
}

function formatDay(value: string, locale: string, month: 'long' | 'short'): string {
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-CR' : 'en-US', { day: 'numeric', month }).format(new Date(value))
}

export default function SurveyQuestionsEditorPage() {
  const { id } = useParams<{ id: string }>()
  const { t, locale } = useTranslation()
  const caps = useViewerCapabilities()
  const navigate = useNavigate()
  const { state, reload } = useSurveyQuestionsModel(id)
  useFollowCompany(state.status === 'ready' ? state.detail.companyId : undefined)
  const [libraryOpen, setLibraryOpen] = useState(false)
  // null until the author changes something: the list on screen is the payload's until then,
  // so the first render already counts the real questions.
  const [edited, setEdited] = useState<AuthoringQuestion[] | null>(null)
  const [openIndex, setOpenIndex] = useState<number | null>(0)
  const [previewLocale, setPreviewLocale] = useState<Locale>(locale)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  // «Usar estas respuestas en todas…»: which question it was pressed on and how many questions
  // show those words afterwards, said beside the button rather than left to be counted.
  const [applied, setApplied] = useState<{ id: string; count: number } | null>(null)

  if (state.status === 'loading') {
    return (
      <LoadingState rows={8} label={t('common.loading')} />
    )
  }
  if (state.status === 'failed') {
    return (
      <ErrorState
        title={t('errors.generic')}
        description={state.message}
        action={
          <Button variant="outline" onClick={() => void reload()}>
            {t('common.retry')}
          </Button>
        }
      />
    )
  }

  const { authoring, detail } = state
  const questions = edited ?? authoring.questions
  const setQuestions = (change: (current: AuthoringQuestion[]) => AuthoringQuestion[]) =>
    setEdited((previous) => change(previous ?? authoring.questions))
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  // A super admin also edits an ACTIVE survey nobody has answered (ruled 2026-11-11). For a
  // client's administrator that survey stays locked, with "Duplicar y editar" as before.
  const operator = readViewerClaims().role === 'super_admin'
  const editable = isEditable(authoring.status, detail.responseCount, operator) && caps.canAdministerSurvey(detail)
  const locked = !isEditable(authoring.status, detail.responseCount, operator)
  const live = !locked && authoring.status !== 'draft'
  // The reader's language first, as the board orders ES · EN for a Spanish reader.
  const locales = [...authoring.locales].sort((x, y) => (x === locale ? -1 : y === locale ? 1 : 0))
  const summary = summarise(questions, locales)
  const emptied = dimensionsWithout(authoring.questions, questions)
  const title = detail.title ?? t('surveys.untitled')
  const copy = (key: string, vars?: Record<string, string | number>) => t(`surveys.next.authoring.${key}`, vars)
  const shownLocale = locales.includes(previewLocale) ? previewLocale : locales[0]

  const update = (index: number, patch: Partial<AuthoringQuestion>) =>
    setQuestions((current) => current.map((q, i) => (i === index ? { ...q, ...patch } : q)))
  const setText = (index: number, field: 'text' | 'scaleLabelMin' | 'scaleLabelMax', loc: Locale, value: string) =>
    setQuestions((current) =>
      current.map((q, i) => (i === index ? { ...q, [field]: { ...q[field], [loc]: { text: value, authored: value.trim() !== '' } } } : q)),
    )

  async function save() {
    if (!id) return
    // A list with an answer left blank would show the respondent a bare "3" among four words.
    // The server would store it (the option keeps its value), so the refusal has to be here.
    const unlabelled = questionsMissingAnswerLabels(questions, locales)
    if (unlabelled.length > 0) {
      setActionError(copy(unlabelled.length === 1 ? 'answerLabelsMissingOne' : 'answerLabelsMissing', { positions: unlabelled.join(', ') }))
      setOpenIndex(unlabelled[0] - 1)
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      await saveSurveyQuestions(baseUrl, id, questions)
      void navigate(`/surveys/${id}`)
    } catch (error) {
      setActionError(describeApiError(error, t, 'common.error'))
      setBusy(false)
    }
  }

  async function duplicateAndEdit() {
    if (!id) return
    setBusy(true)
    setActionError(null)
    try {
      const created = await duplicateSurvey(baseUrl, id, locale)
      void navigate(`/surveys/${created.id}/questions`)
    } catch (error) {
      setActionError(describeApiError(error, t, 'common.error'))
      setBusy(false)
    }
  }

  const responsesLine =
    detail.targetAudienceCount !== null
      ? copy('responsesOf', { count: detail.responseCount, target: detail.targetAudienceCount })
      : copy(byCount(detail.responseCount, 'responsesOne', 'responses'), { count: detail.responseCount })
  const openQuestion = questions[openIndex ?? 0] ?? questions[0]
  const openPosition = openQuestion ? questions.indexOf(openQuestion) + 1 : 0

  return (
    <div>
      {/* The board's `.hdr`, with the page's one primary (Guardar preguntas, or Duplicar y editar
          once the questions are locked) in the header's primary slot. */}
      <PageHeader
        breadcrumbs={[
          { label: t('navigation.surveys'), href: '/surveys' },
          { label: title, href: `/surveys/${id}` },
          { label: copy('title') },
        ]}
        eyebrow={copy('eyebrow', { type: typeLabel(t, detail.type), status: statusLabel(t, authoring.status) })}
        title={copy('title')}
        description={locked ? copy('descriptionLocked') : live ? copy('descriptionLive') : copy('descriptionDraft')}
        meta={
          <>
            {/* Status chips are grey; only Activa wears the blue live chip. */}
            <Chip tone={authoring.status === 'active' ? 'live' : 'neutral'} label={statusLabel(t, authoring.status)} />
            <span>
              {title} ·{' '}
              {locked
                ? responsesLine
                : `${copy(byCount(questions.length, 'questionCountOne', 'questionCount'), { count: questions.length })} · ${locales.length === 2 ? copy('inBoth') : copy(`inOne.${locales[0]}`)}`}
            </span>
          </>
        }
        actions={
          locked ? (
            <Button asChild variant="outline">
              <Link to={`/surveys/${id}`}>{copy('backToSurvey')}</Link>
            </Button>
          ) : (
            <Button asChild variant="outline">
              <Link to={`/surveys/${id}`}>{t('common.cancel')}</Link>
            </Button>
          )
        }
        primaryAction={
          locked ? (
            caps.canAdministerSurvey(detail) ? (
              <Button type="button" variant="primary" disabled={busy} onClick={() => void duplicateAndEdit()}>
                <Copy aria-hidden="true" />
                {copy('duplicateAndEdit')}
              </Button>
            ) : undefined
          ) : editable ? (
            <Button type="button" variant="primary" disabled={busy} onClick={() => void save()}>
              <Check aria-hidden="true" />
              {copy('save')}
            </Button>
          ) : undefined
        }
      />

      {actionError && (
        <Alert variant="destructive" role="alert" className="mb-5">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {live && (
        // Said BEFORE the first change, not after the save: these questions are already in front
        // of the people invited, and the edit is only possible because none of them has answered.
        <Alert variant="warning" role="note" className="mb-5" data-testid="live-banner">
          <AlertDescription>{copy('liveEdit', { status: statusLabel(t, authoring.status).toLowerCase() })}</AlertDescription>
        </Alert>
      )}

      {locked && (
        // The board's banner: the ground tint (#f8f7fb) under a white tile, 14px by 16px, and the
        // page column's 20px to the panels (SurveyQuestionsEditorLocked.dc.html).
        <Panel data-testid="locked-banner" className="mb-5 flex items-start gap-3.5 bg-surface-outer px-4 py-3.5">
          <IconBox tone="card">
            <Lock />
          </IconBox>
          <div className="flex min-w-0 flex-col gap-1 text-sm text-fg-secondary">
            <p className="m-0 text-base font-semibold text-fg-primary">
              {detail.responseCount > 0 ? copy('lockedHasResponses') : copy('lockedByStatus')}
            </p>
            <p className="m-0 max-w-[96ch] leading-normal">
              {detail.responseCount > 0 &&
                `${
                  detail.targetAudienceCount !== null
                    ? copy(detail.responseCount === 1 ? 'arrivedOneOf' : 'arrivedManyOf', { count: detail.responseCount, target: detail.targetAudienceCount })
                    : copy(detail.responseCount === 1 ? 'arrivedOne' : 'arrivedMany', { count: detail.responseCount })
                } ${copy('mixing')} `}
              {caps.canAdministerSurvey(detail) && (
                <>
                  <strong className="text-fg-primary">{copy('duplicateAndEdit')}</strong>{' '}
                  {copy('duplicateCreates', { count: questions.length })}
                  {authoring.status === 'active' ? copy('staysOpen', { date: formatDay(detail.endDate, locale, 'long') }) : '.'}
                </>
              )}
            </p>
          </div>
        </Panel>
      )}

      {/* The board's two columns and the preview stack, 16px apart (SurveyQuestionsEditor.dc.html). */}
      <div data-testid="editor-columns" className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,29rem)]">
        <Panel aria-labelledby="questions-heading">
          <PanelHeading
            id="questions-heading"
            title={copy('questions')}
            count={questions.length}
            aside={locked ? copy('readOnlyOpened', { date: formatDay(detail.startDate, locale, 'short') }) : copy('inAnswerOrder')}
          />
          {editable && (
            <p className="mb-3 mt-0 flex items-center gap-1.5 text-sm text-fg-secondary">
              <GripVertical aria-hidden="true" className="size-3.5" />
              {copy('dragHint')}
            </p>
          )}
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {questions.map((question, index) => {
              const open = editable && openIndex === index
              const written = authoredLocales(question, locales)
              return (
                <li
                  key={question.id}
                  data-testid="question-card"
                  draggable={editable}
                  onDragStart={() => setDragFrom(index)}
                  onDragOver={(event) => editable && event.preventDefault()}
                  onDrop={() => {
                    if (dragFrom !== null) setQuestions((current) => moveQuestion(current, dragFrom, index))
                    setDragFrom(null)
                  }}
                  className={cn('rounded-lg border bg-surface-card', open ? 'border-accent-blue' : 'border-line-default')}
                >
                  <div className={cn('flex items-center gap-3 px-3 py-2.5', open && 'rounded-t-lg bg-surface-icon-box')}>
                    {editable ? (
                      <GripVertical aria-hidden="true" className="size-4 shrink-0 cursor-grab text-fg-secondary" />
                    ) : (
                      <Lock aria-hidden="true" className="size-3.5 shrink-0 text-fg-secondary" />
                    )}
                    <span className="w-4 shrink-0 text-sm text-fg-secondary tabular-nums">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      {/* The board: 13px, 600 on the open card and 500 on the others, in the secondary ink once locked. */}
                      <p className={cn('m-0 text-base', open ? 'font-semibold' : 'font-medium', locked ? 'text-fg-secondary' : 'text-fg-primary')}>
                        {question.text[locale]?.text || question.text[locales[0]]?.text || copy('noText')}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {question.category ? (
                          <Chip tone="neutral" label={dimensionLabel(question.category, t)} />
                        ) : (
                          // Grey with a glyph: amber is the Oportunidad area, never a warning.
                          <Chip icon={<CircleAlert aria-hidden="true" className="size-3" />} label={copy('noDimension')} />
                        )}
                        <Chip tone="neutral" label={scaleChip(t, question)} />
                        {hasAnswerLabels(question) && <Chip tone="neutral" label={copy('answerLabelsChip')} />}
                        {locked && question.commentRequired && <Chip tone="neutral" label={copy('withComment')} />}
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-fg-secondary">
                          {written.length === locales.length && <Check aria-hidden="true" className="size-3" />}
                          {locales.map((l) => l.toUpperCase()).join(' · ')}
                        </span>
                      </div>
                    </div>
                    {editable ? (
                      <label className="mb-0 inline-flex shrink-0 items-center gap-2 text-sm text-fg-secondary">
                        <Switch checked={question.required} onCheckedChange={(value) => update(index, { required: value === true })} />
                        {copy('required')}
                      </label>
                    ) : (
                      question.required && <Chip tone="neutral" label={copy('required')} />
                    )}
                    {editable && (
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        aria-expanded={open}
                        aria-label={copy('openQuestion', { position: index + 1 })}
                        onClick={() => setOpenIndex(open ? null : index)}
                      >
                        <MoreHorizontal aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                  {open && (
                    <div className="flex flex-col gap-3 border-t border-line-light p-4 text-sm">
                      <div className="grid gap-3 md:grid-cols-2">
                        {locales.map((loc) => (
                          <EditorField key={loc} label={copy(`textIn.${loc}`)} required>
                            <Textarea rows={2} className="min-h-[3.375rem]" value={question.text[loc]?.text ?? ''} onChange={(e) => setText(index, 'text', loc, e.target.value)} />
                          </EditorField>
                        ))}
                        <EditorField label={copy('dimension')} hint={copy('dimensionHint')}>
                          <select
                            className="h-8 rounded-md border border-line-default bg-surface-card px-2 text-base text-fg-primary"
                            value={question.category ?? ''}
                            onChange={(e) => update(index, { category: e.target.value || null })}
                          >
                            <option value="">{copy('noDimension')}</option>
                            {[...new Set([...SUGGESTED_DIMENSION_KEYS, ...(question.category ? [question.category] : [])])].map((key) => (
                              <option key={key} value={key}>
                                {dimensionLabel(key, t)}
                              </option>
                            ))}
                          </select>
                        </EditorField>
                        <EditorField label={copy('scale')} hint={copy('scaleHint')}>
                          <select
                            className="h-8 rounded-md border border-line-default bg-surface-card px-2 text-base text-fg-primary"
                            value={question.type}
                            disabled={compatibleScaleTypes(question).length < 2}
                            onChange={(e) => update(index, { type: e.target.value })}
                          >
                            {compatibleScaleTypes(question).map((type) => (
                              <option key={type} value={type}>
                                {scaleLong(t, { ...question, type })}
                              </option>
                            ))}
                          </select>
                        </EditorField>
                      </div>
                      {canLabelAnswers(question) && (
                        // Not an EditorField: that is a <label>, and a label around buttons clicks
                        // the first of them whenever its text is clicked.
                        <EditorGroup label={copy('answersShown')} hint={copy('answersShownHint')}>
                          <span>
                            <Segmented
                              label={copy('answersShown')}
                              value={hasAnswerLabels(question) ? 'list' : 'numbers'}
                              options={[
                                { value: 'numbers', label: copy('answersAsNumbers', { min: question.scaleMin ?? '', max: question.scaleMax ?? '' }) },
                                { value: 'list', label: copy('answersAsList') },
                              ]}
                              onChange={(shown) => {
                                update(index, shown === 'list' ? withAnswerLabels(question) : withoutAnswerLabels(question))
                                setApplied(null)
                              }}
                            />
                          </span>
                        </EditorGroup>
                      )}
                      {hasAnswerLabels(question) ? (
                        <>
                          {locales.map((loc) => (
                            <EditorGroup key={loc} label={copy(`answerLabelsIn.${loc}`)}>
                              <ol data-testid={`answer-labels-${loc}`} className="m-0 flex list-none flex-col gap-1.5 p-0">
                                {(question.options ?? []).map((option) => (
                                  <li key={option.value} className="flex items-center gap-2">
                                    <span aria-hidden="true" className="w-5 shrink-0 text-right text-sm text-fg-secondary tabular-nums">
                                      {option.value}
                                    </span>
                                    <Input
                                      aria-label={`${copy(`answerLabelsIn.${loc}`)} ${option.value}`}
                                      value={option.label[loc]?.text ?? ''}
                                      onChange={(e) => {
                                        const text = e.target.value
                                        setQuestions((current) => current.map((q, i) => (i === index ? setAnswerLabel(q, option.value, loc, text) : q)))
                                        setApplied(null)
                                      }}
                                    />
                                  </li>
                                ))}
                              </ol>
                            </EditorGroup>
                          ))}
                          <div className="flex flex-wrap items-center gap-3">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                const { count } = applyAnswerLabels(questions, question)
                                setQuestions((current) => applyAnswerLabels(current, current[index]).questions)
                                setApplied({ id: question.id, count })
                              }}
                            >
                              {copy('applyToAll', { min: question.scaleMin ?? '', max: question.scaleMax ?? '' })}
                            </Button>
                            {applied?.id === question.id && (
                              <span role="status" data-testid="applied-to-all" className="inline-flex items-center gap-1 text-sm text-fg-secondary">
                                <Check aria-hidden="true" className="size-3.5" />
                                {applied.count > 1
                                  ? copy('appliedToAll', { count: applied.count })
                                  : copy('appliedToAllOne', { min: question.scaleMin ?? '', max: question.scaleMax ?? '' })}
                              </span>
                            )}
                          </div>
                        </>
                      ) : (
                        needsScaleLabels(question.type) &&
                        locales.map((loc) => (
                          <EditorField key={loc} label={copy(`endsIn.${loc}`)}>
                            <div className="grid grid-cols-2 gap-2">
                              <Input aria-label={`${copy(`endsIn.${loc}`)} 1`} value={question.scaleLabelMin[loc]?.text ?? ''} onChange={(e) => setText(index, 'scaleLabelMin', loc, e.target.value)} />
                              <Input aria-label={`${copy(`endsIn.${loc}`)} 2`} value={question.scaleLabelMax[loc]?.text ?? ''} onChange={(e) => setText(index, 'scaleLabelMax', loc, e.target.value)} />
                            </div>
                          </EditorField>
                        ))
                      )}
                      <div className="flex flex-wrap items-center gap-4 border-t border-line-light pt-3">
                        <label className="mb-0 inline-flex items-center gap-2 text-sm text-fg-secondary">
                          <Switch checked={question.required} onCheckedChange={(value) => update(index, { required: value === true })} />
                          {copy('answerRequired')}
                        </label>
                        <label className="mb-0 inline-flex items-center gap-2 text-sm text-fg-secondary">
                          <Switch checked={question.commentRequired} onCheckedChange={(value) => update(index, { commentRequired: value === true })} />
                          {copy('commentRequired')}
                        </label>
                        <span className="ml-auto flex gap-2">
                          {index > 0 && (
                            <Button type="button" variant="outline" onClick={() => { setQuestions((c) => moveQuestion(c, index, index - 1)); setOpenIndex(index - 1) }}>
                              {copy('moveUp')}
                            </Button>
                          )}
                          {index < questions.length - 1 && (
                            <Button type="button" variant="outline" onClick={() => { setQuestions((c) => moveQuestion(c, index, index + 1)); setOpenIndex(index + 1) }}>
                              {copy('moveDown')}
                            </Button>
                          )}
                          <Button type="button" variant="destructive" onClick={() => { setQuestions((c) => removeQuestion(c, index)); setOpenIndex(null) }}>
                            {copy('remove')}
                          </Button>
                        </span>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
          {editable && (
            // The board's row: "Agregar pregunta" at 13px/500, then its tail at 12px/400 as one run of
            // words — "· de la biblioteca o en blanco" — with a word space around "o" and nothing more.
            // The board paints the tail #8a82a5 (3.25:1, barred by inkContrast.test.ts), and the tertiary
            // ink is banned from features/surveys (respondContrast.test.ts), so it takes the secondary.
            <div data-testid="add-question" className="mt-2 flex h-10 w-full items-center justify-center rounded-lg border border-dashed border-line-default">
              <Button type="button" variant="ghost" className="h-8 pl-2 pr-0" onClick={() => setLibraryOpen(true)}>
                <Plus aria-hidden="true" />
                {copy('addQuestion')}
                <span data-testid="add-tail" className="text-sm font-normal text-fg-secondary">{copy('addFromLibrary')}</span>
              </Button>
              <span className="whitespace-pre text-sm text-fg-secondary">{` ${copy('addOr')} `}</span>
              <Button
                type="button"
                variant="ghost"
                className="h-8 px-0 text-sm font-normal text-fg-secondary"
                onClick={() => {
                  setQuestions((current) => [...current, blankQuestion(current.length, locales)])
                  setOpenIndex(questions.length)
                }}
              >
                {copy('addBlankLink')}
              </Button>
            </div>
          )}
          {editable && (
            <QuestionLibraryBrowser
              open={libraryOpen}
              onOpenChange={setLibraryOpen}
              companyId={detail.companyId}
              allowedTypes={SURVEY_QUESTION_TYPES}
              typeLabel={(type) => scaleName(t, type)}
              onAdd={(picked) => {
                // Functional: the browser can add several times before it closes.
                setQuestions((current) => [...current, ...picked.map((item, i) => questionFromLibraryItem(item, current.length + i, locales))])
                setOpenIndex(null)
              }}
            />
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line-light pt-3 text-sm text-fg-secondary">
            <span data-testid="questions-summary">
              {[
                copy('dimensionsCount', { count: summary.dimensions }),
                copy('requiredCount', { count: summary.required }),
                locked
                  ? summary.withComment === 0
                    ? null
                    : summary.withComment === summary.total
                      ? copy('allAskComment', { count: summary.total })
                      : copy('someAskComment', { count: summary.withComment })
                  : locales.length === 2
                    ? summary.fullyTranslated
                      ? copy('bilingual')
                      : copy('untranslated')
                    : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            {!locked && (
              <span data-testid="dimension-check">
                {summary.uncategorised > 0 ? (
                  <span className="inline-flex items-center gap-1 font-medium text-fg-primary">
                    <CircleAlert aria-hidden="true" className="size-3.5" />
                    {copy('missingDimension', { count: summary.uncategorised })}
                  </span>
                ) : emptied.length > 0 ? (
                  <span className="inline-flex items-center gap-1 font-medium text-fg-primary">
                    <CircleAlert aria-hidden="true" className="size-3.5" />
                    {copy('dimensionsWithout', { dimensions: emptied.map((key) => dimensionLabel(key, t)).join(', ') })}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-fg-secondary">
                    <Check aria-hidden="true" className="size-3.5" />
                    {copy('everyDimensionCovered')}
                  </span>
                )}
              </span>
            )}
          </div>
        </Panel>

        <div data-testid="editor-aside" className="flex flex-col gap-4">
          <Panel aria-labelledby="preview-heading">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 id="preview-heading" className="m-0 text-2xl">
                {copy('preview')}
              </h2>
              <div className="flex items-center gap-2">
                {locked && <Chip tone="neutral" icon={<Lock className="size-3" />} label={copy('readOnly')} />}
                {locales.length > 1 && (
                  <Segmented
                    label={copy('previewLanguage')}
                    value={shownLocale}
                    options={locales.map((l) => ({ value: l, label: t(`surveys.next.authoring.language.${l}`) }))}
                    onChange={setPreviewLocale}
                  />
                )}
              </div>
            </div>
            <p className="mb-3 mt-0 text-sm text-fg-secondary">{locked ? copy('previewLocked') : copy('previewDraft')}</p>
            <div data-testid="respondent-preview" className="rounded-xl border border-line-panel bg-surface-card p-4">
              <Eyebrow>{copy('surveyEyebrow')}</Eyebrow>
              <p className="m-0 font-display text-[1.125rem] font-semibold leading-tight text-fg-primary">{title}</p>
              <p className="mb-3 mt-0.5 text-sm text-fg-secondary">
                {locked
                  ? authoring.status === 'active'
                    ? copy('openUntil', { date: formatDay(detail.endDate, locale, 'long') })
                    : copy('closedOn', { date: formatDay(detail.endDate, locale, 'long') })
                  : detail.description}
              </p>
              {openQuestion && (
                <>
                  <div className="mb-2 flex items-center gap-2 border-t border-line-light pt-3">
                    <Eyebrow className="tracking-wider">{openQuestion.category ? dimensionLabel(openQuestion.category, t) : copy('noDimension')}</Eyebrow>
                    <span className="h-px flex-1 bg-line-light" />
                    <span data-testid="preview-position" className="text-sm text-fg-secondary tabular-nums">{copy('positionOf', { position: openPosition, count: questions.length })}</span>
                  </div>
                  <div className="rounded-xl border border-line-panel p-3.5">
                    {/* Semibold UI face at body size, as the artboards draw a preview question (`<b>`). */}
                    <p data-testid="preview-question-text" className="m-0 flex items-baseline gap-2 text-base font-semibold leading-snug">
                      <span aria-hidden="true" className="relative -top-px shrink-0 rounded-md bg-surface-fill-subtle px-1.5 font-sans text-xs font-medium text-fg-secondary tabular-nums">{`${openPosition}/${questions.length}`}</span>
                      <span>
                        <span className="text-fg-primary">{openQuestion.text[shownLocale]?.text || copy('noText')}</span>{' '}
                        {openQuestion.required && <span className="font-sans text-sm font-normal text-fg-secondary">{copy('requiredParen')}</span>}
                      </span>
                    </p>
                    {hasAnswerLabels(openQuestion) ? (
                      // The respond screen's list (`ChoiceAnswer`): one line per answer, in the
                      // author's order. A blank answer shows its number, which is what the
                      // respondent would read if it were saved blank.
                      <div data-testid="preview-answers" aria-hidden="true" className="mt-3 flex flex-col gap-1.5">
                        {(openQuestion.options ?? []).map((option) => (
                          <span key={option.value} className="flex min-h-9 select-none items-center rounded-md bg-surface-fill-subtle px-3 py-1.5 text-base text-fg-secondary">
                            {option.label[shownLocale]?.text || option.value}
                          </span>
                        ))}
                      </div>
                    ) : openQuestion.scaleMin !== null && openQuestion.scaleMax !== null && (
                      <>
                        <div aria-hidden="true" className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${openQuestion.scaleMax - openQuestion.scaleMin + 1}, minmax(0, 1fr))` }}>
                          {Array.from({ length: openQuestion.scaleMax - openQuestion.scaleMin + 1 }, (_, i) => (
                            <span key={i} className="flex h-9 select-none items-center justify-center rounded-md bg-surface-fill-subtle text-base tabular-nums text-fg-secondary">
                              {openQuestion.scaleMin! + i}
                            </span>
                          ))}
                        </div>
                        <div className="mt-1.5 flex justify-between text-xs text-fg-secondary">
                          <span>{openQuestion.scaleLabelMin[shownLocale]?.text}</span>
                          <span>{openQuestion.scaleLabelMax[shownLocale]?.text}</span>
                        </div>
                      </>
                    )}
                    {openQuestion.commentRequired && (
                      <div className="mt-3">
                        <p className="m-0 text-xs font-semibold text-fg-secondary">
                          {copy('comment')} <span className="font-normal text-fg-secondary">{copy('requiredParenMasc')}</span>
                        </p>
                        <div aria-hidden="true" className="mt-1 h-10 rounded-md bg-surface-fill-subtle" />
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex items-center gap-2 border-t border-line-light pt-3 text-xs text-fg-secondary">
                    <span className="h-1 w-12 rounded-full bg-line-light" />
                    {copy('answeredOf', { count: questions.length })}
                  </div>
                </>
              )}
            </div>
          </Panel>
          {!locked && (
            <Panel className="flex items-start gap-3 px-4 py-3.5">
              <IconBox>
                <Lock />
              </IconBox>
              <div className="flex flex-col gap-1 text-sm text-fg-secondary">
                <p className="m-0 text-base font-semibold text-fg-primary">{copy('editableUntilTitle')}</p>
                <p className="m-0 leading-normal">{copy('editableUntilBody')}</p>
              </div>
            </Panel>
          )}
        </div>
      </div>

      {/* The board's footer: the page column's 20px, a full-width hairline, 16px, then the line. */}
      {!locked && (
        <p data-testid="save-note" className="mb-0 mt-5 flex items-center gap-2 border-t border-line-light pt-4 text-sm text-fg-secondary">
          <Lock aria-hidden="true" className="size-3.5 shrink-0" />
          {copy('saveWritesOnly')}
        </p>
      )}
    </div>
  )
}

function scaleChip(t: (key: string) => string, q: AuthoringQuestion): string {
  const type = scaleName(t, q.type)
  return q.scaleMin !== null && q.scaleMax !== null ? `${type} ${q.scaleMin}–${q.scaleMax}` : type
}

function scaleLong(t: (key: string, vars?: Record<string, string | number>) => string, q: AuthoringQuestion): string {
  const type = scaleName(t, q.type)
  return q.scaleMin !== null && q.scaleMax !== null
    ? `${type} · ${t('surveys.next.authoring.fromTo', { min: q.scaleMin, max: q.scaleMax })}`
    : type
}

/** A titled block of several controls: `EditorField`'s look without its `<label>`. */
function EditorGroup({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-fg-secondary">{label}</span>
      {children}
      {hint && <span className="text-sm leading-[1.45] text-fg-secondary">{hint}</span>}
    </div>
  )
}

// `mb-0`: index.css gives every <label> a 12px bottom margin for the old stacked forms; here the
// grid's gap spaces the fields, and the margin made the open card 46px taller than the board. The
// `[&>…]:mt-0` drop the 4px index.css adds above a label's own control (index.css:252-258): the
// board sets the control 6px under its label, the field's gap and nothing more.
function EditorField({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="mb-0 flex flex-col gap-1.5 [&>input]:mt-0 [&>select]:mt-0 [&>textarea]:mt-0">
      <span className="text-sm font-semibold text-fg-secondary">
        {label}
        {required && <span className="text-accent-red-ink"> *</span>}
      </span>
      {children}
      {hint && <span className="text-sm leading-[1.45] text-fg-secondary">{hint}</span>}
    </label>
  )
}
