import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { CircleAlert, Clock, KeyRound, ShieldCheck } from 'lucide-react'
import { useTranslation } from '../../i18n'
import type { TranslateFn } from '../../i18n/translate'
import { Alert, AlertDescription, AlertTitle, Button, LoadingState } from '../../components/ui'
import { AuthRequestError } from '../api'
import { pageWorthyReason } from '../authReason'
import { setToken } from '../token'
import { resolveInitialRoute } from '../../app/resolveInitialRoute'
import {
  clearChallenge,
  confirmEnrollment,
  normaliseCode,
  readChallenge,
  startEnrollment,
  verifyTwoFactor,
  type PendingChallenge,
  type TwoFactorEnrollmentKey,
} from '../twoFactor'
import { AuthCanvas, AuthCard, AuthField, AuthHeadline } from './AuthCanvas'
import { RecoveryCodeList, TwoFactorCodeInput, TwoFactorKey } from './TwoFactorParts'

/**
 * `/login/two-factor` — the second step of signing in, in the same frame as `/login`.
 *
 * It holds no session of its own: what it has is the challenge `acceptSignIn` kept in memory
 * (`twoFactor.ts` — never in storage). No challenge, or a reload → back to `/login`. A challenge past its five minutes →
 * the expired card, which sends the reader back to sign in rather than letting them type a
 * code the server will refuse.
 *
 * - **verify** — a 6-digit authenticator code, or a recovery code instead.
 * - **enroll** — a super administrator with no authenticator: explain why, show the key (QR +
 *   Base32), confirm one code, then show the ten recovery codes ONCE before signing in.
 *
 * The session token is stored only when the server answers one, and the destination is resolved
 * after storing it (`resolveInitialRoute` reads the role out of the stored token).
 */
export default function TwoFactorNextPage() {
  const [challenge] = useState(readChallenge)
  const expired = useExpired(challenge?.expiresAt ?? 0)

  if (!challenge) return <Navigate to="/login" replace />

  return (
    <AuthCanvas>
      <AuthCard>
        {expired ? (
          <ExpiredStep />
        ) : challenge.mode === 'verify' ? (
          <VerifyStep challenge={challenge} />
        ) : (
          <EnrollStep challenge={challenge} />
        )}
      </AuthCard>
    </AuthCanvas>
  )
}

const MAX_TIMER_MS = 2_147_483_647

function useExpired(expiresAt: number): boolean {
  const [expired, setExpired] = useState(() => Date.now() >= expiresAt)
  useEffect(() => {
    if (expired) return
    // Capped: a delay past 2^31-1 ms overflows setTimeout, which then fires at once.
    const timer = window.setTimeout(() => setExpired(Date.now() >= expiresAt), Math.min(MAX_TIMER_MS, Math.max(0, expiresAt - Date.now())))
    return () => window.clearTimeout(timer)
  }, [expired, expiresAt])
  return expired
}

function destinationOf(challenge: PendingChallenge): string {
  return challenge.returnPath ?? resolveInitialRoute()
}

function BackToSignIn() {
  const { t } = useTranslation()
  return (
    <p className="m-0 text-sm">
      <Link to="/login" replace onClick={clearChallenge} className="text-accent-blue-ink underline">
        {t('twoFactor.backToSignIn')}
      </Link>
    </p>
  )
}

function ExpiredStep() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <div data-slot="two-factor-expired" className="flex flex-col gap-3.5">
      <AuthHeadline title={t('twoFactor.expiredTitle')} description={t('twoFactor.expiredBody')} />
      <Button
        type="button"
        variant="primary"
        size="canvas"
        className="w-full"
        onClick={() => {
          clearChallenge()
          navigate('/login', { replace: true })
        }}
      >
        <Clock aria-hidden="true" />
        {t('twoFactor.backToSignIn')}
      </Button>
    </div>
  )
}

type StepError = { kind: 'wrong' } | { kind: 'server'; message: string }

function StepAlert({ error }: { error: StepError | null }) {
  const { t } = useTranslation()
  if (!error) return null
  return (
    <Alert variant="destructive" role="alert" className="px-3.5">
      <CircleAlert aria-hidden="true" />
      {error.kind === 'wrong' ? (
        <>
          <AlertTitle className="text-base font-semibold text-fg-primary">{t('twoFactor.wrongCodeTitle')}</AlertTitle>
          <AlertDescription>{t('twoFactor.wrongCodeBody')}</AlertDescription>
        </>
      ) : (
        <AlertDescription>{error.message}</AlertDescription>
      )}
    </Alert>
  )
}

/**
 * Turns a refusal into what the step shows. 401 is "that code did not work" — unless the
 * challenge has run out meanwhile, which the caller checks first. 403/503 are the platform's
 * kill switch and maintenance window, routed to `/auth/error` exactly as `/login` routes them.
 */
/** A refusal that is neither a wrong code nor a platform state, in the reader's language. */
function localizedFailure(status: number, t: TranslateFn): string {
  return status === 429 ? t('twoFactor.rateLimited') : t('errors.generic')
}

function useRefusal(challenge: PendingChallenge, onExpired: () => void) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (err: unknown): StepError | null => {
    const status = err instanceof AuthRequestError ? err.status : 0
    if (status === 401 && Date.now() >= challenge.expiresAt) {
      onExpired()
      return null
    }
    if (status === 401) return { kind: 'wrong' }
    const reason = pageWorthyReason(status)
    if (reason) {
      // The maintenance text is authored per locale by the server (`authReason.ts`), so the
      // error page is handed the server's message exactly as `/login` hands it.
      const message = err instanceof Error && err.message ? err.message : t('errors.generic')
      clearChallenge()
      navigate(`/auth/error?reason=${reason}`, { replace: true, state: { message } })
      return null
    }
    // Anything else is shown in the catalogue's words, never the server's English.
    return { kind: 'server', message: localizedFailure(status, t) }
  }
}

function VerifyStep({ challenge }: { challenge: PendingChallenge }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const codeId = useId()
  const [kind, setKind] = useState<'totp' | 'recovery'>('totp')
  const [code, setCode] = useState('')
  const [error, setError] = useState<StepError | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [expiredNow, setExpiredNow] = useState(false)
  const [remaining, setRemaining] = useState<number | null>(null)
  const refusal = useRefusal(challenge, () => setExpiredNow(true))

  if (expiredNow) return <ExpiredStep />

  if (remaining !== null) {
    return (
      <div data-slot="two-factor-recovery-remaining" className="flex flex-col gap-3.5">
        <AuthHeadline title={t('twoFactor.signedInTitle')} description={t('twoFactor.recoveryRemaining', { count: remaining })} />
        <Alert variant="warning">
          <KeyRound aria-hidden="true" />
          <AlertDescription>{t('twoFactor.recoveryRefill')}</AlertDescription>
        </Alert>
        <Button type="button" variant="primary" size="canvas" className="w-full" onClick={() => navigate(destinationOf(challenge), { replace: true })}>
          {t('twoFactor.continue')}
        </Button>
      </div>
    )
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const typed = normaliseCode(code, kind)
    if (!typed) return
    setError(null)
    setSubmitting(true)
    try {
      const baseUrl = import.meta.env.VITE_API_BASE_URL as string
      const answer = await verifyTwoFactor(baseUrl, challenge.challengeToken, typed)
      clearChallenge()
      setToken(answer.token)
      if (typeof answer.recoveryCodesRemaining === 'number') {
        setRemaining(answer.recoveryCodesRemaining)
        return
      }
      navigate(destinationOf(challenge), { replace: true })
    } catch (err) {
      setError(refusal(err))
      setCode('')
    } finally {
      setSubmitting(false)
    }
  }

  function switchKind() {
    setKind((current) => (current === 'totp' ? 'recovery' : 'totp'))
    setCode('')
    setError(null)
  }

  return (
    <div data-slot="two-factor-verify" className="flex flex-col gap-3.5">
      <AuthHeadline
        title={t('twoFactor.verifyTitle')}
        description={kind === 'totp' ? t('twoFactor.verifyDetail') : t('twoFactor.recoveryDetail')}
      />
      <form className="flex flex-col gap-3.5" onSubmit={(event) => void submit(event)} noValidate>
        <StepAlert error={error} />
        <AuthField htmlFor={codeId} fieldLabel={kind === 'totp' ? t('twoFactor.codeLabel') : t('twoFactor.recoveryLabel')}>
          <TwoFactorCodeInput id={codeId} kind={kind} value={code} onChange={setCode} invalid={error?.kind === 'wrong'} autoFocus />
        </AuthField>
        <Button type="submit" variant="primary" size="canvas" className="w-full" disabled={submitting || normaliseCode(code, kind) === ''}>
          <ShieldCheck aria-hidden="true" />
          {t('twoFactor.verify')}
        </Button>
        <Button type="button" variant="link" className="h-auto self-start p-0" onClick={switchKind}>
          {kind === 'totp' ? t('twoFactor.useRecovery') : t('twoFactor.useApp')}
        </Button>
        <BackToSignIn />
      </form>
    </div>
  )
}

function EnrollStep({ challenge }: { challenge: PendingChallenge }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const codeId = useId()
  const [key, setKey] = useState<TwoFactorEnrollmentKey | null>(null)
  const [startError, setStartError] = useState<StepError | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<StepError | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [expiredNow, setExpiredNow] = useState(false)
  const [result, setResult] = useState<{ token: string; recoveryCodes: string[] } | null>(null)
  const refusal = useRefusal(challenge, () => setExpiredNow(true))
  const started = useRef(false)

  useEffect(() => {
    // Once: a second start would mint a second secret and orphan the QR already on screen.
    if (started.current) return
    started.current = true
    const baseUrl = import.meta.env.VITE_API_BASE_URL as string
    startEnrollment(baseUrl, challenge.challengeToken).then(setKey, (err: unknown) => {
      // 429 is the Authentication rate limit; anything else (401 included: a challenge the
      // server no longer accepts) is "sign in again".
      const status = err instanceof AuthRequestError ? err.status : 0
      setStartError({ kind: 'server', message: status === 429 ? t('twoFactor.rateLimited') : t('twoFactor.startFailed') })
    })
  }, [challenge.challengeToken, t])

  if (expiredNow) return <ExpiredStep />

  if (result) {
    return (
      <div data-slot="two-factor-codes" className="flex flex-col gap-3.5">
        <AuthHeadline title={t('twoFactor.codesTitle')} description={t('twoFactor.codesBody')} />
        <RecoveryCodeList codes={result.recoveryCodes} />
        <Button
          type="button"
          variant="primary"
          size="canvas"
          className="w-full"
          onClick={() => {
            clearChallenge()
            setToken(result.token)
            navigate(destinationOf(challenge), { replace: true })
          }}
        >
          {t('twoFactor.savedContinue')}
        </Button>
      </div>
    )
  }

  async function confirm(event: FormEvent) {
    event.preventDefault()
    const typed = normaliseCode(code, 'totp')
    if (typed.length !== 6) return
    setError(null)
    setSubmitting(true)
    try {
      const baseUrl = import.meta.env.VITE_API_BASE_URL as string
      setResult(await confirmEnrollment(baseUrl, challenge.challengeToken, typed))
    } catch (err) {
      setError(refusal(err))
      setCode('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div data-slot="two-factor-enroll" className="flex flex-col gap-3.5">
      <AuthHeadline title={t('twoFactor.enrollTitle')} description={t('twoFactor.enrollWhy')} />
      {startError ? (
        <>
          <StepAlert error={startError} />
          <BackToSignIn />
        </>
      ) : key === null ? (
        <LoadingState rows={3} label={t('twoFactor.loadingKey')} />
      ) : (
        <form className="flex flex-col gap-3.5" onSubmit={(event) => void confirm(event)} noValidate>
          <TwoFactorKey enrollment={key} />
          <StepAlert error={error} />
          <AuthField htmlFor={codeId} fieldLabel={t('twoFactor.confirmStep')}>
            <TwoFactorCodeInput id={codeId} kind="totp" value={code} onChange={setCode} invalid={error?.kind === 'wrong'} />
          </AuthField>
          <Button type="submit" variant="primary" size="canvas" className="w-full" disabled={submitting || code.length !== 6}>
            <ShieldCheck aria-hidden="true" />
            {t('twoFactor.confirm')}
          </Button>
          <BackToSignIn />
        </form>
      )}
    </div>
  )
}
