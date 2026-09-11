import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, ChevronRight, Copy, Link2, X } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../i18n'
import { calendarDay } from '../../../lib/calendarDay'
import { cn } from '../../../lib/cn'
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  LoadingRegion,
  SkeletonText,
} from '../../../components/ui'
import {
  createReportShare,
  listReportShares,
  revokeReportShare,
  shareLinkUrl,
  type CreateReportShareResult,
  type ReportShareSummary,
} from '../api/reportShares'
import {
  DEFAULT_LIFETIME_DAYS,
  activeShares,
  expiryPreview,
  inactiveShares,
  inactiveSpan,
  maskedShareUrl,
  opensOf,
  opensPhrase,
  previewLifetime,
  reportFormatLabel,
  sameUtcDay,
} from './derive'

/** The canvas's small-caps label: 10px, bold, spaced .06em, in the label ink. */
const LABEL = 'text-2xs font-bold uppercase tracking-label text-fg-label'

export interface ReportShareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  baseUrl: string
  report: { id: string; title: string; format: string }
  /**
   * Handed the fresh list after every read, so the row's "Enlaces públicos" cell and the
   * page's tile agree with the dialog the moment a link is minted or revoked.
   */
  onSharesChange?: (shares: readonly ReportShareSummary[]) => void
}

/**
 * The share dialog opened from Informes — the ReportShare artboard (10 Sep).
 *
 * Same transport and the same one design constraint as `components/ReportSharePanel.tsx`
 * (which stays as the old page's): the token is readable exactly once, in the mint
 * response, because `report_shares` stores a SHA-256 hash. So a link minted in THIS
 * dialog is shown in full with Copiar and the statement that it cannot be shown again;
 * a link minted earlier is named by its route and never offered for copying — a Copiar
 * that cannot copy is a control that exists and then fails.
 *
 * What the redesign changes: the one warning that matters first, the lifetime with the
 * date it lands on, the ACTIVE links only, and every revoked or expired link behind
 * "Mostrar revocados" instead of in one table with the live ones (the triage's finding:
 * the old dialog listed every link ever made).
 */
export default function ReportShareDialog({ open, onOpenChange, baseUrl, report, onSharesChange }: ReportShareDialogProps) {
  const { t, locale } = useTranslation()
  const [shares, setShares] = useState<ReportShareSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [minted, setMinted] = useState<CreateReportShareResult | null>(null)
  const [days, setDays] = useState(String(DEFAULT_LIFETIME_DAYS))
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<boolean | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const titleRef = useRef<HTMLHeadingElement>(null)

  // The page hands an inline callback; keeping it in a ref keeps `reload` stable, so the
  // opening effect runs once per opening and not once per parent render.
  const onSharesChangeRef = useRef(onSharesChange)
  useEffect(() => {
    onSharesChangeRef.current = onSharesChange
  }, [onSharesChange])

  const reportId = report.id
  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await listReportShares(baseUrl, reportId)
      setShares(next)
      onSharesChangeRef.current?.(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, reportId, t])

  useEffect(() => {
    if (!open) return
    // The freshly minted token is dropped when the dialog closes rather than kept across
    // openings: a credential on screen unasked is the failure `ShareLinkPanel` records.
    setMinted(null)
    setCopied(null)
    setShowInactive(false)
    void reload()
  }, [open, reload])

  async function handleMint() {
    setBusy(true)
    setError(null)
    setCopied(null)
    try {
      const parsed = Number.parseInt(days, 10)
      // Sent as typed. The server clamps to [1, 365] (`ClampLifetimeDays`) and its
      // `expiresAt` is the authority on what was minted; the preview only mirrors it.
      const result = await createReportShare(baseUrl, reportId, Number.isFinite(parsed) ? { expiresInDays: parsed } : {})
      setMinted(result)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setBusy(false)
    }
  }

  async function handleRevoke(shareId: string) {
    setBusy(true)
    setError(null)
    try {
      await revokeReportShare(baseUrl, reportId, shareId)
      // The revoked link is the one on screen: drop it, so the dialog cannot go on offering
      // a URL it has just killed.
      if (minted?.id === shareId) setMinted(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setBusy(false)
    }
  }

  async function handleCopy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      // A denied or absent clipboard: the URL is on screen and selectable, and says so.
      setCopied(false)
    }
  }

  const day = (value: string | number) => {
    const instant = typeof value === 'number' ? value : Date.parse(value)
    return Number.isNaN(instant) ? String(value) : calendarDay(instant, locale)
  }

  const active = activeShares(shares)
  const inactive = inactiveShares(shares)
  const span = inactiveSpan(inactive)
  const allRevoked = inactive.every((share) => share.revokedAt !== null)
  const mintedUrl = minted ? shareLinkUrl(window.location.origin, minted.path) : null
  // A mint whose follow-up read failed is still shown: the token exists only here.
  const orphanMint = minted !== null && !active.some((share) => share.id === minted.id)
  const opensTotal = opensOf(active)
  const lifetime = previewLifetime(days)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        data-slot="report-share-dialog"
        // The artboard's dialog: a 640px content box inside 20px by 24px of padding and a
        // 1px border — 690px outside, 688 of white — 96px from the top, 16px between its
        // blocks, the card radius and a deep shadow. `max-w` is the outer width here
        // (border-box), so it carries the padding and the border the canvas adds outside.
        className="top-24 max-h-[calc(100dvh-7rem)] max-w-[690px] translate-y-0 gap-4 overflow-y-auto rounded-xl px-6 py-5 shadow-2xl"
        // Radix focuses the first control on open, which here is the close button — and a
        // visit to `?share=<id>` has had no pointer interaction, so Chromium treats the
        // programmatic focus as keyboard focus and the page opens with a red ring on "×".
        // The dialog is announced by its title instead (the APG's static element at the
        // top, and Enter no longer closes a dialog nobody has read), moved there with the
        // platform's own `focusVisible: false`: the title is not a control, so it draws no
        // indicator, and nothing in CSS suppresses the one ring the app has
        // (`keyboardOperable.test.tsx`). Tab from the title reaches "×" first, ring and all.
        // Measured in the harness's Chromium 151: a heading focused plainly matches
        // `:focus-visible`; with `{ focusVisible: false }` it does not.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          // A variable, not a literal: `focusVisible` is newer than the DOM lib's `FocusOptions`.
          const quiet: FocusOptions & { focusVisible?: boolean } = { focusVisible: false }
          titleRef.current?.focus(quiet)
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <DialogHeader className="gap-1">
            <p data-slot="share-eyebrow" className="m-0 text-2xs font-bold uppercase tracking-tile text-fg-label">
              {t('reports.next.shareEyebrow', { title: report.title, format: reportFormatLabel(t, report.format) })}
            </p>
            {/* An `<h2>`, so the base rule sets it in the display serif; only the primitive's
                sans weight and size are taken back. `tabIndex={-1}`: focusable by the
                opening above, never a Tab stop. */}
            <DialogTitle ref={titleRef} tabIndex={-1} className="m-0 text-2xl font-normal leading-tight">
              {t('reports.next.shareHeading')}
            </DialogTitle>
            <DialogDescription className="m-0 text-sm text-fg-secondary">{t('reports.next.shareSub')}</DialogDescription>
          </DialogHeader>
          <DialogClose asChild>
            <Button type="button" variant="outline" size="icon" aria-label={t('common.close')}>
              <X aria-hidden="true" />
            </Button>
          </DialogClose>
        </div>

        <div
          role="note"
          data-slot="share-warning"
          className="flex items-start gap-2.5 rounded-lg border border-accent-amber-ring bg-accent-amber-soft px-3.5 py-3"
        >
          <AlertCircle aria-hidden="true" className="mt-px size-4 shrink-0 text-accent-amber-ink" />
          <div className="flex flex-col gap-0.5 text-sm">
            <span className="font-semibold text-fg-primary">{t('reports.shareWarningTitle')}</span>
            <span className="text-fg-secondary">{t('reports.next.shareWarning')}</span>
          </div>
        </div>

        {error && (
          <p role="alert" className="m-0 text-sm text-accent-red-ink">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-end gap-2.5">
          <div className="flex flex-col gap-1">
            {/* `leading-normal`: the canvas's label sits on a 15px line; the primitive's
                `leading-none` made the block 5px shorter and lifted everything below it. */}
            <Label htmlFor="report-share-days" className={cn(LABEL, 'mb-0 leading-normal')}>
              {t('reports.next.expiresIn')}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="report-share-days"
                type="number"
                min={1}
                max={365}
                value={days}
                aria-describedby="report-share-until"
                onChange={(event) => setDays(event.target.value)}
                className="h-8 w-24"
              />
              <span id="report-share-until" data-slot="share-until" className="text-sm text-fg-secondary">
                {t('reports.next.expiresUntil', { date: day(expiryPreview(lifetime, Date.now())) })}
              </span>
            </div>
          </div>
          <span className="flex-1" />
          <Button type="button" variant="primary" disabled={busy} onClick={() => void handleMint()}>
            <Link2 aria-hidden="true" />
            {t('reports.shareCreate')}
          </Button>
        </div>

        <LoadingRegion loading={loading} label={t('common.loading')}>
          {loading ? (
            <SkeletonText lines={2} />
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                {/* `leading-normal` on this row and on the link's two lines below: the canvas
                    sets them on its 1.5 body line, and the tighter theme lines put the link
                    card 4px higher than the artboard's. */}
                <span data-slot="active-heading" className={cn(LABEL, 'leading-normal')}>
                  {active.length > 1
                    ? t('reports.next.activeHeadingMany', { count: active.length })
                    : t('reports.next.activeHeading', { count: active.length })}
                </span>
                <span className="text-xs leading-normal text-fg-label">
                  {opensTotal === 1 ? t('reports.next.opensTotalOne') : t('reports.next.opensTotal', { count: opensTotal })}
                </span>
              </div>

              {orphanMint && mintedUrl && (
                <MintedLink url={mintedUrl} expiresAt={day(minted.expiresAt)} onCopy={handleCopy} t={t} />
              )}

              {active.length === 0 && !orphanMint ? (
                <p data-slot="none-active" className="m-0 text-sm text-fg-secondary">
                  {t('reports.next.noneActive')}
                </p>
              ) : (
                active.map((share) => {
                  const isMinted = minted?.id === share.id && mintedUrl !== null
                  return (
                    <div
                      key={share.id}
                      data-slot="active-link"
                      data-minted={isMinted ? 'true' : 'false'}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-line-default px-3.5 py-3"
                    >
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span
                          data-slot={isMinted ? 'report-share-url' : 'report-share-masked'}
                          aria-label={t('reports.next.linkAddress')}
                          // An earlier link explains its dots where they are: on hover here, and
                          // to a screen reader in the hidden sentence below. The ReportShare
                          // artboard has no line for it under the card — the refuter measured
                          // that line at 21px of extra dialog, "Mostrar revocados" pushed down.
                          title={isMinted ? undefined : t('reports.next.maskedNote')}
                          className={cn(
                            'font-mono text-sm leading-normal tabular-nums text-fg-primary',
                            isMinted ? 'break-all select-all' : 'truncate',
                          )}
                        >
                          {isMinted ? mintedUrl : maskedShareUrl(window.location.host)}
                        </span>
                        {/* `sr-only` is absolutely placed, so the column's gap and height ignore it. */}
                        {!isMinted && (
                          <span data-slot="masked-note" className="sr-only">
                            {t('reports.next.maskedNote')}
                          </span>
                        )}
                        <span className="text-xs leading-normal text-fg-label">
                          {t('reports.next.linkMeta', {
                            created: day(share.createdAt),
                            expires: day(share.expiresAt),
                            opens: opensPhrase(t, share.accessCount),
                          })}
                        </span>
                        {isMinted && <span className="text-xs text-accent-amber-ink">{t('reports.next.mintedNote')}</span>}
                      </div>
                      <div className="flex gap-2">
                        {isMinted && (
                          <Button type="button" variant="outline" onClick={() => void handleCopy(mintedUrl)}>
                            <Copy aria-hidden="true" />
                            {t('reports.next.copy')}
                          </Button>
                        )}
                        <Button type="button" variant="outline" disabled={busy} onClick={() => void handleRevoke(share.id)}>
                          {t('reports.shareRevoke')}
                        </Button>
                      </div>
                    </div>
                  )
                })
              )}

              {copied !== null && (
                <p role="status" className="m-0 text-xs text-fg-secondary">
                  {copied ? t('reports.shareCopied') : t('reports.next.copyFailed')}
                </p>
              )}

              {inactive.length > 0 && (
                <Collapsible open={showInactive} onOpenChange={setShowInactive}>
                  <div
                    data-slot="inactive-toggle"
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-outer px-3.5 py-2.5"
                  >
                    <CollapsibleTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        // The canvas's row is 10px + an 18px line + 10px: `leading-normal` gives
                        // the line, `border-0` takes back the ghost variant's transparent 1px
                        // border above and below it, which drew nothing and made the row 40.
                        className="h-auto gap-2 border-0 p-0 text-sm font-normal leading-normal text-fg-secondary hover:not-disabled:bg-transparent"
                      >
                        <ChevronRight
                          aria-hidden="true"
                          className={cn('size-3.5 text-fg-label transition-transform', showInactive && 'rotate-90')}
                        />
                        {allRevoked ? t('reports.next.showRevoked') : t('reports.next.showInactive')}
                        <span className="font-mono text-sm tabular-nums text-fg-label">{inactive.length}</span>
                      </Button>
                    </CollapsibleTrigger>
                    {span && (
                      <span className="text-xs text-fg-label">
                        {sameUtcDay(span.first, span.last)
                          ? t('reports.next.revokedAllOn', { date: day(span.first) })
                          : t('reports.next.revokedRange', { first: day(span.first), last: day(span.last) })}
                      </span>
                    )}
                  </div>
                  <CollapsibleContent>
                    <ul data-slot="inactive-links" className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
                      {inactive.map((share) => (
                        <li
                          key={share.id}
                          data-slot="inactive-link"
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line-light px-3.5 py-2 text-xs text-fg-label"
                        >
                          <span className="font-mono">{maskedShareUrl(window.location.host)}</span>
                          <span>
                            {share.revokedAt !== null
                              ? t('reports.next.revokedMeta', {
                                  created: day(share.createdAt),
                                  revoked: day(share.revokedAt),
                                  opens: opensPhrase(t, share.accessCount),
                                })
                              : t('reports.next.expiredMeta', {
                                  created: day(share.createdAt),
                                  expires: day(share.expiresAt),
                                  opens: opensPhrase(t, share.accessCount),
                                })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          )}
        </LoadingRegion>

        <div className="flex justify-end gap-2 border-t border-line-light pt-3.5">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** A link this dialog minted whose follow-up list read failed: still the only chance to copy it. */
function MintedLink({
  url,
  expiresAt,
  onCopy,
  t,
}: {
  url: string
  expiresAt: string
  onCopy: (url: string) => Promise<void>
  t: TranslateFn
}) {
  return (
    <div
      data-slot="active-link"
      data-minted="true"
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-line-default px-3.5 py-3"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span data-slot="report-share-url" className="break-all font-mono text-sm tabular-nums text-fg-primary select-all">
          {url}
        </span>
        <span className="text-xs text-fg-label">{t('reports.shareExpiresOn', { date: expiresAt })}</span>
        <span className="text-xs text-accent-amber-ink">{t('reports.next.mintedNote')}</span>
      </div>
      <Button type="button" variant="outline" onClick={() => void onCopy(url)}>
        <Copy aria-hidden="true" />
        {t('reports.next.copy')}
      </Button>
    </div>
  )
}
