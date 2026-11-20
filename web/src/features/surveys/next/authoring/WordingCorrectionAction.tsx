import { useState } from 'react'
import { PencilLine } from 'lucide-react'
import { useTranslation, type Locale } from '../../../../i18n'
import { describeKnownRefusal } from '../../../../api/describeApiError'
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
  Textarea,
} from '../../../../components/ui'
import { correctSurveyWording } from '../../api/paperResponses'
import type { AuthoringQuestion, SurveyQuestionAuthoring } from '../../api/surveyQuestionAuthoring'
import type { AuthoredText } from '../../api/surveyInvitationCopy'
import { isScaleType } from './model'

type Phase =
  | { phase: 'editing' }
  | { phase: 'saving' }
  | { phase: 'saved'; message: string }

/** A locale's words, authored only when they hold some: a blank field leaves the stored words alone. */
function words(text: string): AuthoredText {
  return { text, authored: text.trim() !== '' }
}

function hasAny(by: Record<Locale, AuthoredText>, locales: readonly Locale[]): boolean {
  return locales.some((locale) => by[locale]?.authored === true)
}

/**
 * «Corregir redacción» (ruled 2026-11-19): on a survey that already has answers, a super admin
 * changes the WORDS of its questions -- text, comment prompt, scale end words, option words, in
 * each language the survey is written in -- and nothing else. Every other part of a question is
 * shown, not offered: the server refuses any difference in it (`PUT /surveys/{id}/wording`), and
 * so the answers already stored keep the meaning they were given. Saved as a new version.
 *
 * A comment prompt is offered only where one exists, and the scale words only on a scale: adding
 * either would add something asked, which is not a correction.
 */
export function WordingCorrectionAction({
  surveyId,
  authoring,
  onSaved,
}: {
  surveyId: string
  authoring: SurveyQuestionAuthoring
  /** Called when the dialog closes after a save, so the editor reloads the new words. */
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const copy = (key: string, vars?: Record<string, string | number>) => t(`surveys.next.authoring.wording.${key}`, vars)
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<AuthoringQuestion[]>([])
  const [phase, setPhase] = useState<Phase>({ phase: 'editing' })
  const [problem, setProblem] = useState<string | null>(null)
  const locales = authoring.locales

  function start() {
    setDraft(structuredClone(authoring.questions))
    setPhase({ phase: 'editing' })
    setProblem(null)
    setOpen(true)
  }

  function close() {
    setOpen(false)
    if (phase.phase === 'saved') onSaved()
  }

  const setField = (index: number, field: 'text' | 'commentPrompt' | 'scaleLabelMin' | 'scaleLabelMax', locale: Locale, value: string) =>
    setDraft((current) => current.map((q, i) => (i === index ? { ...q, [field]: { ...q[field], [locale]: words(value) } } : q)))

  const setOption = (index: number, optionIndex: number, locale: Locale, value: string) =>
    setDraft((current) =>
      current.map((q, i) =>
        i === index
          ? {
              ...q,
              options: (q.options ?? []).map((option, o) =>
                o === optionIndex ? { ...option, label: { ...option.label, [locale]: words(value) } } : option,
              ),
            }
          : q,
      ),
    )

  async function save() {
    setPhase({ phase: 'saving' })
    setProblem(null)
    try {
      const result = await correctSurveyWording(baseUrl, surveyId, draft)
      const count = result.changedQuestionIds.length
      setPhase({
        phase: 'saved',
        message:
          count === 0
            ? copy('nothing')
            : count === 1
              ? copy('savedOne', { version: result.version })
              : copy('savedMany', { count, version: result.version }),
      })
    } catch (cause) {
      setProblem(describeKnownRefusal(cause, t) ?? copy('error'))
      setPhase({ phase: 'editing' })
    }
  }

  const label = (field: string, locale: Locale) =>
    locales.length > 1 ? copy('inLocale', { field, language: copy(locale === 'es' ? 'languageEs' : 'languageEn') }) : field
  const busy = phase.phase === 'saving'

  return (
    <>
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={start}>
        <PencilLine aria-hidden="true" />
        {copy('action')}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && !next && close()}>
        <DialogContent closeLabel={t('common.close')} className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{copy('title')}</DialogTitle>
            <DialogDescription>{copy('body')}</DialogDescription>
          </DialogHeader>
          {phase.phase === 'saved' ? (
            <p role="status" className="m-0 text-sm font-medium">
              {phase.message}
            </p>
          ) : (
            <ol className="m-0 flex list-none flex-col gap-6 p-0" data-testid="wording-questions">
              {draft.map((question, index) => {
                const original = authoring.questions[index]
                const withPrompt = original !== undefined && hasAny(original.commentPrompt, locales)
                const onScale = isScaleType(question.type)
                return (
                  <li key={question.id} className="flex flex-col gap-3 rounded-xl border border-line-panel p-4">
                    <p className="m-0 text-sm font-semibold">{copy('question', { position: index + 1 })}</p>
                    {locales.map((locale) => {
                      const id = `wording-${question.id}-text-${locale}`
                      return (
                        <div key={id} className="flex flex-col gap-1.5">
                          <Label htmlFor={id}>{label(copy('text'), locale)}</Label>
                          <Textarea
                            id={id}
                            rows={2}
                            disabled={busy}
                            value={question.text[locale]?.text ?? ''}
                            onChange={(event) => setField(index, 'text', locale, event.target.value)}
                          />
                        </div>
                      )
                    })}
                    {withPrompt
                      ? locales.map((locale) => {
                          const id = `wording-${question.id}-prompt-${locale}`
                          return (
                            <div key={id} className="flex flex-col gap-1.5">
                              <Label htmlFor={id}>{label(copy('commentPrompt'), locale)}</Label>
                              <Input
                                id={id}
                                disabled={busy}
                                value={question.commentPrompt[locale]?.text ?? ''}
                                onChange={(event) => setField(index, 'commentPrompt', locale, event.target.value)}
                              />
                            </div>
                          )
                        })
                      : null}
                    {onScale
                      ? (['scaleLabelMin', 'scaleLabelMax'] as const).flatMap((field) =>
                          locales.map((locale) => {
                            const id = `wording-${question.id}-${field}-${locale}`
                            return (
                              <div key={id} className="flex flex-col gap-1.5">
                                <Label htmlFor={id}>{label(copy(field), locale)}</Label>
                                <Input
                                  id={id}
                                  disabled={busy}
                                  value={question[field][locale]?.text ?? ''}
                                  onChange={(event) => setField(index, field, locale, event.target.value)}
                                />
                              </div>
                            )
                          }),
                        )
                      : null}
                    {(question.options ?? []).flatMap((option, optionIndex) =>
                      locales.map((locale) => {
                        const id = `wording-${question.id}-option-${optionIndex}-${locale}`
                        return (
                          <div key={id} className="flex flex-col gap-1.5">
                            <Label htmlFor={id}>{label(copy('option', { position: optionIndex + 1 }), locale)}</Label>
                            <Input
                              id={id}
                              disabled={busy}
                              value={option.label[locale]?.text ?? ''}
                              onChange={(event) => setOption(index, optionIndex, locale, event.target.value)}
                            />
                          </div>
                        )
                      }),
                    )}
                  </li>
                )
              })}
            </ol>
          )}
          {problem ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{problem}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={close}>
              {phase.phase === 'saved' ? t('common.close') : t('common.cancel')}
            </Button>
            {phase.phase === 'saved' ? null : (
              <Button type="button" variant="primary" disabled={busy} onClick={() => void save()}>
                {busy ? t('common.saving') : copy('save')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
