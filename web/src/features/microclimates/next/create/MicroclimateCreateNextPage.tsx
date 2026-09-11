import { useId, useMemo, useState } from 'react'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { CalendarDays, Clock, Ellipsis, FileText, GripVertical, Plus, Send, ShieldCheck, Users } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../../i18n'
import { PageTopBar } from '../../../../components/layout'
import { CanvasCard, FactList, NoteBand } from '../../../../components/canvas'
import { QuestionLibraryBrowser } from '../../../../components/questions'
import {
  Alert,
  AlertDescription,
  Button,
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '../../../../components/ui'
import { useCompanyScope } from '../../../../company-context'
import { useCompanyName } from '../../../../company-context/useCompanyName'
import { cn } from '../../../../lib/cn'
import MicroclimateQuestionEditor from '../../components/MicroclimateQuestionEditor'
import { languageLabel, questionTypeLabel } from '../../microclimateVocabulary'
import { QUESTION_TYPES } from '../../questionTypes'
import {
  CONTENT_LANGUAGES,
  defaultEmojiScale,
  emptyQuestion,
  needsBothLanguages,
  questionFromLibrary,
  type ContentLanguage,
  type MicroclimateWizardValues,
  type WizardQuestionValues,
} from '../../wizardValues'
import { JourneyRail } from '../JourneyRail'
import { MicroclimateGate } from '../MicroclimateGate'
import { FLOOR, typeCounts, windowLength, windowMs } from '../derive'
import { clock, shortDay, weekdayDay, weekdayLong } from '../format'
import { canvasTypeLabel } from '../vocabulary'
import { useMicroclimateCreateModel, type MicroclimateCreateState, type StartFrom } from './useMicroclimateCreateModel'

/**
 * `/microclimates/new` — the redesigned Crear microclima, drawn as the MicroclimateCreate
 * board of 10 Sep: step one of the triage's "create, share, watch, read", one page instead of
 * the five-step wizard, and one primary "Lanzar". It replaced `MicroclimateCreatePage` on
 * this route; that page stays in the tree, unrouted, as the wiring reference.
 */
export default function MicroclimateCreateNextPage() {
  return (
    <MicroclimateGate needsCompany>
      <CreateScreen />
    </MicroclimateGate>
  )
}

/** The two types whose answers are options the author writes: the full editor handles them. */
const OPTION_TYPES = new Set(['multiple_choice', 'emoji_rating'])

const START_KEY: Record<StartFrom, string> = {
  previous: 'microclimates.next.create.startPrevious',
  template: 'microclimates.next.create.startTemplate',
  blank: 'microclimates.next.create.startBlank',
}

function textIn(language: ContentLanguage, en: string, es: string): string {
  return language === 'es' ? es : language === 'en' ? en : es || en
}

function CreateScreen() {
  const { t, locale } = useTranslation()
  const state = useMicroclimateCreateModel()
  const { values } = state
  const companyId = useCompanyScope().companyId
  const companyName = useCompanyName()
  const [libraryOpen, setLibraryOpen] = useState(false)
  const busy = state.submitting !== null
  const bilingual = needsBothLanguages(values.language)
  const nameId = useId()
  const languageId = useId()
  const expectedId = useId()
  const startId = useId()
  const endId = useId()
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])
  const window = windowMs(values.startTime, values.endTime)
  const start = new Date(values.startTime)
  const end = new Date(values.endTime)
  const titleError = state.attempted && !textIn(values.language, values.titleEn, values.titleEs).trim()

  return (
    <div>
      <PageTopBar
        title={t('microclimates.next.create.title')}
        eyebrow={t('microclimates.next.create.eyebrow')}
        description={t('microclimates.next.create.description')}
        breadcrumbs={[
          { label: t('navigation.microclimates'), href: '/microclimates' },
          { label: t('microclimates.next.create.title') },
        ]}
        actions={
          <Button variant="outline" disabled={busy} onClick={state.saveDraft}>
            <FileText aria-hidden="true" />
            {state.submitting === 'draft' ? t('common.creating') : t('microclimates.next.create.saveDraft')}
          </Button>
        }
      />

      <div className="flex flex-col gap-5">
        {state.submitError && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{state.submitError}</AlertDescription>
          </Alert>
        )}
        {state.attempted && state.errors.length > 0 && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {state.errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <JourneyRail
          states={{ create: 'current', share: 'pending', live: 'pending', read: 'pending' }}
          notes={{
            create: t('microclimates.next.journey.createNote'),
            share: t('microclimates.next.journey.shareNote'),
            live: t('microclimates.next.journey.liveNote'),
            read: t('microclimates.next.journey.readNote'),
          }}
        />

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-w-0 flex-col gap-4">
            <CanvasCard title={t('microclimates.next.create.questionsTitle')}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_200px]">
                <div className="flex min-w-0 flex-col gap-1.5">
                  {bilingual ? (
                    <>
                      <FieldLabel htmlFor={nameId} required>
                        {t('microclimates.next.create.nameEn')}
                      </FieldLabel>
                      <Input
                        id={nameId}
                        value={values.titleEn}
                        disabled={busy}
                        aria-invalid={titleError || undefined}
                        onChange={(event) => state.patch({ titleEn: event.target.value })}
                      />
                      <FieldLabel htmlFor={`${nameId}-es`} required>
                        {t('microclimates.next.create.nameEs')}
                      </FieldLabel>
                      <Input
                        id={`${nameId}-es`}
                        value={values.titleEs}
                        disabled={busy}
                        onChange={(event) => state.patch({ titleEs: event.target.value })}
                      />
                    </>
                  ) : (
                    <>
                      <FieldLabel htmlFor={nameId} required>
                        {t('microclimates.next.create.name')}
                      </FieldLabel>
                      <Input
                        id={nameId}
                        value={values.language === 'es' ? values.titleEs : values.titleEn}
                        disabled={busy}
                        aria-invalid={titleError || undefined}
                        onChange={(event) =>
                          state.patch(values.language === 'es' ? { titleEs: event.target.value } : { titleEn: event.target.value })
                        }
                      />
                    </>
                  )}
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <FieldLabel htmlFor={languageId}>{t('microclimates.contentLanguage')}</FieldLabel>
                  <Select
                    value={values.language}
                    disabled={busy}
                    onValueChange={(language) => state.patch({ language: language as ContentLanguage })}
                  >
                    <SelectTrigger id={languageId} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONTENT_LANGUAGES.map((language) => (
                        <SelectItem key={language} value={language}>
                          {languageLabel(t, language)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <StartFromRow state={state} />

              {state.startFrom === 'template' && state.templates.length > 0 && (
                <Select
                  value={values.templateId === '' ? 'none' : values.templateId}
                  disabled={busy}
                  onValueChange={(templateId) => state.patch({ templateId: templateId === 'none' ? '' : templateId })}
                >
                  <SelectTrigger className="w-full md:w-80" aria-label={t('microclimates.next.create.startTemplate')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('microclimates.noTemplate')}</SelectItem>
                    {state.templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {values.questions.map((question, index) =>
                OPTION_TYPES.has(question.type) ? (
                  <MicroclimateQuestionEditor
                    key={question.key}
                    question={question}
                    order={index + 1}
                    language={values.language}
                    nextKey={state.nextKey}
                    disabled={busy}
                    onChange={(next) => state.setQuestions((all) => all.map((item) => (item.key === question.key ? next : item)))}
                    onRemove={() => state.setQuestions((all) => all.filter((item) => item.key !== question.key))}
                  />
                ) : (
                  <QuestionRow
                    key={question.key}
                    question={question}
                    order={index + 1}
                    total={values.questions.length}
                    language={values.language}
                    disabled={busy}
                    state={state}
                  />
                ),
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={busy}
                    className="h-10 w-full rounded-xl border-dashed text-fg-secondary"
                  >
                    <Plus aria-hidden="true" />
                    {t('microclimates.next.create.addQuestion')}
                    <span className="font-normal text-fg-light">{t('microclimates.next.create.addQuestionHint')}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center">
                  <DropdownMenuItem onSelect={() => state.setQuestions((all) => [...all, emptyQuestion(state.nextKey())])}>
                    {t('microclimates.next.create.addBlank')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setLibraryOpen(true)}>
                    {t('microclimates.next.create.addFromLibrary')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <QuestionLibraryBrowser
                open={libraryOpen}
                onOpenChange={setLibraryOpen}
                companyId={companyId ?? null}
                allowedTypes={QUESTION_TYPES}
                typeLabel={(type) => questionTypeLabel(t, type)}
                onAdd={(picked) => state.setQuestions((all) => [...all, ...picked.map((item) => questionFromLibrary(item, state.nextKey()))])}
              />

              <span className="text-sm text-fg-light">
                {state.templates.length === 0
                  ? t('microclimates.next.create.templateNone', { company: companyName ?? t('microclimates.next.create.theCompany') })
                  : t('microclimates.next.create.templateSome')}
              </span>
            </CanvasCard>

            <CanvasCard title={t('microclimates.next.create.audienceTitle')}>
              <div className="flex min-w-0 flex-col gap-1.5">
                <FieldLabel htmlFor={expectedId}>{t('microclimates.next.create.expected')}</FieldLabel>
                <Input
                  id={expectedId}
                  type="number"
                  min={1}
                  inputMode="numeric"
                  className="w-30 font-mono tabular-nums"
                  value={values.targetParticipantCount}
                  disabled={busy}
                  onChange={(event) => state.patch({ targetParticipantCount: event.target.value })}
                />
                <span className="text-sm leading-normal text-fg-tertiary">
                  {state.previous && String(state.previous.targetParticipantCount) === values.targetParticipantCount.trim()
                    ? t('microclimates.next.create.expectedSame')
                    : t('microclimates.next.create.expectedHint')}
                </span>
              </div>
              <RadioGroupPrimitive.Root
                aria-label={t('microclimates.next.create.howTheyAnswer')}
                value={values.anonymousResponses ? 'anonymous' : 'identified'}
                onValueChange={(value) => state.patch({ anonymousResponses: value === 'anonymous' })}
                disabled={busy}
                className="grid grid-cols-1 gap-3 md:grid-cols-2"
              >
                <AnswerCard
                  value="anonymous"
                  selected={values.anonymousResponses}
                  title={t('microclimates.anonymousShort')}
                  body={t('microclimates.next.create.anonymousBody')}
                />
                <AnswerCard
                  value="identified"
                  selected={!values.anonymousResponses}
                  title={t('microclimates.identifiedShort')}
                  body={t('microclimates.next.create.identifiedBody')}
                />
              </RadioGroupPrimitive.Root>
              <NoteBand icon={<Users />}>{t('microclimates.next.create.noDepartmentFilter')}</NoteBand>
            </CanvasCard>

            <CanvasCard title={t('microclimates.next.create.scheduleTitle')}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <DateTimeField
                  id={startId}
                  label={t('microclimates.next.create.opens')}
                  value={values.startTime}
                  disabled={busy}
                  onChange={(startTime) => state.patch({ startTime })}
                />
                <DateTimeField
                  id={endId}
                  label={t('microclimates.next.create.closes')}
                  value={values.endTime}
                  disabled={busy}
                  onChange={(endTime) => state.patch({ endTime })}
                />
              </div>
              <p className="m-0 flex items-center gap-2 text-sm text-fg-tertiary">
                <Clock aria-hidden="true" className="size-3.5 shrink-0" />
                <span>
                  {t('microclimates.next.create.timezone', { timezone })}{' '}
                  {window === null
                    ? t('microclimates.validationEndAfterStart')
                    : windowSentence(t, locale, window, start, end)}
                </span>
              </p>
            </CanvasCard>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <CanvasCard title={t('microclimates.next.create.previewTitle')} inset="side" aside={<Chip label={t('microclimates.next.create.phone')} />}>
              <RespondentPreview values={values} />
            </CanvasCard>
            <CanvasCard title={t('microclimates.next.create.summaryTitle')} inset="side">
              <FactList
                termWidth="sm"
                size="sm"
                facts={[
                  { id: 'questions', term: t('microclimates.next.create.summaryQuestions'), value: questionsPhrase(t, values) },
                  {
                    id: 'expected',
                    term: t('microclimates.next.create.summaryExpected'),
                    value: <span className="font-mono tabular-nums">{values.targetParticipantCount.trim() || '0'}</span>,
                  },
                  {
                    id: 'answer',
                    term: t('microclimates.next.create.summaryAnswer'),
                    value: t('microclimates.next.create.summaryAnswerValue', {
                      mode: values.anonymousResponses ? t('microclimates.anonymousShort') : t('microclimates.identifiedShort'),
                      floor: FLOOR,
                    }),
                  },
                  {
                    id: 'open',
                    term: t('microclimates.next.create.summaryOpen'),
                    value:
                      window === null
                        ? t('microclimates.next.create.summaryOpenUnset')
                        : t('microclimates.next.create.summaryOpenValue', {
                            length: lengthPhrase(t, window),
                            from: weekdayDay(start, locale),
                            to: weekdayDay(end, locale),
                          }),
                  },
                  {
                    id: 'words',
                    term: t('microclimates.next.create.summaryWords'),
                    value: values.questions.some((question) => question.type === 'open_ended')
                      ? t('microclimates.next.create.summaryWordsProtected', { floor: FLOOR })
                      : t('microclimates.next.create.summaryWordsNone'),
                  },
                ]}
              />
              <Button variant="primary" className="w-full" disabled={busy} onClick={state.launch}>
                <Send aria-hidden="true" />
                {state.submitting === 'launch' ? t('common.creating') : t('microclimates.next.create.launch')}
              </Button>
              <span className="text-sm text-fg-tertiary">{launchNote(t, locale, values)}</span>
            </CanvasCard>
          </div>
        </div>
      </div>
    </div>
  )
}

function FieldLabel({ htmlFor, required, children }: { htmlFor: string; required?: boolean; children: string }) {
  const { t } = useTranslation()
  return (
    <label htmlFor={htmlFor} className="text-sm font-semibold text-fg-secondary">
      {children}
      {required && (
        <span className="text-accent-red-ink" aria-label={t('microclimates.next.create.required')}>
          {' *'}
        </span>
      )}
    </label>
  )
}

function StartFromRow({ state }: { state: MicroclimateCreateState }) {
  const { t } = useTranslation()
  const labelId = useId()
  const copied = state.previous
    ? t('microclimates.next.create.copiedFrom', {
        name: state.previous.title ?? t('microclimates.untitled'),
        count: state.previous.questions.length,
      })
    : ''
  const hint =
    state.startFrom === 'previous'
      ? copied
      : state.startFrom === 'template'
        ? state.templates.length === 0
          ? t('microclimates.next.create.noTemplatesHint')
          : t('microclimates.next.create.templateHint')
        : t('microclimates.next.create.blankHint')
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <span id={labelId} className="text-sm font-semibold text-fg-secondary">
        {t('microclimates.next.create.startFrom')}
      </span>
      <RadioGroupPrimitive.Root
        aria-labelledby={labelId}
        value={state.startFrom}
        onValueChange={(next) => state.setStartFrom(next as StartFrom)}
        disabled={state.submitting !== null}
        orientation="horizontal"
        className="inline-flex shrink-0 gap-0.5 rounded-lg border border-line-default bg-surface-icon-box p-0.75"
      >
        {(['previous', 'template', 'blank'] as const).map((option) => (
          <RadioGroupPrimitive.Item
            key={option}
            value={option}
            disabled={option === 'previous' && !state.previous}
            className={cn(
              'inline-flex h-6 items-center justify-center whitespace-nowrap rounded-md border-0 px-2.5 text-sm font-medium',
              'data-[state=checked]:bg-surface-card data-[state=checked]:text-fg-primary data-[state=checked]:shadow-xs',
              'data-[state=unchecked]:bg-transparent data-[state=unchecked]:text-fg-tertiary',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {t(START_KEY[option])}
          </RadioGroupPrimitive.Item>
        ))}
      </RadioGroupPrimitive.Root>
      <span className="text-sm text-fg-tertiary">{hint}</span>
    </div>
  )
}

function QuestionRow({
  question,
  order,
  total,
  language,
  disabled,
  state,
}: {
  question: WizardQuestionValues
  order: number
  total: number
  language: ContentLanguage
  disabled: boolean
  state: MicroclimateCreateState
}) {
  const { t } = useTranslation()
  const switchId = useId()
  const update = (next: Partial<WizardQuestionValues>) =>
    state.setQuestions((all) => all.map((item) => (item.key === question.key ? { ...item, ...next } : item)))
  const move = (delta: number) =>
    state.setQuestions((all) => {
      const index = all.findIndex((item) => item.key === question.key)
      const target = index + delta
      if (index < 0 || target < 0 || target >= all.length) return all
      const copy = [...all]
      const [moved] = copy.splice(index, 1)
      copy.splice(target, 0, moved as WizardQuestionValues)
      return copy
    })
  const changeType = (type: string) =>
    update({
      type,
      emojiOptions: type === 'emoji_rating' && question.emojiOptions.length === 0 ? defaultEmojiScale(state.nextKey) : question.emojiOptions,
    })

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line-default px-3 pt-2.5 pb-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <GripVertical aria-hidden="true" className="size-4 shrink-0 text-fg-light" />
        <span className="inline-flex size-5.5 shrink-0 items-center justify-center rounded-full bg-surface-icon-box font-mono text-xs font-semibold tabular-nums text-fg-secondary">
          {order}
        </span>
        <Chip label={canvasTypeLabel(t, question.type)} />
        <span className="flex-1" />
        <span className="inline-flex items-center gap-2 text-sm text-fg-secondary">
          <Switch
            id={switchId}
            checked={question.required}
            disabled={disabled}
            onCheckedChange={(required) => update({ required })}
            className="data-[state=checked]:bg-accent-green"
          />
          <label htmlFor={switchId}>
            {question.required ? t('microclimates.next.create.required') : t('microclimates.next.create.optional')}
          </label>
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              disabled={disabled}
              aria-label={t('microclimates.next.create.questionMenu', { order })}
            >
              <Ellipsis aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t('microclimates.next.create.questionType')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={question.type} onValueChange={changeType}>
              {QUESTION_TYPES.map((type) => (
                <DropdownMenuRadioItem key={type} value={type}>
                  {canvasTypeLabel(t, type)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={order === 1} onSelect={() => move(-1)}>
              {t('microclimates.next.create.moveUp')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={order === total} onSelect={() => move(1)}>
              {t('microclimates.next.create.moveDown')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => state.setQuestions((all) => all.filter((item) => item.key !== question.key))}>
              {t('microclimates.removeQuestion')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {language === 'both' ? (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <Input
            aria-label={t('microclimates.questionTextEn')}
            value={question.textEn}
            disabled={disabled}
            onChange={(event) => update({ textEn: event.target.value })}
          />
          <Input
            aria-label={t('microclimates.questionTextEs')}
            value={question.textEs}
            disabled={disabled}
            onChange={(event) => update({ textEs: event.target.value })}
          />
        </div>
      ) : (
        <Input
          aria-label={t('microclimates.next.create.questionText', { order })}
          value={language === 'es' ? question.textEs : question.textEn}
          disabled={disabled}
          onChange={(event) => update(language === 'es' ? { textEs: event.target.value } : { textEn: event.target.value })}
        />
      )}
      {question.type === 'open_ended' && (
        <span className="text-sm leading-normal text-fg-tertiary">{t('microclimates.next.create.wordsHint', { floor: FLOOR })}</span>
      )}
    </div>
  )
}

function AnswerCard({ value, selected, title, body }: { value: string; selected: boolean; title: string; body: string }) {
  return (
    <RadioGroupPrimitive.Item
      value={value}
      className={cn(
        'flex h-auto items-start justify-start gap-2.5 rounded-xl border px-3.5 py-3 text-left font-normal',
        selected ? 'border-fg-primary bg-surface-card' : 'border-line-default bg-surface-outer',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px] bg-surface-card',
          selected ? 'border-fg-primary' : 'border-line-hover',
        )}
      >
        {selected && <span className="size-2 rounded-full bg-fg-primary" />}
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-base font-semibold text-fg-primary">{title}</span>
        <span className="text-sm leading-normal text-fg-secondary">{body}</span>
      </span>
    </RadioGroupPrimitive.Item>
  )
}

function DateTimeField({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string
  label: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-fg-secondary">
        {label}
      </label>
      <div className="relative">
        <CalendarDays aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-light" />
        <Input
          id={id}
          type="datetime-local"
          className="pl-8 font-mono tabular-nums"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  )
}

/** What the respondent's phone will show: the questions in order, nothing answerable. */
function RespondentPreview({ values }: { values: MicroclimateWizardValues }) {
  const { t } = useTranslation()
  const title = textIn(values.language, values.titleEn, values.titleEs).trim() || t('microclimates.untitled')
  const total = values.questions.length
  return (
    <div className="flex flex-col gap-3.5 rounded-[0.75rem] border border-line-default bg-surface-outer p-4">
      <span className="font-store-serif text-xl leading-tight text-fg-primary">{title}</span>
      <span className="self-start">
        {values.anonymousResponses ? (
          <Chip tone="good" icon={<ShieldCheck />} label={t('microclimates.respondAnonymityChip')} />
        ) : (
          <Chip label={t('microclimates.identifiedShort')} />
        )}
      </span>
      {values.questions.map((question, index) => {
        const text = textIn(values.language, question.textEn, question.textEs).trim() || t('microclimates.next.create.previewEmpty')
        return (
          <div key={question.key} className="flex flex-col gap-2.5 rounded-xl border border-line-default bg-surface-card p-3">
            <span className="text-base font-semibold text-fg-primary">
              <span className="mr-1 rounded-md bg-surface-icon-box px-1.5 py-px font-mono text-xs font-medium text-fg-secondary">
                {t('microclimates.next.create.previewPosition', { position: index + 1, total })}
              </span>{' '}
              {text}
              {!question.required && (
                <span className="font-normal text-fg-tertiary"> {t('microclimates.next.create.previewOptional')}</span>
              )}
            </span>
            <PreviewAnswer question={question} language={values.language} />
          </div>
        )
      })}
      <span className="inline-flex h-8 items-center self-start rounded-md border border-line-default px-3 text-base font-medium text-fg-light">
        {t('microclimates.next.create.previewSubmit')}
      </span>
    </div>
  )
}

function PreviewAnswer({ question, language }: { question: WizardQuestionValues; language: ContentLanguage }) {
  const { t } = useTranslation()
  const box = 'inline-flex h-8.5 min-w-0 flex-1 items-center justify-center rounded-md border border-line-default bg-surface-card px-1 text-base text-fg-secondary'
  if (question.type === 'open_ended') {
    return (
      <span className="inline-flex h-8 items-center rounded-md border border-line-default bg-surface-card px-2.5 text-base text-fg-light">
        {t('microclimates.next.type.openEnded')}
      </span>
    )
  }
  const labels =
    question.type === 'yes_no'
      ? [t('common.yes'), t('common.no')]
      : question.type === 'multiple_choice'
        ? question.options.map((option) => textIn(language, option.labelEn, option.labelEs) || '·')
        : question.type === 'emoji_rating'
          ? question.emojiOptions.map((face) => face.emoji || '·')
          : ['1', '2', '3', '4', '5']
  return (
    <span className="flex flex-wrap gap-1.5">
      {labels.map((label, index) => (
        <span key={`${label}-${index}`} className={cn(box, 'font-mono tabular-nums')}>
          {label}
        </span>
      ))}
    </span>
  )
}

const ONE_KEY: Record<string, string> = {
  likert: 'microclimates.next.create.typeLikertOne',
  open_ended: 'microclimates.next.create.typeWordOne',
}
const MANY_KEY: Record<string, string> = {
  likert: 'microclimates.next.create.typeLikertMany',
  open_ended: 'microclimates.next.create.typeWordMany',
}

/** "2 · una escala, una palabra". */
function questionsPhrase(t: TranslateFn, values: MicroclimateWizardValues): string {
  const parts = typeCounts(values.questions).map(({ type, count }) => {
    const label = canvasTypeLabel(t, type).toLocaleLowerCase()
    if (count === 1) return t(ONE_KEY[type] ?? 'microclimates.next.create.typeOtherOne', { label })
    return t(MANY_KEY[type] ?? 'microclimates.next.create.typeOtherMany', { label, count })
  })
  return parts.length === 0
    ? t('microclimates.next.create.summaryNoQuestions')
    : t('microclimates.next.create.summaryQuestionsValue', { count: values.questions.length, types: parts.join(', ') })
}

function lengthPhrase(t: TranslateFn, ms: number): string {
  const length = windowLength(ms)
  return length.unit === 'hours'
    ? t(length.value === 1 ? 'microclimates.next.create.hourOne' : 'microclimates.next.create.hours', { count: length.value })
    : t('microclimates.next.create.minutes', { count: length.value })
}

/** "Abierto 48 horas, de lunes a miércoles." */
function windowSentence(t: TranslateFn, locale: string, ms: number, start: Date, end: Date): string {
  const from = weekdayLong(start, locale)
  const to = weekdayLong(end, locale)
  return from === to && ms < 24 * 3_600_000
    ? t('microclimates.next.create.openSameDay', { length: lengthPhrase(t, ms), day: from })
    : t('microclimates.next.create.openFromTo', { length: lengthPhrase(t, ms), from, to })
}

/**
 * The line under "Lanzar", said as the server does it: launching opens the session at once
 * (`SubmitResponseAsync` checks the status and nothing else) and the sweep closes it at the
 * end (`MicroclimateLifecycleSchedule.cs`). A future opening time does not delay it, so the
 * line says that too instead of promising the board's "lista para abrir el 14 sept".
 */
function launchNote(t: TranslateFn, locale: string, values: MicroclimateWizardValues): string {
  const window = windowMs(values.startTime, values.endTime)
  if (window === null) return t('microclimates.next.create.launchNoteUnset')
  const start = new Date(values.startTime)
  const end = new Date(values.endTime)
  if (start.getTime() > Date.now() + 60_000) {
    return t('microclimates.next.create.launchNoteFuture', {
      date: shortDay(start.toISOString(), locale),
      time: clock(start.toISOString(), locale),
    })
  }
  return t('microclimates.next.create.launchNote', {
    date: shortDay(end.toISOString(), locale),
    time: clock(end.toISOString(), locale),
  })
}
