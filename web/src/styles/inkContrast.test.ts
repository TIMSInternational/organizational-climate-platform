import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { AA_NON_TEXT_CONTRAST, AA_TEXT_CONTRAST } from '../test/a11y'

/**
 * The base ink × surface contrast matrix, in both themes (#83).
 *
 * ## What this covers that the six existing contrast suites did not
 *
 * `accentContrast`, `accentInkContrast`, `badgeVariantContrast`,
 * `chipVariantContrast`, `divInkContrast`, `seqInkContrast` and
 * `shellInkContrast` each measure one *family*: the accent, a badge, a chip, the
 * heatmap ramps, the navy chrome. Between them they had never measured the
 * ordinary case — a paragraph of text on the page — and that is where 1.4.3 is
 * actually spent. `--admin-font-tertiary` is on 144 elements and
 * `--admin-font-section-label` on 14, and until #83 measured them they were
 * 3.66:1 and 2.44:1 on white: every `CardDescription`, `DialogDescription`,
 * `TableCaption`, breadcrumb trail and KPI eyebrow in the product, below AA.
 *
 * That is the issue's own argument for doing this at the token level — "a token
 * that fails contrast fails everywhere at once" — and it is why the repair went
 * into `tokens.css` rather than into 158 call sites.
 *
 * ## Roles, not one blanket threshold
 *
 * WCAG does not ask 4.5:1 of everything, and pretending it does produces a guard
 * people turn off. Each ink below declares what it is FOR, and the role picks the
 * threshold:
 *
 * - **text** → 1.4.3 at 4.5:1. Every string in this product is under 18.66px (the
 *   shell body is 13px, an eyebrow 10px), so the large-text allowance never
 *   applies here.
 * - **nonText** → 1.4.11 at 3:1, and only for ink that carries no text at all.
 *   Exactly one token qualifies, and the source sweep at the foot of this file is
 *   what stops a second one being talked into the category.
 *
 * ## Read from the stylesheet, never from a copy
 *
 * Values and grounds are both parsed out of the shipped `tokens.css`, following
 * `shellInkContrast.test.ts`. A guard holding its own copy of the palette agrees
 * with itself while the product ships something else.
 */

const STYLES = join(process.cwd(), 'src', 'styles')
const TOKENS = join(STYLES, 'tokens.css')
const DARK_SELECTOR = ":root[data-admin-theme='dark']"

function declarations(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/(--admin-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  )
}

function palettes(): { light: Record<string, string>; dark: Record<string, string> } {
  const css = readFileSync(TOKENS, 'utf8')
  const cut = css.indexOf(DARK_SELECTOR)
  expect(cut, 'tokens.css no longer declares a dark palette').toBeGreaterThan(0)
  const light = declarations(css.slice(css.indexOf(':root {'), cut))
  // The dark block overrides the light one rather than replacing it, which is how
  // the cascade actually resolves: a token the dark block does not restate keeps
  // its light value at runtime, and must be measured with the light value here.
  return { light, dark: { ...light, ...declarations(css.slice(cut)) } }
}

function rgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  expect(m, `expected a 6-digit hex colour, got ${JSON.stringify(hex)}`).not.toBeNull()
  const n = parseInt(m![1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Every opaque ground the page's own ink is printed on.
 *
 * Deliberately not `--admin-bg-shell` or `--admin-shell-*`: the chrome re-points
 * these tokens at a different palette inside `.on-shell`, and
 * `shellInkContrast.test.ts` measures that palette on those grounds. Nor
 * `--admin-bg-overlay` / `--admin-bg-hover` / `--admin-bg-active`, which are
 * `rgba()` tints — a translucent fill has no fixed colour of its own, which is
 * the same reason `chipVariants.ts` refuses to pair ink with one.
 */
const SURFACES = [
  '--admin-bg-outer',
  '--admin-bg-panel',
  '--admin-bg-card',
  '--admin-bg-card-hover',
  '--admin-bg-input',
  '--admin-bg-icon-box',
] as const

interface InkRole {
  token: string
  role: 'text' | 'nonText'
  /** What it paints, so the role is arguable rather than asserted. */
  carries: string
}

const INKS: InkRole[] = [
  { token: '--admin-font-primary', role: 'text', carries: 'headings, table cells, a filled input value' },
  { token: '--admin-font-secondary', role: 'text', carries: 'body copy, nav row labels' },
  {
    token: '--admin-font-tertiary',
    role: 'text',
    carries: 'CardDescription, DialogDescription, TableCaption, breadcrumbs, placeholders',
  },
  {
    token: '--admin-font-section-label',
    role: 'text',
    carries: '10px uppercase eyebrows — KPIDisplay, PageTopBar, dropdown group labels',
  },
  {
    token: '--admin-font-light',
    role: 'nonText',
    carries: "the inactive sort glyph and the calendar's outside-month (disabled) days",
  },
]

const THRESHOLD = { text: AA_TEXT_CONTRAST, nonText: AA_NON_TEXT_CONTRAST } as const

describe('base ink contrast', () => {
  const { light, dark } = palettes()

  it('reads real values out of tokens.css — the vacuity control', () => {
    // If the parse ever broke, every table below would compare `undefined` and
    // `rgb()` would fail loudly rather than silently — but a palette that came
    // back with two entries would still produce a green suite over a matrix that
    // measured almost nothing. Both palettes must be fully populated.
    for (const [name, palette] of [['light', light], ['dark', dark]] as const) {
      for (const { token } of INKS) {
        expect(palette[token], `${name} palette has no ${token}`).toMatch(/^#[0-9a-f]{6}$/i)
      }
      for (const surface of SURFACES) {
        expect(palette[surface], `${name} palette has no ${surface}`).toMatch(/^#[0-9a-f]{6}$/i)
      }
    }
    // And the two palettes must actually differ, or "both themes" is one theme
    // measured twice.
    expect(light['--admin-font-primary']).not.toBe(dark['--admin-font-primary'])
  })

  for (const [theme, palette] of [['light', light], ['dark', dark]] as const) {
    describe(theme, () => {
      for (const ink of INKS) {
        it(`${ink.token} clears ${THRESHOLD[ink.role]}:1 on every surface — ${ink.carries}`, () => {
          const failures = SURFACES.map((surface) => ({
            surface,
            ratio: contrast(palette[ink.token], palette[surface]),
          })).filter(({ ratio }) => ratio < THRESHOLD[ink.role])

          expect(
            failures.map((f) => `${f.surface} ${f.ratio.toFixed(2)}:1`),
            `${ink.token} (${palette[ink.token]}) in ${theme}`,
          ).toEqual([])
        })
      }
    })
  }

  /**
   * WCAG 2.1 SC 1.4.11: the focus indicator is a non-text element that has to be
   * distinguishable from the surface it is drawn on. The ring is read out of the
   * `:focus-visible` rule in `index.css` rather than named here, for the reason
   * `shellInkContrast` reads the nav rule: an assertion about a token stays true
   * when the rule stops using that token.
   */
  it('the focus ring is distinguishable from every surface it is drawn on', () => {
    const index = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    )
    const rule = /:focus-visible\s*\{([^}]*)\}/.exec(index)
    expect(rule, 'index.css no longer has a :focus-visible rule').not.toBeNull()

    const outline = /outline:\s*var\((--admin-[\w-]+)\)\s+solid\s+var\((--admin-[\w-]+)\)/.exec(rule![1])
    expect(outline, 'the :focus-visible rule no longer draws a solid outline from tokens').not.toBeNull()
    const [, widthToken, colourToken] = outline!

    // A 0px ring is not a ring. `2.4.7 Focus Visible` is failed by a width of
    // zero just as surely as by `outline: none`, and only this catches it.
    expect(light[widthToken]).toMatch(/^[1-9]/)

    for (const [theme, palette] of [['light', light], ['dark', dark]] as const) {
      const ring = palette[palette[colourToken].startsWith('#') ? colourToken : '--admin-accent-blue']
      for (const surface of SURFACES) {
        expect(
          contrast(ring, palette[surface]),
          `${colourToken} (${ring}) on ${surface} in ${theme}`,
        ).toBeGreaterThanOrEqual(AA_NON_TEXT_CONTRAST)
      }
    }
  })

  /**
   * A form control inside the chrome must not keep the page's ground.
   *
   * The base element layer paints every `input`/`select`/`textarea` with
   * `color: var(--admin-font-primary)` on `background: var(--admin-bg-input)`.
   * `.on-shell` re-points the ink tokens at the navy palette for its whole
   * subtree — so any ground that rule leaves alone is a page colour under chrome
   * ink. `CompanyContextSwitcher` is such a control (the SuperAdmin's native
   * `<select>` in the top strip), and until #83 it printed #eef3f9 on #ffffff:
   * **1.12:1**, the tenant name for the scope the entire product runs under,
   * invisible.
   *
   * Both ends are read out of the shipped stylesheets, and the ground is read
   * from `.on-shell` rather than named here — an assertion naming
   * `--admin-shell-bg-raised` would stay green if the rule stopped re-pointing
   * `--admin-bg-input` at all, which is the exact defect.
   */
  it('the ground a form control gets inside the shell carries the shell ink', () => {
    const index = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    )
    const onShell = /\.on-shell\s*\{([^}]*)\}/.exec(index)
    expect(onShell, 'index.css no longer has an .on-shell rule').not.toBeNull()

    // Which ground the element layer actually gives a control, read from the rule
    // rather than assumed — if `input, select, textarea` is ever repainted from a
    // different token this follows it.
    const control = /\binput,\s*select,\s*textarea\s*\{([^}]*)\}/.exec(index)
    expect(control, 'index.css no longer styles input/select/textarea as one').not.toBeNull()
    const groundToken = /background:\s*var\((--admin-[\w-]+)\)/.exec(control![1])?.[1]
    const inkToken = /color:\s*var\((--admin-[\w-]+)\)/.exec(control![1])?.[1]
    expect(groundToken, 'the control rule declares no background token').toBeDefined()
    expect(inkToken, 'the control rule declares no colour token').toBeDefined()

    const remap = new RegExp(`${groundToken}:\\s*var\\((--admin-shell-[\\w-]+)\\)`).exec(onShell![1])
    expect(
      remap,
      `.on-shell does not re-point ${groundToken}, so a control in the chrome keeps the page's ground under the chrome's ink`,
    ).not.toBeNull()
    const inkRemap = new RegExp(`${inkToken}:\\s*var\\((--admin-shell-[\\w-]+)\\)`).exec(onShell![1])
    expect(inkRemap, `.on-shell does not re-point ${inkToken}`).not.toBeNull()

    for (const [theme, palette] of [['light', light], ['dark', dark]] as const) {
      expect(
        contrast(palette[inkRemap![1]], palette[remap![1]]),
        `${inkRemap![1]} on ${remap![1]} in ${theme}`,
      ).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST)
    }
  })

  /**
   * The exemption, kept honest.
   *
   * `--admin-font-light` is the only ink held to 3:1 instead of 4.5:1, and that
   * is defensible only while nothing it paints is text. It stops being defensible
   * the moment somebody reaches for `text-fg-light` on a timestamp — which is
   * exactly what `ui/notification-dropdown.tsx` did, at 10px and 2.44:1, until
   * #83 moved it. So the allowlist is enforced rather than described.
   *
   * Matching the class name in source, not the rendered element, because that is
   * where the decision is made and where a reviewer would see it. Comments are
   * stripped first: three files discuss `text-fg-light` in prose explaining why
   * they do NOT use it, and a guard that reads its own explanation as a violation
   * is the "the regex matched the comment" mistake this repository has made
   * before.
   */
  it('nothing but the two exempt call sites paints with the non-text ink', () => {
    const ALLOWED = new Map([
      ['components/ui/calendar.tsx', "outside-month days, which react-day-picker renders disabled — 1.4.3 exempts a disabled control"],
      ['components/ui/table.tsx', 'the inactive sort glyph: a graphic, held to 1.4.11 at 3:1, which it clears'],
    ])

    function walk(dir: string, prefix: string): string[] {
      const found: string[] = []
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = `${prefix}${entry.name}`
        if (entry.isDirectory()) found.push(...walk(join(dir, entry.name), `${path}/`))
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          const source = readFileSync(join(dir, entry.name), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '')
          if (/text-fg-light/.test(source)) found.push(path)
        }
      }
      return found
    }

    const users = walk(join(process.cwd(), 'src'), '')
    // The vacuity control: if the sweep found nothing at all the allowlist would
    // be unfalsifiable, and the next `text-fg-light` would slip past a green test.
    expect(users.length, 'the sweep matched no file — is the class still spelled text-fg-light?').toBeGreaterThan(0)
    expect(users.sort()).toEqual([...ALLOWED.keys()].sort())
  })
})
