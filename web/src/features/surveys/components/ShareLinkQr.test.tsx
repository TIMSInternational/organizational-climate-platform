import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import type { ComponentProps } from 'react'
import qrcode from 'qrcode-generator'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import ShareLinkPanel from '../../../components/distribution/ShareLinkPanel'
import SurveyDistributionPage from '../pages/SurveyDistributionPage'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context'
import { tokenFor } from '../../../test/jwtFixture'
import ShareLinkQr, {
  downloadFileName,
  qrModules,
  qrPathData,
  qrPngBlob,
  qrSvgMarkup,
  resolveQrColors,
  shareLinkTarget,
  type RasterDeps,
} from './ShareLinkQr'

afterEach(cleanup)

/**
 * A token of the real shape: `SurveyAccessTokens` mints 32 random bytes and base64url-encodes
 * them, so `public_url` is `/s/` plus 43 characters. The QR version, and therefore the module
 * count pinned below, is a function of that length — a fixture with a short fake token would
 * pin the wrong number and the pin would mean nothing.
 */
const TOKEN = 'aaaabbbbccccddddeeeeffffgggghhhhiiiijjjjkkk'
const LINK = `/s/${TOKEN}`
const ORIGIN = 'https://climate.timsint.com'

function renderQr(props: Partial<ComponentProps<typeof ShareLinkQr>> = {}) {
  return render(
    <TranslationProvider initialLocale="en">
      <ShareLinkQr publicLink={LINK} accessType="public" origin={ORIGIN} {...props} />
    </TranslationProvider>,
  )
}

async function reveal(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'Show QR code' }))
}

describe('ShareLinkQr — when there is nothing to encode', () => {
  it('renders nothing at all when no open link is minted', () => {
    const { container } = renderQr({ publicLink: null })
    expect(container.innerHTML).toBe('')
  })

  it.each(['tokenized', 'restricted'])(
    'renders nothing when the access type is %s rather than public',
    (accessType) => {
      // The server nulls `public_url` on revoke and on any move off `public`
      // (`SurveyDistributionEndpoints.cs:342-348`), so this pairing should not arrive — but
      // "never render a QR for a link that is not active" must hold on the component's own
      // terms, not because an upstream value happened to be null.
      const { container } = renderQr({ accessType })
      expect(container.innerHTML).toBe('')
    },
  )

  it('does not put the code on screen until it is asked for', async () => {
    // Same rule as `ShareLinkPanel`'s mask, and for a sharper version of the same reason:
    // a camera reads a QR off a shared screen with nobody transcribing anything.
    const { container } = renderQr()
    expect(container.querySelector('svg')).toBeNull()
    expect(container.innerHTML).not.toContain(TOKEN)

    await reveal()
    expect(container.querySelector('svg')).not.toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Hide QR code' }))
    expect(container.querySelector('svg')).toBeNull()
  })
})

describe('ShareLinkQr — what the code encodes', () => {
  /**
   * The guarantee that matters: the thing a phone lands on is the absolute form of exactly
   * the link the panel beside it reveals, and not a second string assembled somewhere else.
   *
   * Proven by rendering BOTH components from the one `publicLink` the page passes to both,
   * revealing both, and re-deriving the path data independently from the anchor's own visible
   * text. Decoding the QR is not needed and would prove less: this compares the encoder's
   * input against what the reader is shown.
   */
  it('encodes the absolute form of exactly the link the panel reveals', async () => {
    const { container } = render(
      <TranslationProvider initialLocale="en">
        <ShareLinkPanel
          publicLink={LINK}
          accessType="public"
          onCreate={() => {}}
          onRegenerate={() => {}}
          onRevoke={() => {}}
        />
        <ShareLinkQr publicLink={LINK} accessType="public" origin={ORIGIN} />
      </TranslationProvider>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Reveal' }))
    await reveal()

    const shownLink = container.querySelector('[data-slot="share-link-value"]')?.textContent ?? ''
    expect(shownLink).toBe(LINK)

    const expected = qrPathData(qrModules(`${ORIGIN}${shownLink}`))
    expect(expected.length).toBeGreaterThan(0)
    expect(container.querySelector('svg path')?.getAttribute('d')).toBe(expected)
  })

  it('resolves the site-relative path against the browsing origin, once', () => {
    expect(shareLinkTarget(ORIGIN, LINK)).toBe(`${ORIGIN}${LINK}`)
    // A trailing slash would yield `//s/<token>`, which is a different path from the one the
    // API uniquely indexed.
    expect(shareLinkTarget(`${ORIGIN}/`, LINK)).toBe(`${ORIGIN}${LINK}`)
  })

  it('leaves an already-absolute link alone rather than stacking two origins', () => {
    // Not hypothetical: `scripts/shot-fixtures/distribution.json` serves
    // `"publicLink": "https://climate.example/s/7f3a9c21b4e8"`. Concatenating gives
    // `http://localhost:5173https://climate.example/…` — a code that scans perfectly and
    // lands nowhere, which is the worst way for this feature to fail.
    const absolute = 'https://climate.example/s/7f3a9c21b4e8'
    expect(shareLinkTarget(ORIGIN, absolute)).toBe(absolute)
    expect(shareLinkTarget(ORIGIN, absolute)).not.toContain(`${ORIGIN}https`)
  })

  it('pins the QR version, so a settings change cannot silently coarsen or refine the grid', async () => {
    // 37 modules is version 5 — what type-number `0` with error correction `M` chooses for a
    // 73-character payload. Both halves are pinned: the library's answer, and the number the
    // rendered SVG reports. A drift in either is a change to how every printed code scans.
    const target = shareLinkTarget(ORIGIN, LINK)
    expect(target.length).toBe(73)
    expect(qrModules(target).length).toBe(37)

    const { container } = renderQr()
    await reveal()
    expect(container.querySelector('svg')?.getAttribute('data-qr-modules')).toBe('37')
  })

  /**
   * The orientation and the quiet zone, checked against the library's OWN renderer.
   *
   * `qrPathData` reads `isDark(row, column)` and writes `M<column> <row>` — x from the
   * column, y from the row. Transposing those two produces a picture that still has three
   * finder squares in three corners and still looks exactly like a QR code in a screenshot,
   * while encoding format bits a scanner reads in the wrong place. No screenshot review
   * catches that, and neither does any assertion above.
   *
   * `createSvgTag` in `qrcode-generator` emits `M<col*cell+margin>,<row*cell+margin>` and
   * defaults `margin` to four cells. At `cellSize: 1, margin: 4` that is the same coordinate
   * space this component draws in, so the two paths must name the same set of squares — an
   * assertion against code this lane did not write.
   */
  it('draws the same squares as the library’s own renderer, at the same margin', () => {
    const qr = qrcode(0, 'M')
    qr.addData(shareLinkTarget(ORIGIN, LINK))
    qr.make()
    const reference = [...qr.createSvgTag({ cellSize: 1, margin: 4 }).matchAll(/M(\d+),(\d+)l/g)]
      .map(([, x, y]) => `${x},${y}`)
      .sort()
    const mine = [...qrPathData(qrModules(shareLinkTarget(ORIGIN, LINK))).matchAll(/M(\d+) (\d+)h/g)]
      .map(([, x, y]) => `${x},${y}`)
      .sort()
    expect(reference.length).toBeGreaterThan(100)
    expect(mine).toEqual(reference)
  })

  it('carries a four-module quiet zone inside the viewBox', async () => {
    // In the viewBox rather than in CSS padding, so it survives every scale the SVG is drawn
    // at and the PNG export too: 37 modules + 4 on each side = 45.
    const { container } = renderQr()
    await reveal()
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('viewBox')).toBe('0 0 45 45')

    // The paper rect covers the whole box, quiet zone included; the path never enters it.
    const rect = container.querySelector('[data-slot="qr-paper"]')
    expect([rect?.getAttribute('width'), rect?.getAttribute('height')]).toEqual(['45', '45'])
    const coordinates = [...(svg?.querySelector('path')?.getAttribute('d') ?? '').matchAll(/M(\d+) (\d+)/g)]
    expect(coordinates.length).toBeGreaterThan(0)
    for (const [, x, y] of coordinates) {
      expect(Number(x)).toBeGreaterThanOrEqual(4)
      expect(Number(y)).toBeGreaterThanOrEqual(4)
      expect(Number(x)).toBeLessThan(41)
      expect(Number(y)).toBeLessThan(41)
    }
  })

  it('names the code in the reader’s own language', async () => {
    renderQr()
    await reveal()
    expect(screen.getByRole('img', { name: 'QR code for this survey’s open share link' })).toBeTruthy()

    cleanup()
    render(
      <TranslationProvider initialLocale="es">
        <ShareLinkQr publicLink={LINK} accessType="public" origin={ORIGIN} />
      </TranslationProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar código QR' }))
    expect(
      screen.getByRole('img', { name: 'Código QR del enlace público de esta encuesta' }),
    ).toBeTruthy()
  })
})

/**
 * The QR must be dark-on-light in BOTH themes, because ISO/IEC 18004 assumes it and a
 * light-on-dark code is at the mercy of the scanner. So the two colours are taken from the
 * only tokens this system paints identically in both palettes, and that is measured here from
 * `tokens.css` rather than asserted in a comment — the recurring blind spot this repo
 * documents is a contrast failure that holds in one theme and not the other.
 */
describe('ShareLinkQr — the code never inverts', () => {
  const TOKENS = join(process.cwd(), 'src', 'styles', 'tokens.css')
  const THEME = join(process.cwd(), 'src', 'styles', 'theme.css')
  const DARK_SELECTOR = ":root[data-admin-theme='dark']"
  const SOURCE = join(process.cwd(), 'src', 'features', 'surveys', 'components', 'ShareLinkQr.tsx')

  function palettes(): { light: Record<string, string>; dark: Record<string, string> } {
    const css = readFileSync(TOKENS, 'utf8')
    const cut = css.indexOf(DARK_SELECTOR)
    expect(cut, 'tokens.css no longer declares a dark palette').toBeGreaterThan(0)
    const declarations = (block: string): Record<string, string> =>
      Object.fromEntries(
        [...block.matchAll(/(--admin-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
      )
    const light = declarations(css.slice(css.indexOf(':root {'), cut))
    return { light, dark: { ...light, ...declarations(css.slice(cut)) } }
  }

  function rgb(value: string): [number, number, number] {
    const hex = value.match(/^#([0-9a-fA-F]{6})$/)
    expect(hex, `not a six-digit hex: ${value}`).not.toBeNull()
    return [0, 2, 4].map((i) => parseInt(hex![1].slice(i, i + 2), 16)) as [number, number, number]
  }

  function luminance(channels: [number, number, number]): number {
    const [r, g, b] = channels.map((value) => {
      const scaled = value / 255
      return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }

  function contrast(a: string, b: string): number {
    const [lighter, darker] = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x)
    return (lighter + 0.05) / (darker + 0.05)
  }

  /**
   * The two palette variables the component actually paints, derived end to end and restated
   * nowhere: the class names come out of `ShareLinkQr.tsx`, and `theme.css` says which
   * `--admin-*` each `--color-*` utility resolves to.
   *
   * A guard holding its own copy of the token names can agree with itself while the component
   * paints something else, which is exactly how an ink/paper pair drifts.
   */
  function tokensUsedByComponent(): { ink: string; paper: string } {
    const source = readFileSync(SOURCE, 'utf8')
    const ink = source.match(/const INK_CLASS = 'text-([a-z0-9-]+)'/)
    const paper = source.match(/const PAPER_CLASS = 'fill-([a-z0-9-]+)'/)
    expect(ink, 'INK_CLASS no longer matches — the extractor stopped working').not.toBeNull()
    expect(paper, 'PAPER_CLASS no longer matches — the extractor stopped working').not.toBeNull()

    const theme = readFileSync(THEME, 'utf8')
    const resolve = (utility: string): string => {
      const declared = theme.match(
        new RegExp(`--color-${utility}:\\s*var\\((--admin-[\\w-]+)\\)`),
      )
      expect(declared, `theme.css declares no --color-${utility}`).not.toBeNull()
      return declared![1]
    }
    return { ink: resolve(ink![1]), paper: resolve(paper![1]) }
  }

  it('paints both colours the same in light and dark, so a dark-mode export is not inverted', () => {
    const { light, dark } = palettes()
    const { ink, paper } = tokensUsedByComponent()
    expect(light[ink], `${ink} missing from the light palette`).toBeDefined()
    expect(light[paper], `${paper} missing from the light palette`).toBeDefined()
    expect(dark[ink]).toBe(light[ink])
    expect(dark[paper]).toBe(light[paper])
  })

  it('keeps the module/paper pair above the AA floor in both palettes', () => {
    const { light, dark } = palettes()
    const { ink, paper } = tokensUsedByComponent()
    for (const palette of [light, dark]) {
      expect(contrast(palette[ink], palette[paper])).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('measures a real failure too, so a broken measurement cannot pass everything', () => {
    // Guard the guard: `--admin-font-primary` is the ink that DOES flip with the theme, and
    // against white it is 15.9:1 in light and 1.16:1 in dark. If this ever clears the floor
    // the measurement is broken, not the tokens.
    const { dark } = palettes()
    expect(contrast(dark['--admin-font-primary'], dark['--admin-font-on-accent'])).toBeLessThan(4.5)
  })
})

describe('ShareLinkQr — the PNG download', () => {
  it('builds standalone markup with literal colours, because a data-URL SVG has no CSS', () => {
    const markup = qrSvgMarkup({
      text: shareLinkTarget(ORIGIN, LINK),
      ink: 'rgb(221, 12, 21)',
      paper: 'rgb(255, 255, 255)',
      pixels: 1024,
    })
    expect(markup).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(markup).toContain('width="1024" height="1024"')
    expect(markup).toContain('viewBox="0 0 45 45"')
    expect(markup).toContain('fill="rgb(255, 255, 255)"')
    expect(markup).toContain('fill="rgb(221, 12, 21)"')
    // Nothing the browser would have to resolve against a stylesheet.
    expect(markup).not.toContain('currentColor')
    expect(markup).not.toContain('class=')
    expect(markup).toContain(qrPathData(qrModules(shareLinkTarget(ORIGIN, LINK))))
  })

  /**
   * The one assertion that reaches a *successful* rasterisation.
   *
   * `happy-dom` answers `getContext('2d')` with `null` (measured, not assumed — see the guard
   * test below), so the real DOM cannot produce a bitmap here at all. `RasterDeps` exists so
   * this path is exercised somewhere rather than being taken on trust; a browser is still the
   * only place the real pixels are proven, and the screenshots in the PR are that evidence.
   */
  it('produces an image/png blob when the browser can rasterise', async () => {
    const drawn: string[] = []
    const image = { src: '', onload: null, onerror: null } as unknown as HTMLImageElement
    const deps: RasterDeps = {
      createCanvas: () =>
        ({
          width: 0,
          height: 0,
          getContext: () => ({ drawImage: (_i: unknown) => drawn.push('drawn') }),
          toBlob: (callback: (blob: Blob | null) => void, type?: string) =>
            callback(new Blob(['png-bytes'], { type })),
        }) as unknown as HTMLCanvasElement,
      createImage: () => {
        // Fire `onload` once the caller has assigned `src`, which is the order a real
        // `Image` decodes in.
        Object.defineProperty(image, 'src', {
          configurable: true,
          set(value: string) {
            Object.defineProperty(image, 'src', { configurable: true, value })
            queueMicrotask(() => image.onload?.(new Event('load')))
          },
          get() {
            return ''
          },
        })
        return image
      },
    }

    const markup = qrSvgMarkup({
      text: shareLinkTarget(ORIGIN, LINK),
      ink: 'rgb(0, 0, 0)',
      paper: 'rgb(255, 255, 255)',
      pixels: 64,
    })
    const blob = await qrPngBlob(markup, 64, deps)
    expect(blob).not.toBeNull()
    expect(blob!.type).toBe('image/png')
    expect(blob!.size).toBeGreaterThan(0)
    expect(drawn).toEqual(['drawn'])
  })

  it('returns null rather than throwing when the browser has no 2D context', async () => {
    // Measured, not assumed: this is what happy-dom does, and it is also what a browser with
    // canvas disabled does. `null` is the contract the component's failure notice depends on.
    expect(document.createElement('canvas').getContext('2d')).toBeNull()
    const markup = qrSvgMarkup({ text: 'x', ink: '#000', paper: '#fff', pixels: 8 })
    await expect(qrPngBlob(markup, 8)).resolves.toBeNull()
  })

  /**
   * Which guard actually fires in this environment, measured rather than assumed.
   *
   * `resolveQrColors` reads the live cascade, and under `happy-dom` — which loads no
   * stylesheet and generates no Tailwind rule — the paper rect has no resolvable `fill`. So
   * the component test below reaches its notice through the **colour** guard, not the canvas
   * one, and removing the canvas guard leaves that test green.
   *
   * That is the "two guards look like one test" trap, so it is written down: the canvas guard
   * is covered by `qrPngBlob` directly, one test up, and the successful rasterisation only by
   * the injected `RasterDeps`. Real pixels are proven in a browser, in the PR's screenshots.
   */
  it('cannot resolve the plaque colours under a DOM with no stylesheet', async () => {
    const { container } = renderQr()
    await reveal()
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(resolveQrColors(svg as SVGSVGElement)).toBeNull()
  })

  it('tells the user when the download could not be produced, instead of doing nothing', async () => {
    // The whole path through the component, on the real (canvas-less) DOM. Without this the
    // button would appear to work and no file would ever arrive.
    renderQr()
    await reveal()
    await userEvent.click(screen.getByRole('button', { name: 'Download PNG' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('could not produce the PNG')
    // The code stays on screen: it is still valid and still screenshottable.
    expect(screen.getByRole('img', { name: /QR code/ })).toBeTruthy()
  })
})

/**
 * The wiring, asserted on the PAGE.
 *
 * Everything above renders `ShareLinkQr` directly, which proves the component and proves
 * nothing about whether `/surveys/:id/distribution` ever mounts it. That gap was real and
 * measurable: deleting the `<ShareLinkQr>` element from `SurveyDistributionPage.tsx` left the
 * whole suite green, so a merge resolution that dropped it — on a file two lanes and every
 * future distribution change will touch — would have shipped a green CI with the feature
 * gone. This repo has recorded that exact loss before ("A merge can drop a guarantee").
 *
 * These tests render the real page against a stubbed API. `SurveyDistributionPage.test.tsx`
 * is not a file this lane owns, so the assertion lives here rather than being added there.
 */
describe('the distribution page mounts the QR beside the share link', () => {
  const PAGE_TOKEN = 'aaaabbbbccccddddeeeeffffgggghhhhiiiijjjjkkk'
  const PAGE_LINK = `/s/${PAGE_TOKEN}`

  function surveyRead() {
    return {
      id: 's1',
      companyId: 'c1',
      language: 'both',
      status: 'active',
      title: 'Team pulse',
      resolvedLocale: 'en',
      fallbackFields: [],
      departmentIds: [],
      responseCount: 2,
      settings: { invitationCustomSubject: 'Your invitation', invitationCustomMessage: 'Please answer.' },
    }
  }

  const invitationSummary = {
    total: 1, pending: 0, sent: 1, opened: 0, started: 0, completed: 0, revoked: 0, expired: 0,
  }
  const anonymity = {
    anonymous: false,
    highestRecordableState: 'completed',
    suppressedStates: [],
    guarantee: 'Tracking runs to completion.',
  }

  function distributionRead(overrides: Record<string, unknown> = {}) {
    return {
      id: 'd1',
      surveyId: 's1',
      accessType: 'public',
      publicLink: PAGE_LINK,
      qrCodeUrl: PAGE_LINK,
      accessRules: {
        requireLogin: false, allowAnonymous: true, singleResponse: true,
        activeOutsideSchedule: false, allowedDomains: null, blockedIps: null, maxResponses: null,
      },
      qrCustomization: { foregroundColor: '#000', backgroundColor: '#fff', logoUrl: null, size: 256 },
      tokenizedLinksGenerated: 0,
      regeneratedCount: 0,
      lastRegeneratedAt: null,
      totalAccesses: 0,
      uniqueVisitors: 0,
      lastAccessedAt: null,
      invitations: invitationSummary,
      anonymity,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
      ...overrides,
    }
  }

  function json(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200 })
  }

  function stubApi(distribution: Record<string, unknown> = {}) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes('/distribution')) return Promise.resolve(json(distributionRead(distribution)))
        if (String(url).includes('/invitations')) {
          return Promise.resolve(json({ invitations: [], summary: invitationSummary, anonymity }))
        }
        if (String(url).includes('/admin/departments')) return Promise.resolve(json({ departments: [] }))
        if (String(url).includes('/admin/users')) return Promise.resolve(json({ users: [] }))
        return Promise.resolve(json(surveyRead()))
      }),
    )
  }

  function renderPage() {
    return render(
      <TranslationProvider initialLocale="en">
        <CompanyContextProvider>
          <MemoryRouter initialEntries={['/surveys/s1/distribution']}>
            <Routes>
              <Route path="/surveys/:surveyId/distribution" element={<SurveyDistributionPage />} />
            </Routes>
          </MemoryRouter>
        </CompanyContextProvider>
      </TranslationProvider>,
    )
  }

  beforeEach(() => {
    setToken(tokenFor({ role: 'company_admin', companyId: 'c1' }))
  })

  afterEach(() => {
    cleanup()
    clearToken()
    localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('offers the QR on a public survey, encoding the same link the panel holds', async () => {
    stubApi()
    const { container } = renderPage()

    // Both halves of CLIMA-005 in the one section: the panel's reveal and the code's.
    await screen.findByRole('button', { name: 'Reveal' })
    await userEvent.click(screen.getByRole('button', { name: 'Show QR code' }))

    const svg = container.querySelector('svg[data-qr-modules]')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('data-qr-modules')).toBe('37')

    // Re-derived from the link the FIXTURE served, against the origin the page is browsing.
    // A page that mounted the component but handed it some other string fails here.
    const expected = qrPathData(qrModules(`${window.location.origin}${PAGE_LINK}`))
    expect(expected.length).toBeGreaterThan(0)
    expect(svg?.querySelector('path')?.getAttribute('d')).toBe(expected)
  })

  it('offers no QR on an invitation-only survey, while still rendering the section', async () => {
    stubApi({ accessType: 'tokenized', publicLink: null })
    renderPage()

    // The section is up -- so a null result here is "no QR", not "page never loaded".
    await screen.findByRole('button', { name: 'Create an open link' })
    expect(screen.queryByRole('button', { name: 'Show QR code' })).toBeNull()
  })

  /**
   * The whole download, driven through the page, with the browser bits a `happy-dom` cannot
   * provide stubbed at their real seams — the cascade, the canvas, `Image`, `createObjectURL`
   * and the anchor's `click`. Three separate guarantees ride on it:
   *
   * 1. The saved file is named after the SURVEY. `publicLink` is `/s/` plus the entire
   *    43-character bearer token, so a name taken from the link's tail puts that credential
   *    in the download bubble and the downloads page.
   * 2. The anchor is IN the document when it is clicked. Firefox has historically refused a
   *    programmatic download from a detached anchor, and no Firefox is installed here.
   * 3. The page passes its own `surveyId` down, which nothing else asserts.
   */
  it('downloads a PNG named after the survey, from an anchor inside the document', async () => {
    stubApi()
    renderPage()

    await screen.findByRole('button', { name: 'Reveal' })
    await userEvent.click(screen.getByRole('button', { name: 'Show QR code' }))

    const blobs: Blob[] = []
    const clicks: { download: string; connected: boolean; href: string }[] = []

    // happy-dom loads no stylesheet, so the live cascade cannot answer `resolveQrColors`.
    // The real declaration is kept and only the two properties the component reads are
    // overlaid: `userEvent` reads `pointer-events` on every ancestor before a click and
    // `dom-accessibility-api` calls `getPropertyValue` on this object, so a plain literal
    // here breaks the test harness rather than the code under test.
    const real = globalThis.getComputedStyle.bind(globalThis)
    vi.stubGlobal('getComputedStyle', (element: Element, pseudo?: string | null) => {
      const overrides: Record<string, string> =
        element instanceof SVGSVGElement
          ? { color: 'rgb(221, 12, 21)' }
          : element.getAttribute?.('data-slot') === 'qr-paper'
            ? { fill: 'rgb(255, 255, 255)' }
            : {}
      return new Proxy(real(element, pseudo), {
        get(target, property) {
          if (typeof property === 'string' && property in overrides) return overrides[property]
          const value = Reflect.get(target, property, target) as unknown
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    })
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        set src(_value: string) {
          queueMicrotask(() => this.onload?.())
        }
      },
    )
    // `happy-dom` HAS all four of these; they just answer `null` / do nothing, so they are
    // spied rather than defined, and `vi.restoreAllMocks()` puts the real ones back.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: () => {},
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      (callback: BlobCallback, type?: string) => {
        const blob = new Blob(['png-bytes'], { type })
        blobs.push(blob)
        callback(blob)
      },
    )
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stub-object-url')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push({ download: this.download, connected: this.isConnected, href: this.href })
    })

    await userEvent.click(screen.getByRole('button', { name: 'Download PNG' }))

    expect(screen.queryByRole('alert')).toBeNull()
    expect(blobs.map((blob) => blob.type)).toEqual(['image/png'])
    expect(clicks.length).toBe(1)
    expect(clicks[0].download).toBe('qr-survey-s1.png')
    expect(clicks[0].download).not.toContain(PAGE_TOKEN)
    expect(clicks[0].href).toContain('blob:')
    expect(clicks[0].connected).toBe(true)
    // Cleaned up: the anchor is a means, not a thing left lying in the body.
    expect(document.querySelectorAll('a[download]').length).toBe(0)
  })
})

describe('ShareLinkQr — naming the file, and failing out loud', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('names the download after the survey and never after the token', () => {
    expect(downloadFileName('s1')).toBe('qr-survey-s1.png')
    expect(downloadFileName('9f6f0e2c-1a4b-4e77-9c1e-0b2f5a3d7e11')).toBe(
      'qr-survey-9f6f0e2c-1a4b-4e77-9c1e-0b2f5a3d7e11.png',
    )
    // No id, and anything that is not a plain id, fall back rather than reach the filesystem.
    expect(downloadFileName()).toBe('qr-survey-share-link.png')
    expect(downloadFileName('')).toBe('qr-survey-share-link.png')
    expect(downloadFileName('../../etc/passwd')).toBe('qr-survey-share-link.png')
    expect(downloadFileName(`/s/${TOKEN}`)).toBe('qr-survey-share-link.png')
  })

  /**
   * `handleDownload` used to have a `finally` and no `catch`, so a throw from
   * `getComputedStyle`, `createObjectURL` or `click()` escaped `void handleDownload()` as an
   * unhandled rejection: the button un-disabled and the user was told nothing, which is the
   * one outcome `qrDownloadFailed` exists to prevent. The two failure tests above cannot see
   * it — they both drive the `blob === null` path, which returns normally.
   */
  it('says the download failed when a browser API throws, rather than going quiet', async () => {
    renderQr()
    await reveal()

    // Thrown only for the `<svg>`, which is the element `resolveQrColors` asks about;
    // `userEvent` reads computed style on the button and its ancestors before every click,
    // so a blanket throw would fail inside the test's own click rather than inside the
    // component.
    const real = globalThis.getComputedStyle.bind(globalThis)
    vi.stubGlobal('getComputedStyle', (element: Element, pseudo?: string | null) => {
      if (element instanceof SVGSVGElement) {
        throw new Error('this browser refuses to compute style here')
      }
      return real(element, pseudo)
    })

    // If the rejection is unhandled this still resolves, so the assertion is the notice.
    await userEvent.click(screen.getByRole('button', { name: 'Download PNG' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('could not produce the PNG')
    // And the button is usable again rather than stuck in "Preparing…".
    expect(screen.getByRole('button', { name: 'Download PNG' })).toBeTruthy()
  })
})
