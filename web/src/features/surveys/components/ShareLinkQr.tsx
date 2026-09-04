/* eslint-disable react/only-export-components -- see the note under "Why the pure parts
   live in this file" in the module comment below. */
import { useRef, useState } from 'react'
import qrcode from 'qrcode-generator'
import { useTranslation } from '../../../i18n'
import { Button, H3 } from '../../../components/ui'

/**
 * The open share link as a QR code, rendered in the browser and downloadable as a PNG.
 *
 * CLIMA-005 promises "URL + QR distribution". The URL half has always shipped; the QR half
 * did not exist anywhere in the product. `survey_distributions.qr_code_url` is `NOT NULL`
 * and holds **the URL a QR code would encode**, not an image — see the comment at
 * `src/ClimateProject.Api/Endpoints/SurveyDistributionEndpoints.cs:226`, which says so and
 * says why. Nothing server-side changes here: the field already holds the right value, and
 * this component is the renderer that was missing.
 *
 * ## Why the QR is hidden until asked for
 *
 * `ShareLinkPanel` masks the link by default, and its own comment gives the reason: the
 * failure mode is "the link sitting in plain sight while a distribution page is
 * screen-shared into a stand-up, pasted into a status report, or captured in a screenshot
 * filed against a ticket."
 *
 * A QR code is that same bearer credential in a form a **camera** can lift off a screen
 * from across a room, with nobody transcribing anything. Rendering it unconditionally
 * beside a deliberately-masked link would hand back exactly the disclosure the mask was
 * written to prevent, and would do it in the more dangerous of the two formats. So
 * revealing the QR is a deliberate act, for the same reason and by the same rule.
 *
 * ## Why the colours do not follow the theme
 *
 * ISO/IEC 18004 assumes dark modules on a light background, and while some phone cameras
 * cope with an inverted code, "some" is not a property to hand to a survey respondent
 * standing in front of a printed poster. A theme-following QR would be light-on-dark for
 * every admin in dark mode, and would export that way too.
 *
 * So the pair is picked from the two tokens this design system defines **identically in
 * both palettes**, rather than from a hardcoded black and white:
 *
 * - modules: `--color-accent-blue-fill` — `#dd0c15` at `styles/tokens.css:418` (light) and
 *   `:719` (dark).
 * - paper: `--color-fg-on-accent` — `#ffffff` at `:363` (light) and `:704` (dark).
 *
 * `styles/tokens.css:407-408` names this pair the one surface/ink combination in the
 * system, measured at 5.47:1 with white in both themes by `styles/accentContrast.test.ts`.
 * `ShareLinkQr.test.tsx` re-measures it from `tokens.css` in both palettes rather than
 * trusting this comment, and fails if either token is ever repainted per-theme.
 *
 * The panel around it is ordinary token chrome, so the *plaque* is what stays constant, not
 * the page.
 *
 * ## Why the origin comes from the browser
 *
 * `publicLink` is site-relative (`/s/<token>`) by server design:
 * `SurveyAccessTokens.PublicLinkPrefix` documents that `public_url` is uniquely indexed and
 * "baking a host into it would mean the same link stored under two different origins
 * (staging and production, or before and after a domain change) is two different rows and
 * one broken index" (`SurveyAccessTokens.cs:33-39`).
 *
 * The blunter sentence "nothing here may ever concatenate a host" is a *different* member's
 * doc — `InvitationLinkPath`, at `SurveyAccessTokens.cs:66-75` — and it is scoped to
 * invitation links, which the mail sender resolves against `EmailOptions.AppBaseUrl`. It is
 * quoted here only to say where it does and does not apply: this component concatenates a
 * host, on purpose, to a value that rule does not govern.
 *
 * A camera has no page to resolve a relative path against, so the QR *must* carry an
 * absolute URL. `window.location.origin` is the only honest source available on this
 * screen: it is the origin the administrator is looking at, which means a staging admin
 * gets a staging QR and a production admin gets a production one, with no configuration to
 * get wrong.
 *
 * ## Why the pure parts live in this file, and why the file disables one lint rule
 *
 * `qrModules`, `qrPathData`, `shareLinkTarget`, `qrSvgMarkup`, `resolveQrColors` and
 * `qrPngBlob` are exported so they can be measured directly. Two of the guarantees this
 * feature makes are only checkable that way: that the PNG blob really is `image/png` (which
 * needs a canvas seam, because `happy-dom` has no 2D context), and that the standalone
 * export markup carries literal colours rather than a `currentColor` no `data:` URL can
 * resolve.
 *
 * `react/only-export-components` warns about that because a module mixing a component with
 * other exports breaks Vite's Fast Refresh for the file. That is a dev-server nicety; the
 * alternative is a second module whose only purpose is to be importable, and the web lint
 * budget is a hard `--max-warnings 10` that `main` already sits exactly at, so a warning
 * here is a CI failure rather than a note. The rule is disabled for this file, deliberately
 * and in one place, rather than paid for six times.
 */

/**
 * `0` asks the library for the smallest version that fits, so the code stays as coarse —
 * and therefore as scannable — as the payload allows.
 */
const QR_TYPE_NUMBER = 0

/**
 * Error correction level M: ~15% recovery. L is more fragile than a printed poster in an
 * office corridor deserves; Q and H push the module count up (a finer grid) for redundancy
 * a screen-or-poster QR does not need.
 */
const QR_ERROR_CORRECTION = 'M'

/**
 * Four modules of blank margin on every side, which is the quiet zone ISO/IEC 18004
 * requires. It lives inside the `viewBox`, not in CSS padding, so it survives every scale
 * the SVG is drawn at and, crucially, the PNG export — a downloaded QR pasted onto a poster
 * with no quiet zone is the classic unreadable code.
 */
const QUIET_ZONE_MODULES = 4

/** Edge length of the exported PNG, in pixels. */
const DOWNLOAD_PIXELS = 1024

/**
 * What the saved file is called.
 *
 * **Not** named after the link. `publicLink` is `/s/` plus the *whole* token — 43 base64url
 * characters, `SurveyAccessTokens.EncodedLength` — so `linkPath.split('/').pop()` is the
 * entire bearer credential, and a download filename is displayed in the browser's download
 * bubble, its downloads page and every OS file listing. Those are the same screen-share
 * surfaces this component hides the code behind in the first place, so putting the token
 * there would undo the reason the reveal is a click.
 *
 * The survey id is used instead: it is already in this page's own URL, it opens nothing, and
 * it is the thing an admin matches a code against. Anything that is not a plain id falls
 * back to a fixed name rather than being interpolated into a path — a filename is a
 * filesystem write instruction, and `..` or a slash in it is not something to pass through.
 */
export function downloadFileName(surveyId?: string): string {
  const plainId = (surveyId ?? '').match(/^[A-Za-z0-9-]{1,64}$/)
  return plainId === null ? 'qr-survey-share-link.png' : `qr-survey-${plainId[0]}.png`
}

/** The dark-module colour: a Tailwind utility over `--color-accent-blue-fill`. */
const INK_CLASS = 'text-accent-blue-fill'

/** The paper colour: a Tailwind utility over `--color-fg-on-accent`. */
const PAPER_CLASS = 'fill-fg-on-accent'

export interface ShareLinkQrProps {
  /**
   * The site-relative share link (`/s/<token>`), or `null` when the survey is invitation-only
   * and no open link is minted. `null` renders nothing at all.
   */
  publicLink: string | null
  /**
   * How the survey is reachable. Only `public` gets a QR code. The server already nulls
   * `public_url` when the access type moves off `public` or the link is revoked
   * (`RevokeLink`, `SurveyDistributionEndpoints.cs:342-348`), so this is a second lock on
   * the same door — stated here because "never render a QR for a link that is not active"
   * is the requirement, and a requirement enforced only by a value arriving `null` from
   * somewhere else is enforced by accident.
   */
  accessType?: string
  /** Absolute origin to resolve `publicLink` against. Defaults to the browsing origin. */
  origin?: string
  /**
   * The survey this link belongs to, used only to name the downloaded file. Optional because
   * the name has a safe fallback and a QR nobody can file is worse than a generic filename.
   */
  surveyId?: string
}

/** The QR grid for `text`, as rows of dark/light modules. */
export function qrModules(text: string): boolean[][] {
  const qr = qrcode(QR_TYPE_NUMBER, QR_ERROR_CORRECTION)
  qr.addData(text)
  qr.make()
  const count = qr.getModuleCount()
  return Array.from({ length: count }, (_, row) =>
    Array.from({ length: count }, (_, column) => qr.isDark(row, column)),
  )
}

/**
 * One `<path>` covering every dark module, offset by the quiet zone.
 *
 * One path rather than N `<rect>`s: a version-5 code is 37x37, so roughly 700 dark modules,
 * and 700 elements is 700 elements the browser lays out and the serialiser writes into the
 * PNG's source markup. The sub-path is written as an explicit closed square rather than
 * `h1v1h-1z`-with-implicit-close so adjacent modules share an exact edge and no hairline
 * seam appears between them at any scale.
 */
export function qrPathData(modules: boolean[][], quietZone = QUIET_ZONE_MODULES): string {
  const parts: string[] = []
  for (const [row, cells] of modules.entries()) {
    for (const [column, dark] of cells.entries()) {
      if (dark) parts.push(`M${column + quietZone} ${row + quietZone}h1v1h-1z`)
    }
  }
  return parts.join('')
}

/** Anything already carrying a scheme, e.g. `https://…`. */
const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i

/**
 * The absolute URL a camera should end up at.
 *
 * A trailing slash on the origin would produce `https://host//s/token`, which resolves but
 * is not the path the API indexed, so it is trimmed rather than tolerated.
 *
 * An already-absolute `publicLink` is passed through untouched. The API stores site-relative
 * paths and `SurveyAccessTokens.PublicLinkPrefix` says it always will, so this should not
 * arrive from the server — but `web/scripts/shot-fixtures/distribution.json` carries
 * `"publicLink": "https://climate.example/s/7f3a9c21b4e8"`, which is proof that a caller in
 * this repository already hands one over. Prefixing an origin onto that yields
 * `http://localhost:5173https://climate.example/…`: a QR that encodes a URL resolving
 * nowhere, and fails by sending a respondent to a dead page rather than by looking broken.
 */
export function shareLinkTarget(origin: string, publicLink: string): string {
  if (ABSOLUTE_URL.test(publicLink)) return publicLink
  return `${origin.replace(/\/+$/, '')}${publicLink}`
}

/** The two colours the live SVG actually paints, resolved from the cascade. */
export interface QrColors {
  ink: string
  paper: string
}

/**
 * Read the rendered colours back off the DOM rather than restating the token values.
 *
 * The PNG is produced by loading serialised SVG markup into an `Image`, and that markup is
 * parsed with **no CSS context at all** — a Tailwind class or a `currentColor` in it paints
 * nothing. So the export has to carry literal colours, and the only way to have them agree
 * with the screen is to ask the browser what the screen is.
 */
export function resolveQrColors(svg: SVGSVGElement): QrColors | null {
  const paperNode = svg.querySelector('[data-slot="qr-paper"]')
  if (paperNode === null) return null
  const ink = getComputedStyle(svg).color
  const paper = getComputedStyle(paperNode).fill
  if (ink === '' || paper === '' || paper === 'none') return null
  return { ink, paper }
}

export interface QrSvgMarkupOptions {
  text: string
  ink: string
  paper: string
  pixels: number
  quietZone?: number
}

/** A standalone SVG document for `text`, with literal colours and no external dependencies. */
export function qrSvgMarkup({
  text,
  ink,
  paper,
  pixels,
  quietZone = QUIET_ZONE_MODULES,
}: QrSvgMarkupOptions): string {
  const modules = qrModules(text)
  const extent = modules.length + quietZone * 2
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}"`,
    ` viewBox="0 0 ${extent} ${extent}" shape-rendering="crispEdges">`,
    `<rect width="${extent}" height="${extent}" fill="${paper}"/>`,
    `<path d="${qrPathData(modules, quietZone)}" fill="${ink}"/>`,
    '</svg>',
  ].join('')
}

/**
 * The browser objects `qrPngBlob` needs, injectable so a test can supply a canvas that
 * works. `happy-dom` returns `null` from `getContext('2d')`, which is the real guard path
 * and is tested as such — but it also means the *successful* rasterisation cannot be
 * exercised against the real DOM, so the seam exists to let one assertion reach it.
 */
export interface RasterDeps {
  createCanvas: () => HTMLCanvasElement
  createImage: () => HTMLImageElement
}

const browserRasterDeps: RasterDeps = {
  createCanvas: () => document.createElement('canvas'),
  createImage: () => new Image(),
}

/**
 * Rasterise standalone SVG markup to a PNG blob, entirely in the browser.
 *
 * `null` on every path a browser can refuse on — no 2D context, no `toBlob`, an `Image`
 * that will not decode the markup — because the caller has a real thing to say to the user
 * in that case, and a thrown exception here would surface as the page's generic
 * "action failed".
 *
 * No server call: the API has no image endpoint, and adding one would put a rendering
 * dependency and a licence question into the deployed service to produce a file the client
 * already has everything needed to make. See `docs/decisions/qr-rendering.md`.
 */
export async function qrPngBlob(
  markup: string,
  pixels: number,
  deps: RasterDeps = browserRasterDeps,
): Promise<Blob | null> {
  const canvas = deps.createCanvas()
  if (typeof canvas.getContext !== 'function' || typeof canvas.toBlob !== 'function') return null
  const context = canvas.getContext('2d')
  if (context === null) return null
  canvas.width = pixels
  canvas.height = pixels

  const image = deps.createImage()
  const decoded = await new Promise<boolean>((resolve) => {
    image.onload = () => resolve(true)
    image.onerror = () => resolve(false)
    // A data URL rather than a blob URL: a blob URL has to be revoked, and an `Image`
    // whose source is revoked mid-decode fails silently.
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
  })
  if (!decoded) return null

  // The paper rect fills the whole viewBox, so the PNG is opaque and needs no explicit
  // background fill underneath it.
  context.drawImage(image, 0, 0, pixels, pixels)
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
}

export default function ShareLinkQr({ publicLink, accessType, origin, surveyId }: ShareLinkQrProps) {
  const { t } = useTranslation()
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [shown, setShown] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [failed, setFailed] = useState(false)

  // The two conditions under which there is nothing to encode. Deliberately before the
  // `useState` consumers and after the hooks, so the hook order never depends on the data.
  if (publicLink === null) return null
  if (accessType !== undefined && accessType !== 'public') return null

  // Re-bound as a `const` so the narrowing above survives into `handleDownload`: a
  // destructured parameter's narrowing does not reach a nested function.
  const linkPath = publicLink
  const resolvedOrigin = origin ?? (typeof window === 'undefined' ? '' : window.location.origin)
  const target = shareLinkTarget(resolvedOrigin, linkPath)
  // Encoded only while the code is on screen. `qrModules` runs the whole encoder --
  // Reed-Solomon blocks and eight mask evaluations over a 37x37 grid -- and this page
  // re-renders on every invitation-filter click, every busy flag and every notice, so doing
  // it for a code nobody has asked for is that work repeated for nothing in the DOM.
  const modules = shown ? qrModules(target) : null
  const extent = modules === null ? 0 : modules.length + QUIET_ZONE_MODULES * 2

  async function handleDownload(): Promise<void> {
    const svg = svgRef.current
    if (svg === null) return
    setDownloading(true)
    setFailed(false)
    try {
      const colors = resolveQrColors(svg)
      const blob =
        colors === null
          ? null
          : await qrPngBlob(
              qrSvgMarkup({ text: target, ink: colors.ink, paper: colors.paper, pixels: DOWNLOAD_PIXELS }),
              DOWNLOAD_PIXELS,
            )
      if (blob === null) {
        setFailed(true)
        return
      }
      const href = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = downloadFileName(surveyId)
      // In the document for the click, not clicked while detached. Chromium honours a
      // detached `<a download>` and that is the only engine installed on the machine this
      // was built on (`ls ~/Library/Caches/ms-playwright` lists chromium and
      // chromium_headless_shell only), but Firefox has historically required a
      // programmatically-clicked download anchor to be in the document. Ship the form that
      // works in both rather than the form that was measurable here.
      anchor.style.display = 'none'
      document.body.append(anchor)
      try {
        anchor.click()
      } finally {
        anchor.remove()
        URL.revokeObjectURL(href)
      }
    } catch {
      // Every line in the `try` is a line a browser can throw from: `getComputedStyle`
      // inside `resolveQrColors`, `createObjectURL` on a blob the browser will not take,
      // and `click()` itself under a download policy that refuses. Without this clause the
      // rejection escaped `void handleDownload()` unhandled and the only thing the user saw
      // was the button un-disable with nothing said -- the exact outcome
      // `qrDownloadFailed` exists to prevent, reached by the one path that skipped it.
      setFailed(true)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="flex flex-col gap-panel-gap rounded-lg border border-line-light bg-surface-panel p-panel md:w-[20rem] md:shrink-0">
      <H3>{t('surveys.distribution.qrTitle')}</H3>
      <p className="text-sm text-fg-secondary">{t('surveys.distribution.qrHint')}</p>

      {modules !== null ? (
        <>
          {/* The plaque, not the page: `PAPER_CLASS` and `INK_CLASS` are the two tokens
              that are identical in both palettes, so the code never inverts. The white
              border ring is the quiet zone made visible against a dark page — the zone
              itself is inside the viewBox and is what a scanner reads. */}
          <div className="rounded-md bg-fg-on-accent p-inline">
            <svg
              ref={svgRef}
              role="img"
              aria-label={t('surveys.distribution.qrAlt')}
              viewBox={`0 0 ${extent} ${extent}`}
              shapeRendering="crispEdges"
              data-qr-modules={modules.length}
              className={`block h-auto w-full ${INK_CLASS}`}
            >
              <title>{t('surveys.distribution.qrAlt')}</title>
              <rect
                data-slot="qr-paper"
                width={extent}
                height={extent}
                className={PAPER_CLASS}
              />
              <path d={qrPathData(modules)} fill="currentColor" />
            </svg>
          </div>

          <div className="flex flex-wrap gap-inline">
            <Button variant="outline" size="sm" onClick={() => setShown(false)}>
              {t('surveys.distribution.qrHide')}
            </Button>
            <Button variant="outline" size="sm" disabled={downloading} onClick={() => void handleDownload()}>
              {downloading
                ? t('surveys.distribution.qrDownloading')
                : t('surveys.distribution.qrDownload')}
            </Button>
          </div>

          {failed && (
            <p role="alert" className="text-sm text-fg-secondary">
              {t('surveys.distribution.qrDownloadFailed')}
            </p>
          )}
        </>
      ) : (
        <div>
          <Button variant="outline" size="sm" onClick={() => setShown(true)}>
            {t('surveys.distribution.qrShow')}
          </Button>
        </div>
      )}
    </div>
  )
}
