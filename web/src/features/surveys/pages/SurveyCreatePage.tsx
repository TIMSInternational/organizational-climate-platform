import { useCallback, useEffect, useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { WizardStepper, type WizardStep } from '../../../components/wizard'
import { KpiTile } from '../../../components/charts'
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
import { cn } from '../../../lib/cn'
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
import SurveyWizardSetup from '../components/SurveyWizardSetup'
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
  surveyQuestionCount,
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
 * ## What the redesign changed, and what it deliberately did not
 *
 * Nothing about the flow. #265 built the steps, #266 the autosave and #267 the template
 * path, and all three behaviours are load-bearing and settled: a conflict stops autosave
 * and an error does not, and template mode instantiates server-side with a read-only
 * questions preview. None of that is touched here.
 *
 * What changed is what the page tells you about itself while you use it.
 *
 * - **Step state moved into a rail** (`WizardStepper`). It now says, for every step and
 *   at all times, whether it is complete, current, *n outstanding* or locked. Before,
 *   the only way to find out what a step still wanted was to walk to it and press
 *   Continue.
 * - **The setup panel** under the rail keeps the two decisions that change the rest of
 *   the wizard — the template and the content language — visible after the basics step
 *   they were made on has scrolled out of reach.
 * - **The review step leads with three readings** (questions, days open, departments)
 *   in `KpiTile`, then the facts. It used to be a flat definition list in which "12
 *   questions" and "Periodic Survey" were set identically; a count and a category are
 *   not the same kind of statement and no longer look like it.
 * - **Paired fields sit side by side** — the two template pickers, the two dates. A
 *   screenshot at 1440 showed a 512px column of fields beside 600px of nothing.
 *
 * The readings it renders are in the mono face with tabular figures — the step ordinals,
 * the completion meter, the three review tiles, the review dates and each question card's
 * position — which is the rule that makes this product read as an instrument. Two numbers
 * on this page deliberately are not: the value inside the "expected respondents" box,
 * which is a control rather than a reading, and the clock time inside "Draft saved at
 * {time}", which arrives already inside a translated sentence.
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
  const templateQuestionCount = template === null ? null : template.questions.length
  const questionCount = surveyQuestionCount(values, templateQuestionCount)
  const days = scheduledDays(values)

  return (
    <div>
      <PageTopBar
        title={t('surveys.wizardTitle')}
        description={t('surveys.wizardDescription')}
        breadcrumbs={[
          { label: t('navigation.surveys'), href: '/surveys' },
          { label: t('surveys.wizardTitle') },
        ]}
        // Which of the two creation paths this is, stated once and at the top. It
        // decides which endpoint runs and whether the questions step is an editor or a
        // preview, so it is the single most consequential thing about the page -- and it
        // was previously readable only from the second select on the basics step, which
        // stops being on screen the moment that step is left.
        badge={{
          text: fromTemplate ? t('surveys.modeFromTemplate') : t('surveys.modeBlank'),
          variant: fromTemplate ? 'default' : 'secondary',
        }}
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
        aside={
          <SurveyWizardSetup
            // `null` where no template is chosen, `undefined` while the detail is in
            // flight -- the panel shows those differently, and collapsing them here
            // would make a loading template look like a blank survey.
            templateName={fromTemplate ? (template?.name ?? undefined) : null}
            languageName={languageLabel(t, values.language)}
          />
        }
      >
        {currentStep === 'basics' && (
          <div className="grid gap-panel-gap">
            {/* The filter and the picker it filters, side by side: they are one
                decision made in two moves, and stacking them put the list of
                templates a scroll away from the control that narrows it. */}
            <div className="grid gap-panel-gap md:grid-cols-2">
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
            </div>

            {templateError !== null && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{templateError}</AlertDescription>
              </Alert>
            )}

            <Separator />

            {/* Language and type together, ahead of the title: both change what the
                rest of the form asks for -- `both` splits every title, description and
                question into two boxes -- so they belong before the boxes they split,
                not scattered among them. */}
            <div className="grid gap-panel-gap md:grid-cols-2">
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

              <SelectField
                required
                label={t('surveys.typeLabel')}
                value={values.type}
                onChange={(next) => patch({ type: next })}
                options={SURVEY_TYPES.map((code) => ({ value: code, label: typeLabel(t, code) }))}
              />
            </div>

            {both ? (
              // The two language columns side by side rather than stacked: they are the
              // same sentence twice, and reading them as a pair is how a missing or
              // mismatched translation becomes obvious.
              <div className="grid gap-panel-gap md:grid-cols-2">
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
              </div>
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

            {both ? (
              <div className="grid gap-panel-gap md:grid-cols-2">
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
              </div>
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
            <div className="grid gap-panel-gap md:grid-cols-2">
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
            {/* The span the two dates add up to, as a reading, the moment they make one.
                Rendered only when `scheduledDays` has an answer: a "0" beside two empty
                boxes is a measurement of nothing, and the step's own validation is
                already the thing that says the dates are missing. */}
            {days !== null && (
              <KpiTile
                className="md:max-w-field"
                label={t('surveys.readingDaysOpen')}
                value={days}
                locale={locale}
              />
            )}
          </div>
        )}

        {currentStep === 'audience' && (
          <div className="grid gap-panel-gap">
            <fieldset className="grid gap-inline border-0 p-0">
              <legend className="mb-inline font-medium">{t('surveys.departmentsLabel')}</legend>
              {departments.length === 0 ? (
                <p className="m-0 text-fg-secondary">{t('surveys.departmentsAll')}</p>
              ) : (
                // Packed and wrapping rather than stacked: a company with thirty
                // departments is a step you scroll for. Not a column grid either --
                // rendering three departments into `lg:grid-cols-3` spread them across
                // the whole panel with roughly 200px of nothing between each name, which
                // reads as three unrelated controls rather than one list.
                <div className="flex flex-wrap gap-x-section gap-y-inline">
                  {departments.map((department) => (
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
                  ))}
                </div>
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
                    <div className="flex min-w-0 items-center gap-inline">
                      {/* The same mono ordinal the step rail uses, for the same reason:
                          a position is a reading. `aria-hidden` because the heading
                          beside it already says "Question 3" in words. */}
                      <span
                        aria-hidden="true"
                        className="grid size-6 flex-none place-items-center rounded-md bg-surface-icon-box font-mono text-xs font-semibold tabular-nums text-fg-secondary"
                      >
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <h3 className="m-0 min-w-0 truncate">
                        {t('surveys.questionPosition', { position: index + 1 })}
                      </h3>
                    </div>
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
            {/* The three numbers first, as readings, then the facts. A count of
                questions and the name of a survey type were previously set
                identically in one definition list, which made the shape of the survey
                something you had to read for rather than see. */}
            <div className="grid gap-panel-gap sm:grid-cols-3">
              <KpiTile
                label={t('surveys.questions')}
                value={questionCount}
                sub={
                  fromTemplate ? t('surveys.readingFromTemplate') : t('surveys.readingWrittenHere')
                }
                locale={locale}
              />
              <KpiTile
                label={t('surveys.readingDaysOpen')}
                value={days ?? 0}
                // Zero days and "no dates set" are different statements; the sub-line
                // is what keeps the tile from asserting the first when it means the
                // second. Review is only reachable with valid dates, so this is a
                // backstop rather than an expected state.
                sub={days === null ? t('surveys.readingNoDates') : undefined}
                locale={locale}
              />
              <KpiTile
                label={t('surveys.departmentsLabel')}
                value={values.departmentIds.length}
                sub={
                  values.departmentIds.length === 0
                    ? t('surveys.departmentsAll')
                    : t('surveys.readingOfDepartments', { total: departments.length })
                }
                locale={locale}
              />
            </div>

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
              {/* The dates themselves, not the span between them -- the span is the
                  tile above. Both are readings, so both are mono. */}
              <Review mono label={t('surveys.startDate')} value={reviewDate(values.startDate, locale)} />
              <Review mono label={t('surveys.endDate')} value={reviewDate(values.endDate, locale)} />
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
 * One end of the schedule, as the review step should show it.
 *
 * The wizard holds `<input type="datetime-local">` text — `2026-09-01T09:00`, local
 * wall clock — which is a machine format and reads as one. This is the same instant in
 * the reader's own locale.
 *
 * An empty string for an unparseable value rather than a fallback: `Review` renders an
 * em dash for empty, and "Invalid Date" is worse than saying nothing. Review is only
 * reachable once `scheduleErrors` has passed, so neither case is expected.
 */
function reviewDate(value: string, locale: string): string {
  const when = new Date(value)
  if (Number.isNaN(when.getTime())) return ''
  return when.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
}

/** The title as the review step should show it, whichever language columns are in use. */
function reviewTitle(values: SurveyWizardValues): string {
  if (values.language === 'both') {
    return [values.titleEn, values.titleEs].filter((s) => s.trim().length > 0).join(' / ')
  }
  return (values.language === 'es' ? values.titleEs : values.titleEn).trim()
}

/**
 * One row of the review list.
 *
 * `mono` is not decoration: it marks the value as a *reading* — a date, a count, an
 * identifier — and readings are set in the mono face with tabular figures throughout
 * this product, while prose stays in the sans face. A survey's title and its type are
 * prose; its start and end are not.
 */
function Review({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap gap-inline">
      <dt className="min-w-40 font-medium text-fg-secondary">{label}</dt>
      <dd className={cn('m-0 min-w-0 break-words', mono && 'font-mono tabular-nums')}>
        {value.length > 0 ? value : '—'}
      </dd>
    </div>
  )
}
