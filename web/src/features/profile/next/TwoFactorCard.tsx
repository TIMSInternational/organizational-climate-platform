import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { Check, CircleAlert, ShieldCheck } from 'lucide-react'
import { Alert, AlertDescription, Button, Chip } from '../../../components/ui'
import { isApiStatus } from '../../../api/authFetch'
import { setToken } from '../../../auth/token'
import { normaliseCode, type TwoFactorEnrollmentKey } from '../../../auth/twoFactor'
import { RecoveryCodeList, TwoFactorCodeInput, TwoFactorKey } from '../../../auth/next/TwoFactorParts'
import { useTranslation } from '../../../i18n'
import { calendarDay } from '../../../lib/calendarDay'
import { Field, Panel } from '../../org-structure/next/super/parts'
import {
  confirmProfileTwoFactor,
  disableProfileTwoFactor,
  getProfileTwoFactor,
  startProfileTwoFactor,
  type ProfileTwoFactorStatus,
} from '../api/twoFactor'

/**
 * *Verificación en dos pasos* on `/profile` — driven entirely by `GET /profile/two-factor`.
 *
 * - `available: false` (the feature is off) or an API without the endpoint → nothing at all.
 * - Optional users (`required: false`) can turn it on, change device, and turn it off.
 * - `required` users (super administrators) get no off switch — only a device change, which the
 *   server accepts with a current code.
 *
 * Confirm and disable bump the server's security stamp, which kills every session including this
 * one, and answer a fresh token: it is stored BEFORE anything else happens, or the next request
 * from this page would be a 401 and a sign-out.
 */

const CARD = 'border-line-panel shadow-none py-4.5'

type Flow =
  | { kind: 'idle' }
  | { kind: 'ask'; purpose: 'disable' | 'changeDevice' }
  | { kind: 'key'; key: TwoFactorEnrollmentKey }
  | { kind: 'codes'; codes: string[] }

type CardError = 'wrong' | 'forbidden' | { message: string }

export default function TwoFactorCard() {
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [status, setStatus] = useState<ProfileTwoFactorStatus | null>(null)
  const [flow, setFlow] = useState<Flow>({ kind: 'idle' })
  const [notice, setNotice] = useState<'enabled' | 'disabled' | null>(null)
  const [error, setError] = useState<CardError | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(() => {
    getProfileTwoFactor(baseUrl).then(setStatus, () => setStatus(null))
  }, [baseUrl])

  useEffect(reload, [reload])

  if (!status || !status.available) return null

  function explain(err: unknown): CardError {
    if (isApiStatus(err, 401)) return 'wrong'
    if (isApiStatus(err, 403)) return 'forbidden'
    // In the catalogue's words, never the server's English (a 400 here reads "Start the set-up first.").
    return { message: isApiStatus(err, 429) ? t('twoFactor.rateLimited') : t('errors.generic') }
  }

  async function run(action: () => Promise<void>) {
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      await action()
    } catch (err) {
      setError(explain(err))
      // A 401 from the code calls is ambiguous: a wrong code, or a session that has ended.
      // Re-reading the status through `authFetch` settles it — a dead session signs the reader
      // out there as on every other page; a live one just refreshes the card.
      if (isApiStatus(err, 401)) reload()
    } finally {
      setBusy(false)
    }
  }

  const begin = (currentCode: string | null) =>
    run(async () => setFlow({ kind: 'key', key: await startProfileTwoFactor(baseUrl, currentCode) }))

  const confirm = (code: string) =>
    run(async () => {
      const result = await confirmProfileTwoFactor(baseUrl, code)
      setToken(result.token)
      setFlow({ kind: 'codes', codes: result.recoveryCodes })
    })

  const disable = (code: string) =>
    run(async () => {
      setToken(await disableProfileTwoFactor(baseUrl, code))
      setFlow({ kind: 'idle' })
      setNotice('disabled')
      reload()
    })

  const cancel = () => {
    setError(null)
    setFlow({ kind: 'idle' })
  }

  return (
    <Panel
      className={CARD}
      labelledBy="profile-two-factor"
      heading={
        <h2 id="profile-two-factor" className="m-0 text-2xl">
          {t('twoFactor.profileTitle')}
        </h2>
      }
      meta={t('twoFactor.profileMeta')}
    >
      <div data-slot="profile-two-factor" className="flex flex-col gap-3.5">
        {notice && (
          <Alert variant="success" data-slot="two-factor-notice">
            <Check aria-hidden="true" />
            <AlertDescription role="status">{notice === 'enabled' ? t('twoFactor.enabledDone') : t('twoFactor.disabledDone')}</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive" role="alert">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>
              {error === 'wrong' ? t('twoFactor.wrongCodeBody') : error === 'forbidden' ? t('twoFactor.forbidden') : error.message}
            </AlertDescription>
          </Alert>
        )}

        {flow.kind === 'codes' ? (
          <div className="flex flex-col gap-3">
            <p className="m-0 text-base font-semibold text-fg-primary">{t('twoFactor.codesTitle')}</p>
            <p className="m-0 text-sm text-fg-secondary">{t('twoFactor.codesBody')}</p>
            <RecoveryCodeList codes={flow.codes} />
            <div>
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  setFlow({ kind: 'idle' })
                  setNotice('enabled')
                  reload()
                }}
              >
                {t('twoFactor.savedContinue')}
              </Button>
            </div>
          </div>
        ) : flow.kind === 'key' ? (
          <div className="flex flex-col gap-3">
            <TwoFactorKey enrollment={flow.key} />
            <CodeForm
              label={t('twoFactor.confirmStep')}
              submitLabel={t('twoFactor.confirm')}
              busy={busy}
              invalid={error === 'wrong'}
              onSubmit={confirm}
              onCancel={cancel}
            />
          </div>
        ) : flow.kind === 'ask' ? (
          <div className="flex flex-col gap-3">
            <p className="m-0 text-sm text-fg-secondary">
              {flow.purpose === 'disable' ? t('twoFactor.disableBody') : t('twoFactor.changeDeviceBody')}
            </p>
            <CodeForm
              label={t('twoFactor.currentCodeLabel')}
              submitLabel={flow.purpose === 'disable' ? t('twoFactor.disableTitle') : t('twoFactor.continue')}
              destructive={flow.purpose === 'disable'}
              busy={busy}
              invalid={error === 'wrong'}
              onSubmit={(code) => (flow.purpose === 'disable' ? disable(code) : begin(code))}
              onCancel={cancel}
            />
          </div>
        ) : (
          <StatusView
            status={status}
            busy={busy}
            onEnable={() => void begin(null)}
            onChangeDevice={() => setFlow({ kind: 'ask', purpose: 'changeDevice' })}
            onDisable={() => setFlow({ kind: 'ask', purpose: 'disable' })}
          />
        )}
      </div>
    </Panel>
  )
}

function StatusView({
  status,
  busy,
  onEnable,
  onChangeDevice,
  onDisable,
}: {
  status: ProfileTwoFactorStatus
  busy: boolean
  onEnable: () => void
  onChangeDevice: () => void
  onDisable: () => void
}) {
  const { t, locale } = useTranslation()
  const since = status.enabledAt ? Date.parse(status.enabledAt) : Number.NaN

  return (
    <div className="flex flex-col gap-3">
      <dl className="m-0 flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <dt className="text-ui text-fg-tertiary">{t('twoFactor.statusLabel')}</dt>
          <dd className="m-0">
            <Chip tone={status.enabled ? 'good' : 'neutral'} label={status.enabled ? t('twoFactor.statusOn') : t('twoFactor.statusOff')} />
          </dd>
        </div>
        {status.enabled && !Number.isNaN(since) && (
          <div className="flex flex-wrap items-baseline gap-2">
            <dt className="text-ui text-fg-tertiary">{t('twoFactor.enabledSince')}</dt>
            <dd className="m-0 text-ui text-fg-primary">{calendarDay(since, locale)}</dd>
          </div>
        )}
        {status.enabled && (
          <div className="flex flex-wrap items-baseline gap-2">
            <dt className="text-ui text-fg-tertiary">{t('twoFactor.codesLeft')}</dt>
            <dd className="m-0 text-ui tabular-nums text-fg-primary">{status.recoveryCodesRemaining}</dd>
          </div>
        )}
      </dl>
      <p className="m-0 text-sm text-fg-secondary">{status.required ? t('twoFactor.requiredNote') : t('twoFactor.optionalNote')}</p>
      <div className="flex flex-wrap gap-2">
        {status.enabled ? (
          <>
            <Button type="button" variant="outline" disabled={busy} onClick={onChangeDevice}>
              {t('twoFactor.changeDevice')}
            </Button>
            {!status.required && (
              <Button type="button" variant="outline" disabled={busy} onClick={onDisable}>
                {t('twoFactor.disable')}
              </Button>
            )}
          </>
        ) : (
          <Button type="button" variant="primary" disabled={busy} onClick={onEnable}>
            <ShieldCheck aria-hidden="true" />
            {t('twoFactor.enable')}
          </Button>
        )}
      </div>
    </div>
  )
}

function CodeForm({
  label,
  submitLabel,
  destructive = false,
  busy,
  invalid,
  onSubmit,
  onCancel,
}: {
  label: string
  submitLabel: string
  destructive?: boolean
  busy: boolean
  invalid: boolean
  onSubmit: (code: string) => Promise<void> | void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const [code, setCode] = useState('')
  const ready = normaliseCode(code, 'totp').length === 6

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready) return
    void onSubmit(normaliseCode(code, 'totp'))
    setCode('')
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
      <Field fieldLabel={label} htmlFor={id} required>
        <div className="max-w-56">
          <TwoFactorCodeInput id={id} kind="totp" value={code} onChange={setCode} invalid={invalid} autoFocus />
        </div>
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant={destructive ? 'destructive' : 'primary'} disabled={busy || !ready}>
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}
