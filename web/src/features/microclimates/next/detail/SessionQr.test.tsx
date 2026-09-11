import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TranslationProvider } from '../../../../i18n'
import { SessionQr } from './SessionQr'

const TOKENS = join(process.cwd(), 'src', 'styles', 'tokens.css')
const THEME = join(process.cwd(), 'src', 'styles', 'theme.css')
const DARK_SELECTOR = ":root[data-admin-theme='dark']"

function declarations(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/(--admin-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
}

/** The light palette, and the dark one as the overrides it is (the dark block restates only what changes). */
function palettes(): { light: Record<string, string>; dark: Record<string, string> } {
  const css = readFileSync(TOKENS, 'utf8')
  const cut = css.indexOf(DARK_SELECTOR)
  expect(cut, 'tokens.css no longer declares a dark palette').toBeGreaterThan(0)
  const light = declarations(css.slice(css.indexOf(':root {'), cut))
  return { light, dark: { ...light, ...declarations(css.slice(cut)) } }
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  expect(match, `expected a 6-digit hex colour, got ${hex}`).not.toBeNull()
  const n = parseInt(match![1], 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

afterEach(cleanup)

describe('SessionQr', () => {
  function renderQr() {
    const { container } = render(
      <TranslationProvider>
        <SessionQr url="https://climate.test/microclimates/m1/respond" microclimateId="m1">
          <p>explicación</p>
        </SessionQr>
      </TranslationProvider>,
    )
    // By its module count, not its name: this provider renders the default locale, not es.
    const svg = container.querySelector<SVGSVGElement>('svg[data-qr-modules]')!
    expect(svg).not.toBeNull()
    expect(screen.getByRole('img')).toBe(svg)
    const paper = svg.querySelector('[data-slot="qr-paper"]')
    expect(paper).not.toBeNull()
    return { svg, paper: paper! }
  }

  // MicroclimateDetail.dc.html: the QR plaque is neutral, beside the one red primary
  // ("Copiar enlace"). The modules were `text-accent-blue-fill` — the brand red #dd0c15 —
  // which the fidelity refuter measured as 5,916 red pixels in the plaque.
  it('paints the modules in the neutral shell ink on the white plaque, never the brand red', () => {
    const { svg, paper } = renderQr()
    const ink = svg.getAttribute('class')!.split(' ')
    expect(ink).toContain('text-surface-shell')
    expect(ink.some((name) => name.includes('accent'))).toBe(false)
    expect(paper.getAttribute('class')!.split(' ')).toContain('fill-fg-on-accent')
    // `resolveQrColors` reads the svg's computed `color` and the paper's `fill`: the downloaded
    // PNG is painted with this same pair, because the path is `currentColor`.
    expect(svg.querySelector('path')?.getAttribute('fill')).toBe('currentColor')
  })

  it('keeps that pair dark on white in both palettes, so the code never inverts and stays scannable', () => {
    const theme = readFileSync(THEME, 'utf8')
    expect(theme).toMatch(/--color-surface-shell:\s*var\(--admin-bg-shell\);/)
    expect(theme).toMatch(/--color-fg-on-accent:\s*var\(--admin-font-on-accent\);/)
    const { light, dark } = palettes()
    for (const [name, palette] of [['light', light], ['dark', dark]] as const) {
      const ratio = contrast(palette['--admin-bg-shell'], palette['--admin-font-on-accent'])
      expect(ratio, `QR ink on paper is ${ratio.toFixed(2)}:1 in ${name}`).toBeGreaterThanOrEqual(12)
      expect(luminance(palette['--admin-bg-shell']), `QR ink is not dark in ${name}`).toBeLessThan(0.05)
    }
  })
})
