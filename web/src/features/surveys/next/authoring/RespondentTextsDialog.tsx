import { useEffect, useState } from 'react'
import { useTranslation, createTranslator, type Locale } from '../../../../i18n'
import { CATALOGUES } from '../../../../i18n/locale'
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  SkeletonText,
  TextareaField,
  TextField,
} from '../../../../components/ui'
import {
  ESTIMATED_MINUTES_MAX,
  ESTIMATED_MINUTES_MIN,
  getSurveyRespondentTexts,
  parseStatedMinutes,
  RESPONDENT_CLOSING_MAX,
  RESPONDENT_INTRO_MAX,
  saveSurveyRespondentTexts,
  type RespondentTextField,
  type SurveyRespondentTexts,
} from '../../api/surveyRespondentTexts'
import { describeApiError } from '../../../../api/describeApiError'
import { respondDuration } from '../../respondEstimate'

const baseUrl = import.meta.env.VITE_API_BASE_URL

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; context: SurveyRespondentTexts; draft: SurveyRespondentTexts['texts']; minutes: string }

/**
 * "Textos para quien responde": the survey's own anonymity-box paragraph and thank-you, in every
 * language the survey is written in (Eagle's corrections, 2026-10-20).
 *
 * Each box shows the product's default as its placeholder, in that box's language, so an empty
 * box says exactly what the respondent will read instead. That is the whole contract: empty is
 * the default, which is what every survey made before this feature keeps saying.
 *
 * Self-contained -- it loads and saves on its own -- so the distribution model, which already
 * carries every other write on the page, does not grow a second copy-editing state machine.
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

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setState({ status: 'loading' })
    setSaveError(null)
    getSurveyRespondentTexts(baseUrl, surveyId)
      .then((context) => {
        if (!cancelled) setState({ status: 'ready', context, draft: context.texts, minutes: context.estimatedMinutes === null ? '' : String(context.estimatedMinutes) })
      })
      .catch(() => { if (!cancelled) setState({ status: 'error' }) })
    return () => { cancelled = true }
  }, [open, surveyId])

  const edit = (locale: Locale, field: RespondentTextField, text: string) =>
    setState((current) =>
      current.status !== 'ready'
        ? current
        : { ...current, draft: { ...current.draft, [locale]: { ...current.draft[locale], [field]: { text, authored: current.draft[locale][field].authored } } } },
    )

  const editMinutes = (minutes: string) =>
    setState((current) => (current.status !== 'ready' ? current : { ...current, minutes }))

  const parsedMinutes = state.status === 'ready' ? parseStatedMinutes(state.minutes) : null
  const minutesInvalid = parsedMinutes !== null && !parsedMinutes.valid

  async function save() {
    if (state.status !== 'ready' || parsedMinutes === null || !parsedMinutes.valid) return
    setSaving(true)
    setSaveError(null)
    try {
      await saveSurveyRespondentTexts(baseUrl, surveyId, state.draft, state.context.requiredLocales, parsedMinutes.minutes)
      onSaved(t('surveys.next.respondentTexts.saved'))
      onOpenChange(false)
    } catch (cause) {
      setSaveError(describeApiError(cause, t))
    } finally {
      setSaving(false)
    }
  }

  // What the respondent reads while the duration box is empty: the estimate from the questions.
  const calculated = respondDuration(state.status === 'ready' ? state.context.questionCount : 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('surveys.next.respondentTexts.title')}</DialogTitle>
        </DialogHeader>
        <p className="m-0 text-base text-fg-secondary">{t('surveys.next.respondentTexts.help')}</p>
        {state.status === 'error' ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{t('surveys.next.respondentTexts.loadFailed')}</AlertDescription>
          </Alert>
        ) : state.status === 'loading' ? (
          <SkeletonText lines={4} />
        ) : (
          <div className="flex flex-col gap-panel-gap">
            {!state.context.editable && (
              <Alert variant="default">
                <AlertDescription>{t('surveys.distribution.copyLocked')}</AlertDescription>
              </Alert>
            )}
            <div className={state.context.requiredLocales.length > 1 ? 'grid gap-panel-gap md:grid-cols-2' : 'grid gap-panel-gap'}>
              {state.context.requiredLocales.map((locale) => {
                // The default in THIS box's language, which is what the respondent reads if it stays empty.
                const fallback = createTranslator(CATALOGUES[locale])
                return (
                  <section key={locale} className="flex flex-col gap-panel-gap">
                    {state.context.requiredLocales.length > 1 && (
                      <h3 className="text-xl font-semibold text-fg-primary">{t(`surveys.distribution.locale.${locale}`)}</h3>
                    )}
                    <TextareaField
                      label={t('surveys.next.respondentTexts.introLabel')}
                      description={t('surveys.next.respondentTexts.introHelp', { max: RESPONDENT_INTRO_MAX })}
                      placeholder={fallback('surveyRespond.anonymousBody')}
                      value={state.draft[locale].intro.text}
                      rows={5}
                      maxLength={RESPONDENT_INTRO_MAX}
                      disabled={!state.context.editable || saving}
                      onChange={(text) => edit(locale, 'intro', text)}
                    />
                    <TextareaField
                      label={t('surveys.next.respondentTexts.closingLabel')}
                      description={t('surveys.next.respondentTexts.closingHelp', { max: RESPONDENT_CLOSING_MAX })}
                      // The default thanks is its title alone since 2026-11-18 (`Submitted`).
                      placeholder={fallback('surveyRespond.thankYouTitle')}
                      value={state.draft[locale].closing.text}
                      rows={3}
                      maxLength={RESPONDENT_CLOSING_MAX}
                      disabled={!state.context.editable || saving}
                      onChange={(text) => edit(locale, 'closing', text)}
                    />
                  </section>
                )
              })}
            </div>
            {/* One per survey, not per language: a number. Empty is the calculation from the
                questions, and the placeholder is that calculation, so an empty box says exactly
                what the respondent reads (PROCOMER, 2026-11-19: «38 es mucho»). */}
            <TextField
              type="number"
              label={t('surveys.next.respondentTexts.durationLabel')}
              description={
                calculated.underAMinute
                  ? t('surveys.next.respondentTexts.durationHelpBrief')
                  : t('surveys.next.respondentTexts.durationHelp', { minutes: calculated.minutes })
              }
              placeholder={calculated.underAMinute ? '' : String(calculated.minutes)}
              value={state.minutes}
              error={minutesInvalid ? t('surveys.next.respondentTexts.durationInvalid', { min: ESTIMATED_MINUTES_MIN, max: ESTIMATED_MINUTES_MAX }) : undefined}
              disabled={!state.context.editable || saving}
              onChange={editMinutes}
            />
            {saveError && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            )}
            <div>
              <Button onClick={() => void save()} disabled={!state.context.editable || saving || minutesInvalid}>
                {saving ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
