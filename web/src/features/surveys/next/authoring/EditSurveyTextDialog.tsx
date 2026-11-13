import { useEffect, useState } from 'react'
import { describeKnownRefusal } from '../../../../api/describeApiError'
import { useTranslation, type Locale } from '../../../../i18n'
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  SkeletonText,
  Textarea,
} from '../../../../components/ui'
import { getSurveyText, type SurveyText } from '../../api/surveyText'

/** The longest title the builder accepts; the server trims and stores it as written. */
export const SURVEY_TITLE_MAX = 200

function readSurveyText(id: string): Promise<SurveyText> {
  return getSurveyText(import.meta.env.VITE_API_BASE_URL as string, id)
}

type Load = { status: 'loading' } | { status: 'failed'; message: string } | { status: 'ready'; text: SurveyText }

/**
 * «Editar nombre» -- a survey's name and description, in every language it is written in.
 *
 * Before 11 Nov 2026 nothing on screen could rename a survey at all, not even a draft: the name
 * was set in the builder and fixed from then on. Ruled 2026-11-11 for TIMS
 * (`docs/decisions/operators-edit-a-live-survey.md`): on a survey that has left draft, a super
 * admin may still change both, because no stored answer points at them. The dialog says what the
 * change does NOT reach -- the invitations already sent keep the old name -- and that it lands in
 * Historial.
 */
export function EditSurveyTextDialog({
  surveyId,
  live,
  open,
  onOpenChange,
  onSave,
  load = readSurveyText,
}: {
  surveyId: string
  /** The survey has left draft: respondents may already see it. */
  live: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (text: { title: Partial<Record<Locale, string>>; description: Partial<Record<Locale, string>> }) => Promise<void>
  /** Injectable only so a test need not stand up the API. */
  load?: (id: string) => Promise<SurveyText>
}) {
  const { t } = useTranslation()
  const copy = (key: string, vars?: Record<string, string | number>) => t(`surveys.next.detail.rename.${key}`, vars)
  const [state, setState] = useState<Load>({ status: 'loading' })
  const [title, setTitle] = useState<Partial<Record<Locale, string>>>({})
  const [description, setDescription] = useState<Partial<Record<Locale, string>>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setState({ status: 'loading' })
    setProblem(null)
    load(surveyId).then(
      (text) => {
        if (cancelled) return
        setTitle(Object.fromEntries(text.locales.map((l) => [l, text.title[l].text])))
        setDescription(Object.fromEntries(text.locales.map((l) => [l, text.description[l].text])))
        setState({ status: 'ready', text })
      },
      (cause: unknown) => {
        if (!cancelled) setState({ status: 'failed', message: describeKnownRefusal(cause, t) ?? t('errors.generic') })
      },
    )
    return () => {
      cancelled = true
    }
    // Every dependency is stable for the dialog's life (`t` is memoised, `load` a module function),
    // so this reads once per opening and never wipes what the operator is typing.
  }, [open, surveyId, load, t])

  const locales = state.status === 'ready' ? state.text.locales : []
  const bilingual = locales.length > 1
  const label = (field: 'titleLabel' | 'descriptionLabel', locale: Locale) =>
    bilingual ? copy(`${field}In`, { language: t(`surveys.next.detail.rename.language.${locale}`) }) : copy(field)

  async function save() {
    if (state.status !== 'ready') return
    const missing = locales.find((locale) => (title[locale] ?? '').trim() === '')
    if (missing) {
      setProblem(bilingual ? copy('errorTitleIn', { language: t(`surveys.next.detail.rename.language.${missing}`) }) : copy('errorTitle'))
      return
    }
    // A description the survey never had in a language, left empty, stays absent rather than
    // being written as "translated to nothing" -- the state `fallbackFields` reports.
    const descriptions: Partial<Record<Locale, string>> = {}
    for (const locale of locales) {
      const value = (description[locale] ?? '').trim()
      if (value !== '' || state.text.description[locale].authored) descriptions[locale] = value
    }
    setProblem(null)
    setSaving(true)
    try {
      await onSave({
        title: Object.fromEntries(locales.map((l) => [l, (title[l] ?? '').trim()])),
        description: descriptions,
      })
      onOpenChange(false)
    } catch (cause) {
      setProblem(describeKnownRefusal(cause, t) ?? t('errors.generic'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent closeLabel={t('common.close')} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy('title')}</DialogTitle>
          <DialogDescription>{live ? copy('bodyLive') : copy('body')}</DialogDescription>
        </DialogHeader>
        {state.status === 'loading' && <SkeletonText lines={4} />}
        {state.status === 'failed' && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        )}
        {state.status === 'ready' &&
          locales.map((locale) => (
            <div key={locale} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`survey-rename-title-${locale}`}>{label('titleLabel', locale)}</Label>
                <Input
                  id={`survey-rename-title-${locale}`}
                  value={title[locale] ?? ''}
                  maxLength={SURVEY_TITLE_MAX}
                  disabled={saving}
                  onChange={(event) => setTitle((prev) => ({ ...prev, [locale]: event.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`survey-rename-description-${locale}`}>{label('descriptionLabel', locale)}</Label>
                <Textarea
                  id={`survey-rename-description-${locale}`}
                  value={description[locale] ?? ''}
                  rows={5}
                  disabled={saving}
                  onChange={(event) => setDescription((prev) => ({ ...prev, [locale]: event.target.value }))}
                />
              </div>
            </div>
          ))}
        {live && state.status === 'ready' && (
          <p role="note" className="m-0 text-sm text-fg-secondary" data-testid="rename-reach">
            {copy('reach')}
          </p>
        )}
        {problem && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" variant="primary" disabled={saving || state.status !== 'ready'} onClick={() => void save()}>
            {saving ? t('common.saving') : copy('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
