import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../../i18n'
import { calendarDay } from '../../../lib/calendarDay'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  LoadingRegion,
  SkeletonText,
  Table,
} from '../../../components/ui'
import {
  createReportShare,
  listReportShares,
  revokeReportShare,
  shareLinkUrl,
  type CreateReportShareResult,
  type ReportShareSummary,
} from '../api/reportShares'

/**
 * Mint, show once, list and revoke the public links to one report (#139).
 *
 * ## The one design constraint: the link is readable exactly once
 *
 * `report_shares` stores a SHA-256 hash of the token (`ReportShareTokens.cs`), so the mint
 * response is the only place the value ever exists in readable form — not the list route, not
 * the database, not a later request. The panel therefore does the opposite of what
 * `components/distribution/ShareLinkPanel` does for a survey: that one MASKS the link and
 * offers a reveal, because a survey's link can be re-read from the record at any time and the
 * risk worth managing is the link sitting in plain sight during a screen-share. Here there is
 * nothing to re-read. Masking a value the administrator can never see again would mean the
 * feature could be used only by somebody who thought to click reveal.
 *
 * So the URL is shown, in full, with the statement that it cannot be shown again, and the
 * remedy for a lost link is stated where the loss happens: mint a new one and revoke the old.
 *
 * ## The URL is assembled here, not on the server
 *
 * `CreateReportShareResponse.Path` is `/shared/reports/{token}` and carries no origin, because
 * the API does not know which of its front ends is asking (`ReportShareDtos.cs` says so). The
 * origin comes from `window.location.origin`, which is the one origin the administrator is
 * demonstrably able to reach — a configured base URL could name a host they cannot.
 *
 * ## Why a copy button AND the URL as selectable text
 *
 * `MicroclimateLivePage` records the finding this has to live with: the clipboard API is
 * blocked outside a secure context and silently no-ops in several embedded browsers, and a
 * copy button that does nothing is worse than a link somebody can select. Both are here — the
 * button for the common case, the full text for the case where it fails — and a failed copy
 * says so rather than claiming success, exactly as `ErasureRequestPanel` does.
 */
interface ReportSharePanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  baseUrl: string
  reportId: string
  reportTitle: string
}

/** The default the server applies when `expiresInDays` is omitted (`ReportShareTokens`). */
const DEFAULT_EXPIRY_DAYS = 30

export default function ReportSharePanel({
  open,
  onOpenChange,
  baseUrl,
  reportId,
  reportTitle,
}: ReportSharePanelProps) {
  const { t, locale } = useTranslation()
  const [shares, setShares] = useState<ReportShareSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [minted, setMinted] = useState<CreateReportShareResult | null>(null)
  const [expiresInDays, setExpiresInDays] = useState(String(DEFAULT_EXPIRY_DAYS))
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<boolean | null>(null)

  // `useCallback` rather than a plain function plus a deps-array lie: the lint budget is
  // `--max-warnings 10` and it is full, so a new `react-hooks(exhaustive-deps)` warning fails
  // CI. `t` is stable per locale.
  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setShares(await listReportShares(baseUrl, reportId))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, reportId, t])

  useEffect(() => {
    if (!open) return
    // The freshly-minted token is dropped when the dialog closes rather than kept in state
    // across openings: a credential on screen unasked, at the moment an administrator is most
    // likely to be screen-sharing, is the failure `ShareLinkPanel` records.
    setMinted(null)
    setCopied(null)
    reload()
  }, [open, reload])

  async function handleMint() {
    setBusy(true)
    setError(null)
    setCopied(null)
    try {
      const parsed = Number.parseInt(expiresInDays, 10)
      // Sent only when it is a number. The server clamps [1, 365] rather than rejecting, so
      // the panel does not clamp a second time -- two clamps are two places to disagree -- and
      // reads `expiresAt` back off the response as the authority on what was minted.
      const result = await createReportShare(
        baseUrl,
        reportId,
        Number.isFinite(parsed) ? { expiresInDays: parsed } : {},
      )
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
      // The revoked link is the one on screen: drop it, so the panel cannot go on offering a
      // URL it has just killed.
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
      // A denied or absent clipboard is not worth an alert: the URL is on screen and
      // selectable, so the reader can still take it.
      setCopied(false)
    }
  }

  function day(value: string): string {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? value : calendarDay(parsed, locale)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('reports.shareTitle')}</DialogTitle>
          <DialogDescription>
            {t('reports.shareDescription', { title: reportTitle })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-panel-gap">
          <Alert variant="warning" role="note">
            <AlertTitle>{t('reports.shareWarningTitle')}</AlertTitle>
            <AlertDescription>{t('reports.shareWarning')}</AlertDescription>
          </Alert>

          {error && <p role="alert">{error}</p>}

          {minted && (
            <Alert variant="info">
              <AlertTitle>{t('reports.shareMintedTitle')}</AlertTitle>
              <AlertDescription>
                <p>{t('reports.shareShownOnce')}</p>
                {/* A readings surface, so mono with tabular figures -- and selectable, which
                    is the fallback when the clipboard is unavailable. */}
                <p
                  data-slot="report-share-url"
                  className="mt-2 break-all font-mono text-sm tabular-nums"
                >
                  {shareLinkUrl(window.location.origin, minted.path)}
                </p>
                <p data-slot="report-share-expiry" className="mt-2 text-sm">
                  {t('reports.shareExpiresOn', { date: day(minted.expiresAt) })}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-inline">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void handleCopy(shareLinkUrl(window.location.origin, minted.path))
                    }
                  >
                    {t('reports.shareCopy')}
                  </Button>
                  {copied !== null && (
                    <span role="status" className="text-sm">
                      {copied ? t('reports.shareCopied') : t('reports.shareCopyFailed')}
                    </span>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-end gap-inline">
            <div>
              <Label htmlFor="report-share-days">{t('reports.shareExpiresInDays')}</Label>
              <Input
                id="report-share-days"
                type="number"
                min={1}
                max={365}
                value={expiresInDays}
                onChange={(event) => setExpiresInDays(event.target.value)}
              />
            </div>
            <Button type="button" disabled={busy} onClick={() => void handleMint()}>
              {t('reports.shareCreate')}
            </Button>
          </div>

          <LoadingRegion loading={loading} label={t('common.loading')}>
            {loading ? (
              <SkeletonText lines={2} />
            ) : shares.length === 0 ? (
              <p className="text-fg-secondary">{t('reports.shareNone')}</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>{t('reports.shareCreatedAt')}</th>
                    <th>{t('reports.shareExpiresAt')}</th>
                    <th>{t('reports.shareOpens')}</th>
                    <th>{t('common.status')}</th>
                    <th>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {shares.map((share) => (
                    <tr key={share.id}>
                      <td>{day(share.createdAt)}</td>
                      <td>{day(share.expiresAt)}</td>
                      {/* Readings, so mono with tabular figures -- the redesign's one
                          typographic law. */}
                      <td className="font-mono tabular-nums">
                        {share.accessCount.toLocaleString(locale)}
                      </td>
                      <td>
                        {/* `secondary` and `outline` only: every other badge variant fails
                            WCAG AA 1.4.3 in at least one theme against styles/tokens.css,
                            measured in ReportList.tsx. The word carries the meaning. */}
                        <Badge variant={share.isActive ? 'secondary' : 'outline'}>
                          {share.isActive ? t('reports.shareActive') : t('reports.shareInactive')}
                        </Badge>
                      </td>
                      <td>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy || share.revokedAt !== null}
                          onClick={() => void handleRevoke(share.id)}
                        >
                          {t('reports.shareRevoke')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </LoadingRegion>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
