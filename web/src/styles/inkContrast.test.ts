import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
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
 * `shellInkContrast.test.ts` measures that palette on those grounds.
 */
const SURFACES = [
  '--admin-bg-outer',
  '--admin-bg-panel',
  '--admin-bg-card',
  '--admin-bg-card-hover',
  '--admin-bg-input',
  '--admin-bg-icon-box',
] as const

/**
 * …and every ground the design system's own state layers make out of them.
 *
 * This matrix used to stop at the opaque tokens, on the grounds that "a
 * translucent fill has no fixed colour of its own". That is true of the token and
 * false of the pixel: the alpha and the surfaces it composites over are all
 * constants in the same file, so the resulting colour is exactly computable — and
 * it is what a reader actually looks at, because the state layers are on the rows
 * that carry the most text in the product:
 *
 * - `ui/table.tsx` puts `hover:bg-state-hover data-[state=selected]:bg-state-active`
 *   on EVERY `TableRow`, and `index.css` hovers `tbody tr` in the base layer too.
 * - `ui/dropdown-menu.tsx` and `ui/select.tsx` tint the highlighted item.
 * - `CommandPalette` tints the selected row and its ESC chip.
 *
 * The bases are the two surfaces those components sit on: a panel (measured live
 * — the companies table's hovered row composites over `--admin-bg-panel`) and a
 * card (four files render a `<Table>` inside a `<Card>`). At the values this
 * branch shipped, `--admin-font-tertiary` measured **4.11:1** on
 * `--admin-bg-active` over white and **3.72:1** on the same tint over the dark
 * card — a repair that had cleared the opaque matrix by ~1% and then lost it to
 * the row underneath. Both tiers were re-valued again; see `tokens.css`.
 */
const STATE_LAYERS = ['--admin-bg-hover', '--admin-bg-active'] as const
const STATE_LAYER_BASES = ['--admin-bg-panel', '--admin-bg-card'] as const

/** `rgba(r, g, b, a)` over an opaque hex, as the hex a screen would show. */
function composite(tint: string, base: string): string {
  const parts = /rgba?\(([^)]+)\)/.exec(tint)
  expect(parts, `expected an rgba() tint, got ${JSON.stringify(tint)}`).not.toBeNull()
  const [r, g, b, a = 1] = parts![1].split(/[\s,/]+/).filter(Boolean).map(Number)
  const under = rgb(base)
  return `#${[r, g, b]
    .map((channel, index) => Math.round(a * channel + (1 - a) * under[index]))
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`
}

/** Every ground an ink can land on in one theme: the opaque ones, then the tints. */
function grounds(palette: Record<string, string>): [string, string][] {
  const opaque = SURFACES.map((surface) => [surface, palette[surface]] as [string, string])
  const tinted = STATE_LAYERS.flatMap((layer) =>
    STATE_LAYER_BASES.map(
      (base) => [`${layer} over ${base}`, composite(palette[layer], palette[base])] as [string, string],
    ),
  )
  return [...opaque, ...tinted]
}

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
      // The state layers must really be translucent tints, and each composite
      // must really differ from the surface under it — a tint parsed as opaque,
      // or an alpha that rounded to nothing, would add four grounds that measure
      // exactly what the four opaque ones already did.
      for (const layer of STATE_LAYERS) {
        expect(palette[layer], `${name} palette has no ${layer}`).toMatch(/^rgba\(/)
      }
      for (const [surface, value] of grounds(palette).slice(SURFACES.length)) {
        expect(value, `${name}: ${surface} did not composite`).toMatch(/^#[0-9a-f]{6}$/i)
        expect(
          STATE_LAYER_BASES.map((base) => palette[base]),
          `${name}: ${surface} composited to its own base`,
        ).not.toContain(value)
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
          const failures = grounds(palette)
            .map(([surface, value]) => ({
              surface,
              ratio: contrast(palette[ink.token], value),
            }))
            .filter(({ ratio }) => ratio < THRESHOLD[ink.role])

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
      for (const [surface, value] of grounds(palette)) {
        expect(
          contrast(ring, value),
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

  /**
   * The same exemption, on the other side of the wall.
   *
   * The sweep above reads `.ts`/`.tsx` for the Tailwind class. It cannot see a
   * hand-written stylesheet, and that is exactly where the exemption was being
   * broken: `.nav-section-title` in `index.css` set `color: var(--admin-font-light)`
   * and `components/layout/CommandPalette.tsx` renders the palette's group headings
   * with that class — on the page's white panel, outside `.on-shell`, so it
   * resolved to the page value. Measured live in Chromium with the palette open:
   * **3.25:1** at 10px in light, 3.94:1 in dark. Both below 4.5:1, and both
   * invisible to a guard that only greps components.
   *
   * The rule is derived rather than listed, so it also covers rules nobody has
   * written yet: this ink may paint text **only from a `:disabled` selector**,
   * which is the one category 1.4.3 exempts by name. That leaves `button:disabled`
   * and `input, select, textarea :disabled` legal and everything else red.
   *
   * A `--admin-font-light: …` declaration is a re-pointing of the token, not a
   * paint (`.on-shell` does exactly that), so only `color:` declarations count.
   */
  it('no stylesheet paints text with the non-text ink outside a :disabled rule', () => {
    const NON_TEXT_INK = '--admin-font-light'

    function stylesheets(dir: string, prefix = ''): [string, string][] {
      const found: [string, string][] = []
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = `${prefix}${entry.name}`
        if (entry.isDirectory()) found.push(...stylesheets(join(dir, entry.name), `${path}/`))
        else if (entry.name.endsWith('.css'))
          found.push([path, readFileSync(join(dir, entry.name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')])
      }
      return found
    }

    // `selector { … }` for every rule in the file. Nested at-rules (`@layer`,
    // `@media`) are stripped of their own braces first so the selectors inside
    // them are seen — every rule in `index.css` lives inside an `@layer`.
    function rules(css: string): [string, string][] {
      const found: [string, string][] = []
      const open: string[] = []
      let buffer = ''
      for (const character of css) {
        if (character === '{') {
          open.push(buffer.trim())
          buffer = ''
        } else if (character === '}') {
          const prelude = open.pop() ?? ''
          // `@layer`/`@media` carry rules, they do not paint. Only the selector
          // that actually holds the declaration is judged.
          if (prelude && !prelude.startsWith('@')) found.push([prelude, buffer])
          buffer = ''
        } else buffer += character
      }
      return found
    }

    const files = stylesheets(join(process.cwd(), 'src'))
    expect(files.length, 'the stylesheet sweep found no .css files').toBeGreaterThan(1)

    const offenders: string[] = []
    for (const [path, css] of files) {
      for (const [selector, body] of rules(css)) {
        if (!new RegExp(`color:\\s*var\\(${NON_TEXT_INK}\\)`).test(body)) continue
        if (!selector.includes(':disabled')) offenders.push(`${path}  ${selector}`)
      }
    }
    expect(offenders).toEqual([])

    // The vacuity control, in both directions: the parse must actually find the
    // two legal `:disabled` paints (or the sweep above passed over nothing), and
    // the rule must reject the spelling that was wrong.
    const legal = files.flatMap(([path, css]) =>
      rules(css)
        .filter(([, body]) => new RegExp(`color:\\s*var\\(${NON_TEXT_INK}\\)`).test(body))
        .map(([selector]) => `${path}  ${selector}`),
    )
    expect(legal.length, 'no stylesheet paints with the non-text ink at all — is the token renamed?').toBeGreaterThanOrEqual(2)
    expect(
      rules(`.nav-section-title { color: var(${NON_TEXT_INK}); }`).filter(
        ([selector]) => !selector.includes(':disabled'),
      ),
    ).toHaveLength(1)
  })

  /**
   * Every ground a chrome component paints must be one `.on-shell` re-points.
   *
   * The rule re-points the ink tokens for its whole subtree, so a ground it does
   * NOT re-point is a page colour under chrome ink. #83 found that twice, one
   * component apart, and both were invisible to the whole suite:
   *
   * - `CompanyContextSwitcher`, the SuperAdmin's `<select>`, on `--admin-bg-input`:
   *   **1.12:1**. Fixed by re-pointing that token; the test above pins it.
   * - `RoleBasedNav`'s collapsed-rail flyout — the only route to a group's
   *   children while the rail is collapsed — on `--admin-bg-panel`: **1.45:1** for
   *   the links and 2.15:1 for the heading, measured live in Chromium at
   *   /dashboard, light. Fixed by painting it from `--admin-bg-overlay`, the token
   *   `.on-shell` already re-points for a popover hanging out of the rail.
   *
   * So this measures the class of defect rather than the two instances. The
   * chrome's components are *derived* from `AdminLayout`: whatever it renders
   * inside an element carrying `on-shell` is chrome, so a component added to the
   * rail tomorrow is swept without anybody remembering to list it here. Every
   * `--admin-bg-*` token those files name must appear on the left of a re-pointing
   * in `.on-shell`, and every re-pointing must land on a `--admin-shell-*` value
   * that `shellInkContrast.test.ts` already measures the shell inks against.
   *
   * This is also what makes the `--admin-bg-overlay` re-pointing load-bearing
   * rather than decorative: delete that line and `SidebarUserMenu`'s popover — a
   * light overlay hanging out of a dark rail — goes back to printing shell ink on
   * a page ground, and this test says so by name.
   */
  it('every ground a chrome component paints is re-pointed by .on-shell', () => {
    const index = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    )
    const onShell = /\.on-shell\s*\{([^}]*)\}/.exec(index)
    expect(onShell, 'index.css no longer has an .on-shell rule').not.toBeNull()
    const remaps = Object.fromEntries(
      [...onShell![1].matchAll(/(--admin-bg-[\w-]+):\s*var\((--admin-shell-[\w-]+)\)/g)].map((m) => [
        m[1],
        m[2],
      ]),
    )

    // Which components are chrome, read out of AdminLayout rather than listed.
    const layoutPath = join(process.cwd(), 'src', 'app', 'AdminLayout.tsx')
    const layout = readFileSync(layoutPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const jsx = layout.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    const shellTags = new Set<string>()
    for (const open of jsx.matchAll(/<(\w+)[^>]*className="[^"]*\bon-shell\b/g)) {
      // From the opening tag to its matching close, by counting the tag itself.
      const from = open.index!
      const tag = open[1]
      let depth = 0
      let at = from
      const step = new RegExp(`<(/?)${tag}[\\s>/]`, 'g')
      step.lastIndex = from
      for (let m = step.exec(jsx); m; m = step.exec(jsx)) {
        depth += m[1] === '/' ? -1 : 1
        at = m.index
        if (depth === 0) break
      }
      for (const child of jsx.slice(from, at).matchAll(/<([A-Z]\w+)/g)) shellTags.add(child[1])
    }
    expect(shellTags.size, 'no chrome components were found inside an .on-shell element').toBeGreaterThanOrEqual(4)

    // …and where those components live, resolved through AdminLayout's own
    // imports. Most of the chrome arrives through the `components/layout` barrel,
    // so a name that lands on a directory is followed one more hop through that
    // directory's `index.ts` — otherwise the sweep would read the barrel, which
    // paints nothing, and pass over every component in it.
    function moduleFor(name: string, from: string, specifier: string): string | null {
      const base = join(from, specifier)
      for (const candidate of [`${base}.tsx`, `${base}.ts`]) {
        if (existsSync(candidate)) return candidate
      }
      const barrel = join(base, 'index.ts')
      if (!existsSync(barrel)) return null
      const source = readFileSync(barrel, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      for (const re of [
        new RegExp(`export\\s+\\{[^}]*\\b${name}\\b[^}]*\\}\\s+from\\s+'(\\.[^']+)'`),
        new RegExp(`export\\s+\\{\\s*default\\s+as\\s+${name}\\s*\\}\\s+from\\s+'(\\.[^']+)'`),
      ]) {
        const hit = re.exec(source)
        if (hit) return moduleFor(name, base, hit[1])
      }
      return null
    }

    const appDir = join(process.cwd(), 'src', 'app')
    const files: string[] = []
    for (const imported of layout.matchAll(
      /import\s+(?:(\w+)|\{([^}]*)\})\s+from\s+'(\.[^']+)'/g,
    )) {
      const names = imported[1] ? [imported[1]] : imported[2].split(',').map((n) => n.trim())
      for (const name of names) {
        if (!shellTags.has(name)) continue
        const file = moduleFor(name, appDir, imported[3])
        expect(file, `${name} is rendered inside .on-shell but resolves to no module`).not.toBeNull()
        files.push(file!)
      }
    }
    expect(
      files.length,
      'none of the chrome components resolved to a module',
    ).toBeGreaterThanOrEqual(5)

    const painted = new Set<string>()
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      for (const token of source.matchAll(/var\((--admin-bg-[\w-]+)\)/g)) painted.add(token[1])
    }
    expect(painted.size, 'no chrome component paints any ground — did the sweep break?').toBeGreaterThan(0)

    const unmapped = [...painted].filter((token) => !remaps[token]).sort()
    expect(
      unmapped,
      'a chrome component paints a ground .on-shell does not re-point, so it keeps the page colour under the chrome ink',
    ).toEqual([])

    // Every re-pointing must land somewhere the shell inks are already measured.
    for (const token of painted) {
      expect(light[remaps[token]], `${remaps[token]} is not a colour in tokens.css`).toBeDefined()
    }
  })
})
