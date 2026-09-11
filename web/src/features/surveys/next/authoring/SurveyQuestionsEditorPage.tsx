import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, GripVertical, Lock, MoreHorizontal, Plus } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import { PageTopBar } from '../../../../components/layout'
import { Alert, AlertDescription, Button, Chip, ErrorState, Input, LoadingRegion, SkeletonText, Switch, Textarea } from '../../../../components/ui'
import { useViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { useCompanyScope } from '../../../../company-context'
import { QuestionLibraryBrowser } from '../../../../components/questions'
import { useTranslation, type Locale } from '../../../../i18n'
import { cn } from '../../../../lib/cn'
import { getSurveyQuestionAuthoring, saveSurveyQuestions, type AuthoringQuestion, type SurveyQuestionAuthoring } from '../../api/surveyQuestionAuthoring'
import { duplicateSurvey, getSurvey, type SurveyDetail } from '../../api/surveys'
import { dimensionLabel } from '../../dimensionLabel'
import { needsScaleLabels, statusLabel, SUGGESTED_DIMENSION_KEYS, SURVEY_QUESTION_TYPES, typeLabel } from '../../surveyVocabulary'
import { Eyebrow, IconBox, Panel, PanelHeading, Segmented } from '../../../shared-next/parts'
import {
  authoredLocales,
  blankQuestion,
  compatibleScaleTypes,
  dimensionsWithout,
  isEditable,
  moveQuestion,
  questionFromLibraryItem,
  removeQuestion,
  scaleName,
  summarise,
} from './model'

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
      setState({ status: 'failed', message: error instanceof Error ? error.message : t('common.error') })
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
  const scope = useCompanyScope()
  const navigate = useNavigate()
  const { state, reload } = useSurveyQuestionsModel(id)
  const [libraryOpen, setLibraryOpen] = useState(false)
  // null until the author changes something: the list on screen is the payload's until then,
  // so the first render already counts the real questions.
  const [edited, setEdited] = useState<AuthoringQuestion[] | null>(null)
  const [openIndex, setOpenIndex] = useState<number | null>(0)
  const [previewLocale, setPreviewLocale] = useState<Locale>(locale)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  if (state.status === 'loading') {
    return (
      <LoadingRegion loading label={t('common.loading')}>
        <SkeletonText lines={8} />
      </LoadingRegion>
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
  const editable = isEditable(authoring.status, detail.responseCount) && caps.canAuthorSurveys
  const locked = !isEditable(authoring.status, detail.responseCount)
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
    setBusy(true)
    setActionError(null)
    try {
      await saveSurveyQuestions(baseUrl, id, questions)
      void navigate(`/surveys/${id}`)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('common.error'))
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
      setActionError(error instanceof Error ? error.message : t('common.error'))
      setBusy(false)
    }
  }

  const responsesLine =
    detail.targetAudienceCount !== null
      ? copy('responsesOf', { count: detail.responseCount, target: detail.targetAudienceCount })
      : copy('responses', { count: detail.responseCount })
  const openQuestion = questions[openIndex ?? 0] ?? questions[0]
  const openPosition = openQuestion ? questions.indexOf(openQuestion) + 1 : 0

  return (
    <div>
      <PageTopBar
        breadcrumbs={[
          { label: t('navigation.surveys'), href: '/surveys' },
          { label: title, href: `/surveys/${id}` },
          { label: copy('title') },
        ]}
        eyebrow={copy('eyebrow', { type: typeLabel(t, detail.type), status: statusLabel(t, authoring.status) })}
        title={copy('title')}
        description={locked ? copy('descriptionLocked') : copy('descriptionDraft')}
        meta={
          <>
            <Chip tone={authoring.status === 'active' ? 'good' : authoring.status === 'draft' ? 'warning' : 'neutral'} label={statusLabel(t, authoring.status)} />
            <span>
              {title} ·{' '}
              {locked
                ? responsesLine
                : `${copy('questionCount', { count: questions.length })} · ${locales.length === 2 ? copy('inBoth') : copy(`inOne.${locales[0]}`)}`}
            </span>
          </>
        }
        actions={
          locked ? (
            <>
              <Button asChild variant="outline">
                <Link to={`/surveys/${id}`}>{copy('backToSurvey')}</Link>
              </Button>
              {caps.canAuthorSurveys && (
                <Button type="button" variant="primary" disabled={busy} onClick={() => void duplicateAndEdit()}>
                  <Copy aria-hidden="true" />
                  {copy('duplicateAndEdit')}
                </Button>
              )}
            </>
          ) : (
            <>
              <Button asChild variant="outline">
                <Link to={`/surveys/${id}`}>{t('common.cancel')}</Link>
              </Button>
              {editable && (
                <Button type="button" variant="primary" disabled={busy} onClick={() => void save()}>
                  <Check aria-hidden="true" />
                  {copy('save')}
                </Button>
              )}
            </>
          )
        }
      />

      {actionError && (
        <Alert variant="destructive" role="alert" className="mb-5">
          <AlertDescription>{actionError}</AlertDescription>
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
              {caps.canAuthorSurveys && (
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
                    <span className="w-4 shrink-0 font-mono text-sm text-fg-tertiary tabular-nums">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      {/* The board: 13px, 600 on the open card and 500 on the others, in the secondary ink once locked. */}
                      <p className={cn('m-0 text-base', open ? 'font-semibold' : 'font-medium', locked ? 'text-fg-secondary' : 'text-fg-primary')}>
                        {question.text[locale]?.text || question.text[locales[0]]?.text || copy('noText')}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {question.category ? (
                          <Chip tone="neutral" label={dimensionLabel(question.category, t)} />
                        ) : (
                          <Chip tone="warning" label={copy('noDimension')} />
                        )}
                        <Chip tone="neutral" label={scaleChip(t, question)} />
                        {locked && question.commentRequired && <Chip tone="neutral" label={copy('withComment')} />}
                        <span className="inline-flex items-center gap-1 font-mono text-2xs text-chip-good-ink">
                          {written.length === locales.length && <Check aria-hidden="true" className="size-3" />}
                          {locales.map((l) => l.toUpperCase()).join(' · ')}
                        </span>
                      </div>
                    </div>
                    {editable ? (
                      <label className="mb-0 inline-flex shrink-0 items-center gap-2 text-sm text-fg-secondary">
                        <Switch className="data-[state=checked]:bg-chip-good-ink" checked={question.required} onCheckedChange={(value) => update(index, { required: value === true })} />
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
                      {needsScaleLabels(question.type) &&
                        locales.map((loc) => (
                          <EditorField key={loc} label={copy(`endsIn.${loc}`)}>
                            <div className="grid grid-cols-2 gap-2">
                              <Input aria-label={`${copy(`endsIn.${loc}`)} 1`} value={question.scaleLabelMin[loc]?.text ?? ''} onChange={(e) => setText(index, 'scaleLabelMin', loc, e.target.value)} />
                              <Input aria-label={`${copy(`endsIn.${loc}`)} 2`} value={question.scaleLabelMax[loc]?.text ?? ''} onChange={(e) => setText(index, 'scaleLabelMax', loc, e.target.value)} />
                            </div>
                          </EditorField>
                        ))}
                      <div className="flex flex-wrap items-center gap-4 border-t border-line-light pt-3">
                        <label className="mb-0 inline-flex items-center gap-2 text-sm text-fg-secondary">
                          <Switch className="data-[state=checked]:bg-chip-good-ink" checked={question.required} onCheckedChange={(value) => update(index, { required: value === true })} />
                          {copy('answerRequired')}
                        </label>
                        <label className="mb-0 inline-flex items-center gap-2 text-sm text-fg-secondary">
                          <Switch className="data-[state=checked]:bg-chip-good-ink" checked={question.commentRequired} onCheckedChange={(value) => update(index, { commentRequired: value === true })} />
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
                          <Button type="button" variant="outline" className="text-chip-critical-ink" onClick={() => { setQuestions((c) => removeQuestion(c, index)); setOpenIndex(null) }}>
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
            // The board's row: "Agregar pregunta" at 13px/500 in the ghost button's ink (#4a3d72), then
            // its tail at 12px/400 as one run of words — "· de la biblioteca o en blanco" — with a word
            // space around "o" and nothing more. The board paints the tail #8a82a5 (3.25:1), below AA for
            // 12px text and barred by inkContrast.test.ts, so it takes the lightest AA ink, the tertiary.
            <div data-testid="add-question" className="mt-2 flex h-10 w-full items-center justify-center rounded-lg border border-dashed border-line-default">
              <Button type="button" variant="ghost" className="h-8 pl-2 pr-0" onClick={() => setLibraryOpen(true)}>
                <Plus aria-hidden="true" />
                {copy('addQuestion')}
                <span data-testid="add-tail" className="text-sm font-normal text-fg-tertiary">{copy('addFromLibrary')}</span>
              </Button>
              <span className="whitespace-pre text-sm text-fg-tertiary">{` ${copy('addOr')} `}</span>
              <Button
                type="button"
                variant="ghost"
                className="h-8 px-0 text-sm font-normal text-fg-tertiary"
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
              companyId={scope.companyId ?? null}
              allowedTypes={SURVEY_QUESTION_TYPES}
              typeLabel={(type) => scaleName(t, type)}
              onAdd={(picked) => {
                // Functional: the browser can add several times before it closes.
                setQuestions((current) => [...current, ...picked.map((item, i) => questionFromLibraryItem(item, current.length + i, locales))])
                setOpenIndex(null)
              }}
            />
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line-light pt-3 text-sm text-fg-tertiary">
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
                  <span className="text-accent-amber-ink">{copy('missingDimension', { count: summary.uncategorised })}</span>
                ) : emptied.length > 0 ? (
                  <span className="text-accent-amber-ink">{copy('dimensionsWithout', { dimensions: emptied.map((key) => dimensionLabel(key, t)).join(', ') })}</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-chip-good-ink">
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
            <p className="mb-3 mt-0 text-sm text-fg-tertiary">{locked ? copy('previewLocked') : copy('previewDraft')}</p>
            <div data-testid="respondent-preview" className="rounded-lg border border-line-default p-4">
              <Eyebrow>{copy('surveyEyebrow')}</Eyebrow>
              <p className="m-0 font-serif text-[1.125rem] text-fg-primary">{title}</p>
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
                    <span className="font-mono text-xs text-fg-tertiary">{copy('positionOf', { position: openPosition, count: questions.length })}</span>
                  </div>
                  <div className="rounded-lg border border-line-default p-3">
                    <p className="m-0 flex items-start gap-2 text-base">
                      <span className="rounded bg-surface-icon-box px-1.5 font-mono text-xs font-medium text-fg-secondary">{`${openPosition}/${questions.length}`}</span>
                      <span>
                        <strong className="text-fg-primary">{openQuestion.text[shownLocale]?.text || copy('noText')}</strong>{' '}
                        {openQuestion.required && <span className="text-fg-tertiary">{copy('requiredParen')}</span>}
                      </span>
                    </p>
                    {openQuestion.scaleMin !== null && openQuestion.scaleMax !== null && (
                      <>
                        <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${openQuestion.scaleMax - openQuestion.scaleMin + 1}, minmax(0, 1fr))` }}>
                          {Array.from({ length: openQuestion.scaleMax - openQuestion.scaleMin + 1 }, (_, i) => (
                            <span key={i} className="flex h-9 items-center justify-center rounded-md border border-line-default font-mono text-base text-fg-secondary">
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
                          {copy('comment')} <span className="font-normal text-fg-tertiary">{copy('requiredParenMasc')}</span>
                        </p>
                        <div className="mt-1 h-10 rounded-md border border-line-default" />
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex items-center gap-2 border-t border-line-light pt-3 text-xs text-fg-tertiary">
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
        <p data-testid="save-note" className="mb-0 mt-5 flex items-center gap-2 border-t border-line-light pt-4 text-sm text-fg-tertiary">
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

// `mb-0`: index.css gives every <label> a 12px bottom margin for the old stacked forms; here the
// grid's gap spaces the fields, and the margin made the open card 46px taller than the board. The
// `[&>…]:mt-0` drop the 4px index.css adds above a label's own control (index.css:252-258): the
// board sets the control 6px under its label, the field's gap and nothing more.
function EditorField({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="mb-0 flex flex-col gap-1.5 [&>input]:mt-0 [&>select]:mt-0 [&>textarea]:mt-0">
      <span className="text-sm font-semibold text-fg-secondary">
        {label}
        {required && <span className="text-chip-critical-ink"> *</span>}
      </span>
      {children}
      {hint && <span className="text-sm leading-[1.45] text-fg-tertiary">{hint}</span>}
    </label>
  )
}
