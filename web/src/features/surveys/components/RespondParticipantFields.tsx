import { useTranslation } from '../../../i18n'
import { Alert, AlertDescription, Input } from '../../../components/ui'
import { PARTICIPANT_EMAIL_MAX, PARTICIPANT_NAME_MAX, type ParticipantProblem } from './participantIdentity'

/**
 * "¿Quién responde?" — the respondent's name (required) and email (optional), asked once,
 * after the demographic questions and before the first survey question.
 *
 * The copy above the fields is the whole consent and it is written to be literally true of
 * the storage: we record THAT they answered, never WHAT. The name and email go to
 * `survey_participations`, which holds no response id, no área and no time of day, in a
 * write the server makes only after the response itself has been stored
 * (`docs/decisions/participation-is-not-linked-to-answers.md`). Nothing here is sent until
 * the completing post — an abandoned survey leaves no name behind.
 *
 * `Input` and not a bare `<input>`: `index.css` gives every bare input a fixed 32px height,
 * the admin shell's density. `h-11` and `text-respond` are this page's, for a control an
 * operario taps on a phone — the same two overrides `RespondDemographicField`'s select needs.
 */
export default function RespondParticipantFields({
  name,
  email,
  problem,
  disabled,
  onNameChange,
  onEmailChange,
}: {
  name: string
  email: string
  problem: ParticipantProblem
  disabled: boolean
  onNameChange: (next: string) => void
  onEmailChange: (next: string) => void
}) {
  const { t } = useTranslation('surveyRespond')

  return (
    <fieldset
      id="participant-identity"
      tabIndex={-1}
      className="min-w-0 rounded-xl border border-line-default bg-surface-card p-panel shadow-sm transition-colors focus-within:border-accent-blue-ring"
    >
      <legend className="float-left m-0 w-full p-0">
        <span className="block text-question font-normal text-fg-primary md:text-respond-question">
          {t('identity.question')}
        </span>
      </legend>

      <div className="clear-both flex flex-col gap-4 pt-3.5">
        {problem !== null && (
          <Alert variant="destructive" role="alert">
            <AlertDescription id="participant-error">
              {problem === 'name' ? t('identity.nameMissing') : t('identity.emailInvalid')}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="participant-name" className="mb-0 text-respond font-medium text-fg-primary">
            {t('identity.name')}
            <span className="sr-only"> {t('requiredMarker')}</span>
          </label>
          <Input
            id="participant-name"
            type="text"
            autoComplete="name"
            className="h-11 text-respond"
            value={name}
            maxLength={PARTICIPANT_NAME_MAX}
            required
            disabled={disabled}
            aria-invalid={problem === 'name' || undefined}
            aria-describedby={problem === 'name' ? 'participant-error' : undefined}
            onChange={(event) => onNameChange(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="participant-email" className="mb-0 text-respond font-medium text-fg-primary">
            {t('identity.email')} <span className="font-normal text-fg-secondary">{t('next.optional')}</span>
          </label>
          <Input
            id="participant-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            className="h-11 text-respond"
            value={email}
            maxLength={PARTICIPANT_EMAIL_MAX}
            disabled={disabled}
            aria-invalid={problem === 'email' || undefined}
            aria-describedby={problem === 'email' ? 'participant-error participant-email-help' : 'participant-email-help'}
            onChange={(event) => onEmailChange(event.target.value)}
          />
          <p id="participant-email-help" className="m-0 text-respond-sm text-fg-secondary">
            {t('identity.emailHelp')}
          </p>
        </div>
      </div>
    </fieldset>
  )
}
