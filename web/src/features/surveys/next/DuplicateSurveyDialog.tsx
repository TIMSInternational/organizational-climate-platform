import { useEffect, useState } from 'react'
import { useTranslation } from '../../../i18n'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  RadioGroup,
  RadioGroupItem,
} from '../../../components/ui'

type DuplicateChoice = 'withAudience' | 'questionsOnly'

/**
 * «Duplicar» asks first which copy to make (ruled 2026-11-18, PROCOMER's DEMO copy):
 *
 * - «Copiar con la misma audiencia» -- the default, and exactly the copy «Duplicar» always made.
 * - «Solo las preguntas — la audiencia queda por elegir» -- the copy is aimed at NOBODY until
 *   «Editar audiencia» saves an audience, and nothing can send, schedule or activate it before
 *   then. Never "no targets", which would be the whole company.
 *
 * The settings travel either way; only the people differ. One dialog for every place «Duplicar»
 * is offered -- the detail page, both survey lists and the questions editor -- so the choice
 * reads the same wherever it is made.
 */
export function DuplicateSurveyDialog({
  open,
  onOpenChange,
  busy = false,
  onDuplicate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  busy?: boolean
  /** `includeAudience` false is «Solo las preguntas». */
  onDuplicate: (includeAudience: boolean) => void
}) {
  const { t } = useTranslation()
  const copy = (key: string) => t(`surveys.next.duplicate.${key}`)
  const [choice, setChoice] = useState<DuplicateChoice>('withAudience')

  // Each opening starts from the default: a choice left from an earlier copy must not carry over.
  useEffect(() => {
    if (open) setChoice('withAudience')
  }, [open])

  return (
    <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <DialogContent closeLabel={t('common.close')} className="max-w-lg" data-testid="duplicate-survey-dialog">
        <DialogHeader>
          <DialogTitle>{copy('title')}</DialogTitle>
          <DialogDescription>{copy('intro')}</DialogDescription>
        </DialogHeader>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="sr-only">{copy('choiceLabel')}</legend>
          <RadioGroup
            aria-label={copy('choiceLabel')}
            value={choice}
            onValueChange={(next) => setChoice(next === 'questionsOnly' ? 'questionsOnly' : 'withAudience')}
            className="gap-3"
          >
            {(['withAudience', 'questionsOnly'] as const).map((option) => {
              const itemId = `duplicate-survey-${option}`
              return (
                <div key={option} className="flex items-start gap-2">
                  <RadioGroupItem id={itemId} value={option} aria-describedby={`${itemId}-help`} className="mt-1" />
                  <label htmlFor={itemId} className="min-w-0 cursor-pointer">
                    <span className="block text-sm font-medium text-fg-primary">{copy(option)}</span>
                    <span id={`${itemId}-help`} className="block text-sm text-fg-secondary">
                      {copy(option === 'questionsOnly' ? 'questionsOnlyHelp' : 'withAudienceHelp')}
                    </span>
                  </label>
                </div>
              )
            })}
          </RadioGroup>
        </fieldset>
        <p className="m-0 text-sm text-fg-secondary">{copy('keeps')}</p>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" variant="primary" disabled={busy} onClick={() => onDuplicate(choice === 'withAudience')}>
            {copy('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
