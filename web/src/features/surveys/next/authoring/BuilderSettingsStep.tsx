import { CheckboxField, TextField } from '../../../../components/ui'
import { useTranslation } from '../../../../i18n'
import { PanelHeading } from '../../../shared-next/parts'
import type { SurveyWizardValues } from '../../wizardValues'

/**
 * The builder's settings step (G16): the per-survey settings `POST /surveys` (and
 * `POST /survey-templates/{id}/use`, through the same `ApplySettings`) accepts and no builder
 * control set until now. Each one is a choice made once, for THIS new survey; nothing here
 * reaches a survey that already exists.
 *
 * Only settings the respond form actually honours are offered, and every description says what
 * the respondent will see -- measured, not taken from the setting's name:
 *
 * - `randomizeQuestions` -- `orderQuestions` shuffles per respondent session (open questions
 *   last) and `respondDimensions` then prints NO dimension heading. One flag, one promise.
 * - `autoSave` -- `respondAutosaveAllowed`; it also needs `allowPartialResponses`, which the
 *   server enforces, so the box is disabled while partial responses are off.
 * - `timeLimitMinutes` -- the form shows it as a SUGGESTED time with a countdown, and says
 *   outright that nothing is submitted when it runs out (`timeLimitHelp` on the respond form).
 * - `responseLimit` -- `SurveyResponseEndpoints` refuses a NEW response once `ResponseCount`
 *   (completed responses) reaches it; a respondent already under way may finish.
 *
 * Deliberately absent (stored by the API, read by no sender, or settled by a ruling): see the
 * PR body for the list.
 */
export function BuilderSettingsStep({
  values,
  patch,
}: {
  values: SurveyWizardValues
  patch: (next: Partial<SurveyWizardValues>) => void
}) {
  const { t } = useTranslation()
  const copy = (key: string, vars?: Record<string, string | number>) => t(`surveys.next.builder.settings.${key}`, vars)
  return (
    <>
      <PanelHeading title={t('surveys.stepSettings')} />
      <p className="-mt-3 mb-0 text-sm text-fg-secondary">{copy('intro')}</p>
      <div className="flex flex-col gap-4" data-testid="builder-settings">
        <CheckboxField
          label={copy('randomizeLabel')}
          description={copy('randomizeHelp')}
          checked={values.randomizeQuestions === true}
          onChange={(checked) => patch({ randomizeQuestions: checked })}
        />
        <CheckboxField
          label={copy('autoSaveLabel')}
          description={values.allowPartialResponses ? copy('autoSaveHelp') : copy('autoSaveNeedsPartial')}
          // Partial responses off: the server refuses every partial save, so background saving
          // cannot happen whatever this says -- shown as off rather than as a promise.
          disabled={!values.allowPartialResponses}
          checked={values.allowPartialResponses && values.autoSave !== false}
          onChange={(checked) => patch({ autoSave: checked })}
        />
        {/* Stacked, not two columns: each description is several lines, and side by side the
            grid let the two fields start at different heights (settings-light.png, first shot). */}
        <div className="flex max-w-md flex-col gap-4">
          <TextField
            type="number"
            label={copy('timeLimitLabel')}
            description={copy('timeLimitHelp')}
            placeholder={copy('noLimit')}
            value={values.timeLimitMinutes ?? ''}
            onChange={(next) => patch({ timeLimitMinutes: next })}
          />
          <TextField
            type="number"
            label={copy('responseLimitLabel')}
            description={copy('responseLimitHelp')}
            placeholder={copy('noLimit')}
            value={values.responseLimit ?? ''}
            onChange={(next) => patch({ responseLimit: next })}
          />
        </div>
      </div>
    </>
  )
}
