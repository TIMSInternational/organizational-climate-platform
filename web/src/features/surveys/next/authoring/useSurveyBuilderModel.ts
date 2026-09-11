import { useCallback, useEffect, useId, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from '../../../../i18n'
import { listDepartments, type Department } from '../../../org-structure/api/departments'
import { createSurvey } from '../../api/surveyCreate'
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

/**
 * The model behind `/surveys/new` — THE wiring seam of Nueva encuesta, redesigned as a two-pane
 * builder. It is the previous wizard's state, moved and not re-imagined
 * (`pages/SurveyCreatePage.tsx`, kept unrouted as the wiring reference): the same
 * `SurveyWizardValues`, the same draft through `useSurveyDraft` (so a draft made in either is the
 * other's), the reader's locale as the content-language seed (`defaultContentLanguage`, PR #459),
 * and the same two submits — `POST /surveys` with `buildCreateInput`, or
 * `POST /survey-templates/{id}/use` with `buildInstantiateInput`, the server copying a template's
 * questions whole.
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
  const [nextKey, setNextKey] = useState(0)

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
      .then((detail) => {
        if (cancelled) return
        setTemplate(detail)
        setValues((current) => {
          // The template's questions decide the language — `/use` infers it and takes none.
          const language = (CONTENT_LANGUAGES as readonly string[]).includes(detail.language)
            ? (detail.language as ContentLanguage)
            : current.language
          // The template's name seeds an empty title in the column the reader will see; a title
          // the author already typed is never overwritten.
          const column = language === 'es' || (language === 'both' && locale === 'es') ? 'titleEs' : 'titleEn'
          return {
            ...current,
            language,
            [column]: current[column].trim() === '' ? detail.name : current[column],
          }
        })
      })
      .catch((error: unknown) => {
        if (!cancelled) setTemplateError(error instanceof Error ? error.message : t('errors.generic'))
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, locale, t, templateId])

  const patch = useCallback((next: Partial<SurveyWizardValues>) => setValues((current) => ({ ...current, ...next })), [])

  const applyRestored = useCallback((restored: SurveyWizardValues, restoredStep: number) => {
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
      const created = startsFromTemplate(values)
        ? await instantiateSurveyTemplate(baseUrl, values.templateId, buildInstantiateInput(values, companyId), locale)
        : await createSurvey(baseUrl, buildCreateInput(values, companyId), locale)
      await draft.discardAfterCreate()
      navigate(`/surveys/${created.id}`)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t('surveys.createFailed'))
    } finally {
      setSubmitting(false)
    }
  }, [baseUrl, companyId, draft, locale, navigate, t, values])

  return {
    values,
    patch,
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
