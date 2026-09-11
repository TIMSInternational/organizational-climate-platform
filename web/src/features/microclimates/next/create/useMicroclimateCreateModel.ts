import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from '../../../../i18n'
import { useCompanyScope } from '../../../../company-context'
import {
  createMicroclimate,
  getMicroclimate,
  listMicroclimates,
  updateMicroclimate,
  type MicroclimateDetail,
  type Question,
} from '../../api/microclimates'
import { listMicroclimateTemplates, type MicroclimateTemplate } from '../../api/microclimateTemplates'
import {
  buildCreateInput,
  emptyQuestion,
  emptyWizardValues,
  wizardStepErrors,
  type ContentLanguage,
  type MicroclimateWizardValues,
  type WizardQuestionValues,
} from '../../wizardValues'
import { nameHead } from '../../../dashboard/next/derive'
import { defaultWindow, newestFirst, toLocalInput } from '../derive'
import { shortDay } from '../format'

/** Where the questions come from: the last session, a template (which brings none), or nothing. */
export type StartFrom = 'previous' | 'template' | 'blank'

export interface MicroclimateCreateState {
  /** The previous session and the templates are still being read. */
  loading: boolean
  /** The newest session's detail — what "La sesión anterior" copies — or `null`. */
  previous: MicroclimateDetail | null
  templates: readonly MicroclimateTemplate[]
  values: MicroclimateWizardValues
  startFrom: StartFrom
  setStartFrom: (next: StartFrom) => void
  patch: (next: Partial<MicroclimateWizardValues>) => void
  setQuestions: (update: (questions: WizardQuestionValues[]) => WizardQuestionValues[]) => void
  nextKey: () => string
  /** Every blocking problem, from the same rules the wizard ran (`wizardStepErrors`). */
  errors: readonly string[]
  /** A submit was attempted, so the errors are on screen. */
  attempted: boolean
  submitting: 'draft' | 'launch' | null
  submitError: string | null
  saveDraft: () => void
  launch: () => void
}

/** One of the previous session's questions, as an editable row in the new session's language. */
export function questionFromPrevious(question: Question, key: string, language: ContentLanguage, resolvedLocale: string): WizardQuestionValues {
  const text = question.text ?? ''
  const intoEs = language === 'es' || (language === 'both' && resolvedLocale === 'es')
  return {
    key,
    textEn: intoEs ? '' : text,
    textEs: intoEs ? text : '',
    type: question.type,
    required: question.required,
    options: (question.options ?? []).map((option, index) => {
      const label = option.label ?? option.value
      return { key: `${key}-o${index}`, labelEn: intoEs ? '' : label, labelEs: intoEs ? label : '' }
    }),
    emojiOptions: (question.emojiOptions ?? []).map((face, index) => {
      const label = face.label ?? ''
      return { key: `${key}-e${index}`, emoji: face.emoji, labelEn: intoEs ? '' : label, labelEs: intoEs ? label : '' }
    }),
  }
}

/**
 * THE wiring seam of `/microclimates/new`. The payload and the submit path are
 * `MicroclimateCreatePage`'s, unchanged: `buildCreateInput` over `MicroclimateWizardValues`,
 * validated by `wizardStepErrors`, sent through `createMicroclimate` (`POST /microclimates`).
 * "Lanzar" is that same create followed by the old detail page's launch —
 * `updateMicroclimate(id, { status: 'active' })` — because `CreateAsync` always makes a draft.
 *
 * What is new is where a session starts: the board's "Empezar desde · La sesión anterior",
 * which reads the newest session (`GET /microclimates`, then its detail) and copies its
 * questions, its expected count, its anonymity and the length of its window.
 */
export function useMicroclimateCreateModel(): MicroclimateCreateState {
  const { t, locale } = useTranslation()
  const navigate = useNavigate()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const companyId = useCompanyScope().companyId

  const keyCounter = useRef(0)
  const nextKey = useCallback(() => {
    keyCounter.current += 1
    return `k${keyCounter.current}`
  }, [])

  const [values, setValues] = useState<MicroclimateWizardValues>(() => {
    const { start, end } = defaultWindow(new Date())
    return {
      ...emptyWizardValues(locale === 'es' ? 'es' : 'en'),
      startTime: toLocalInput(start),
      endTime: toLocalInput(end),
      questions: [emptyQuestion('k0')],
    }
  })
  const [startFrom, setStartFromState] = useState<StartFrom>('blank')
  const [previous, setPrevious] = useState<MicroclimateDetail | null>(null)
  const [templates, setTemplates] = useState<MicroclimateTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [attempted, setAttempted] = useState(false)
  const [submitting, setSubmitting] = useState<'draft' | 'launch' | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  // Once the author has typed, a late answer from the server must not overwrite the form.
  const touched = useRef(false)

  const copyPrevious = useCallback(
    (session: MicroclimateDetail, current: MicroclimateWizardValues): MicroclimateWizardValues => {
      const { start, end } = defaultWindow(new Date(), session)
      const title = session.title
        ? t('microclimates.next.create.titleFromPrevious', {
            name: nameHead(session.title),
            date: shortDay(start.toISOString(), locale),
          })
        : ''
      const inEs = current.language === 'es'
      return {
        ...current,
        titleEn: inEs ? current.titleEn : title,
        titleEs: inEs ? title : current.titleEs,
        startTime: toLocalInput(start),
        endTime: toLocalInput(end),
        targetParticipantCount: String(session.targetParticipantCount > 0 ? session.targetParticipantCount : current.targetParticipantCount),
        anonymousResponses: session.anonymousResponses,
        templateId: '',
        questions: [...session.questions]
          .sort((a, b) => a.order - b.order)
          .map((question) => questionFromPrevious(question, nextKey(), current.language, session.resolvedLocale)),
      }
    },
    [locale, nextKey, t],
  )

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    setLoading(true)
    const readPrevious = async (): Promise<MicroclimateDetail | null> => {
      const newest = newestFirst(await listMicroclimates(baseUrl, companyId, locale))[0]
      return newest ? getMicroclimate(baseUrl, newest.id, locale) : null
    }
    Promise.all([
      readPrevious().catch(() => null),
      // A template is attribution only; a failed read hides the picker rather than blocking
      // the form (the old page's one silent catch, kept for its reason).
      listMicroclimateTemplates(baseUrl, companyId).catch(() => [] as MicroclimateTemplate[]),
    ]).then(([session, list]) => {
      if (cancelled) return
      setPrevious(session)
      setTemplates(list)
      setLoading(false)
      if (session && !touched.current) {
        setStartFromState('previous')
        setValues((current) => copyPrevious(session, current))
      }
    })
    return () => {
      cancelled = true
    }
  }, [baseUrl, companyId, copyPrevious, locale])

  const patch = useCallback((next: Partial<MicroclimateWizardValues>) => {
    touched.current = true
    setValues((current) => ({ ...current, ...next }))
  }, [])

  const setQuestions = useCallback((update: (questions: WizardQuestionValues[]) => WizardQuestionValues[]) => {
    touched.current = true
    setValues((current) => ({ ...current, questions: update(current.questions) }))
  }, [])

  const setStartFrom = useCallback(
    (next: StartFrom) => {
      touched.current = true
      setStartFromState(next)
      setValues((current) => {
        if (next === 'previous' && previous) return copyPrevious(previous, current)
        // A template brings no questions (`MicroclimateTemplate` has none), so both other
        // starts are an empty question to write.
        return { ...current, templateId: next === 'template' ? current.templateId : '', questions: [emptyQuestion(nextKey())] }
      })
    },
    [copyPrevious, nextKey, previous],
  )

  const errors = useMemo(() => wizardStepErrors(values, t).review, [values, t])

  const submit = useCallback(
    async (mode: 'draft' | 'launch') => {
      setAttempted(true)
      if (!companyId || errors.length > 0) return
      setSubmitError(null)
      setSubmitting(mode)
      try {
        const created = await createMicroclimate(baseUrl, buildCreateInput(values, companyId))
        if (mode === 'launch') {
          try {
            await updateMicroclimate(baseUrl, created.id, { status: 'active' })
          } catch (err) {
            // The draft exists; staying here would invite a second one. The session's own page
            // says why it did not launch and offers the launch again.
            navigate(`/microclimates/${created.id}`, {
              state: { launchError: err instanceof Error ? err.message : t('errors.generic') },
            })
            return
          }
        }
        navigate(`/microclimates/${created.id}`)
      } catch (err) {
        // The server's own message: it names the question and option a client guess cannot.
        setSubmitError(err instanceof Error ? err.message : t('errors.generic'))
      } finally {
        setSubmitting(null)
      }
    },
    [baseUrl, companyId, errors.length, navigate, t, values],
  )

  return {
    loading,
    previous,
    templates,
    values,
    startFrom,
    setStartFrom,
    patch,
    setQuestions,
    nextKey,
    errors,
    attempted,
    submitting,
    submitError,
    saveDraft: () => void submit('draft'),
    launch: () => void submit('launch'),
  }
}
