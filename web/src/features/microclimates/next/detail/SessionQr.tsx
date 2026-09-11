import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Download } from 'lucide-react'
import { useTranslation } from '../../../../i18n'
import { Button } from '../../../../components/ui'
import { downloadBlobFile } from '../../../../lib/downloadBlobFile'
import { qrModules, qrPathData, qrPngBlob, qrSvgMarkup, resolveQrColors } from '../../../surveys/components/ShareLinkQr'

/** Four modules of quiet zone, inside the viewBox — ISO/IEC 18004's minimum, as `ShareLinkQr` draws it. */
const QUIET_ZONE = 4
const DOWNLOAD_PIXELS = 1024

/**
 * The session's respond link as a QR code beside its explanation and its download — the
 * board's 150px "QR" square, filled, in a `150px | 1fr` row.
 *
 * Built from `ShareLinkQr`'s own exported parts (`qrModules`, `qrPathData`, `qrSvgMarkup`,
 * `qrPngBlob`, `resolveQrColors` — `qrcode-generator`, already a dependency) and its plaque:
 * modules in `text-accent-blue-fill` on `fill-fg-on-accent`, the one ink/paper pair defined
 * identically in both palettes, so the code never inverts in the dark theme.
 *
 * Unlike a survey's share link this one is shown at once, not behind a reveal: the survey
 * link is a bearer token, while a microclimate's respond URL is its id, which the board
 * prints in full beside the code — the point of the step is to put it in front of a room.
 */
export function SessionQr({ url, microclimateId, children }: { url: string; microclimateId: string; children: ReactNode }) {
  const { t } = useTranslation()
  const svgRef = useRef<SVGSVGElement | null>(null)
  const modules = useMemo(() => qrModules(url), [url])
  const extent = modules.length + QUIET_ZONE * 2
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  async function download(): Promise<void> {
    const svg = svgRef.current
    if (svg === null) return
    setBusy(true)
    setFailed(false)
    try {
      const colors = resolveQrColors(svg)
      const blob =
        colors === null
          ? null
          : await qrPngBlob(qrSvgMarkup({ text: url, ink: colors.ink, paper: colors.paper, pixels: DOWNLOAD_PIXELS }), DOWNLOAD_PIXELS)
      if (blob === null) {
        setFailed(true)
        return
      }
      downloadBlobFile(`microclimate-${microclimateId}-qr.png`, blob)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid grid-cols-1 items-center gap-5 sm:grid-cols-[150px_minmax(0,1fr)]">
      <div className="flex size-[150px] shrink-0 items-center justify-center rounded-xl border border-line-default bg-fg-on-accent p-2">
        <svg
          ref={svgRef}
          role="img"
          aria-label={t('microclimates.next.detail.qrAlt')}
          viewBox={`0 0 ${extent} ${extent}`}
          shapeRendering="crispEdges"
          data-qr-modules={modules.length}
          className="block size-full text-accent-blue-fill"
        >
          <title>{t('microclimates.next.detail.qrAlt')}</title>
          <rect data-slot="qr-paper" width={extent} height={extent} className="fill-fg-on-accent" />
          <path d={qrPathData(modules, QUIET_ZONE)} fill="currentColor" />
        </svg>
      </div>
      <div className="flex min-w-0 flex-col items-start gap-2.5">
        {children}
        <Button variant="outline" disabled={busy} onClick={() => void download()}>
          <Download aria-hidden="true" />
          {t('microclimates.next.detail.downloadQr')}
        </Button>
        {failed && (
          <span role="alert" className="text-sm text-accent-red-ink">
            {t('microclimates.next.detail.qrFailed')}
          </span>
        )}
      </div>
    </div>
  )
}
