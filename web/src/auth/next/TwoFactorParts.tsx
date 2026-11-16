import { useMemo } from 'react'
import { Check, Copy, Download } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { Button, Input } from '../../components/ui'
import { qrModules, qrPathData } from '../../features/surveys/components/ShareLinkQr'
import { useCopyLink } from '../../features/microclimates/next/useCopyLink'
import { groupSecret, type TwoFactorEnrollmentKey } from '../twoFactor'
import { downloadTextFile } from '../../lib/downloadTextFile'

/**
 * The pieces the sign-in enrollment (`TwoFactorNextPage`) and the profile card
 * (`TwoFactorCard`) share, so the two places a person meets their authenticator key and their
 * recovery codes cannot drift apart.
 *
 * The QR is `ShareLinkQr`'s own generator (`qrModules` + `qrPathData`, `qrcode-generator`,
 * already a dependency) on `SessionQr`'s plaque: dark ink on a light plaque in both themes,
 * because an authenticator's camera reads a QR, not a theme.
 */

const QUIET_ZONE = 4

/** Copy feedback, announced politely beside the button that caused it. */
function CopyFeedback({ ok }: { ok: boolean | null }) {
  const { t } = useTranslation()
  if (ok === null) return null
  return (
    <span role="status" className={ok ? 'text-xs text-fg-secondary' : 'text-xs text-accent-red'}>
      {ok ? t('twoFactor.copied') : t('twoFactor.copyFailed')}
    </span>
  )
}

export function TwoFactorKey({ enrollment }: { enrollment: TwoFactorEnrollmentKey }) {
  const { t } = useTranslation()
  const modules = useMemo(() => qrModules(enrollment.otpauthUri), [enrollment.otpauthUri])
  const extent = modules.length + QUIET_ZONE * 2
  const { outcome, copy } = useCopyLink()
  const grouped = groupSecret(enrollment.secret)

  return (
    <div data-slot="two-factor-key" className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
      <div className="flex size-[160px] shrink-0 items-center justify-center justify-self-center rounded-xl border border-line-default bg-fg-on-accent p-2">
        <svg
          role="img"
          aria-label={t('twoFactor.qrAlt')}
          viewBox={`0 0 ${extent} ${extent}`}
          shapeRendering="crispEdges"
          data-qr-modules={modules.length}
          className="block size-full text-surface-shell"
        >
          <title>{t('twoFactor.qrAlt')}</title>
          <path d={qrPathData(modules, QUIET_ZONE)} fill="currentColor" />
        </svg>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <p className="m-0 text-sm text-fg-secondary">{t('twoFactor.scanStep')}</p>
        <p className="m-0 text-xs font-semibold text-fg-tertiary">{t('twoFactor.manualLabel')}</p>
        <code data-slot="two-factor-secret" className="block select-all break-words rounded-md border border-line-default bg-surface-fill-subtle px-2.5 py-1.5 font-mono text-sm tracking-wide text-fg-primary">
          {grouped}
        </code>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void copy('secret', enrollment.secret)}>
            <Copy aria-hidden="true" />
            {t('twoFactor.copyKey')}
          </Button>
          <CopyFeedback ok={outcome?.key === 'secret' ? outcome.ok : null} />
        </div>
      </div>
    </div>
  )
}

export function RecoveryCodeList({ codes }: { codes: readonly string[] }) {
  const { t } = useTranslation()
  const { outcome, copy } = useCopyLink()

  return (
    <div data-slot="recovery-codes" className="flex flex-col gap-2.5">
      <ul
        aria-label={t('twoFactor.codesListLabel')}
        className="m-0 grid list-none grid-cols-2 gap-x-4 gap-y-1.5 rounded-md border border-line-default bg-surface-fill-subtle p-3 font-mono text-sm tracking-wide text-fg-primary select-all"
      >
        {codes.map((code) => (
          <li key={code} className="tabular-nums">
            {code}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void copy('codes', codes.join('\n'))}>
          {outcome?.key === 'codes' && outcome.ok ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {t('twoFactor.copyCodes')}
        </Button>
        {/* A Blob built here, never a link to the API: the codes exist only in this answer. */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            downloadTextFile(t('twoFactor.codesFileName'), 'text/plain', `${t('twoFactor.codesFileHeading')}\n\n${codes.join('\n')}\n`, {
              byteOrderMark: false,
            })
          }
        >
          <Download aria-hidden="true" />
          {t('twoFactor.downloadCodes')}
        </Button>
        <CopyFeedback ok={outcome?.key === 'codes' ? outcome.ok : null} />
      </div>
    </div>
  )
}

/**
 * One code field for both kinds. An authenticator code is six digits (`one-time-code` lets a
 * phone offer it); a recovery code is `XXXXX-XXXXX`, case-insensitive, so nothing here
 * refuses a lower-case or space-separated paste.
 */
export function TwoFactorCodeInput({
  id,
  kind,
  value,
  onChange,
  invalid = false,
  autoFocus = false,
}: {
  id: string
  kind: 'totp' | 'recovery'
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  autoFocus?: boolean
}) {
  return (
    <Input
      id={id}
      name={kind === 'totp' ? 'one-time-code' : 'recovery-code'}
      type="text"
      inputMode={kind === 'totp' ? 'numeric' : 'text'}
      autoComplete={kind === 'totp' ? 'one-time-code' : 'off'}
      autoCapitalize={kind === 'totp' ? undefined : 'characters'}
      spellCheck={false}
      maxLength={kind === 'totp' ? 6 : 14}
      required
      // A field the reader arrives at to fill: focusing it is the one thing they came to do.
      autoFocus={autoFocus}
      aria-invalid={invalid || undefined}
      value={value}
      onChange={(event) => onChange(kind === 'totp' ? event.target.value.replace(/\D/g, '') : event.target.value)}
      className="w-full font-mono text-base tracking-widest"
    />
  )
}
