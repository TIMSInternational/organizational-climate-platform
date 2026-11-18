import type { TranslateFn } from '../../../../i18n'
import type { SurveyCredentialMode } from '../../api/companySettings'

/** A credential mode's name, as every screen that shows one prints it. */
export function credentialModeLabel(t: TranslateFn, mode: SurveyCredentialMode): string {
  if (mode === 'per_survey') return t('companySettings.credentialMode.perSurveyLabel')
  if (mode === 'personal_link') return t('companySettings.credentialMode.personalLinkLabel')
  return t('companySettings.credentialMode.sharedLabel')
}
