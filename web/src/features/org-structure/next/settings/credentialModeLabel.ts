import type { TranslateFn } from '../../../../i18n'
import type { CredentialMode } from '../../api/companySettings'

/** A credential mode's name, as every screen that shows one prints it. */
export function credentialModeLabel(t: TranslateFn, mode: CredentialMode): string {
  return t(mode === 'per_survey' ? 'companySettings.credentialMode.perSurveyLabel' : 'companySettings.credentialMode.sharedLabel')
}
