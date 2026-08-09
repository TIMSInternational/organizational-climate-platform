import { useCallback, useEffect, useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { Plus, Trash2 } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { WizardStepper, type WizardStep } from '../../../components/wizard'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CheckboxField,
  SelectField,
  Separator,
  TextField,
  TextareaField,
} from '../../../components/ui'
import { useCompanyScope } from '../../../company-context'
import { listDepartments, type Department } from '../../org-structure/api/departments'
import { createSurvey } from '../api/surveyCreate'
import {
  getSurveyTemplate,
  instantiateSurveyTemplate,
  listSurveyTemplates,
  type SurveyTemplateDetail,
  type SurveyTemplateListItem,
} from '../api/surveyTemplates'
import SurveyQuestionList from '../components/SurveyQuestionList'
import { useSurveyDraft } from '../useSurveyDraft'
import {
  SurveyDraftIndicator,
  SurveyDraftRecoveryBanner,
} from '../components/SurveyDraftNotices'
import {
  CONTENT_LANGUAGES,
  SURVEY_WIZARD_STEPS,
  buildCreateInput,
  buildInstantiateInput,
  emptyOption,
  emptyQuestion,
  emptyWizardValues,
  needsBothLanguages,
  scheduledDays,
  startsFromTemplate,
  wizardStepErrors,
  type ContentLanguage,
  type SurveyWizardValues,
} from '../wizardValues'
import {
  SURVEY_QUESTION_TYPES,
  SURVEY_TYPES,
  languageLabel,
  needsOptions,
  questionTypeLabel,
  typeLabel,
} from '../surveyVocabulary'

/**
 * The "no template" and "every category" sentinels.
 *
 * A `<Select>` option cannot carry an empty string as its value -- Radix reserves `''`
 * for "nothing is selected" and renders the placeholder instead of the row. The wizard's
 * own state keeps `''` for both, which is what `startsFromTemplate` and the unfiltered
 * catalogue query read; these exist only on the wire between state and control. The
 * microclimate wizard has the identical pair for the identical reason.
 */
const NO_TEMPLATE = '__none__'
const ALL_CATEGORIES = '__all__'

/**
 * The survey creation wizard — `/surveys/new`.
 *
 * ## Why this page did not exist
 *
 * `POST /surveys` has been implemented since #104 and nothing in the frontend ever
 * called it. There was no create route, no create button and no `createSurvey` in the
 * API client, so a survey could not be made from inside the product at all — which is
 * why the surveys list is empty in every environment. `surveyTemplates.ts` says the
 * quiet part out loud in its own docstring: "Choosing one belongs to the wizard
 * (#108), which can also supply the localized title". This is that wizard.
 *
 * ## It is the microclimate wizard's sibling, on purpose
 *
 * Same `WizardStepper`, same step order (basics → schedule → audience → questions →
 * review), same validation-is-the-page's/gating-is-the-stepper's split, same
 * `wizardValues.ts` shape. `WizardStepper` was extracted for exactly this and had one
 * caller until now. An admin who has created a microclimate already knows this flow.
 *
 * ## Starting from a template (#267)
 *
 * The basics step offers the catalogue, defaulting to "start blank". Choosing a template
 * changes which endpoint creates the survey: `POST /survey-templates/{id}/use` instead of
 * `POST /surveys`, with the **server** copying the questions. The questions step becomes
 * a read-only preview.
 *
 * That preview is not a limitation reluctantly accepted, it is the correct behaviour.
 * `SurveyQuestionValues` has no field for an option's `value`, nor for `category`, the
 * scale bounds and labels, `commentRequired` or the comment prompt — all of which a
 * `TemplateQuestion` carries and instantiation copies verbatim. Loading a template into
 * this page's editor and re-creating it through `POST /surveys` would therefore flatten
 * it, invisibly: the survey would look plausible and simply be less than the template,
 * and its option values — what `SurveyAggregation` calls "THE group key" — would be
 * re-derived from labels. `wizardValues.ts` records the full argument.
 *
 * The honest cost is that a template's questions cannot be adjusted on the way through.
 * They cannot be adjusted afterwards either: `PUT /surveys/{id}` can replace them, but no
 * client code calls it and there is no survey question editor. That gap is real, and it
 * is smaller than a template that quietly stops aggregating.
 *
 * The content language is *reported* rather than chosen in template mode. `/use` takes no
 * language and infers it from the template's own questions, which is the only value that
 * cannot produce a survey declaring a language it holds no text for.
 *
 * ## What it deliberately does not do
 *
 * **Launch the survey.** `CreateSurveyRequest` carries no status and `CreateAsync`
 * writes `draft`; `/use` writes `draft` too, so both paths land in the same place.
 * Publishing is a separate guarded transition. The review step says so rather than
 * leaving someone to discover it.
 *
 * **Collect settings it was not asked to.** `SurveySettingsInput` has fifteen members
 * and every one means "leave this alone" when omitted, so the wizard sends the three
 * it actually asks about and lets the server keep its defaults for the rest.
 */
export default function SurveyCreatePage() {
  const { t, locale } = useTranslation()
  const navigate = useNavigate()
  const scope = useCompanyScope()
  const companyId = scope.companyId
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const keyPrefix = useId()

  const [values, setValues] = useState<SurveyWizardValues>(() => emptyWizardValues('en'))
  const [stepIndex, setStepIndex] = useState(0)
  const [departments, setDepartments] = useState<Department[]>([])
  const [templates, setTemplates] = useState<SurveyTemplateListItem[]>([])
  const [templateCategory, setTemplateCategory] = useState('')
  // The chosen template's questions, or null while none is chosen / the fetch is in
  // flight. Null is what makes the questions step block rather than pass vacuously.
  const [template, setTemplate] = useState<SurveyTemplateDetail | null>(null)
  const [templateError, setTemplateError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  // Monotonic, so a key is never reused after a removal — React would otherwise
  // reconcile a new question onto the removed one's DOM and carry its focus over.
  const [nextKey, setNextKey] = useState(0)

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    listDepartments(baseUrl, companyId)
      .then((result) => {
        if (!cancelled) setDepartments(result)
      })
      // A failed department list is not a reason to block the flow: the audience step
      // is optional, and an empty picker still means "every department".
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [baseUrl, companyId])

  useEffect(() => {
    let cancelled = false
    // No companyId is sent: the server scopes the catalogue by role, giving a company
    // admin the global templates plus their own. Sending one would narrow it wrongly.
    listSurveyTemplates(baseUrl, { category: templateCategory }, locale)
      .then((result) => {
        // `Array.isArray` rather than trusting the shape: this list is mapped during
        // render, so a response without a `templates` member throws inside React and
        // white-screens the whole wizard -- a blank create page is a far worse outcome
        // than an empty picker, and the catalogue is the least essential thing here.
        if (!cancelled) setTemplates(Array.isArray(result) ? result : [])
      })
      // Silent, like the microclimate wizard's: templates are an accelerator, and an
      // author who cannot see the catalogue can still build a survey by hand.
      .catch(() => {
        if (!cancelled) setTemplates([])
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, locale, templateCategory])

  const templateId = values.templateId

  useEffect(() => {
    if (templateId === '') {
      setTemplate(null)
      setTemplateError(null)
      return
    }
    let cancelled = false
    setTemplate(null)
    setTemplateError(null)
    getSurveyTemplate(baseUrl, templateId, locale)
      .then((detail) => {
        if (cancelled) return
        setTemplate(detail)
        setValues((current) => ({
          ...current,
          // The template's questions decide the survey's content language -- the server
          // infers exactly this and takes no `language` on `/use`, so offering a choice
          // here would be a control that changes nothing. Reflected, not chosen.
          language: (CONTENT_LANGUAGES as readonly string[]).includes(detail.language)
            ? (detail.language as ContentLanguage)
            : current.language,
          // Seeded only into an empty box. Overwriting a title the author already typed
          // because they then browsed templates would be the wizard undoing their work.
          titleEn: current.titleEn.trim() === '' ? detail.name : current.titleEn,
        }))
      })
      .catch((err: unknown) => {
        // Not silent, unlike the catalogue: a template that was chosen and then failed to
        // load leaves the wizard unable to say what it is about to create.
        if (!cancelled) setTemplateError(err instanceof Error ? err.message : t('errors.generic'))
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, locale, t, templateId])

  const patch = useCallback((next: Partial<SurveyWizardValues>) => {
    setValues((current) => ({ ...current, ...next }))
  }, [])

  // Applying a recovered draft sets the step as well as the values: coming back to step
  // 1 of a survey you had taken to the review step is most of the frustration of having
  // lost it in the first place.
  const applyRestored = useCallback((restored: SurveyWizardValues, restoredStep: number) => {
    setValues(restored)
    // `currentStep` is 1-based on the wire (the server defaults it to 1) and 0-based
    // here. Clamped rather than trusted -- a draft written by a wizard with more steps
    // than this one has would otherwise index past the end of the step list.
    setStepIndex(Math.min(Math.max(restoredStep - 1, 0), SURVEY_WIZARD_STEPS.length - 1))
  }, [])

  const draft = useSurveyDraft({
    baseUrl,
    locale,
    enabled: Boolean(companyId),
    keyPrefix,
    values,
    currentStep: stepIndex + 1,
    onRestore: applyRestored,
  })

  function makeKey(): string {
    const key = `${keyPrefix}-${nextKey}`
    setNextKey((n) => n + 1)
    return key
  }

  const fromTemplate = startsFromTemplate(values)
  // Derived from the catalogue rather than from a fixed list: a template's category is a
  // free string the author chose, and hardcoding a vocabulary here would hide any
  // category not in it. Deliberately not recomputed from the *filtered* result, or
  // choosing one category would leave the picker with no way back -- the unfiltered
  // request that repopulates it is the one keyed on `templateCategory`.
  const categoryOptions = Array.from(
    new Set(templates.map((option) => option.category).filter((category) => category !== '')),
  ).sort()
  const errors = wizardStepErrors(values, t, template === null ? null : template.questions.length)
  const both = needsBothLanguages(values.language)

  const steps: WizardStep[] = SURVEY_WIZARD_STEPS.map((id) => ({
    id,
    label: t(`surveys.step${id.charAt(0).toUpperCase()}${id.slice(1)}`),
    description:
      // "Add at least one" is an instruction that cannot be followed in template mode --
      // there is no editor on that step. Rendering the page is what showed it still
      // being given.
      id === 'questions' && fromTemplate
        ? t('surveys.stepQuestionsFromTemplateDescription')
        : t(`surveys.step${id.charAt(0).toUpperCase()}${id.slice(1)}Description`),
    errors: errors[id],
  }))

  async function handleSubmit(): Promise<void> {
    if (!companyId) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      // Two endpoints, one wizard. `/use` is not an optimisation of `/surveys` here: it
      // is the only path that copies the template's option values, categories, scale
      // bounds and comment prompts, none of which this form can express. See
      // `wizardValues.ts`.
      const created = fromTemplate
        ? await instantiateSurveyTemplate(
            baseUrl,
            values.templateId,
            buildInstantiateInput(values, companyId),
            locale,
          )
        : await createSurvey(baseUrl, buildCreateInput(values, companyId), locale)
      // Before navigating, and awaited: the survey is the record now, and a draft left
      // behind would be offered back as unfinished work the next time the wizard opens.
      await draft.discardAfterCreate()
      navigate(`/surveys/${created.id}`)
    } catch (err) {
      // The server's own message names the offending field; render it rather than
      // replacing it with a guess.
      setSubmitError(err instanceof Error ? err.message : t('surveys.createFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  if (!companyId) {
    return <p role="alert">{t('common.noCompanyAssociated')}</p>
  }

  const currentStep = SURVEY_WIZARD_STEPS[stepIndex]

  return (
    <div>
      <PageTopBar
        title={t('surveys.wizardTitle')}
        description={t('surveys.wizardDescription')}
        breadcrumbs={[
          { label: t('navigation.surveys'), href: '/surveys' },
          { label: t('surveys.wizardTitle') },
        ]}
      />

      {submitError && (
        <Alert variant="destructive" role="alert" className="mb-panel-gap">
          <AlertDescription>{submitError}</AlertDescription>
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

      {/* Above the stepper, not tucked beside the submit button: on a phone the button
          sits at the bottom of a scrolled panel, and "your work is not being saved"
          under it is off screen at the moment it starts being true. */}
      <SurveyDraftIndicator state={draft.state} locale={locale} onSaveAnyway={draft.saveAnyway} />

      <WizardStepper
        steps={steps}
        currentIndex={stepIndex}
        onNavigate={setStepIndex}
        onSubmit={() => void handleSubmit()}
        submitLabel={t('surveys.createSurvey')}
        submitting={submitting}
        stepListLabel={t('surveys.wizardStepList')}
        progressLabel={t('surveys.wizardProgress', {
          current: stepIndex + 1,
          total: SURVEY_WIZARD_STEPS.length,
        })}
      >
        {currentStep === 'basics' && (
          <div className="grid gap-panel-gap">
            <SelectField
              label={t('surveys.templateCategoryFilter')}
              description={t('surveys.templateCategoryFilterHelp')}
              value={templateCategory === '' ? ALL_CATEGORIES : templateCategory}
              onChange={(next) => setTemplateCategory(next === ALL_CATEGORIES ? '' : next)}
              options={[
                { value: ALL_CATEGORIES, label: t('surveys.allCategories') },
                ...categoryOptions.map((code) => ({ value: code, label: code })),
              ]}
            />

            <SelectField
              label={t('surveys.startFromTemplate')}
              description={t('surveys.startFromTemplateHelp')}
              value={values.templateId === '' ? NO_TEMPLATE : values.templateId}
              onChange={(next) => patch({ templateId: next === NO_TEMPLATE ? '' : next })}
              options={[
                { value: NO_TEMPLATE, label: t('surveys.startBlank') },
                ...templates.map((option) => ({ value: option.id, label: option.name })),
              ]}
            />

            {templateError !== null && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{templateError}</AlertDescription>
              </Alert>
            )}

            <SelectField
              label={t('surveys.contentLanguage')}
              // Not a choice in template mode: `/use` takes no language and infers it
              // from the template's own questions, so a select here would be a control
              // that silently does nothing.
              disabled={fromTemplate}
              description={fromTemplate ? t('surveys.contentLanguageFromTemplate') : undefined}
              value={values.language}
              onChange={(next) => patch({ language: next as ContentLanguage })}
              options={CONTENT_LANGUAGES.map((code) => ({
                value: code,
                label: languageLabel(t, code),
              }))}
            />
            {both ? (
              <>
                <TextField
                  required
                  label={t('surveys.titleEn')}
                  value={values.titleEn}
                  onChange={(next) => patch({ titleEn: next })}
                />
                <TextField
                  required
                  label={t('surveys.titleEs')}
                  value={values.titleEs}
                  onChange={(next) => patch({ titleEs: next })}
                />
              </>
            ) : (
              <TextField
                required
                label={t('surveys.titleLabel')}
                value={values.language === 'es' ? values.titleEs : values.titleEn}
                onChange={(next) =>
                  patch(values.language === 'es' ? { titleEs: next } : { titleEn: next })
                }
              />
            )}

            <SelectField
              required
              label={t('surveys.typeLabel')}
              value={values.type}
              onChange={(next) => patch({ type: next })}
              options={SURVEY_TYPES.map((code) => ({ value: code, label: typeLabel(t, code) }))}
            />

            {both ? (
              <>
                <TextareaField
                  label={t('surveys.descriptionEn')}
                  value={values.descriptionEn}
                  onChange={(next) => patch({ descriptionEn: next })}
                />
                <TextareaField
                  label={t('surveys.descriptionEs')}
                  value={values.descriptionEs}
                  onChange={(next) => patch({ descriptionEs: next })}
                />
              </>
            ) : (
              <TextareaField
                label={t('surveys.descriptionLabel')}
                value={values.language === 'es' ? values.descriptionEs : values.descriptionEn}
                onChange={(next) =>
                  patch(
                    values.language === 'es'
                      ? { descriptionEs: next }
                      : { descriptionEn: next },
                  )
                }
              />
            )}
          </div>
        )}

        {currentStep === 'schedule' && (
          <div className="grid gap-panel-gap">
            <TextField
              required
              type="datetime-local"
              label={t('surveys.startDate')}
              value={values.startDate}
              onChange={(next) => patch({ startDate: next })}
            />
            <TextField
              required
              type="datetime-local"
              label={t('surveys.endDate')}
              value={values.endDate}
              onChange={(next) => patch({ endDate: next })}
            />
          </div>
        )}

        {currentStep === 'audience' && (
          <div className="grid gap-panel-gap">
            <fieldset className="grid gap-inline border-0 p-0">
              <legend className="mb-inline font-medium">{t('surveys.departmentsLabel')}</legend>
              {departments.length === 0 ? (
                <p className="m-0 text-fg-secondary">{t('surveys.departmentsAll')}</p>
              ) : (
                departments.map((department) => (
                  <CheckboxField
                    key={department.id}
                    label={department.name}
                    checked={values.departmentIds.includes(department.id)}
                    onChange={(checked) =>
                      patch({
                        departmentIds: checked
                          ? [...values.departmentIds, department.id]
                          : values.departmentIds.filter((id) => id !== department.id),
                      })
                    }
                  />
                ))
              )}
            </fieldset>

            <TextField
              type="number"
              label={t('surveys.targetAudienceLabel')}
              description={t('surveys.targetAudienceHelp')}
              value={values.targetAudienceCount}
              onChange={(next) => patch({ targetAudienceCount: next })}
              error={errors.audience[0]}
            />

            <Separator />

            <CheckboxField
              label={t('surveys.anonymous')}
              checked={values.anonymous}
              onChange={(checked) => patch({ anonymous: checked })}
            />
            <CheckboxField
              label={t('surveys.allowPartialResponses')}
              checked={values.allowPartialResponses}
              onChange={(checked) => patch({ allowPartialResponses: checked })}
            />
            <CheckboxField
              label={t('surveys.showProgress')}
              checked={values.showProgress}
              onChange={(checked) => patch({ showProgress: checked })}
            />
          </div>
        )}

        {currentStep === 'questions' && fromTemplate && (
          <div className="grid gap-panel-gap">
            <Alert>
              <AlertDescription>{t('surveys.templateQuestionsReadOnly')}</AlertDescription>
            </Alert>
            {template === null ? (
              <p className="m-0 text-fg-secondary">{t('common.loading')}</p>
            ) : (
              /* The same renderer the template detail page uses. It shows each option as
                 `label (value)`, which is the right amount of detail here: the value is
                 what the copied survey will carry and what makes two surveys from this
                 template comparable. */
              <SurveyQuestionList questions={template.questions} />
            )}
          </div>
        )}

        {currentStep === 'questions' && !fromTemplate && (
          <div className="grid gap-panel-gap">
            {values.questions.map((question, index) => (
              <Card key={question.key}>
                <CardContent className="grid gap-panel-gap">
                  <div className="flex items-center justify-between gap-inline">
                    <h3 className="m-0">{t('surveys.questionPosition', { position: index + 1 })}</h3>
                    <Button
                      variant="outline"
                      type="button"
                      onClick={() =>
                        patch({ questions: values.questions.filter((q) => q.key !== question.key) })
                      }
                    >
                      <Trash2 aria-hidden="true" className="size-icon" />
                      {t('surveys.removeQuestion')}
                    </Button>
                  </div>

                  {both ? (
                    <>
                      <TextField
                        required
                        label={t('surveys.questionTextEn')}
                        value={question.textEn}
                        onChange={(next) => patchQuestion(question.key, { textEn: next })}
                      />
                      <TextField
                        required
                        label={t('surveys.questionTextEs')}
                        value={question.textEs}
                        onChange={(next) => patchQuestion(question.key, { textEs: next })}
                      />
                    </>
                  ) : (
                    <TextField
                      required
                      label={t('surveys.questionText')}
                      value={values.language === 'es' ? question.textEs : question.textEn}
                      onChange={(next) =>
                        patchQuestion(
                          question.key,
                          values.language === 'es' ? { textEs: next } : { textEn: next },
                        )
                      }
                    />
                  )}

                  <SelectField
                    label={t('surveys.questionType')}
                    value={question.type}
                    onChange={(next) => patchQuestion(question.key, { type: next })}
                    options={SURVEY_QUESTION_TYPES.map((code) => ({
                      value: code,
                      label: questionTypeLabel(t, code),
                    }))}
                  />

                  <CheckboxField
                    label={t('surveys.required')}
                    checked={question.required}
                    onChange={(checked) => patchQuestion(question.key, { required: checked })}
                  />

                  {needsOptions(question.type) && (
                    <div className="grid gap-inline">
                      <p className="m-0 font-medium">{t('surveys.optionsLabel')}</p>
                      {question.options.map((option) => (
                        <div key={option.key} className="flex flex-wrap items-end gap-inline">
                          <div className="min-w-0 flex-1">
                            <TextField
                              label={both ? t('surveys.optionLabelEn') : t('surveys.optionsLabel')}
                              value={
                                both || values.language !== 'es' ? option.labelEn : option.labelEs
                              }
                              onChange={(next) =>
                                patchOption(
                                  question.key,
                                  option.key,
                                  both || values.language !== 'es'
                                    ? { labelEn: next }
                                    : { labelEs: next },
                                )
                              }
                            />
                          </div>
                          {both && (
                            <div className="min-w-0 flex-1">
                              <TextField
                                label={t('surveys.optionLabelEs')}
                                value={option.labelEs}
                                onChange={(next) =>
                                  patchOption(question.key, option.key, { labelEs: next })
                                }
                              />
                            </div>
                          )}
                          <Button
                            variant="outline"
                            type="button"
                            aria-label={t('surveys.removeOption')}
                            onClick={() =>
                              patchQuestion(question.key, {
                                options: question.options.filter((o) => o.key !== option.key),
                              })
                            }
                          >
                            <Trash2 aria-hidden="true" className="size-icon" />
                          </Button>
                        </div>
                      ))}
                      <div>
                        <Button
                          variant="outline"
                          type="button"
                          onClick={() =>
                            patchQuestion(question.key, {
                              options: [...question.options, emptyOption(makeKey())],
                            })
                          }
                        >
                          <Plus aria-hidden="true" className="size-icon" />
                          {t('surveys.addOption')}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}

            <div>
              <Button
                variant="primary"
                type="button"
                onClick={() => patch({ questions: [...values.questions, emptyQuestion(makeKey())] })}
              >
                <Plus aria-hidden="true" className="size-icon" />
                {t('surveys.addQuestion')}
              </Button>
            </div>
          </div>
        )}

        {currentStep === 'review' && (
          <div className="grid gap-panel-gap">
            <dl className="m-0 grid gap-inline">
              <Review
                label={t('surveys.startFromTemplate')}
                value={fromTemplate ? (template?.name ?? '') : t('surveys.startBlank')}
              />
              <Review label={t('surveys.titleLabel')} value={reviewTitle(values)} />
              <Review label={t('surveys.typeLabel')} value={typeLabel(t, values.type)} />
              <Review
                label={t('surveys.contentLanguage')}
                value={languageLabel(t, values.language)}
              />
              <Review
                label={t('surveys.stepSchedule')}
                value={reviewSchedule(values, t)}
              />
              <Review
                label={t('surveys.departmentsLabel')}
                value={
                  values.departmentIds.length === 0
                    ? t('surveys.departmentsAll')
                    : departments
                        .filter((d) => values.departmentIds.includes(d.id))
                        .map((d) => d.name)
                        .join(', ')
                }
              />
              <Review
                label={t('surveys.questions')}
                value={reviewQuestionCount(
                  fromTemplate ? (template?.questions.length ?? 0) : values.questions.length,
                  t,
                )}
              />
            </dl>

            <Alert>
              <AlertDescription>{t('surveys.reviewCreatesDraft')}</AlertDescription>
            </Alert>
          </div>
        )}
      </WizardStepper>
    </div>
  )

  function patchQuestion(key: string, next: Partial<SurveyWizardValues['questions'][number]>) {
    patch({
      questions: values.questions.map((q) => (q.key === key ? { ...q, ...next } : q)),
    })
  }

  function patchOption(
    questionKey: string,
    optionKey: string,
    next: Partial<SurveyWizardValues['questions'][number]['options'][number]>,
  ) {
    patch({
      questions: values.questions.map((q) =>
        q.key === questionKey
          ? { ...q, options: q.options.map((o) => (o.key === optionKey ? { ...o, ...next } : o)) }
          : q,
      ),
    })
  }
}

/**
 * Two keys rather than one with a `{count}`: `createTranslator` does plain `{name}`
 * interpolation and has no plural rules, so one key produces "1 questions" -- it did, and
 * rendering the review step is what showed it. English and Spanish happen to pluralise
 * this the same way, which is why two keys suffice.
 */
function reviewQuestionCount(count: number, t: TranslateFn): string {
  return count === 1
    ? t('surveys.reviewQuestionCountOne')
    : t('surveys.reviewQuestionCount', { count })
}

/** Same singular/plural reason as the question count above. */
function reviewSchedule(values: SurveyWizardValues, t: (k: string, p?: Record<string, string | number>) => string): string {
  const days = scheduledDays(values)
  if (days === null) return ''
  return days === 1 ? t('surveys.reviewRunsForOneDay') : t('surveys.reviewRunsForDays', { count: days })
}

/** The title as the review step should show it, whichever language columns are in use. */
function reviewTitle(values: SurveyWizardValues): string {
  if (values.language === 'both') {
    return [values.titleEn, values.titleEs].filter((s) => s.trim().length > 0).join(' / ')
  }
  return (values.language === 'es' ? values.titleEs : values.titleEn).trim()
}

function Review({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-inline">
      <dt className="min-w-40 font-medium text-fg-secondary">{label}</dt>
      <dd className="m-0 min-w-0 break-words">{value.length > 0 ? value : '—'}</dd>
    </div>
  )
}
