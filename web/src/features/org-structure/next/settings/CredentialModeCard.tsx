import { useId } from 'react'
import { Info } from 'lucide-react'
import { useTranslation } from '../../../../i18n'
import { RadioGroup, RadioGroupItem } from '../../../../components/ui'
import { CREDENTIAL_MODES, type CredentialMode } from '../../api/companySettings'
import { Panel } from '../super/parts'
import { credentialModeLabel } from './credentialModeLabel'

const K = 'companySettings.credentialMode'

/**
 * How a company's people sign in to its surveys — `CompanySettings.CredentialMode`, which no
 * screen showed or set before (audit G1): an admin learned it from an import's done screen,
 * after the accounts existed.
 *
 * Shared by the company administrator's settings and the super administrator's company detail,
 * so the two describe the mode in the same words. The saved mode is printed apart from the
 * choice, because a choice that differs from it changes nothing until the page is saved — and
 * even then only surveys created afterwards: each survey froze its own mode at create
 * (`SurveyEndpoints.CreateAsync`, `CredentialModes.Resolve`).
 */
export default function CredentialModeCard({
  saved,
  value,
  onChange,
  disabled = false,
}: {
  /** What the server holds now. */
  saved: CredentialMode
  /** What the form will send. */
  value: CredentialMode
  onChange: (mode: CredentialMode) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const ids = useId()
  const headingId = `${ids}-heading`

  return (
    <Panel
      labelledBy={headingId}
      heading={
        <h2 id={headingId} className="m-0 text-2xl">
          {t(`${K}.heading`)}
        </h2>
      }
      meta={t(`${K}.meta`)}
      className="gap-4 pb-5"
    >
      <p data-slot="credential-mode-current" className="m-0 text-sm text-fg-secondary">
        {t(`${K}.current`, { mode: credentialModeLabel(t, saved) })}
      </p>
      <RadioGroup
        aria-labelledby={headingId}
        value={value}
        disabled={disabled}
        onValueChange={(next) => onChange(next === 'per_survey' ? 'per_survey' : 'shared')}
        className="gap-3"
      >
        {CREDENTIAL_MODES.map((mode) => {
          const itemId = `${ids}-${mode}`
          return (
            <div key={mode} className="flex min-w-0 items-start gap-2.5">
              <RadioGroupItem id={itemId} value={mode} aria-describedby={`${itemId}-help`} className="mt-1" />
              <label htmlFor={itemId} className="min-w-0 cursor-pointer">
                <span className="block text-base font-medium text-fg-primary">{credentialModeLabel(t, mode)}</span>
                <span id={`${itemId}-help`} className="block text-sm text-fg-secondary">
                  {t(mode === 'per_survey' ? `${K}.perSurveyHelp` : `${K}.sharedHelp`)}
                </span>
              </label>
            </div>
          )
        })}
      </RadioGroup>
      <p className="m-0 flex items-start gap-2 rounded-md bg-surface-icon-box px-3.5 py-3 text-sm text-fg-secondary">
        <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <span>
          {value !== saved ? `${t(`${K}.pending`, { mode: credentialModeLabel(t, value) })} ` : ''}
          {t(`${K}.appliesToNew`)}
        </span>
      </p>
    </Panel>
  )
}
