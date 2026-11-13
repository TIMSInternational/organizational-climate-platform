import { cleanup, render as rtlRender } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import themeCss from '../../styles/theme.css?raw'
import tokensCss from '../../styles/tokens.css?raw'
import { TranslationProvider } from '../../i18n'
import { HatchTag } from '../canvas/HatchTag'
import { HatchedCount } from '../../features/dashboard/next/team/parts'
import ProtectedCell from './ProtectedCell'
import { ANONYMITY_FLOOR, PROTECTED_HATCH, PROTECTED_LABEL } from './suppression'

/**
 * The words on a hatch are on a solid pill, and the pill is readable.
 *
 * The Apple-design review (11 Nov) measured "menos de 3 respuestas" printed straight over the
 * hatch at 3.97:1 on the light stripe (`#6c6c71` on `#e0e0e5`) — under the 4.5:1 text needs
 * (HIG accessibility.md › Vision). happy-dom paints nothing, so this checks the two things a
 * screenshot would: that the words sit inside a `PROTECTED_LABEL` element inside the hatched
 * one, and that the label's ink and fill, resolved through `theme.css` and `tokens.css`,
 * clear 4.5:1 in both themes.
 */

afterEach(cleanup)

function render(ui: ReactElement) {
  return rtlRender(<TranslationProvider initialLocale="es">{ui}</TranslationProvider>)
}

const DARK_BLOCK = /:root\[data-admin-theme='dark'\]\s*\{([\s\S]*?)\n\}/m

function token(name: string, theme: 'light' | 'dark'): string {
  const source = theme === 'dark' ? (DARK_BLOCK.exec(tokensCss)?.[1] ?? '') : tokensCss
  const match = new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm').exec(source)
  if (!match) throw new Error(`${name} is not declared in the ${theme} block of tokens.css`)
  return match[1].trim()
}

/** `bg-surface-card` → `--color-surface-card` → `--admin-bg-card` → its hex. */
function resolve(utility: string, theme: 'light' | 'dark'): string {
  const name = utility.replace(/^(bg|text)-/, '')
  const match = new RegExp(`--color-${name}:\\s*var\\((--admin-[a-z0-9-]+)\\)`).exec(themeCss)
  if (!match) throw new Error(`theme.css maps no --color-${name}`)
  return token(match[1], theme)
}

function luminance(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`${hex} is not an opaque six-digit hex`)
  const [r, g, b] = [1, 3, 5].map((at) => {
    const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const classes = PROTECTED_LABEL.split(/\s+/)
const fill = classes.find((c) => c.startsWith('bg-'))
const ink = classes.find((c) => c.startsWith('text-fg-'))

describe('PROTECTED_LABEL', () => {
  it('names an opaque fill and an ink', () => {
    expect(fill).toBeDefined()
    expect(ink).toBeDefined()
  })

  it.each(['light', 'dark'] as const)('clears 4.5:1 for text in %s', (theme) => {
    // `luminance` throws on anything but an opaque hex, so a translucent fill — whose
    // rendered colour would be the stripes behind it — fails here too.
    expect(contrast(resolve(ink!, theme), resolve(fill!, theme))).toBeGreaterThanOrEqual(4.5)
  })

  it('is measurably better than the ink it replaced, on the stripe', () => {
    // Guard the guard: the pair that failed must still read as failing, or the threshold
    // above is not testing anything.
    expect(contrast(token('--admin-font-tertiary', 'light'), token('--admin-hatch-stripe', 'light'))).toBeLessThan(4.5)
  })
})

/** The words must sit inside a PROTECTED_LABEL element that is itself inside the hatch. */
function expectWordsOnThePill(container: HTMLElement, words: string) {
  const pill = Array.from(container.querySelectorAll<HTMLElement>('[data-slot="protected-label"]')).find((el) =>
    el.textContent?.includes(words),
  )
  expect(pill, `no protected-label element carries «${words}»`).toBeDefined()
  for (const c of classes) expect(pill!.className).toContain(c)
  const hatch = pill!.parentElement?.closest(`[class*="repeating-linear-gradient"]`)
  expect(hatch?.className).toContain(PROTECTED_HATCH)
}

describe('the words on a hatch', () => {
  it('HatchTag prints its label on the pill', () => {
    const { container } = render(<HatchTag label="protegido" />)
    expectWordsOnThePill(container, 'protegido')
  })


  it('ProtectedCell prints its word on the pill', () => {
    const { container } = render(
      <ProtectedCell responses={ANONYMITY_FLOOR - 1} mark="word">
        <span>4,1</span>
      </ProtectedCell>,
    )
    expectWordsOnThePill(container, 'Protegido')
  })
})

/**
 * `HatchedCount` left the hatch (dashboard lane, 12 Nov): the spec's protected state is a
 * padlock and the words in the tertiary ink on the tile, with no striped box. The reason
 * this file exists still holds for it — the words must read at 4.5:1 — so it is measured on
 * the surfaces it now stands on: a card (the leader's survey list, `NodoTile`) and the
 * `bg-surface-fill-subtle` CoverageBox laid over a card (the supervisor's tiles). Should it
 * ever stand on the stripes again, its words must be on the pill like every other hatch.
 */
describe('HatchedCount, off the hatch', () => {
  function rgba(value: string): [number, number, number, number] {
    const hex = /^#([0-9a-f]{6})$/i.exec(value)
    if (hex) return [0, 2, 4].map((at) => Number.parseInt(hex[1].slice(at, at + 2), 16)).concat(1) as never
    const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(value)
    if (!fn) throw new Error(`${value} is neither a six-digit hex nor rgb()/rgba()`)
    return [Number(fn[1]), Number(fn[2]), Number(fn[3]), fn[4] === undefined ? 1 : Number(fn[4])]
  }
  /** A translucent fill composited over an opaque one, as the browser paints it. */
  function over(top: string, under: string): string {
    const [r, g, b, a] = rgba(top)
    const [r0, g0, b0] = rgba(under)
    return `#${[r * a + r0 * (1 - a), g * a + g0 * (1 - a), b * a + b0 * (1 - a)]
      .map((c) => Math.round(c).toString(16).padStart(2, '0'))
      .join('')}`
  }

  function renderCount() {
    const { container } = render(<HatchedCount text="menos de 3 respuestas" label="Menos de 3 respuestas" />)
    const words = Array.from(container.querySelectorAll<HTMLElement>('[data-slot="protected-label"]')).find((el) =>
      el.textContent?.includes('menos de 3 respuestas'),
    )
    expect(words, 'no protected-label element carries the words').toBeDefined()
    return { container, words: words! }
  }

  it('puts its words on the pill whenever it stands on the hatch', () => {
    const { container, words } = renderCount()
    if (container.querySelector(`[class*="repeating-linear-gradient"]`)) expectWordsOnThePill(container, 'menos de 3 respuestas')
    else expect(words.closest(`[class*="repeating-linear-gradient"]`)).toBeNull()
  })

  it.each(['light', 'dark'] as const)('reads at 4.5:1 on a card and on a fill-subtle tile in %s', (theme) => {
    const { words } = renderCount()
    if (words.closest(`[class*="repeating-linear-gradient"]`)) return // measured by the pill above
    const owner = words.closest<HTMLElement>('[class*="text-fg-"]')
    const inkClass = owner?.className.split(/\s+/).find((c) => c.startsWith('text-fg-'))
    expect(inkClass, 'HatchedCount sets no text-fg-* ink').toBeDefined()
    const ink = resolve(inkClass!, theme)
    const card = resolve('bg-surface-card', theme)
    expect(contrast(ink, card)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(ink, over(resolve('bg-surface-fill-subtle', theme), card))).toBeGreaterThanOrEqual(4.5)
  })
})
