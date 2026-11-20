import { useEffect, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  SkeletonText,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextField,
} from '../../../../components/ui'
import {
  ESTIMATED_MINUTES_MAX,
  ESTIMATED_MINUTES_MIN,
  getSurveyRespondentTexts,
  parseStatedMinutes,
  saveSurveyEstimatedMinutes,
  type SurveyRespondentTexts,
} from '../../api/surveyRespondentTexts'
import {
  getSurveyRespondentContent,
  RespondentContentRefusal,
  saveSurveyRespondentContent,
  type RespondentContentByLocale,
  type RespondentContentView,
  type RespondentTextLocale,
} from '../../api/respondentContent'
import {
  contentChanges,
  fieldLabelKey,
  hasChanges,
  ownValues,
  placeholderProblems,
  withValue,
} from '../../respondentContentEditor'
import { describeApiError } from '../../../../api/describeApiError'
import { respondDuration } from '../../respondEstimate'
import { RespondentContentFields, TextAlignField, type RefusedField } from './RespondentContentFields'

const baseUrl = import.meta.env.VITE_API_BASE_URL

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'ready'
      content: RespondentContentView
      texts: SurveyRespondentTexts
      draft: RespondentContentByLocale
      minutes: string
    }

const C = 'surveys.next.respondentContent'

/**
 * "Textos para quien responde": every text a respondent reads on this survey's screens, the
 * text alignment, and the stated duration (Eagle's corrections, 2026-10-20; widened to the whole
 * registry by the ruling of 2026-11-19, `docs/decisions/editable-respondent-content.md`).
 *
 * ## What an empty box is
 *
 * Inherit. A survey's text replaces its company's, which replaces the product default, per
 * language — so each box shows, as its placeholder AND under it, what the respondent reads if it
 * stays empty: «De la empresa: …» when the company wrote one in that language, «Predeterminado:
 * …» otherwise. Saving an emptied box clears it at this level, and the company's (or the
 * default) shows again.
 *
 * ## Where it saves
 *
 * The texts go to `PUT /surveys/{id}/respondent-content`, partial: only the boxes that changed
 * are sent. The anonymity paragraph and the thank-you still live in their survey columns — the
 * route writes them there — so this dialog and everything that read those columns agree. The
 * duration is a number, not a text: it still goes to `PUT /surveys/{id}` as
 * `settings.estimatedMinutes`, and only when it changed.
 *
 * ## Who may save
 *
 * The GET's `editable`: a company admin while the survey is draft, scheduled or active; a TIMS
 * super admin in any status but archived — the ruling's "although it's already published". Read
 * only otherwise. The duration keeps the settings rule (draft, scheduled or active) for everyone.
 *
 * Self-contained -- it loads and saves on its own -- so the distribution page, and the builder
 * that mounts it too, carry no copy-editing state of their own.
 */
export function RespondentTextsDialog({
  surveyId,
  open,
  onOpenChange,
  onSaved,
}: {
  surveyId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (message: string) => void
}) {
  const { t } = useTranslation()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [refused, setRefused] = useState<RefusedField | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setState({ status: 'loading' })
    setSaveError(null)
    setRefused(null)
    Promise.all([getSurveyRespondentContent(baseUrl, surveyId), getSurveyRespondentTexts(baseUrl, surveyId)])
      .then(([content, texts]) => {
        if (cancelled) return
        setState({
          status: 'ready',
          content,
          texts,
          draft: ownValues(content),
          minutes: texts.estimatedMinutes === null ? '' : String(texts.estimatedMinutes),
        })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [open, surveyId])

  const editText = (locale: RespondentTextLocale | '*', key: string, value: string) => {
    setRefused(null)
    setState((current) => (current.status !== 'ready' ? current : { ...current, draft: withValue(current.draft, locale, key, value) }))
  }

  const editMinutes = (minutes: string) =>
    setState((current) => (current.status !== 'ready' ? current : { ...current, minutes }))

  const parsedMinutes = state.status === 'ready' ? parseStatedMinutes(state.minutes) : null
  const minutesInvalid = parsedMinutes !== null && !parsedMinutes.valid
  const locales: RespondentTextLocale[] = state.status === 'ready' ? state.content.requiredLocales : []
  const problems = state.status === 'ready' ? placeholderProblems(state.content.entries, state.draft, locales) : []
  const textsEditable = state.status === 'ready' && state.content.editable
  const minutesEditable = state.status === 'ready' && state.texts.editable

  async function save() {
    if (state.status !== 'ready' || parsedMinutes === null || !parsedMinutes.valid || problems.length > 0) return
    setSaving(true)
    setSaveError(null)
    setRefused(null)
    try {
      const changes = contentChanges(ownValues(state.content), state.draft, state.content.requiredLocales)
      if (textsEditable && hasChanges(changes)) {
        await saveSurveyRespondentContent(baseUrl, surveyId, changes)
      }
      if (minutesEditable && parsedMinutes.minutes !== state.texts.estimatedMinutes) {
        await saveSurveyEstimatedMinutes(baseUrl, surveyId, parsedMinutes.minutes)
      }
      onSaved(t('surveys.next.respondentTexts.saved'))
      onOpenChange(false)
    } catch (cause) {
      const reason = describeApiError(cause, t)
      if (cause instanceof RespondentContentRefusal && cause.key !== null) {
        setRefused({ key: cause.key, locale: cause.locale, message: reason })
        setSaveError(
          t(`${C}.refusedField`, {
            field: t(fieldLabelKey(cause.key)),
            locale: cause.locale && cause.locale !== '*' ? t(`surveys.distribution.locale.${cause.locale}`) : '—',
            reason,
          }),
        )
      } else {
        setSaveError(reason)
      }
    } finally {
      setSaving(false)
    }
  }

  // What the respondent reads while the duration box is empty: the estimate from the questions.
  const calculated = respondDuration(state.status === 'ready' ? state.texts.questionCount : 0)

  const fieldsFor = (ready: Extract<State, { status: 'ready' }>, locale: RespondentTextLocale) => (
    <RespondentContentFields
      view={ready.content}
      locale={locale}
      draft={ready.draft}
      disabled={!textsEditable || saving}
      refused={refused}
      onChange={editText}
    />
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('surveys.next.respondentTexts.title')}</DialogTitle>
        </DialogHeader>
        <p className="m-0 text-base text-fg-secondary">{t('surveys.next.respondentTexts.helpChain')}</p>
        {state.status === 'error' ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{t('surveys.next.respondentTexts.loadFailed')}</AlertDescription>
          </Alert>
        ) : state.status === 'loading' ? (
          <SkeletonText lines={4} />
        ) : (
          <div className="flex flex-col gap-panel-gap">
            {!textsEditable && (
              <Alert variant="default">
                <AlertDescription>{t('surveys.next.respondentTexts.locked')}</AlertDescription>
              </Alert>
            )}
            {/* One per survey, not per language: a number. Empty is the calculation from the
                questions, and the placeholder is that calculation, so an empty box says exactly
                what the respondent reads (PROCOMER, 2026-11-19: «38 es mucho»). */}
            <TextField
              type="number"
              label={t('surveys.next.respondentTexts.durationLabel')}
              description={[
                calculated.underAMinute
                  ? t('surveys.next.respondentTexts.durationHelpBrief')
                  : t('surveys.next.respondentTexts.durationHelp', { minutes: calculated.minutes }),
                minutesEditable ? '' : t('surveys.next.respondentTexts.durationLocked'),
              ]
                .filter(Boolean)
                .join(' ')}
              placeholder={calculated.underAMinute ? '' : String(calculated.minutes)}
              value={state.minutes}
              error={minutesInvalid ? t('surveys.next.respondentTexts.durationInvalid', { min: ESTIMATED_MINUTES_MIN, max: ESTIMATED_MINUTES_MAX }) : undefined}
              disabled={!minutesEditable || saving}
              onChange={editMinutes}
            />
            <TextAlignField
              view={state.content}
              draft={state.draft}
              disabled={!textsEditable || saving}
              onChange={(value) => editText('*', 'display.textAlign', value)}
            />
            <h3 className="m-0 font-sans text-xl font-semibold text-fg-primary">{t('surveys.next.respondentTexts.screensHeading')}</h3>
            {locales.length > 1 ? (
              <Tabs defaultValue={locales[0]} className="flex flex-col gap-panel-gap">
                <TabsList>
                  {locales.map((locale) => (
                    <TabsTrigger key={locale} value={locale}>
                      {t(`surveys.distribution.locale.${locale}`)}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {locales.map((locale) => (
                  <TabsContent key={locale} value={locale}>
                    {fieldsFor(state, locale)}
                  </TabsContent>
                ))}
              </Tabs>
            ) : (
              locales.map((locale) => <div key={locale}>{fieldsFor(state, locale)}</div>)
            )}
            {problems.length > 0 && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>
                  {problems
                    .map((problem) =>
                      t(`${C}.refusedField`, {
                        field: t(fieldLabelKey(problem.key)),
                        locale: t(`surveys.distribution.locale.${problem.locale}`),
                        reason: t(`${C}.unknownPlaceholder`, { placeholder: problem.placeholder }),
                      }),
                    )
                    .join(' ')}
                </AlertDescription>
              </Alert>
            )}
            {saveError && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            )}
            <div>
              <Button
                onClick={() => void save()}
                disabled={(!textsEditable && !minutesEditable) || saving || minutesInvalid || problems.length > 0}
              >
                {saving ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
