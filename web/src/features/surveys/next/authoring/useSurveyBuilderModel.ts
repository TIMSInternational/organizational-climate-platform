import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from '../../../../i18n'
import { listDepartments, type Department } from '../../../org-structure/api/departments'
import { createSurvey } from '../../api/surveyCreate'
import { getSurveyQuestionAuthoring, replaceSurveyQuestions } from '../../api/surveyQuestionAuthoring'
import { listSurveyDimensions } from '../../api/surveys'
import {
  getSurveyTemplate,
  instantiateSurveyTemplate,
  listSurveyTemplates,
  type SurveyTemplateDetail,
  type SurveyTemplateListItem,
} from '../../api/surveyTemplates'
import { useSurveyDraft } from '../../useSurveyDraft'
import {
  CONTENT_LANGUAGES,
  SURVEY_WIZARD_STEPS,
  buildCreateInput,
  buildInstantiateInput,
  defaultContentLanguage,
  startsFromTemplate,
  type ContentLanguage,
  type SurveyQuestionValues,
  type SurveyWizardValues,
} from '../../wizardValues'
import { arrangedQuestions, arrangementChanged, materialiseTemplate, templateCovers } from './templateRows'

/**
 * The model behind `/surveys/new` — THE wiring seam of Nueva encuesta, redesigned as a two-pane
 * builder. It is the previous wizard's state, moved and not re-imagined
 * (`pages/SurveyCreatePage.tsx`, kept unrouted as the wiring reference): the same
 * `SurveyWizardValues`, the same draft through `useSurveyDraft` (so a draft made in either is the
 * other's), the reader's locale as the content-language seed (`defaultContentLanguage`, PR #459),
 * and the same two submits — `POST /surveys` with `buildCreateInput`, or
 * `POST /survey-templates/{id}/use` with `buildInstantiateInput`.
 *
 * Template mode draws the template's questions as rows the author can reorder, drop, make
 * optional or add to, as the SurveyBuilder artboard does (`templateRows.ts`). `/use` still copies
 * the template whole; only a changed arrangement is then written onto the copy with the question
 * editor's own `PUT /surveys/{id}`. The content language is the reader's whenever the template is
 * written in it — `/use` honours `language` (`UseSurveyTemplateRequest.Language`) — and the
 * template's own otherwise.
 */
export function useSurveyBuilderModel(companyId: string) {
  const { t, locale } = useTranslation()
  const navigate = useNavigate()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const keyPrefix = useId()
  const [searchParams] = useSearchParams()
  const fallbackLanguage = defaultContentLanguage(locale)

  // `?template={id}` seeds the first state and nothing after, as the previous wizard did.
  const [values, setValues] = useState<SurveyWizardValues>(() => {
    const initial = emptyValues(fallbackLanguage)
    const requested = searchParams.get('template')
    return requested === null || requested === '' ? initial : { ...initial, templateId: requested }
  })
  const [stepIndex, setStepIndex] = useState(0)
  const [departments, setDepartments] = useState<Department[] | null>(null)
  const [templates, setTemplates] = useState<SurveyTemplateListItem[]>([])
  const [template, setTemplate] = useState<SurveyTemplateDetail | null>(null)
  const [templateError, setTemplateError] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  /** The survey exists but the rows' arrangement could not be written onto its copy. */
  const [unsaved, setUnsaved] = useState<{ id: string; message: string } | null>(null)
  const [nextKey, setNextKey] = useState(0)
  /** The template whose questions the rows already hold — a restored draft's, or one copied here. */
  const materialisedFor = useRef<string | null>(null)
  const templateKeys = useRef(0)

  useEffect(() => {
    let cancelled = false
    // A failed directory is not a reason to block the flow: no departments means everyone.
    listDepartments(baseUrl, companyId)
      .then((result) => !cancelled && setDepartments(Array.isArray(result) ? result.filter((d) => d.isActive !== false) : []))
      .catch(() => !cancelled && setDepartments(null))
    listSurveyDimensions(baseUrl, companyId)
      .then((result) => !cancelled && setHistory(Array.isArray(result) ? result : []))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [baseUrl, companyId])

  useEffect(() => {
    let cancelled = false
    listSurveyTemplates(baseUrl, { category: '' }, locale)
      .then((result) => !cancelled && setTemplates(Array.isArray(result) ? result : []))
      .catch(() => !cancelled && setTemplates([]))
    return () => {
      cancelled = true
    }
  }, [baseUrl, locale])

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
      .then(async (detail) => {
        // A bilingual template is read in its other language too, so the rows carry both
        // columns and the author may pick either language — or both — for the survey.
        const other =
          detail.language === 'both'
            ? await getSurveyTemplate(baseUrl, templateId, locale === 'es' ? 'en' : 'es').catch(() => null)
            : null
        if (cancelled) return
        const reads = other === null ? [detail] : [detail, other]
        const copy = materialisedFor.current !== templateId
        materialisedFor.current = templateId
        const keys = Array.from({ length: detail.questions.length }, () => `${keyPrefix}-t${templateKeys.current++}`)
        const rows = copy ? materialiseTemplate(reads, keys) : []
        setTemplate(detail)
        setValues((current) => {
          const language =
            templateCovers(detail.language, current.language) ||
            !(CONTENT_LANGUAGES as readonly string[]).includes(detail.language)
              ? current.language
              : (detail.language as ContentLanguage)
          // The template's name seeds an empty title in the column the reader will see; a title
          // the author already typed is never overwritten.
          const column = language === 'es' || (language === 'both' && locale === 'es') ? 'titleEs' : 'titleEn'
          return {
            ...current,
            language,
            [column]: current[column].trim() === '' ? detail.name : current[column],
            questions: copy ? [...rows, ...current.questions.filter((q) => q.templateOrder === undefined)] : current.questions,
          }
        })
      })
      .catch((error: unknown) => {
        if (!cancelled) setTemplateError(error instanceof Error ? error.message : t('errors.generic'))
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, keyPrefix, locale, t, templateId])

  const patch = useCallback((next: Partial<SurveyWizardValues>) => setValues((current) => ({ ...current, ...next })), [])

  /** Another template (or none): the previous template's rows go, the author's own stay. */
  const chooseTemplate = useCallback((next: string) => {
    materialisedFor.current = null
    setValues((current) => ({
      ...current,
      templateId: next,
      questions: current.questions.filter((q) => q.templateOrder === undefined),
    }))
  }, [])

  const applyRestored = useCallback((restored: SurveyWizardValues, restoredStep: number) => {
    // A draft that holds rows keeps them — the author's arrangement, not the template's again. A
    // draft from before template rows existed holds none, and gets them copied in.
    materialisedFor.current = restored.questions.length > 0 ? restored.templateId : null
    setValues(restored)
    setStepIndex(Math.min(Math.max(restoredStep - 1, 0), SURVEY_WIZARD_STEPS.length - 1))
  }, [])

  const draft = useSurveyDraft({
    baseUrl,
    locale,
    fallbackLanguage,
    enabled: true,
    keyPrefix,
    values,
    currentStep: stepIndex + 1,
    onRestore: applyRestored,
  })

  /** `count` fresh React keys at once — `nextKey` read in a loop would repeat one. */
  const takeKeys = useCallback(
    (count: number) => {
      const keys = Array.from({ length: count }, (_, index) => `${keyPrefix}-${nextKey + index}`)
      setNextKey((n) => n + count)
      return keys
    },
    [keyPrefix, nextKey],
  )

  const setQuestions = useCallback(
    (change: (questions: SurveyQuestionValues[]) => SurveyQuestionValues[]) =>
      setValues((current) => ({ ...current, questions: change(current.questions) })),
    [],
  )

  const submit = useCallback(async () => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      if (!startsFromTemplate(values)) {
        const created = await createSurvey(baseUrl, buildCreateInput(values, companyId), locale)
        await draft.discardAfterCreate()
        navigate(`/surveys/${created.id}`)
        return
      }
      const created = await instantiateSurveyTemplate(baseUrl, values.templateId, buildInstantiateInput(values, companyId), locale)
      if (template !== null && arrangementChanged(values.questions, template)) {
        try {
          const copied = await getSurveyQuestionAuthoring(baseUrl, created.id)
          await replaceSurveyQuestions(baseUrl, created.id, arrangedQuestions(values, copied.questions))
        } catch (error) {
          // The survey exists with the template's questions. The draft goes — submitting it
          // again would create a second survey — and the author is sent to the editor that
          // can still make the changes.
          await draft.discardAfterCreate()
          setUnsaved({ id: created.id, message: error instanceof Error ? error.message : t('errors.generic') })
          return
        }
      }
      await draft.discardAfterCreate()
      navigate(`/surveys/${created.id}`)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t('surveys.createFailed'))
    } finally {
      setSubmitting(false)
    }
  }, [baseUrl, companyId, draft, locale, navigate, t, template, values])

  return {
    values,
    patch,
    chooseTemplate,
    setQuestions,
    stepIndex,
    setStepIndex,
    departments,
    templates,
    template,
    templateError,
    history,
    draft,
    takeKeys,
    submit,
    submitting,
    submitError,
    unsaved,
  }
}

function emptyValues(language: ContentLanguage): SurveyWizardValues {
  return {
    templateId: '',
    language,
    titleEn: '',
    titleEs: '',
    descriptionEn: '',
    descriptionEs: '',
    type: 'periodic',
    startDate: '',
    endDate: '',
    departmentIds: [],
    targetAudienceCount: '',
    anonymous: true,
    allowPartialResponses: true,
    showProgress: true,
    questions: [],
  }
}
