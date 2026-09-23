import type { FormEvent, ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { CheckCircle2, ShieldCheck } from 'lucide-react'
import { useTranslation } from '../../../../i18n'
import { Alert, AlertDescription, Button, Spinner, TextField } from '../../../../components/ui'
import { InvitationFrame } from './InvitationFrame'
import { cn } from '../../../../lib/cn'
import { useAcceptInvitationModel } from './useAcceptInvitationModel'

/** `SystemSettings.PasswordPolicy.MinLength` defaults to 8; the server is authoritative. */
const DEFAULT_MIN_PASSWORD_LENGTH = 8

/** The artboard's `.card`: 8px, the default hairline, the faint shadow. */
const CARD = 'rounded-xl border border-line-default bg-surface-card shadow-sm'

/**
 * `/accept-invitation/:token` — accepting an invitation and choosing a password, drawn as
 * the AcceptInvitation artboard (10 Sep). It replaced `AcceptInvitationPage` on this
 * route; the old page stays in the tree, unrouted, as the wiring reference.
 *
 * This is the only way most users of this product are created — the self-service
 * `/register` path works solely for email domains a company has already registered — so it
 * is the page a demo is most likely to walk through.
 *
 * ## What the redesign changed
 *
 * **A refusal that cannot be fixed takes the form away.** The artboard's right-hand panel
 * names three — caducada, ya usada, no encontrada — and says what is wrong today: they
 * arrive as the server's English sentence, above a form that will refuse every further
 * submission. They are now sentences from the catalogue, in the reader's language, in
 * place of the form (`derive.ts`). A refusal the invitee CAN fix — a short password, an
 * address on the wrong domain — still sits above a form they can correct, which is the
 * behaviour this page always had.
 *
 * **The frame is the public strip, full width.** The compact lockup at the left margin and
 * the language and theme chips at the right, over one centred column — the same strip the
 * invitee meets again on the survey they were invited to answer, but spanning the window
 * rather than capped at the column. `InvitationFrame` says why that cannot be
 * `RespondShell` and what should replace both.
 *
 * ## What is drawn from the invitation, and what is not
 *
 * Nothing. The artboard proposes a block naming the company, the inviter and the role, and
 * marks it "dato nuevo" precisely because the page cannot know any of it: the only
 * endpoint this token has is `POST /invitations/{token}/accept`, which is the submission
 * itself. There is no public read. So the heading names no organisation, and the email
 * field is an editable optional input rather than the artboard's locked one — a shareable
 * link needs an address supplied, and a personal invitation carries its own. Inventing a
 * company name here, or drawing a locked field over a value this page never received,
 * would be a screen built on a fiction.
 */
export default function AcceptInvitationNextPage() {
  const { t } = useTranslation()
  const { token } = useParams<{ token: string }>()
  const model = useAcceptInvitationModel(token)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void model.submit()
  }

  return (
    <InvitationFrame skipLabel={t('auth.next.accept.skip')}>
      {model.submitting ? (
        <PendingState />
      ) : model.accountCreated ? (
        <CreatedState />
      ) : model.failure?.terminal ? (
        <DeadState
          titleKey={model.failure.titleKey}
          bodyKey={model.failure.bodyKey}
          offerSignIn={model.failure.offerSignIn}
        />
      ) : (
        <Form model={model} onSubmit={handleSubmit} />
      )}
    </InvitationFrame>
  )
}

function Form({
  model,
  onSubmit,
}: {
  model: ReturnType<typeof useAcceptInvitationModel>
  onSubmit: (event: FormEvent) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-panel-gap">
      <section className={cn(CARD, 'flex flex-col gap-5 p-7 pb-6')}>
        <header className="grid gap-2">
          <span className="text-2xs font-semibold uppercase tracking-eyebrow text-fg-secondary">
            {t('auth.next.accept.eyebrow')}
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
            {t('auth.next.accept.title')}
          </h1>
          <p className="max-w-prose text-base text-fg-secondary">
            {t('auth.next.accept.description')}
          </p>
        </header>

        {/* A refusal the invitee can still do something about. The server's own words,
            because they are the only statement of which requirement was missed — the
            password policy is configurable and this page cannot read it. */}
        {model.serverMessage && !model.failure?.terminal && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{model.serverMessage}</AlertDescription>
          </Alert>
        )}

        <form className="grid gap-panel-gap" onSubmit={onSubmit}>
          {/* Optional: a personal invitation already carries the address, and only a
              shareable link needs one supplied. */}
          <TextField
            label={t('auth.next.accept.emailLabel')}
            type="email"
            value={model.email}
            description={t('auth.next.accept.emailHint')}
            onChange={model.setEmail}
          />
          <TextField
            label={t('auth.next.accept.nameLabel')}
            value={model.name}
            required
            placeholder={t('auth.next.accept.namePlaceholder')}
            onChange={model.setName}
          />
          <TextField
            label={t('auth.next.accept.passwordLabel')}
            type="password"
            value={model.password}
            required
            description={t('auth.next.accept.passwordHint', { min: DEFAULT_MIN_PASSWORD_LENGTH })}
            onChange={model.setPassword}
          />
          <Button
            type="submit"
            variant="primary"
            size="canvas"
            className="w-full"
            disabled={model.password.length > 0 && model.password.length < DEFAULT_MIN_PASSWORD_LENGTH}
          >
            {t('auth.next.accept.submit')}
          </Button>
        </form>
      </section>

      <p className="flex flex-wrap items-center justify-center gap-inline text-base">
        <span className="text-fg-secondary">{t('auth.next.accept.alreadyHaveAccount')}</span>
        <Link to="/login">{t('auth.next.accept.signIn')}</Link>
      </p>

      {/* The one promise this page can make about what the account is for, and the reason
          an employee should be willing to create one at all. */}
      <p className="flex items-start gap-inline px-1 text-sm text-fg-secondary">
        <ShieldCheck aria-hidden="true" className="size-icon shrink-0 translate-y-0.5 text-accent-green" />
        <span className="min-w-0">{t('auth.next.accept.anonymityNote')}</span>
      </p>
    </div>
  )
}

/**
 * The invitation is over, whatever is typed next.
 *
 * `role="alert"` because it replaces the control the reader was using: it has to be
 * announced rather than wait its turn. The sign-in link is offered only where signing in
 * is genuinely the way out — an invitation already accepted, or an address that already
 * has an account — and never for an expired or unknown one, where it would send somebody
 * with no account to a form they cannot pass.
 */
function DeadState({
  titleKey,
  bodyKey,
  offerSignIn,
}: {
  titleKey: string | null
  bodyKey: string | null
  offerSignIn: boolean
}) {
  const { t } = useTranslation('auth')

  return (
    <StateCard
      label={t('next.accept.deadEyebrow')}
      title={titleKey === null ? t('next.accept.notFoundTitle') : t(titleKey)}
      body={bodyKey === null ? t('next.accept.notFoundBody') : t(bodyKey)}
      live="alert"
      action={
        offerSignIn ? (
          <Button asChild variant="primary" size="canvas" className="w-full">
            <Link to="/login">{t('next.accept.signIn')}</Link>
          </Button>
        ) : undefined
      }
    />
  )
}

/** The account exists but its token names no company, so there is nowhere to send them. */
/**
 * The wait, in the SAME frame as everything either side of it.
 *
 * This branch used to `return <AuthPending />` before the frame was reached — a whole-page
 * swap out of `AuthCanvas` and into `AuthShell`, the previous design language. So the one
 * screen most users of this product ever meet went: "La sede" while they typed, last
 * month's shell for as long as the request took, then "La sede" again to tell them it
 * worked. The redesign made that worse rather than better: while this page drew its own
 * frame the two halves merely differed, and now one of them is the full treatment.
 *
 * A pending state is a state of this screen, so it is a `StateCard` like its siblings, and
 * the only thing that changes between typing, waiting and done is the card.
 *
 * `role="status"` rather than a bare spinner: `AuthPending` announced the wait to a screen
 * reader and that must not be lost in the move. `StateCard`'s `live` prop carries it, and
 * the spinner itself is `aria-hidden` — the sentence is what gets announced, not the mark.
 */
function PendingState() {
  const { t } = useTranslation()

  return (
    <StateCard
      label={t('auth.next.accept.eyebrow')}
      title={t('auth.creatingAccount')}
      body={t('auth.pendingDetail')}
      live="status"
      // Default `md` is `size-icon`, the size CreatedState and DeadState give their marks.
      // Spinner is aria-hidden of its own accord; the announced text is the title.
      icon={<Spinner />}
    />
  )
}

function CreatedState() {
  const { t } = useTranslation()

  return (
    <StateCard
      label={t('auth.next.accept.eyebrow')}
      title={t('auth.accountCreated')}
      body={t('auth.accountCreatedRoleNote')}
      live="status"
      icon={<CheckCircle2 aria-hidden="true" className="size-icon text-accent-green" />}
      action={
        <Button asChild variant="primary" size="canvas" className="w-full">
          <Link to="/login">{t('auth.backToSignIn')}</Link>
        </Button>
      }
    />
  )
}

/** The states artboard's card: the case in a small label, then the sentence and its why. */
function StateCard({
  label,
  title,
  body,
  live,
  icon,
  action,
}: {
  /** Already-translated. */
  label: string
  /** Already-translated. */
  title: string
  /** Already-translated. */
  body: string
  live: 'alert' | 'status'
  icon?: ReactNode
  action?: ReactNode
}) {
  return (
    <section role={live} className={cn(CARD, 'flex flex-col gap-2.5 p-7 pb-6')}>
      <span className="flex items-center gap-inline text-2xs font-semibold uppercase tracking-label text-fg-tertiary">
        {icon}
        {label}
      </span>
      <div className="grid min-w-0 gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">{title}</h1>
        <p className="max-w-prose text-base text-fg-secondary">{body}</p>
      </div>
      {action}
    </section>
  )
}
