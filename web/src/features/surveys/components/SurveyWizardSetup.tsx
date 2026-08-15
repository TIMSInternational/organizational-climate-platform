import { useTranslation } from '../../../i18n'

export interface SurveyWizardSetupProps {
  /** The chosen template's name, `null` for a blank survey, `undefined` while it loads. */
  templateName: string | null | undefined
  /** Already-translated name of the survey's content language. */
  languageName: string
}

/**
 * The two decisions that change what the rest of the survey wizard does, kept in the
 * rail where they stay visible on every step.
 *
 * Both are made on the basics step and both stop being visible the moment it is left,
 * which is exactly when they start mattering most: on the questions step a template
 * makes the editor a read-only preview, and a `both` content language is why the title
 * and every question have two boxes. Someone four steps in has no other way to check
 * either without walking back.
 *
 * They are readings, not controls. Changing the template from here would mean
 * re-validating the questions step from a panel that is not the questions step, and the
 * language picker is already disabled in template mode for a reason
 * (`/survey-templates/{id}/use` takes no language). So this reports, and the basics step
 * remains the one place either is decided.
 *
 * `undefined` and `null` are different answers and are shown differently: `undefined` is
 * "the template detail has not arrived", which is the same state that makes the questions
 * step block, and `null` is "no template was chosen".
 *
 * `text-fg-secondary` rather than `text-fg-tertiary` for the labels, because
 * `respondContrast.test.ts` bans the latter from `features/surveys/` by name: #818181 on
 * this panel's recessed #f0f0f0 measures 3.42:1 in light against AA's 4.5:1. That guard
 * caught this file on its first run; #474747 is 8.15:1.
 */
export default function SurveyWizardSetup({ templateName, languageName }: SurveyWizardSetupProps) {
  const { t } = useTranslation()

  return (
    <div className="rounded-xl border border-line-light bg-surface-icon-box p-card">
      <p className="m-0 text-2xs font-semibold uppercase tracking-label text-fg-secondary">
        {t('surveys.railSetup')}
      </p>
      <dl className="m-0 mt-inline grid gap-1">
        {templateName !== null && (
          <div className="grid gap-0.5">
            <dt className="text-xs text-fg-secondary">{t('surveys.railTemplate')}</dt>
            <dd className="m-0 break-words text-base font-medium">
              {templateName ?? t('common.loading')}
            </dd>
          </div>
        )}
        <div className="grid gap-0.5">
          <dt className="text-xs text-fg-secondary">{t('surveys.contentLanguage')}</dt>
          <dd className="m-0 break-words text-base font-medium">{languageName}</dd>
        </div>
      </dl>
    </div>
  )
}
