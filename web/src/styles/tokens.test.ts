import { describe, it, expect } from 'vitest'
// `?raw` so the assertions read the stylesheets as authored, before Tailwind
// compiles them — these are claims about the source, not about the bundle.
import tokensCss from './tokens.css?raw'
import themeCss from './theme.css?raw'
import indexCss from '../index.css?raw'
import adminThemeSource from '../theme/adminTheme.ts?raw'
import respondShellSource from '../components/layout/RespondShell.tsx?raw'

/**
 * The token layer is a port, not a design. These tests pin the two things a
 * reviewer cannot check by eye:
 *
 *  1. the values that came from a named legacy declaration still equal it, so
 *     "no visual regression against the legacy admin pages" degrades into a
 *     failing test rather than into a silent drift (#169);
 *  2. the invariants the layer's own docs promise — the space scale is named in
 *     pixels, `--spacing` keeps Tailwind's numeric utilities stock, the root
 *     font size is not pinned, the type scale is relative.
 *
 * Legacy sources are cited per assertion. They live in the retired Next.js app
 * (`climate-project`), so they are quoted here rather than imported.
 */

/** Comments cite legacy CSS verbatim, braces and all, so structural matching strips them. */
function stripComments(css: string) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

const indexRules = stripComments(indexCss)

/** Value of a custom property in the first (`:root`, light) block that declares it. */
function token(name: string): string {
  const match = new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm').exec(tokensCss)
  if (!match) throw new Error(`token ${name} is not declared in tokens.css`)
  return match[1].trim()
}

/** Value of a custom property inside the dark palette block. */
function darkToken(name: string): string {
  const body = /:root\[data-admin-theme='dark'\]\s*\{([\s\S]*?)\n\}/m.exec(stripComments(tokensCss))
  if (!body) throw new Error('tokens.css has no dark palette block')
  const match = new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm').exec(body[1])
  if (!match) throw new Error(`token ${name} is not declared in the dark block`)
  return match[1].trim()
}

describe('the fixtures themselves', () => {
  it('are the stylesheets as authored, not a stub or a compiled copy', () => {
    // Vitest returns an empty string for CSS imports unless `test.css` is on.
    expect(tokensCss).toContain('THE NUMBER IN THE NAME IS THE PIXEL COUNT')
    expect(indexCss).toContain('NO LEGACY COUNTERPART')
    expect(themeCss).toContain('TWO NUMBERING SYSTEMS MEET HERE')
  })
})

describe('space scale', () => {
  const declarations = [...tokensCss.matchAll(/^\s*--admin-space-(\d+):\s*([^;]+);/gm)]

  it('declares a scale', () => {
    expect(declarations.length).toBeGreaterThan(10)
  })

  // The trap this prevents: `p-4` is 16px (4 × --spacing) while
  // `var(--admin-space-4)` is 4px. Naming the token by its pixel value is what
  // stops the two numbering systems from being mistaken for each other.
  it.each(declarations.map((d) => [d[1], d[2].trim()]))(
    '--admin-space-%s is %s, i.e. the number in the name is the pixel count',
    (digits, value) => {
      expect(value).toBe(`${digits}px`)
    },
  )
})

describe('tailwind spacing unit', () => {
  it('keeps the numeric utilities identical to stock Tailwind', () => {
    // Tailwind emits `calc(var(--spacing) * N)` for `p-N`. A 4px unit is stock.
    expect(/--spacing:\s*var\(--admin-space-4\)\s*;/.test(themeCss)).toBe(true)
    expect(token('--admin-space-4')).toBe('4px')
  })
})

describe('type scale', () => {
  it('is relative, so browser default-font-size preferences are honoured', () => {
    const sizes = [...tokensCss.matchAll(/^\s*--admin-text-[\w-]+:\s*([^;]+);/gm)].map((m) =>
      m[1].trim(),
    )
    expect(sizes.length).toBe(8)
    for (const size of sizes) expect(size).toMatch(/rem$/)
  })

  it('does not pin the root font size', () => {
    const htmlBlock = /\bhtml\s*\{([^}]*)\}/.exec(indexRules)
    expect(htmlBlock).not.toBeNull()
    expect(htmlBlock![1]).not.toMatch(/font-size/)
  })

  it('is the 13px admin base — legacy AppShell.tsx/Sidebar.tsx `fontSize: 13`', () => {
    // 0.8125rem = 13px at a 16px default.
    expect(token('--admin-text-base')).toBe('0.8125rem')
    expect(indexRules).toMatch(/body\s*\{[^}]*font-size:\s*var\(--admin-text-base\)/)
  })

  it('carries the legacy heading treatment — globals.css h1..h6', () => {
    expect(token('--admin-weight-semibold')).toBe('600')
    expect(token('--admin-leading-tight')).toBe('1.2')
    expect(token('--admin-tracking-tight')).toBe('-0.025em')
  })
})

describe('control density', () => {
  it.each([
    // ui/button.tsx size="sm" and ui/input.tsx / ui/select.tsx: `h-8` = 32px.
    ['--admin-size-control-lg', '2rem'],
    // Sidebar.tsx nav rows and avatar tiles: `minHeight: 28` / `height: 28`.
    ['--admin-size-control-md', '1.75rem'],
    ['--admin-size-icon-box', '1.75rem'],
    // Legacy nav icons: `h-4 w-4`.
    ['--admin-size-icon', '16px'],
    // ui/button.tsx / ui/input.tsx `rounded-[4px]`; AppShell <main> radius 8.
    ['--admin-radius-md', '4px'],
    ['--admin-radius-xl', '8px'],
    // AppShell.tsx content inset 12 and inter-panel gap 8.
    ['--admin-size-shell-gutter', 'var(--admin-space-12)'],
    ['--admin-size-panel-gap', 'var(--admin-space-8)'],
  ])('%s is %s', (name, expected) => {
    expect(token(name)).toBe(expected)
  })

  it('sizes buttons, inputs and selects at the legacy 32px control height', () => {
    expect(indexRules).toMatch(/button\s*\{[^}]*height:\s*var\(--admin-size-control-lg\)/)
    expect(indexRules).toMatch(
      /input,\s*select,\s*textarea\s*\{[^}]*height:\s*var\(--admin-size-control-lg\)/,
    )
  })

  it('reserves full width for controls inside a form row, not every control', () => {
    // A bare <input type="search"> must keep its intrinsic width.
    expect(indexRules).toMatch(/label > input,[\s\S]*?width:\s*100%/)
    const bareControlRule = /\binput,\s*select,\s*textarea\s*\{([^}]*)\}/.exec(indexRules)
    expect(bareControlRule).not.toBeNull()
    expect(bareControlRule![1]).not.toMatch(/width:/)
  })

  /**
   * The token survives; the shell is no longer one of its callers.
   *
   * This used to assert `adminLayoutSource` mentioned the cap. That assertion is
   * now unrunnable as written — `AdminLayout` still *names* the token, in the
   * comment explaining why it stopped using it, so the regex would match a
   * comment and pass vacuously whatever the markup did. The cap's real callers are
   * asserted instead: two standalone centred pages with no rail beside them, which
   * is the shape a centred capped column is right for.
   */
  it('keeps the content cap for the pages that have no rail to drift away from', () => {
    expect(token('--admin-size-content-max')).toBe('1280px')
    // `RespondShell` is where the cap now lives: it frames all three respond
    // routes -- `/survey/:id`, `/surveys/:id/respond` and
    // `/microclimates/:id/respond` -- which were three divergent copies of one
    // standalone centred layout before, only one of which had ever been given one.
    expect(respondShellSource).toMatch(/max-w-content/)
  })

  it('gives the page header a flex basis wide enough to be worth wrapping for', () => {
    // `layout/PageTopBar.tsx` wears this as `basis-header-text`, and it is what
    // makes the action cluster drop to its own line instead of squeezing the
    // title. The value has to be a real width: a zero (or a percentage, which is
    // what `flex-1`'s `0%` basis is) puts the flex base size back at nothing and
    // the row silently stops wrapping at every viewport — invisible to happy-dom,
    // and the defect this token was added to fix.
    expect(token('--admin-size-header-text-min')).toBe('20rem')
    expect(themeCss).toMatch(/--container-header-text:\s*var\(--admin-size-header-text-min\)/)
  })

  it('reserves a viewport-relative block for a page-level empty state', () => {
    // `ui/error-state.tsx` reads this for its `fill` variant. Viewport-relative
    // because the dead space it compensates for grows with the display.
    expect(token('--admin-size-empty-fill')).toBe('50vh')
  })
})

describe('colour palette', () => {
  it('is the admin palette: blue on the shell, white inside', () => {
    // No longer byte-for-byte legacy Twenty-CRM. Federico asked for "blue on the
    // shell, white inside", so `--admin-bg-shell` went navy and the content ground
    // went white -- and the light neutrals were re-biased from green-grey to
    // blue-grey, because a green-biased grey under a navy chrome reads as two
    // unrelated products. Values only; whether any of these pairings is legible is
    // measured in the contrast suites next door (`shellInkContrast`,
    // `chipVariantContrast`, `accentContrast`, ...). Two different claims, kept in
    // two places on purpose: this one catches a value changing AT ALL, those catch a
    // value changing into something unreadable.
    expect(token('--admin-bg-outer')).toBe('#ffffff')
    expect(token('--admin-bg-panel')).toBe('#ffffff')
    expect(token('--admin-border-default')).toBe('#dbe3ee')
    expect(token('--admin-font-primary')).toBe('#0d1626')
    expect(token('--admin-font-secondary')).toBe('#44536b')
    expect(token('--admin-font-tertiary')).toBe('#78879c')
    // The shell frame itself. Pinned because it is the one token the redesign is
    // ABOUT: it is what "blue on the shell" means, and it is deliberately a separate
    // token from `--admin-bg-outer`, which is also the ground of the sign-in and
    // survey-answering screens and must stay white.
    expect(token('--admin-bg-shell')).toBe('#122c4d')
    expect(darkToken('--admin-bg-shell')).toBe('#0a1c31')
    // The brand accent. NOT byte-for-byte legacy any more: UI-0 revalued it from
    // the legacy `#2e9098` (oklch chroma 0.089, under the 0.1 floor, which is why
    // the product read grey) to the validated teal, and split off a darker fill
    // step so white-on-accent can clear AA. `accentContrast.test.ts` is what pins
    // the relationship between the three; this only pins the values.
    expect(token('--admin-accent-blue')).toBe('#0d9488')
    expect(token('--admin-accent-blue-fill')).toBe('#0f766e')
    expect(token('--admin-accent-blue-fill-hover')).toBe('#115e59')
    expect(token('--admin-font-on-accent')).toBe('#ffffff')
  })

  it('ships a dark palette that a mode switch can actually reach', () => {
    expect(tokensCss).toMatch(/:root\[data-admin-theme='dark'\]/)
    // src/theme/adminTheme.ts is what sets it; asserted there in full.
    expect(adminThemeSource).toContain("'data-admin-theme'")
  })
})

/**
 * #208. The ramp gained a paired ink per step so a value can be painted inside a
 * heatmap cell and stay legible.
 *
 * The *values* are pinned here; whether they are legible is measured in
 * `seqInkContrast.test.ts`, which runs `scripts/check-seq-contrast.mjs` over this
 * same file. Two different claims, deliberately in two places: this one catches a
 * value changing at all, that one catches a value changing into something
 * unreadable.
 */
describe('sequential ramp paired ink', () => {
  const steps = [1, 2, 3, 4, 5, 6, 7]

  it('declares an ink for every step of both themes', () => {
    expect(steps.map((n) => token(`--admin-chart-seq-${n}-ink`))).toEqual([
      '#02100f',
      '#02100f',
      '#02100f',
      '#02100f',
      '#02100f',
      '#02100f',
      '#f0fdfa',
    ])
    expect(steps.map((n) => darkToken(`--admin-chart-seq-${n}-ink`))).toEqual([
      '#f0fdfa',
      '#f0fdfa',
      '#f0fdfa',
      '#f0fdfa',
      '#02100f',
      '#02100f',
      '#02100f',
    ])
  })

  it('draws its inks from outside the ramp', () => {
    // Not a stylistic preference: #0d9488 sits in the middle of the ramp in both
    // themes, and the deepest step of the ramp itself (#042f2e) measures 3.86:1
    // against it -- a fail. An ink taken from the ramp cannot clear AA.
    const ramp = new Set([
      ...steps.map((n) => token(`--admin-chart-seq-${n}`)),
      ...steps.map((n) => darkToken(`--admin-chart-seq-${n}`)),
    ])
    for (const n of steps) {
      expect(ramp.has(token(`--admin-chart-seq-${n}-ink`))).toBe(false)
      expect(ramp.has(darkToken(`--admin-chart-seq-${n}-ink`))).toBe(false)
    }
  })

  it('exposes each ink as a utility, next to the fill it belongs to', () => {
    for (const n of steps) {
      expect(themeCss).toContain(`--color-chart-seq-${n}-ink: var(--admin-chart-seq-${n}-ink);`)
    }
  })
})

describe('class detection', () => {
  it('scans code, not prose — a utility named in the docs must not ship CSS', () => {
    expect(indexCss).toMatch(/@import 'tailwindcss' source\(none\)/)
    expect(indexCss).toMatch(/@source '\.\/\*\*\/\*\.\{ts,tsx\}'/)
    expect(indexCss).toMatch(/@source '\.\.\/index\.html'/)
    expect(indexCss).toMatch(/@source not '\.\/\*\*\/\*\.test\.\{ts,tsx\}'/)
  })
})
