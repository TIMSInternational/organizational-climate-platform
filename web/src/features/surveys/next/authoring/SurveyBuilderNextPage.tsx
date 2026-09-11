import { useState } from 'react'
import { ArrowRight, Check, EyeOff, FileText, GripVertical, Lock, MoreHorizontal, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { PageTopBar } from '../../../../components/layout'
import {
  Alert,
  AlertDescription,
  Button,
  CheckboxField,
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ErrorState,
  Select,
  SelectContent,
  SelectField,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  TextField,
  TextareaField,
} from '../../../../components/ui'
import { ANONYMITY_FLOOR } from '../../../../components/charts'
import { QuestionLibraryBrowser } from '../../../../components/questions'
import { useViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { useCompanyScope } from '../../../../company-context'
import { useTranslation, type TranslateFn } from '../../../../i18n'
import { cn } from '../../../../lib/cn'
import type { SurveyRespondQuestion } from '../../api/surveyResponses'
import { SurveyDraftIndicator, SurveyDraftRecoveryBanner } from '../../components/SurveyDraftNotices'
import { dimensionLabel } from '../../dimensionLabel'
import { hasDraftableContent } from '../../draftContent'
import {
  SUGGESTED_DIMENSION_KEYS,
  SURVEY_QUESTION_TYPES,
  SURVEY_TYPES,
  languageLabel,
  needsOptions,
  needsScaleLabels,
  questionTypeLabel,
  typeLabel,
} from '../../surveyVocabulary'
import {
  CONTENT_LANGUAGES,
  SURVEY_WIZARD_STEPS,
  chosenDimensions,
  derivedOptionValue,
  emptyOption,
  emptyQuestion,
  positionsWithoutDimension,
  questionFromLibrary,
  scheduledDays,
  startsFromTemplate,
  surveyQuestionCount,
  wizardStepErrors,
  type ContentLanguage,
  type SurveyQuestionValues,
  type SurveyWizardStepId,
  type SurveyWizardValues,
} from '../../wizardValues'
import { Eyebrow, PanelHeading } from '../../../shared-next/parts'
import { PreviewQuestion, PreviewSection } from './QuestionPreview'
import { Card } from './parts'
import { dimensionSections } from './launch'
import { useSurveyBuilderModel } from './useSurveyBuilderModel'

const NO_TEMPLATE = '__none__'

/**
 * Nueva encuesta, redesigned (canvas board "SurveyBuilder") — `/surveys/new`.
 *
 * The wizard as a two-pane editor. The five steps are a progress rail, not pages; the left pane
 * holds the current step, the right pane is the respondent's own view of what is being built —
 * the survey's header as it is typed and the selected question as the respond page will draw it.
 * The questions step is the artboard's: rows with a drag handle, the dimension and scale chips and
 * a required switch, "Agregar pregunta" from the library or blank.
 *
 * State, draft and submit are the previous wizard's (`useSurveyBuilderModel`); only an author the
 * server would accept reaches the builder (`canAuthorSurveys` — `POST /surveys` is `CanAdminister`).
 */
export default function SurveyBuilderNextPage() {
  const caps = useViewerCapabilities()
  const scope = useCompanyScope()
  const { t } = useTranslation()
  if (!caps.canAuthorSurveys || scope.companyId === undefined) {
    return (
      <ErrorState
        title={t('surveys.next.builder.cannotAuthorTitle')}
        description={scope.isSuperAdmin ? t('surveys.next.builder.pickCompany') : t('surveys.next.builder.cannotAuthorBody')}
      />
    )
  }
  return <SurveyBuilder companyId={scope.companyId} />
}

function SurveyBuilder({ companyId }: { companyId: string }) {
  const { t, locale } = useTranslation()
  const m = useSurveyBuilderModel(companyId)
  const { values, patch, setQuestions, stepIndex, setStepIndex, template, draft } = m
  const copy = (key: string, vars?: Record<string, string | number>) => t(`surveys.next.builder.${key}`, vars)
  const [attempted, setAttempted] = useState<ReadonlySet<SurveyWizardStepId>>(new Set())
  const [selected, setSelected] = useState(0)
  const [editing, setEditing] = useState<string | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)

  const fromTemplate = startsFromTemplate(values)
  const errors = wizardStepErrors(values, t, template === null ? null : template.questions.length)
  const step = SURVEY_WIZARD_STEPS[stepIndex]
  const last = stepIndex === SURVEY_WIZARD_STEPS.length - 1
  const both = values.language === 'both'
  // The reader's column when the survey is bilingual; the survey's own language otherwise.
  const shown: 'en' | 'es' = values.language === 'both' ? (locale === 'es' ? 'es' : 'en') : values.language
  const title = (shown === 'es' ? values.titleEs : values.titleEn).trim()
  const description = (shown === 'es' ? values.descriptionEs : values.descriptionEn).trim()
  const previewQuestions: SurveyRespondQuestion[] = fromTemplate
    ? (template?.questions ?? []).map((q, index) => ({ ...q, order: index, category: (q as { category?: string | null }).category ?? null }))
    : values.questions.map((q, index) => respondShape(q, index, shown))
  const sections = dimensionSections(previewQuestions)
  const focus = Math.min(selected, Math.max(previewQuestions.length - 1, 0))
  const focusSection = sections.find((section) => section.questions.some((entry) => entry.position === focus + 1))
  const reachable = (index: number) =>
    index <= stepIndex || SURVEY_WIZARD_STEPS.slice(0, index).every((id) => errors[id].length === 0)

  function goNext() {
    if (errors[step].length > 0) {
      setAttempted((current) => new Set(current).add(step))
      return
    }
    if (last) void m.submit()
    else setStepIndex(stepIndex + 1)
  }

  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= values.questions.length) return
    setQuestions((questions) => {
      const next = [...questions]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
    setSelected(to)
  }

  const patchQuestion = (key: string, next: Partial<SurveyQuestionValues>) =>
    setQuestions((questions) => questions.map((q) => (q.key === key ? { ...q, ...next } : q)))

  return (
    <div>
      <PageTopBar
        title={copy('title')}
        badge={{ text: copy('draftBadge'), variant: 'secondary' }}
        description={`${copy(`stepLine.${step}`)} ${copy('stepOf', { current: stepIndex + 1, total: SURVEY_WIZARD_STEPS.length })}`}
        breadcrumbs={[{ label: t('navigation.surveys'), href: '/surveys' }, { label: copy('title') }]}
        actions={
          <Button
            type="button"
            variant="outline"
            disabled={!hasDraftableContent(values) || draft.state.status === 'saving' || draft.state.status === 'conflict'}
            onClick={draft.saveNow}
          >
            <FileText aria-hidden="true" className="size-icon" />
            {copy('saveDraft')}
          </Button>
        }
      />

      {m.submitError && (
        <Alert variant="destructive" role="alert" className="mb-4">
          <AlertDescription>{m.submitError}</AlertDescription>
        </Alert>
      )}
      {draft.recovery !== null && (
        <SurveyDraftRecoveryBanner
          recovery={draft.recovery}
          locale={locale}
          onRestore={draft.restore}
          onDiscard={draft.discardRecovered}
          onDismiss={draft.dismissRecovery}
        />
      )}

      <Card className="mt-5 flex flex-wrap items-center gap-6 px-5 py-3.5" data-testid="builder-rail">
        <ol aria-label={t('surveys.wizardStepList')} className="m-0 flex min-w-0 flex-1 list-none items-center gap-3.5 p-0">
          {SURVEY_WIZARD_STEPS.map((id, index) => {
            const state = index < stepIndex ? (errors[id].length === 0 ? 'done' : 'open') : index === stepIndex ? 'current' : 'pending'
            return (
              <li key={id} className={cn('flex min-w-0 items-center gap-3.5', index < SURVEY_WIZARD_STEPS.length - 1 && 'flex-1')}>
                <button
                  type="button"
                  aria-current={state === 'current' ? 'step' : undefined}
                  disabled={!reachable(index)}
                  onClick={() => setStepIndex(index)}
                  className="flex min-w-0 items-center gap-2.5 border-0 bg-transparent p-0 text-left shadow-none disabled:cursor-default"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-5.5 shrink-0 items-center justify-center rounded-full font-mono text-xs [&>svg]:size-3',
                      state === 'done' && 'border border-accent-green-ring bg-chip-good-fill text-chip-good-ink',
                      state === 'open' && 'border border-accent-amber-ring bg-chip-warning-fill text-chip-warning-ink',
                      state === 'current' && 'bg-accent-red font-semibold text-fg-on-accent',
                      state === 'pending' && 'border border-line-default bg-surface-icon-box text-fg-label',
                    )}
                  >
                    {state === 'done' ? <Check /> : index + 1}
                  </span>
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className={cn('text-sm', state === 'current' ? 'font-semibold text-fg-primary' : state === 'pending' ? 'font-medium text-fg-label' : 'font-medium text-fg-secondary')}>
                      {t(`surveys.step${id.charAt(0).toUpperCase()}${id.slice(1)}`)}
                    </span>
                    <span
                      className={cn(
                        'text-xs',
                        state === 'done' && 'text-chip-good-ink',
                        state === 'open' && 'text-accent-amber-ink',
                        state === 'current' && 'text-accent-red',
                        state === 'pending' && 'text-fg-label',
                      )}
                    >
                      {copy(`railState.${state}`)}
                    </span>
                  </span>
                </button>
                {index < SURVEY_WIZARD_STEPS.length - 1 && (
                  <span aria-hidden="true" className={cn('h-px min-w-6 flex-1', index < stepIndex ? 'bg-accent-green' : 'bg-line-default')} />
                )}
              </li>
            )
          })}
        </ol>
        <div className="flex flex-none items-center gap-2.5 border-l border-line-light pl-5">
          <span id="builder-language" className="whitespace-nowrap text-sm font-semibold text-fg-secondary">
            {t('surveys.contentLanguage')}
          </span>
          <Select value={values.language} disabled={fromTemplate} onValueChange={(next) => patch({ language: next as ContentLanguage })}>
            <SelectTrigger aria-labelledby="builder-language" className="w-38">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONTENT_LANGUAGES.map((code) => (
                <SelectItem key={code} value={code}>
                  {languageLabel(t, code)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <div className="mt-5 grid items-start gap-4 lg:grid-cols-2">
        <Card className="flex min-w-0 flex-col gap-3 px-5 pb-4.5 pt-4" data-testid="builder-step">
          {step === 'questions' ? (
            <>
              <PanelHeading
                title={copy('questionsTitle')}
                count={surveyQuestionCount(values, template === null ? null : template.questions.length)}
                aside={fromTemplate && template ? copy('fromTemplate', { name: template.name }) : undefined}
              />
              <p className="-mt-2 mb-0 flex items-start gap-2 text-sm text-fg-secondary">
                {fromTemplate ? <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /> : <GripVertical aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />}
                {fromTemplate ? copy('templateHint') : copy('dragHint')}
              </p>
              {m.templateError && (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{m.templateError}</AlertDescription>
                </Alert>
              )}
              <ol className="m-0 flex list-none flex-col gap-2 p-0" data-testid="builder-questions">
                {previewQuestions.map((question, index) => {
                  const own = fromTemplate ? null : values.questions[index]
                  const isSelected = index === focus
                  return (
                    <li
                      key={own?.key ?? question.id}
                      draggable={!fromTemplate}
                      onDragStart={() => setDragFrom(index)}
                      onDragOver={(event) => !fromTemplate && event.preventDefault()}
                      onDrop={() => {
                        if (dragFrom !== null) move(dragFrom, index)
                        setDragFrom(null)
                      }}
                      data-selected={isSelected || undefined}
                      className={cn('rounded-lg border', isSelected ? 'border-accent-blue bg-surface-icon-box' : 'border-line-default bg-surface-card')}
                    >
                      <div className="flex items-center gap-2.5 py-2.5 pl-2 pr-3">
                        {fromTemplate ? (
                          <Lock aria-hidden="true" className="size-4 shrink-0 text-fg-label" />
                        ) : (
                          <GripVertical aria-hidden="true" className="size-4 shrink-0 cursor-grab text-fg-label" />
                        )}
                        <span className="w-5.5 shrink-0 text-center font-mono text-sm text-fg-secondary tabular-nums">{index + 1}</span>
                        <button
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => setSelected(index)}
                          className="flex min-w-0 flex-1 flex-col items-start gap-1.5 border-0 bg-transparent p-0 text-left shadow-none"
                        >
                          <span className={cn('block w-full text-base text-fg-primary', isSelected ? 'font-semibold' : 'truncate font-medium')}>
                            {question.text?.trim() ? question.text : copy('noText')}
                          </span>
                          <span className="flex flex-wrap items-center gap-1.5">
                            {question.category ? (
                              <Chip label={dimensionLabel(question.category, t)} />
                            ) : (
                              <Chip tone="warning" label={copy('noDimension')} />
                            )}
                            <Chip label={typeChip(t, question)} />
                          </span>
                        </button>
                        <label className="mb-0 inline-flex shrink-0 items-center gap-2 text-sm text-fg-secondary">
                          <Switch
                            className="data-[state=checked]:bg-chip-good-ink"
                            checked={question.required}
                            disabled={fromTemplate}
                            onCheckedChange={(value) => own && patchQuestion(own.key, { required: value === true })}
                          />
                          {copy('required')}
                        </label>
                        {own && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button type="button" variant="outline" size="icon" className="size-7" aria-label={copy('questionMenu', { position: index + 1 })}>
                                <MoreHorizontal aria-hidden="true" className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => { setSelected(index); setEditing(editing === own.key ? null : own.key) }}>
                                {editing === own.key ? copy('closeEditor') : copy('edit')}
                              </DropdownMenuItem>
                              <DropdownMenuItem disabled={index === 0} onSelect={() => move(index, index - 1)}>{copy('moveUp')}</DropdownMenuItem>
                              <DropdownMenuItem disabled={index === previewQuestions.length - 1} onSelect={() => move(index, index + 1)}>{copy('moveDown')}</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => { setQuestions((questions) => questions.filter((q) => q.key !== own.key)); setEditing(null) }}>
                                {copy('remove')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                      {own && editing === own.key && (
                        <QuestionEditor
                          t={t}
                          question={own}
                          language={values.language}
                          history={m.history}
                          others={values.questions.filter((q) => q.key !== own.key)}
                          onChange={(next) => patchQuestion(own.key, next)}
                          onAddOption={() => patchQuestion(own.key, { options: [...own.options, emptyOption(m.takeKeys(1)[0])] })}
                        />
                      )}
                    </li>
                  )
                })}
              </ol>
              {!fromTemplate && (
                <div className="flex h-10 items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-default" data-testid="add-question">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" className="h-8 px-2">
                        <Plus aria-hidden="true" className="size-4" />
                        {copy('addQuestion')}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onSelect={() => setLibraryOpen(true)}>{copy('addFromLibrary')}</DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => {
                          const [key] = m.takeKeys(1)
                          setQuestions((questions) => [...questions, emptyQuestion(key)])
                          setSelected(values.questions.length)
                          setEditing(key)
                        }}
                      >
                        {copy('addBlank')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <span className="text-sm text-fg-label">{copy('addTail')}</span>
                </div>
              )}
              <QuestionsFooter t={t} values={values} questions={previewQuestions} fromTemplate={fromTemplate} />
              <QuestionLibraryBrowser
                open={libraryOpen}
                onOpenChange={setLibraryOpen}
                companyId={companyId}
                allowedTypes={SURVEY_QUESTION_TYPES}
                typeLabel={(type) => questionTypeLabel(t, type)}
                onAdd={(picked) => {
                  const keys = m.takeKeys(picked.length)
                  setQuestions((questions) => [...questions, ...picked.map((item, index) => questionFromLibrary(item, keys[index]))])
                }}
              />
            </>
          ) : (
            <StepForm step={step} m={m} both={both} copy={copy} />
          )}
          {attempted.has(step) && errors[step].length > 0 && (
            <ul role="alert" className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-accent-amber-ink">
              {errors[step].map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex min-w-0 flex-col gap-3 bg-surface-outer px-5 pb-4.5 pt-4" data-testid="builder-preview">
          <PanelHeading
            title={copy('previewTitle')}
            aside={
              <span className="inline-flex items-center gap-2">
                <Chip label={languageLabel(t, shown)} />
                <Chip label={copy('desktop')} />
              </span>
            }
          />
          <p className="-mt-2 mb-0 text-sm text-fg-secondary">{copy('previewLine')}</p>
          <div className="flex flex-col gap-3.5 rounded-lg border border-line-default bg-surface-card px-4.5 pb-4.5 pt-4 shadow-xs">
            <div className="flex flex-col gap-1 border-b border-line-light pb-3">
              <Eyebrow>{copy('surveyEyebrow')}</Eyebrow>
              <p className="m-0 font-serif text-lg text-fg-primary">{title || copy('untitled')}</p>
              {description && <p className="m-0 text-sm text-fg-secondary">{description}</p>}
            </div>
            {focusSection ? (
              <PreviewSection category={focusSection.category} index={focusSection.index} count={focusSection.count}>
                <PreviewQuestion question={previewQuestions[focus]} position={focus + 1} total={previewQuestions.length} />
              </PreviewSection>
            ) : (
              <p className="m-0 text-sm text-fg-secondary">{fromTemplate && template === null ? t('common.loading') : copy('previewEmpty')}</p>
            )}
            <div aria-hidden="true" className="flex flex-wrap items-center justify-between gap-3 border-t border-line-light pt-2.5">
              <span className="inline-flex items-center gap-2 text-xs text-fg-secondary">
                <span className="h-1.25 w-12 rounded-sm bg-surface-icon-box" />
                {copy('answeredOf', { count: previewQuestions.length })}
              </span>
              <span className="inline-flex gap-2">
                <span className="inline-flex h-7 items-center rounded border border-line-default px-3 text-sm text-fg-primary">{copy('saveLater')}</span>
                <span className="inline-flex h-7 items-center rounded border border-accent-red-ring bg-chip-critical-fill px-3 text-sm text-chip-critical-ink">
                  {copy('submitAnswers')}
                </span>
              </span>
            </div>
          </div>
          <p className="m-0 flex items-start gap-2 text-sm text-fg-secondary">
            <EyeOff aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            {copy('previewNote')}
          </p>
        </Card>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-line-light pt-4">
        <span className="inline-flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-secondary">
          <span className="inline-flex items-center gap-2">
            <Lock aria-hidden="true" className="size-3.5 shrink-0" />
            {copy('nothingSent')}
          </span>
          <SurveyDraftIndicator state={draft.state} locale={locale} onSaveAnyway={draft.saveAnyway} />
        </span>
        <span className="flex gap-2">
          <Button type="button" variant="outline" disabled={stepIndex === 0} onClick={() => setStepIndex(stepIndex - 1)}>
            {copy('back')}
          </Button>
          <Button type="button" variant="primary" disabled={m.submitting} onClick={goNext}>
            {last ? <Check aria-hidden="true" className="size-icon" /> : <ArrowRight aria-hidden="true" className="size-icon" />}
            {last ? copy('create') : copy('next')}
          </Button>
        </span>
      </div>
    </div>
  )
}

/** A wizard question as the respond page will receive it — the columns the reader will see. */
function respondShape(q: SurveyQuestionValues, index: number, lang: 'en' | 'es'): SurveyRespondQuestion {
  const pick = (en: string, es: string) => (lang === 'es' ? es || '' : en || '')
  return {
    id: q.key,
    text: pick(q.textEn, q.textEs),
    type: q.type,
    options: needsOptions(q.type)
      ? q.options
          .filter((option) => derivedOptionValue(option) !== null)
          .map((option, order) => ({ order, value: derivedOptionValue(option) ?? '', label: pick(option.labelEn, option.labelEs) || null }))
      : null,
    scaleMin: q.scaleMin,
    scaleMax: q.scaleMax,
    scaleLabelMin: pick(q.scaleLabelMinEn, q.scaleLabelMinEs) || null,
    scaleLabelMax: pick(q.scaleLabelMaxEn, q.scaleLabelMaxEs) || null,
    required: q.required,
    commentRequired: false,
    commentPrompt: null,
    order: index,
    category: q.category.trim() || null,
  }
}

/** "Likert 1–5" for a scale, the type's own name for anything else. */
function typeChip(t: TranslateFn, q: SurveyRespondQuestion): string {
  if ((q.type === 'likert' || q.type === 'rating') && (q.options?.length ?? 0) === 0) {
    return t(`surveys.next.builder.scaleChip.${q.type}`, { min: q.scaleMin ?? 1, max: q.scaleMax ?? 5 })
  }
  return questionTypeLabel(t, q.type)
}

function QuestionsFooter({
  t,
  values,
  questions,
  fromTemplate,
}: {
  t: TranslateFn
  values: SurveyWizardValues
  questions: SurveyRespondQuestion[]
  fromTemplate: boolean
}) {
  const copy = (key: string, vars?: Record<string, string | number>) => t(`surveys.next.builder.${key}`, vars)
  const dimensions = fromTemplate
    ? new Set(questions.map((q) => q.category).filter((c): c is string => !!c)).size
    : chosenDimensions(values).length
  const missing = fromTemplate ? questions.filter((q) => !q.category).length : positionsWithoutDimension(values).length
  const required = questions.filter((q) => q.required).length
  const open = questions.filter((q) => q.type === 'open_ended').length
  if (questions.length === 0) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-light pt-2.5 text-sm text-fg-secondary" data-testid="questions-footer">
      <span>
        {copy('coverage', { dimensions, required })} · {open === 0 ? copy('noOpen') : copy('someOpen', { count: open })}
      </span>
      {missing === 0 ? (
        <span className="inline-flex items-center gap-1.5 text-chip-good-ink">
          <Check aria-hidden="true" className="size-3.5" />
          {copy('everyDimension')}
        </span>
      ) : (
        <span className="text-accent-amber-ink">{copy('withoutDimension', { count: missing })}</span>
      )}
    </div>
  )
}

function QuestionEditor({
  t,
  question,
  language,
  history,
  others,
  onChange,
  onAddOption,
}: {
  t: TranslateFn
  question: SurveyQuestionValues
  language: ContentLanguage
  history: readonly string[]
  others: readonly SurveyQuestionValues[]
  onChange: (next: Partial<SurveyQuestionValues>) => void
  onAddOption: () => void
}) {
  const copy = (key: string) => t(`surveys.next.builder.${key}`)
  const columns: ('en' | 'es')[] = language === 'both' ? ['es', 'en'] : [language]
  const current = question.category.trim()
  const chips = [...new Set([...SUGGESTED_DIMENSION_KEYS, ...history, ...others.map((q) => q.category.trim()), current].filter((c) => c !== ''))]
  return (
    <div className="flex flex-col gap-3 border-t border-line-light p-4 text-sm" data-testid="question-editor">
      {columns.map((col) => (
        <TextField
          key={col}
          required
          label={col === 'es' ? t('surveys.questionTextEs') : t('surveys.questionTextEn')}
          value={col === 'es' ? question.textEs : question.textEn}
          onChange={(next) => onChange(col === 'es' ? { textEs: next } : { textEn: next })}
        />
      ))}
      <SelectField
        label={t('surveys.questionType')}
        value={question.type}
        onChange={(next) => onChange({ type: next })}
        options={SURVEY_QUESTION_TYPES.map((code) => ({ value: code, label: questionTypeLabel(t, code) }))}
      />
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1.5 text-sm font-medium">{copy('dimension')}</legend>
        <div className="flex flex-wrap gap-1.5">
          {chips.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={key === current}
              onClick={() => onChange({ category: key })}
              className={cn(
                'inline-flex h-5.5 items-center rounded-md border px-2 text-xs font-medium shadow-none',
                key === current ? 'border-accent-blue-ring bg-chip-accent-fill text-fg-primary' : 'border-line-light bg-surface-icon-box text-fg-secondary',
              )}
            >
              {dimensionLabel(key, t)}
            </button>
          ))}
        </div>
      </fieldset>
      {needsScaleLabels(question.type) && (
        <div className="grid gap-2 md:grid-cols-2">
          {columns.map((col) => (
            <div key={col} className="contents">
              <TextField
                label={col === 'es' ? t('surveyCreate.scaleMinEs') : t('surveyCreate.scaleMinEn')}
                value={col === 'es' ? question.scaleLabelMinEs : question.scaleLabelMinEn}
                onChange={(next) => onChange(col === 'es' ? { scaleLabelMinEs: next } : { scaleLabelMinEn: next })}
              />
              <TextField
                label={col === 'es' ? t('surveyCreate.scaleMaxEs') : t('surveyCreate.scaleMaxEn')}
                value={col === 'es' ? question.scaleLabelMaxEs : question.scaleLabelMaxEn}
                onChange={(next) => onChange(col === 'es' ? { scaleLabelMaxEs: next } : { scaleLabelMaxEn: next })}
              />
            </div>
          ))}
        </div>
      )}
      {needsOptions(question.type) && (
        <div className="flex flex-col gap-2">
          {question.options.map((option) => (
            <div key={option.key} className="flex flex-wrap items-end gap-2">
              {columns.map((col) => (
                <div key={col} className="min-w-0 flex-1">
                  <TextField
                    label={col === 'es' ? t('surveys.optionLabelEs') : t('surveys.optionLabelEn')}
                    value={col === 'es' ? option.labelEs : option.labelEn}
                    onChange={(next) =>
                      onChange({
                        options: question.options.map((o) => (o.key === option.key ? { ...o, ...(col === 'es' ? { labelEs: next } : { labelEn: next }) } : o)),
                      })
                    }
                  />
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t('surveys.removeOption')}
                onClick={() => onChange({ options: question.options.filter((o) => o.key !== option.key) })}
              >
                <Trash2 aria-hidden="true" className="size-icon" />
              </Button>
            </div>
          ))}
          <div>
            <Button type="button" variant="outline" size="sm" onClick={onAddOption}>
              <Plus aria-hidden="true" className="size-4" />
              {t('surveys.addOption')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function StepForm({
  step,
  m,
  both,
  copy,
}: {
  step: SurveyWizardStepId
  m: ReturnType<typeof useSurveyBuilderModel>
  both: boolean
  copy: (key: string, vars?: Record<string, string | number>) => string
}) {
  const { t, locale } = useTranslation()
  const { values, patch, departments, templates, template } = m
  const fromTemplate = startsFromTemplate(values)
  const days = scheduledDays(values)
  const columns: ('en' | 'es')[] = both ? ['es', 'en'] : [values.language === 'es' ? 'es' : 'en']
  const headcount = (departments ?? []).reduce((sum, d) => sum + d.employeeCount, 0)

  if (step === 'basics') {
    return (
      <>
        <PanelHeading title={t('surveys.stepBasics')} />
        <div className="grid gap-3 md:grid-cols-2">
          <SelectField
            label={t('surveys.startFromTemplate')}
            value={values.templateId === '' ? NO_TEMPLATE : values.templateId}
            onChange={(next) => patch({ templateId: next === NO_TEMPLATE ? '' : next })}
            options={[{ value: NO_TEMPLATE, label: t('surveys.startBlank') }, ...templates.map((option) => ({ value: option.id, label: option.name }))]}
          />
          <SelectField
            required
            label={t('surveys.typeLabel')}
            value={values.type}
            onChange={(next) => patch({ type: next })}
            options={SURVEY_TYPES.map((code) => ({ value: code, label: typeLabel(t, code) }))}
          />
        </div>
        {columns.map((col) => (
          <TextField
            key={`title-${col}`}
            required
            label={both ? (col === 'es' ? t('surveys.titleEs') : t('surveys.titleEn')) : t('surveys.titleLabel')}
            value={col === 'es' ? values.titleEs : values.titleEn}
            onChange={(next) => patch(col === 'es' ? { titleEs: next } : { titleEn: next })}
          />
        ))}
        {columns.map((col) => (
          <TextareaField
            key={`description-${col}`}
            label={both ? (col === 'es' ? t('surveys.descriptionEs') : t('surveys.descriptionEn')) : t('surveys.descriptionLabel')}
            value={col === 'es' ? values.descriptionEs : values.descriptionEn}
            onChange={(next) => patch(col === 'es' ? { descriptionEs: next } : { descriptionEn: next })}
          />
        ))}
        {fromTemplate && <p className="m-0 text-sm text-fg-secondary">{t('surveys.contentLanguageFromTemplate')}</p>}
      </>
    )
  }
  if (step === 'schedule') {
    return (
      <>
        <PanelHeading title={t('surveys.stepSchedule')} />
        <div className="grid gap-3 md:grid-cols-2">
          <TextField required type="datetime-local" label={t('surveys.startDate')} value={values.startDate} onChange={(next) => patch({ startDate: next })} />
          <TextField required type="datetime-local" label={t('surveys.endDate')} value={values.endDate} onChange={(next) => patch({ endDate: next })} />
        </div>
        {days !== null && (
          <p className="m-0 text-sm text-fg-secondary">
            <span className="font-mono text-fg-primary tabular-nums">{days}</span> {copy('daysOpen')}
          </p>
        )}
      </>
    )
  }
  if (step === 'audience') {
    return (
      <>
        <PanelHeading title={t('surveys.stepAudience')} />
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1.5 text-sm font-medium">{t('surveys.departmentsLabel')}</legend>
          {departments === null || departments.length === 0 ? (
            <p className="m-0 text-sm text-fg-secondary">{t('surveys.departmentsAll')}</p>
          ) : (
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {departments.map((department) => (
                <CheckboxField
                  key={department.id}
                  label={t('surveyCreate.departmentPeople', { name: department.name, count: department.employeeCount })}
                  checked={values.departmentIds.includes(department.id)}
                  onChange={(checked) =>
                    patch({
                      departmentIds: checked
                        ? [...values.departmentIds, department.id]
                        : values.departmentIds.filter((id) => id !== department.id),
                    })
                  }
                />
              ))}
            </div>
          )}
          {departments !== null && departments.length > 0 && values.departmentIds.length === 0 && (
            <p className="m-0 text-sm text-fg-secondary">{copy('reachesEveryone', { count: headcount })}</p>
          )}
        </fieldset>
        <p className="m-0 flex items-start gap-2 rounded-md bg-surface-icon-box px-3.5 py-3 text-sm text-fg-secondary">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          {copy('floorNote', { floor: ANONYMITY_FLOOR })}
        </p>
        <TextField
          type="number"
          label={t('surveys.targetAudienceLabel')}
          description={t('surveys.targetAudienceHelp')}
          value={values.targetAudienceCount}
          onChange={(next) => patch({ targetAudienceCount: next })}
        />
        <CheckboxField label={t('surveys.anonymous')} checked={values.anonymous} onChange={(checked) => patch({ anonymous: checked })} />
        <CheckboxField label={t('surveys.allowPartialResponses')} checked={values.allowPartialResponses} onChange={(checked) => patch({ allowPartialResponses: checked })} />
        <CheckboxField label={t('surveys.showProgress')} checked={values.showProgress} onChange={(checked) => patch({ showProgress: checked })} />
      </>
    )
  }
  // review
  const named = (departments ?? []).filter((d) => values.departmentIds.includes(d.id)).map((d) => d.name)
  const rows: [string, string][] = [
    [t('surveys.startFromTemplate'), fromTemplate ? (template?.name ?? '—') : t('surveys.startBlank')],
    [t('surveys.titleLabel'), [values.titleEs, values.titleEn].filter((s) => s.trim() !== '').join(' / ') || '—'],
    [t('surveys.typeLabel'), typeLabel(t, values.type)],
    [t('surveys.contentLanguage'), languageLabel(t, values.language)],
    [t('surveys.startDate'), reviewDate(values.startDate, locale)],
    [t('surveys.endDate'), reviewDate(values.endDate, locale)],
    [t('surveys.departmentsLabel'), values.departmentIds.length === 0 ? t('surveys.departmentsAll') : named.join(', ') || t('surveys.readingDepartmentsUnlisted')],
    [copy('questionsTitle'), String(surveyQuestionCount(values, template === null ? null : template.questions.length))],
  ]
  return (
    <>
      <PanelHeading title={t('surveys.stepReview')} />
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-fg-secondary">{label}</dt>
            <dd className="m-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="m-0 rounded-md bg-surface-icon-box px-3.5 py-3 text-sm text-fg-secondary">{t('surveys.reviewCreatesDraft')}</p>
    </>
  )
}

function reviewDate(value: string, locale: string): string {
  const when = new Date(value)
  if (Number.isNaN(when.getTime())) return '—'
  return when.toLocaleString(locale === 'es' ? 'es-CR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })
}
