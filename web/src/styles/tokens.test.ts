import { describe, it, expect } from 'vitest'
// `?raw` so the assertions read the stylesheets as authored, before Tailwind
// compiles them — these are claims about the source, not about the bundle.
import tokensCss from './tokens.css?raw'
import themeCss from './theme.css?raw'
import indexCss from '../index.css?raw'
import adminThemeSource from '../theme/adminTheme.ts?raw'
import adminLayoutSource from '../app/AdminLayout.tsx?raw'

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

  it('caps the content column somewhere', () => {
    expect(token('--admin-size-content-max')).toBe('1280px')
    expect(adminLayoutSource).toContain('var(--admin-size-content-max)')
  })
})

describe('colour palette', () => {
  it('is the legacy Twenty-CRM admin palette, unchanged', () => {
    expect(token('--admin-bg-outer')).toBe('#f0f0f0')
    expect(token('--admin-bg-panel')).toBe('#ffffff')
    expect(token('--admin-border-default')).toBe('#e0e0e0')
    expect(token('--admin-font-primary')).toBe('#141414')
    expect(token('--admin-font-secondary')).toBe('#474747')
    expect(token('--admin-font-tertiary')).toBe('#818181')
    // The brand accent, and the selected-nav-row fill in the legacy sidebar.
    expect(token('--admin-accent-blue')).toBe('#2e9098')
    expect(token('--admin-font-on-accent')).toBe('#ffffff')
  })

  it('ships a dark palette that a mode switch can actually reach', () => {
    expect(tokensCss).toMatch(/:root\[data-admin-theme='dark'\]/)
    // src/theme/adminTheme.ts is what sets it; asserted there in full.
    expect(adminThemeSource).toContain("'data-admin-theme'")
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
