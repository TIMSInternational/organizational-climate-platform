import { useCallback, useEffect, useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from '../../../i18n'
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
  CONTENT_LANGUAGES,
  SURVEY_WIZARD_STEPS,
  buildCreateInput,
  emptyOption,
  emptyQuestion,
  emptyWizardValues,
  needsBothLanguages,
  scheduledDays,
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
 * ## What it deliberately does not do
 *
 * **Launch the survey.** `CreateSurveyRequest` carries no status and `CreateAsync`
 * writes `draft`; publishing is a separate guarded transition. The review step says
 * so rather than leaving someone to discover it.
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

  const patch = useCallback((next: Partial<SurveyWizardValues>) => {
    setValues((current) => ({ ...current, ...next }))
  }, [])

  function makeKey(): string {
    const key = `${keyPrefix}-${nextKey}`
    setNextKey((n) => n + 1)
    return key
  }

  const errors = wizardStepErrors(values, t)
  const both = needsBothLanguages(values.language)

  const steps: WizardStep[] = SURVEY_WIZARD_STEPS.map((id) => ({
    id,
    label: t(`surveys.step${id.charAt(0).toUpperCase()}${id.slice(1)}`),
    description: t(`surveys.step${id.charAt(0).toUpperCase()}${id.slice(1)}Description`),
    errors: errors[id],
  }))

  async function handleSubmit(): Promise<void> {
    if (!companyId) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const created = await createSurvey(baseUrl, buildCreateInput(values, companyId), locale)
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
              label={t('surveys.contentLanguage')}
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

        {currentStep === 'questions' && (
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
              {/* Two keys rather than one with a `{count}`: `createTranslator` does
                  plain `{name}` interpolation and has no plural rules, so "1
                  questions" is what one key produces — it did, and rendering the
                  review step is what showed it. English and Spanish happen to
                  pluralise this the same way, which is why two keys suffice. */}
              <Review
                label={t('surveys.questions')}
                value={
                  values.questions.length === 1
                    ? t('surveys.reviewQuestionCountOne')
                    : t('surveys.reviewQuestionCount', { count: values.questions.length })
                }
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
