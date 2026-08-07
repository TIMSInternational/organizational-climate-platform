import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from '../../../i18n'
import { useCompanyScope } from '../../../company-context'
import { PageTopBar } from '../../../components/layout'
import { WizardStepper, type WizardStep } from '../../../components/wizard'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  CheckboxField,
  EmptyState,
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
  Input,
  SelectField,
  Table,
  TextField,
  TextareaField,
} from '../../../components/ui'
import { createMicroclimate } from '../api/microclimates'
import { listMicroclimateTemplates, type MicroclimateTemplate } from '../api/microclimateTemplates'
import MicroclimateQuestionEditor from '../components/MicroclimateQuestionEditor'
import { languageLabel, questionTypeLabel } from '../microclimateVocabulary'
import {
  CONTENT_LANGUAGES,
  WIZARD_STEPS,
  buildCreateInput,
  emptyQuestion,
  emptyWizardValues,
  needsBothLanguages,
  scheduledMinutes,
  wizardStepErrors,
  type ContentLanguage,
  type MicroclimateWizardValues,
} from '../wizardValues'

/**
 * The catalogue paths for each step's heading, written out rather than assembled
 * from the step id.
 *
 * A computed key path (`microclimates.step${id}`) is invisible to anyone grepping for
 * where a string is used, and it returns the key path itself — on screen — when a
 * rename catches one half of the pair. The property names are `nameKey`/
 * `descriptionKey` rather than `label`/`blurb` on purpose: the #217 guard flags a
 * property called `label` or `blurb` holding prose, and it cannot tell a catalogue
 * path from the copy it points at.
 */
const STEP_KEYS: Record<
  (typeof WIZARD_STEPS)[number],
  { nameKey: string; descriptionKey: string }
> = {
  basics: {
    nameKey: 'microclimates.stepBasics',
    descriptionKey: 'microclimates.stepBasicsDescription',
  },
  schedule: {
    nameKey: 'microclimates.stepSchedule',
    descriptionKey: 'microclimates.stepScheduleDescription',
  },
  audience: {
    nameKey: 'microclimates.stepAudience',
    descriptionKey: 'microclimates.stepAudienceDescription',
  },
  questions: {
    nameKey: 'microclimates.stepQuestions',
    descriptionKey: 'microclimates.stepQuestionsDescription',
  },
  review: {
    nameKey: 'microclimates.stepReview',
    descriptionKey: 'microclimates.stepReviewDescription',
  },
}

/**
 * The template picker's "none" option.
 *
 * Not `''`: Radix's `SelectItem` throws on an empty-string value, which it reserves
 * for "nothing is selected". The wizard's own state keeps `''` for no template —
 * that is what `buildCreateInput` turns into an omitted `templateId` — and this
 * sentinel exists only between the two.
 */
const NO_TEMPLATE = 'none'

/**
 * #127 — creating a microclimate, one decision at a time.
 *
 * ## Why a wizard replaces the inline form
 *
 * `MicroclimateForm` was a single panel that appeared under a toggle on the list
 * page, with eleven controls, no per-field validation and one English `setError`
 * string for every failure. Everything it collected is still collected here; what
 * changes is that a wrong answer is attached to the field that produced it and the
 * admin sees what they are about to create before it exists.
 *
 * ## The steps come from the DTO
 *
 * See `wizardValues.ts` for the full argument, including the four things the issue
 * asks for that the current backend cannot store (department targeting, autosave, a
 * question bank, distribution controls) and are therefore not faked here.
 *
 * ## Two things this page states out loud rather than hiding
 *
 * 1. **It always creates a draft.** `CreateAsync` hardcodes `Status = "draft"`, so
 *    there is no "create and launch". The review step says so, and the page
 *    navigates to the session where launching actually happens.
 * 2. **A template does not fill in the questions.** `MicroclimateTemplate` carries a
 *    name, a description and a category — no questions — and `CreateAsync` uses the
 *    id only to validate scope and bump `UsageCount`. A picker that looked like it
 *    would populate the form and then did nothing is worse than a labelled reference.
 *
 * ## Zero new lint warnings
 *
 * `--max-warnings 10` is exactly full, so the template fetch is a `useCallback`
 * listed in its own effect's dependency array rather than a function called from an
 * effect with `[companyId]`. Same shape as `SurveysListPage`.
 */
export default function MicroclimateCreatePage() {
  const { t, locale } = useTranslation()
  const navigate = useNavigate()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const scope = useCompanyScope()
  const companyId = scope.companyId

  // Seeded from the reader's UI locale rather than hardcoded to English. The server
  // defaults to `company.Settings.Language` when the field is omitted, and this form
  // always sends it, so the seed is what an admin is most likely to want rather than
  // a claim about the company.
  const [values, setValues] = useState<MicroclimateWizardValues>(() =>
    emptyWizardValues(locale === 'es' ? 'es' : 'en'),
  )
  const [stepIndex, setStepIndex] = useState(0)
  const [templates, setTemplates] = useState<MicroclimateTemplate[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // A counter rather than an index: removing the second of three questions must not
  // renumber the third's React key, or the browser moves focus and the DOM state of
  // every field below it shifts up one row.
  const keyCounter = useRef(0)
  const nextKey = useCallback(() => {
    keyCounter.current += 1
    return `k${keyCounter.current}`
  }, [])

  const loadTemplates = useCallback(async () => {
    if (!companyId) return
    try {
      setTemplates(await listMicroclimateTemplates(baseUrl, companyId))
    } catch {
      // Deliberately silent, and the only silent catch on this page. Templates are a
      // reference field: if the list cannot be fetched the picker is simply absent,
      // and blocking creation of a microclimate because an optional attribution
      // lookup failed would be the wrong trade.
      setTemplates([])
    }
  }, [baseUrl, companyId])

  useEffect(() => {
    void loadTemplates()
  }, [loadTemplates])

  const errors = useMemo(() => wizardStepErrors(values, t), [values, t])
  const bilingual = needsBothLanguages(values.language)
  const minutes = scheduledMinutes(values)
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])

  const steps: WizardStep[] = WIZARD_STEPS.map((id) => ({
    id,
    label: t(STEP_KEYS[id].nameKey),
    description: t(STEP_KEYS[id].descriptionKey),
    errors: errors[id],
  }))

  function patch(next: Partial<MicroclimateWizardValues>): void {
    setValues((current) => ({ ...current, ...next }))
  }

  async function handleSubmit(): Promise<void> {
    if (!companyId) return
    setSubmitError(null)
    setSubmitting(true)
    try {
      const created = await createMicroclimate(baseUrl, buildCreateInput(values, companyId))
      navigate(`/microclimates/${created.id}`)
    } catch (err) {
      // The server's own message, verbatim: it names the question and the option that
      // a client-side guess could only describe in general terms.
      setSubmitError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  if (scope.status === 'needs-selection') {
    return (
      <EmptyState
        title={t('companyContext.chooseACompany')}
        description={t('companyContext.chooseACompanyDescription')}
      />
    )
  }

  if (scope.status === 'no-company') {
    return <p role="alert">{t('common.noCompanyAssociated')}</p>
  }

  const currentStep = WIZARD_STEPS[stepIndex]

  return (
    <div>
      <PageTopBar
        title={t('microclimates.wizardTitle')}
        description={t('microclimates.wizardDescription')}
        breadcrumbs={[
          { label: t('navigation.microclimates'), href: '/microclimates' },
          { label: t('microclimates.wizardTitle') },
        ]}
      />

      {submitError && (
        <Alert variant="destructive" role="alert" className="mb-panel-gap">
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      )}

      <WizardStepper
        steps={steps}
        currentIndex={stepIndex}
        onNavigate={setStepIndex}
        onSubmit={() => void handleSubmit()}
        submitLabel={submitting ? t('common.creating') : t('microclimates.wizardCreate')}
        progressLabel={t('microclimates.wizardStepOf', {
          current: stepIndex + 1,
          total: WIZARD_STEPS.length,
        })}
        stepListLabel={t('microclimates.wizardTitle')}
        submitting={submitting}
      >
        {currentStep === 'basics' && (
          <>
            <SelectField
              label={t('microclimates.contentLanguage')}
              description={t('microclimates.contentLanguageDescription')}
              value={values.language}
              onChange={(language) => patch({ language: language as ContentLanguage })}
              options={CONTENT_LANGUAGES.map((language) => ({
                value: language,
                label: languageLabel(t, language),
              }))}
              disabled={submitting}
            />

            {bilingual ? (
              <div className="grid gap-panel-gap md:grid-cols-2">
                <TextField
                  label={t('microclimates.titleEn')}
                  value={values.titleEn}
                  onChange={(titleEn) => patch({ titleEn })}
                  disabled={submitting}
                  required
                />
                <TextField
                  label={t('microclimates.titleEs')}
                  value={values.titleEs}
                  onChange={(titleEs) => patch({ titleEs })}
                  disabled={submitting}
                  required
                />
              </div>
            ) : (
              <TextField
                label={t('microclimates.title')}
                value={values.language === 'es' ? values.titleEs : values.titleEn}
                onChange={(value) =>
                  patch(values.language === 'es' ? { titleEs: value } : { titleEn: value })
                }
                disabled={submitting}
                required
              />
            )}

            {bilingual ? (
              <div className="grid gap-panel-gap md:grid-cols-2">
                <TextareaField
                  label={t('microclimates.descriptionEn')}
                  description={t('microclimates.descriptionHint')}
                  value={values.descriptionEn}
                  onChange={(descriptionEn) => patch({ descriptionEn })}
                  rows={3}
                  disabled={submitting}
                />
                <TextareaField
                  label={t('microclimates.descriptionEs')}
                  value={values.descriptionEs}
                  onChange={(descriptionEs) => patch({ descriptionEs })}
                  rows={3}
                  disabled={submitting}
                />
              </div>
            ) : (
              <TextareaField
                label={t('microclimates.descriptionField')}
                description={t('microclimates.descriptionHint')}
                value={values.language === 'es' ? values.descriptionEs : values.descriptionEn}
                onChange={(value) =>
                  patch(
                    values.language === 'es'
                      ? { descriptionEs: value }
                      : { descriptionEn: value },
                  )
                }
                rows={3}
                disabled={submitting}
              />
            )}
          </>
        )}

        {currentStep === 'schedule' && (
          <>
            <div className="grid gap-panel-gap md:grid-cols-2">
              {/* `datetime-local` rather than the `DatePicker` primitive: a
                  microclimate is minutes long, so a date with no time would make the
                  whole schedule meaningless. `FormItem`/`FormControl` still supply the
                  id and label wiring `TextField` would have — `TextField` simply has
                  no `datetime-local` in its type union. */}
              <FormItem>
                <FormLabel>{t('microclimates.startTime')}</FormLabel>
                <FormControl>
                  <Input
                    type="datetime-local"
                    value={values.startTime}
                    onChange={(event) => patch({ startTime: event.target.value })}
                    disabled={submitting}
                  />
                </FormControl>
              </FormItem>
              <FormItem>
                <FormLabel>{t('microclimates.endTime')}</FormLabel>
                <FormControl>
                  <Input
                    type="datetime-local"
                    value={values.endTime}
                    onChange={(event) => patch({ endTime: event.target.value })}
                    disabled={submitting}
                  />
                </FormControl>
                <FormDescription>
                  {t('microclimates.timezoneNotice', { timezone })}
                </FormDescription>
              </FormItem>
            </div>

            {minutes !== null && (
              <p className="m-0 text-fg-secondary">
                {t('microclimates.scheduleDuration', { minutes })}
              </p>
            )}
          </>
        )}

        {currentStep === 'audience' && (
          <>
            <TextField
              label={t('surveys.targetParticipants')}
              description={t('microclimates.targetParticipantsHint')}
              type="number"
              value={values.targetParticipantCount}
              onChange={(targetParticipantCount) => patch({ targetParticipantCount })}
              disabled={submitting}
              required
            />
            <CheckboxField
              label={t('microclimates.anonymousResponses')}
              description={
                values.anonymousResponses
                  ? t('microclimates.anonymousHint')
                  : t('microclimates.identifiedHint')
              }
              checked={values.anonymousResponses}
              onChange={(anonymousResponses) => patch({ anonymousResponses })}
              disabled={submitting}
            />
            {templates.length > 0 && (
              <SelectField
                label={t('actionPlans.startFromTemplate')}
                description={t('microclimates.templateHint')}
                value={values.templateId === '' ? NO_TEMPLATE : values.templateId}
                onChange={(templateId) =>
                  patch({ templateId: templateId === NO_TEMPLATE ? '' : templateId })
                }
                options={[
                  { value: NO_TEMPLATE, label: t('microclimates.noTemplate') },
                  ...templates.map((template) => ({ value: template.id, label: template.name })),
                ]}
                disabled={submitting}
              />
            )}
          </>
        )}

        {currentStep === 'questions' && (
          <>
            <p className="m-0 text-fg-secondary">{t('microclimates.questionsHint')}</p>
            {values.questions.length === 0 ? (
              <EmptyState
                title={t('microclimates.validationQuestionsRequired')}
                description={t('microclimates.questionsHint')}
              />
            ) : (
              values.questions.map((question, index) => (
                <MicroclimateQuestionEditor
                  key={question.key}
                  question={question}
                  order={index + 1}
                  language={values.language}
                  nextKey={nextKey}
                  disabled={submitting}
                  onChange={(next) =>
                    patch({
                      questions: values.questions.map((candidate) =>
                        candidate.key === question.key ? next : candidate,
                      ),
                    })
                  }
                  onRemove={() =>
                    patch({
                      questions: values.questions.filter(
                        (candidate) => candidate.key !== question.key,
                      ),
                    })
                  }
                />
              ))
            )}
            <div>
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() => patch({ questions: [...values.questions, emptyQuestion(nextKey())] })}
              >
                {t('surveys.addQuestion')}
              </Button>
            </div>
          </>
        )}

        {currentStep === 'review' && (
          <>
            <Table>
              <tbody>
                <tr>
                  <th scope="row">{t('microclimates.reviewTitleLabel')}</th>
                  <td>
                    {bilingual
                      ? `${values.titleEn} / ${values.titleEs}`
                      : values.language === 'es'
                        ? values.titleEs
                        : values.titleEn}
                  </td>
                </tr>
                <tr>
                  <th scope="row">{t('microclimates.descriptionField')}</th>
                  <td>
                    {values.descriptionEn.trim() || values.descriptionEs.trim() ? (
                      bilingual ? (
                        `${values.descriptionEn} / ${values.descriptionEs}`
                      ) : values.language === 'es' ? (
                        values.descriptionEs
                      ) : (
                        values.descriptionEn
                      )
                    ) : (
                      <span className="text-fg-secondary">
                        {t('microclimates.reviewNoDescription')}
                      </span>
                    )}
                  </td>
                </tr>
                <tr>
                  <th scope="row">{t('microclimates.contentLanguage')}</th>
                  <td>{languageLabel(t, values.language)}</td>
                </tr>
                <tr>
                  <th scope="row">{t('microclimates.startTime')}</th>
                  <td>{new Date(values.startTime).toLocaleString(locale)}</td>
                </tr>
                <tr>
                  <th scope="row">{t('microclimates.endTime')}</th>
                  <td>{new Date(values.endTime).toLocaleString(locale)}</td>
                </tr>
                <tr>
                  <th scope="row">{t('surveys.targetParticipants')}</th>
                  <td>{values.targetParticipantCount}</td>
                </tr>
                <tr>
                  <th scope="row">{t('microclimates.anonymousResponses')}</th>
                  <td>
                    {values.anonymousResponses
                      ? t('microclimates.anonymousShort')
                      : t('microclimates.identifiedShort')}
                  </td>
                </tr>
                <tr>
                  <th scope="row">{t('surveys.questions')}</th>
                  <td>
                    {t('microclimates.reviewQuestionCount', { count: values.questions.length })}
                  </td>
                </tr>
              </tbody>
            </Table>

            <Table>
              <thead>
                <tr>
                  <th>{t('common.order')}</th>
                  <th>{t('surveys.questionText')}</th>
                  <th>{t('common.type')}</th>
                  <th>{t('common.required')}</th>
                </tr>
              </thead>
              <tbody>
                {values.questions.map((question, index) => (
                  <tr key={question.key}>
                    <td>{index + 1}</td>
                    <td>
                      {bilingual
                        ? `${question.textEn} / ${question.textEs}`
                        : values.language === 'es'
                          ? question.textEs
                          : question.textEn}
                    </td>
                    <td>{questionTypeLabel(t, question.type)}</td>
                    <td>{question.required ? t('common.yes') : t('common.no')}</td>
                  </tr>
                ))}
              </tbody>
            </Table>

            {/* Not an error and not a warning: it is what the server is going to do,
                said before it happens rather than discovered afterwards on a session
                that is not collecting anything. */}
            <Alert>
              <AlertDescription>
                <span className="flex flex-wrap items-center gap-inline">
                  <Badge variant="secondary">{t('microclimates.statusDraft')}</Badge>
                  {t('microclimates.wizardCreatedAsDraft')}
                </span>
              </AlertDescription>
            </Alert>
          </>
        )}
      </WizardStepper>
    </div>
  )
}
