import { Link } from 'react-router'
import { Mail } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { Alert, AlertDescription, AlertTitle, Button, Input } from '../../components/ui'
import { AuthCanvas, AuthCard, AuthField, AuthHeadline } from './AuthCanvas'
import { AuthTransitionCard } from './AuthTransitionCard'
import { useRegisterModel } from './useRegisterModel'

/**
 * `/register` — the Register artboard, which replaced `RegisterPage` on this route (the
 * old page stays in the tree, unrouted, with its own tests, as the wiring reference).
 *
 * ## What this endpoint actually does, said before the user submits
 *
 * `POST /auth/signup` takes `{ name, email, password }`, joins the new account to the
 * company whose `EmailDomain` matches the address, and mints it `Roles.Employee`. There is
 * no company picker and no approval step. Both of those decisions are invisible on a form
 * that only asks for three fields, so the card states them: the domain rule under the
 * email field, the role under the button.
 *
 * ## The 404 is the invitation route, in our words and not the server's
 *
 * When no company has registered the domain the server answers 404 with an English
 * sentence. The previous page printed it verbatim — on a Spanish screen, to a person whose
 * only remaining option is to ask an administrator for an invitation. The artboard's
 * annotation names that as the defect to fix, so this page prints the catalogue's sentence
 * with the typed domain in it, as guidance rather than as a red failure, and the form keeps
 * everything that was typed.
 *
 * ## What the password rule on screen is
 *
 * `DEFAULT_PASSWORD_POLICY` in `derive.ts` — the shipped default of
 * `SystemSettings.PasswordPolicy`, which is what the artboard states. The button disables
 * on a password that cannot satisfy it, so the round trip that would have been refused
 * with an English list of unmet rules does not happen.
 */
export default function RegisterNextPage() {
  const { t } = useTranslation()
  const model = useRegisterModel()

  if (model.submitting) {
    return <AuthTransitionCard detail={t('auth.next.transitionRegister')} />
  }

  return (
    <AuthCanvas stage="access">
      <AuthCard>
        <AuthHeadline
          eyebrow={t('auth.next.eyebrow')}
          title={t('auth.next.createAccount')}
          description={t('auth.next.registerDetail')}
        />

        <form className="flex flex-col gap-3.5" onSubmit={model.submit}>
          {/* Not an alert and not red: this is the product's onboarding rule answering,
              and the reader's next step is a request to a person, not a correction to a
              field. The recessed surface is the artboard's own. */}
          {model.needsInvitation && (
            <Alert
              variant="default"
              role="status"
              className="border-line-light bg-surface-outer px-3.5 [&>svg]:text-fg-secondary"
            >
              <Mail aria-hidden="true" />
              <AlertTitle className="text-base font-semibold text-fg-primary">
                {t('auth.next.invitationNeededTitle')}
              </AlertTitle>
              <AlertDescription>
                {model.domain
                  ? t('auth.next.invitationNeededBody', { domain: model.domain })
                  : t('auth.next.invitationNeededBodyNoDomain')}
              </AlertDescription>
            </Alert>
          )}

          {model.serverError && (
            <Alert variant="destructive" role="alert" className="px-3.5">
              <AlertDescription>{model.serverError}</AlertDescription>
            </Alert>
          )}

          <AuthField htmlFor="register-name" fieldLabel={t('auth.next.nameLabel')} required>
            <Input
              id="register-name"
              autoComplete="name"
              required
              value={model.name}
              placeholder={t('auth.next.namePlaceholder')}
              onChange={(event) => model.setName(event.target.value)}
            />
          </AuthField>

          <AuthField
            htmlFor="register-email"
            fieldLabel={t('auth.next.emailLabel')}
            required
            // The rule, not the value: the board states that the organisation is decided
            // by the domain and not chosen here, and `/auth/success` is where the domain
            // that actually decided it is named — off the minted token rather than off
            // what was typed.
            helper={t('auth.next.registerDomainHelp')}
          >
            <Input
              id="register-email"
              type="email"
              autoComplete="email"
              required
              value={model.email}
              placeholder={t('auth.next.emailPlaceholder')}
              onChange={(event) => model.setEmail(event.target.value)}
            />
          </AuthField>

          <AuthField
            htmlFor="register-password"
            fieldLabel={t('auth.next.passwordLabel')}
            required
            helper={t('auth.next.passwordPolicy')}
          >
            <Input
              id="register-password"
              type="password"
              autoComplete="new-password"
              required
              value={model.password}
              onChange={(event) => model.setPassword(event.target.value)}
            />
          </AuthField>

          {/* "Crear cuenta", not the heading's "Crear una cuenta": the board sets the
              button shorter than the title on purpose, and a control repeating its page's
              `<h1>` word for word reads as a second heading. */}
          <Button type="submit" variant="primary" size="canvas" className="w-full" disabled={!model.passwordOk}>
            {t('auth.next.createAccountAction')}
          </Button>

          <p className="m-0 text-sm text-fg-tertiary">{t('auth.next.registerRoleNote')}</p>
        </form>
      </AuthCard>

      {/* Under the card, centred, as the board draws it. The base layer inks every anchor
          in the app's link blue; the canvas's is the primary ink, underlined. */}
      <p className="m-0 flex flex-wrap justify-center gap-1.5 text-base text-fg-secondary">
        <span>{t('auth.next.alreadyHaveAccount')}</span>
        <Link to="/login" className="text-fg-primary underline">
          {t('auth.next.signIn')}
        </Link>
      </p>

    </AuthCanvas>
  )
}
