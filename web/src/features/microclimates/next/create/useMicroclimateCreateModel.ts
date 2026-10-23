import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from '../../../../i18n'
import { useCompanyScope } from '../../../../company-context'
import {
  createMicroclimate,
  getMicroclimate,
  listMicroclimates,
  replaceMicroclimateContent,
  updateMicroclimate,
  type MicroclimateDetail,
  type Question,
} from '../../api/microclimates'
import { listMicroclimateTemplates, type MicroclimateTemplate } from '../../api/microclimateTemplates'
import {
  buildCreateInput,
  buildReplaceInput,
  emptyQuestion,
  emptyWizardValues,
  wizardStepErrors,
  wizardValuesFromDraft,
  type ContentLanguage,
  type MicroclimateWizardValues,
  type WizardQuestionValues,
} from '../../wizardValues'
import { getCompanySettings } from '../../../org-structure/api/companySettings'
import { isKnownTimeZone } from '../../../surveys/next/authoring/zonedWindow'
import { nameHead } from '../../../dashboard/next/derive'
import { newestFirst } from '../derive'
import { defaultWallWindow, sessionZone, shortDayIn } from './companyClock'

/**
 * The company's IANA zone from its settings (`GET /admin/companies/{id}/settings`, the read
 * Nueva encuesta makes for the same purpose), or `null` when it cannot be read or is not a zone
 * this platform knows. Never throws: the form works on the browser's zone without it.
 */
async function companyZone(baseUrl: string, companyId: string): Promise<string | null> {
  try {
    const zone = (await getCompanySettings(baseUrl, companyId))?.settings?.timezone
    return isKnownTimeZone(zone) ? zone : null
  } catch {
    return null
  }
}

/** Where the questions come from: the last session, a template (which brings none), or nothing. */
export type StartFrom = 'previous' | 'template' | 'blank'

/**
 * Editing a draft (G23), at `/microclimates/:id/edit`: the same form, filled from the draft.
 * `notDraft` is a session that has been launched — its content is history and the server would
 * refuse the save with a 409, so the page says so instead of offering a form.
 */
export type DraftLoad = { status: 'none' } | { status: 'loading' } | { status: 'ready'; companyId: string } | { status: 'failed'; error: string } | { status: 'notDraft'; id: string }

export interface MicroclimateCreateState {
  /** The draft being edited, when there is one. */
  draft: DraftLoad
  /**
   * The company's IANA zone (`settings.timezone`), which Apertura and Cierre are read on (G16):
   * `undefined` while it is being read, `null` when it could not be (the browser's zone is used,
   * and the schedule card says so).
   */
  timeZone: string | null | undefined
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
export function useMicroclimateCreateModel(editId?: string): MicroclimateCreateState {
  const { t, locale } = useTranslation()
  const navigate = useNavigate()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const companyId = useCompanyScope().companyId

  const keyCounter = useRef(0)
  const nextKey = useCallback(() => {
    keyCounter.current += 1
    return `k${keyCounter.current}`
  }, [])

  // Until the company's zone is read, the default window is drawn on the browser's; it is
  // redrawn on the company's when the read lands, unless the author has typed by then.
  const [values, setValues] = useState<MicroclimateWizardValues>(() => {
    const { startTime, endTime } = defaultWallWindow(new Date(), sessionZone(null))
    return {
      ...emptyWizardValues(locale === 'es' ? 'es' : 'en'),
      startTime,
      endTime,
      questions: [emptyQuestion('k0')],
    }
  })
  const [timeZone, setTimeZone] = useState<string | null | undefined>(undefined)
  const [startFrom, setStartFromState] = useState<StartFrom>('blank')
  const [previous, setPrevious] = useState<MicroclimateDetail | null>(null)
  const [templates, setTemplates] = useState<MicroclimateTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<DraftLoad>(editId ? { status: 'loading' } : { status: 'none' })
  const [attempted, setAttempted] = useState(false)
  const [submitting, setSubmitting] = useState<'draft' | 'launch' | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  // Once the author has typed, a late answer from the server must not overwrite the form.
  const touched = useRef(false)

  const copyPrevious = useCallback(
    (session: MicroclimateDetail, current: MicroclimateWizardValues, zone: string | null | undefined): MicroclimateWizardValues => {
      const clockZone = sessionZone(zone)
      const { start, startTime, endTime } = defaultWallWindow(new Date(), clockZone, session)
      const title = session.title
        ? t('microclimates.next.create.titleFromPrevious', {
            name: nameHead(session.title),
            date: shortDayIn(start, locale, clockZone),
          })
        : ''
      const inEs = current.language === 'es'
      return {
        ...current,
        titleEn: inEs ? current.titleEn : title,
        titleEs: inEs ? title : current.titleEs,
        startTime,
        endTime,
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

  // Editing: the draft is the starting point, so neither "the previous session" nor a template
  // is read. A bilingual draft is read in both languages -- see `wizardValuesFromDraft`.
  useEffect(() => {
    if (!editId) return
    let cancelled = false
    setDraft({ status: 'loading' })
    const read = async () => {
      const first = await getMicroclimate(baseUrl, editId, 'es')
      if (first.status !== 'draft' || first.responseCount > 0) return { first, en: null, es: null, zone: null }
      // The draft's own company's zone: a super administrator edits whichever tenant it is in.
      const zone = companyZone(baseUrl, first.companyId)
      if (first.language === 'both') return { first, en: await getMicroclimate(baseUrl, editId, 'en'), es: first, zone: await zone }
      if (first.language === 'es') return { first, en: null, es: first, zone: await zone }
      return { first, en: await getMicroclimate(baseUrl, editId, 'en'), es: null, zone: await zone }
    }
    read()
      .then(({ first, en, es, zone }) => {
        if (cancelled) return
        if (!en && !es) {
          setDraft({ status: 'notDraft', id: first.id })
          return
        }
        setTimeZone(zone)
        setValues(wizardValuesFromDraft(en, es, nextKey, zone))
        setDraft({ status: 'ready', companyId: first.companyId })
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!cancelled) setDraft({ status: 'failed', error: err instanceof Error ? err.message : t('errors.generic') })
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, editId, nextKey, t])

  useEffect(() => {
    if (!companyId || editId) return
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
      companyZone(baseUrl, companyId),
    ]).then(([session, list, zone]) => {
      if (cancelled) return
      setPrevious(session)
      setTemplates(list)
      setTimeZone(zone)
      setLoading(false)
      if (touched.current) return
      if (session) {
        setStartFromState('previous')
        setValues((current) => copyPrevious(session, current, zone))
      } else {
        const { startTime, endTime } = defaultWallWindow(new Date(), sessionZone(zone))
        setValues((current) => ({ ...current, startTime, endTime }))
      }
    })
    return () => {
      cancelled = true
    }
  }, [baseUrl, companyId, copyPrevious, editId, locale])

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
        if (next === 'previous' && previous) return copyPrevious(previous, current, timeZone)
        // A template brings no questions (`MicroclimateTemplate` has none), so both other
        // starts are an empty question to write.
        return { ...current, templateId: next === 'template' ? current.templateId : '', questions: [emptyQuestion(nextKey())] }
      })
    },
    [copyPrevious, nextKey, previous, timeZone],
  )

  const errors = useMemo(() => wizardStepErrors(values, t).review, [values, t])

  const submit = useCallback(
    async (mode: 'draft' | 'launch') => {
      setAttempted(true)
      if ((!companyId && !editId) || errors.length > 0) return
      setSubmitError(null)
      setSubmitting(mode)
      try {
        const created = editId
          ? await replaceMicroclimateContent(baseUrl, editId, buildReplaceInput(values, timeZone))
          : await createMicroclimate(baseUrl, buildCreateInput(values, companyId as string, timeZone))
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
    [baseUrl, companyId, editId, errors.length, navigate, t, timeZone, values],
  )

  return {
    draft,
    timeZone,
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
