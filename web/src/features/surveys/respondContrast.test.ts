import { describe, it, expect } from 'vitest'
import { readFileSync, globSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every ink/surface pair the respond form writes must clear WCAG AA in BOTH palettes.
 *
 * ## Why this file exists rather than a note in review
 *
 * This project's documented recurring blind spot is a contrast failure that is visible
 * in one theme only — #80 shipped four AA failures that all passed in dark and all
 * failed in light. The respond page is the worst possible place to repeat it: it is
 * the screen the most people see, it is the only one a respondent cannot ask an
 * administrator to work around, and a respondent who cannot read the error telling
 * them a question is unanswered simply abandons the survey.
 *
 * Two real failures were found by measuring while this page was written, and both
 * were the asymmetric kind:
 *
 * | pair | light | dark |
 * |---|---|---|
 * | `text-accent-red` on `bg-surface-card` (the inline error, first draft) | 4.83:1 | **4.43:1** |
 * | `text-fg-tertiary` on `bg-surface-card` (question numbering, hints) | **3.90:1** | **4.28:1** |
 *
 * Neither is visible in a snapshot, in `tsc`, in oxlint or in
 * `styles/utilityExistence.test.ts` — every one of those classes compiles perfectly.
 * The error now uses the soft-fill/primary-ink treatment `alertVariants` already
 * uses, and the tertiary ink is gone from this feature entirely.
 *
 * ## What it checks
 *
 * The pairs below are the *claim*; the sweep at the bottom is what stops the claim
 * going stale. If a class from `LOW_CONTRAST_INKS` reappears anywhere under
 * `features/surveys/`, this fails — so the fix cannot be quietly undone by a later
 * edit that reaches for the obvious utility again.
 *
 * Values come from `styles/tokens.css` rather than a hardcoded list, for the reason
 * `seqInkContrast.test.ts` gives: a guard that restates the values it guards can
 * agree with itself while both are wrong.
 */

const TOKENS = join(process.cwd(), 'src', 'styles', 'tokens.css')
const FEATURE = join(process.cwd(), 'src', 'features', 'surveys')
const DARK_SELECTOR = ":root[data-admin-theme='dark']"

/**
 * Two files outside `features/surveys/` that render this same page.
 *
 * `components/layout/RespondShell.tsx` is the frame all four respond routes now
 * share — the eyebrow, the reading labels and the reading sub-lines are its ink,
 * not the feature's. The microclimate files are the other two respond routes, built
 * from the same tiles and answered by the same people. A ban that stops at a
 * directory boundary is a ban the next edit walks around, and the blind spot this
 * file exists for does not care which folder the class is in.
 *
 * `components/MicroclimatePulseForm.tsx` is on this list because #130 moved the
 * questions there out of `pages/MicroclimateRespondPage.tsx`, which now holds a shell
 * and nothing else. Sweeping only the page would still pass — vacuously, over a file
 * with no classes left in it — while every drawn string on that route went unchecked.
 * `pages/MicroclimateInvitationPage.tsx` is the landing card in front of them.
 */
const ALSO_SWEPT = [
  join(process.cwd(), 'src', 'components', 'layout', 'RespondShell.tsx'),
  join(process.cwd(), 'src', 'features', 'microclimates', 'pages', 'MicroclimateRespondPage.tsx'),
  join(process.cwd(), 'src', 'features', 'microclimates', 'pages', 'MicroclimateInvitationPage.tsx'),
  join(process.cwd(), 'src', 'features', 'microclimates', 'components', 'MicroclimatePulseForm.tsx'),
]

type Rgba = [number, number, number, number]

function declarations(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/(--admin-[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]),
  )
}

function palettes(): { light: Record<string, string>; dark: Record<string, string> } {
  const css = readFileSync(TOKENS, 'utf8')
  const cut = css.indexOf(DARK_SELECTOR)
  expect(cut, 'tokens.css no longer declares a dark palette').toBeGreaterThan(0)
  const light = declarations(css.slice(css.indexOf(':root {'), cut))
  return { light, dark: { ...light, ...declarations(css.slice(cut)) } }
}

function parseColor(value: string): Rgba {
  const hex = value.match(/^#([0-9a-fA-F]{6})$/)
  if (hex) {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16))
    return [r, g, b, 1]
  }
  const rgb = value.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/)
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])]
  }
  throw new Error(`Unparseable colour: ${value}`)
}

/** Composites a translucent fill over the opaque surface behind it. */
function flatten(fill: Rgba, surface: Rgba): Rgba {
  const [, , , alpha] = fill
  return [
    ...([0, 1, 2] as const).map((i) => Math.round(fill[i] * alpha + surface[i] * (1 - alpha))),
    1,
  ] as Rgba
}

function relativeLuminance([r, g, b]: Rgba): number {
  const channel = (value: number): number => {
    const scaled = value / 255
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrastRatio(a: Rgba, b: Rgba): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * WCAG AA 1.4.3. Every string on this page is `text-sm` (12px) or `text-base`
 * (13px), so the small-text threshold is the right one throughout — there is no
 * large-text exemption to reach for.
 */
const AA_SMALL_TEXT = 4.5

/**
 * @param base the opaque surface a translucent fill composites over. The question
 * card sits on the panel; the public route's own chrome sits on the outer surface.
 */
interface Pair {
  what: string
  ink: string
  fill: string
  base: string
}

const PAIRS: readonly Pair[] = [
  // The question card and everything written on it.
  { what: 'question text', ink: '--admin-font-primary', fill: '--admin-bg-card', base: '--admin-bg-panel' },
  { what: 'question numbering and the required marker', ink: '--admin-font-secondary', fill: '--admin-bg-card', base: '--admin-bg-panel' },
  { what: 'choice labels', ink: '--admin-font-primary', fill: '--admin-bg-card', base: '--admin-bg-panel' },
  { what: 'scale end labels', ink: '--admin-font-secondary', fill: '--admin-bg-card', base: '--admin-bg-panel' },
  // The inline "this question needs an answer" message.
  { what: 'the unanswered-question error', ink: '--admin-font-primary', fill: '--admin-accent-bg-red', base: '--admin-bg-card' },
  // Ranking rows, which sit on the input surface inside the card.
  { what: 'ranking option labels', ink: '--admin-font-primary', fill: '--admin-bg-input', base: '--admin-bg-card' },
  { what: 'ranking positions', ink: '--admin-font-secondary', fill: '--admin-bg-input', base: '--admin-bg-card' },
  { what: 'the comment hint', ink: '--admin-font-secondary', fill: '--admin-bg-card', base: '--admin-bg-panel' },
  // The page around the questions, on both routes.
  { what: 'the survey title', ink: '--admin-font-primary', fill: '--admin-bg-panel', base: '--admin-bg-outer' },
  { what: 'the closing date and progress count', ink: '--admin-font-secondary', fill: '--admin-bg-panel', base: '--admin-bg-outer' },
  { what: "the public route's product name", ink: '--admin-font-secondary', fill: '--admin-bg-panel', base: '--admin-bg-outer' },
  // The notices: anonymity, content language, time limit, thank you.
  { what: 'an alert title', ink: '--admin-font-primary', fill: '--admin-accent-bg-green', base: '--admin-bg-panel' },
  { what: 'an alert body', ink: '--admin-font-secondary', fill: '--admin-accent-bg-green', base: '--admin-bg-panel' },
  { what: 'a warning alert body', ink: '--admin-font-secondary', fill: '--admin-accent-bg-amber', base: '--admin-bg-panel' },
  { what: 'an info alert body', ink: '--admin-font-secondary', fill: '--admin-accent-bg-blue', base: '--admin-bg-panel' },
  { what: 'a destructive alert body', ink: '--admin-font-secondary', fill: '--admin-accent-bg-red', base: '--admin-bg-panel' },
  // The instrument panel the redesign added: reading tiles on the recessed
  // surface, and the mono index chip on the same surface inside a question card.
  { what: 'a reading label and its sub-line', ink: '--admin-font-secondary', fill: '--admin-bg-icon-box', base: '--admin-bg-panel' },
  { what: 'a reading value', ink: '--admin-font-primary', fill: '--admin-bg-icon-box', base: '--admin-bg-panel' },
  { what: 'the question index chip', ink: '--admin-font-secondary', fill: '--admin-bg-icon-box', base: '--admin-bg-card' },
  // The anonymity state chip. Secondary ink on the soft fill, not the accent --
  // see REJECTED_INK_ON_SOFT below for the measurement that decided it.
  { what: 'the anonymous chip word', ink: '--admin-font-secondary', fill: '--admin-accent-bg-green', base: '--admin-bg-panel' },
  { what: 'the not-anonymous chip word', ink: '--admin-font-secondary', fill: '--admin-accent-bg-blue', base: '--admin-bg-panel' },
]

/**
 * The obvious ink for a green chip on a green fill, measured and rejected.
 *
 * The first draft of the anonymity chip set the word in `text-accent-green`
 * (`text-accent-blue` for the identified case), which is what any reader would
 * reach for and what every other soft-filled pill in this app looks like it does.
 * `alertVariants` does not: it puts `text-fg-primary` on the fill and reserves the
 * accent for the `[&>svg]`. This asserts WHY, so nobody re-derives it from taste.
 *
 * These are asserted to FAIL, deliberately. If a palette change ever lifts them
 * over AA the test goes red and the ban above can be revisited, which is the
 * opposite of the usual stale-comment failure mode.
 */
const REJECTED_INK_ON_SOFT: readonly Pair[] = [
  { what: 'accent green on the soft green fill', ink: '--admin-accent-green', fill: '--admin-accent-bg-green', base: '--admin-bg-panel' },
  { what: 'accent blue on the soft blue fill', ink: '--admin-accent-blue', fill: '--admin-accent-bg-blue', base: '--admin-bg-panel' },
]

describe('the respond page reads in both themes', () => {
  const { light, dark } = palettes()
  const themes = [
    ['light', light],
    ['dark', dark],
  ] as const

  it.each(
    PAIRS.flatMap((pair) => themes.map(([theme, palette]) => [pair.what, theme, palette, pair] as const)),
  )('%s clears AA in %s', (_what, _theme, palette, pair) => {
    const surface = flatten(parseColor(palette[pair.fill]), parseColor(palette[pair.base]))
    expect(contrastRatio(parseColor(palette[pair.ink]), surface)).toBeGreaterThanOrEqual(
      AA_SMALL_TEXT,
    )
  })

  it.each(REJECTED_INK_ON_SOFT.map((pair) => [pair.what, pair] as const))(
    '%s is under AA in light, which is why the chip word is not inked with it',
    (_what, pair) => {
      const surface = flatten(parseColor(light[pair.fill]), parseColor(light[pair.base]))
      expect(contrastRatio(parseColor(light[pair.ink]), surface)).toBeLessThan(AA_SMALL_TEXT)
    },
  )

  /**
   * The two utilities measured to fail above. Banned from this feature by name so a
   * later edit reaching for the obvious class fails here rather than in production —
   * neither one is detectable by `utilityExistence`, because both compile perfectly.
   */
  const LOW_CONTRAST_INKS = ['text-fg-tertiary', 'text-accent-red']

  it.each(LOW_CONTRAST_INKS)('never writes %s, which fails AA on this page', (utility) => {
    const swept = [
      ...globSync('**/*.tsx', { cwd: FEATURE })
        .filter((file) => !/\.test\.tsx$/.test(file))
        .map((file) => join(FEATURE, file)),
      ...ALSO_SWEPT,
    ]
    // Guard the guard: an empty sweep passes vacuously, and the two files added by
    // path would go unnoticed if either were renamed.
    expect(swept.length).toBeGreaterThan(10)

    const offenders = swept
      .filter((file) => {
        const source = readFileSync(file, 'utf8')
        // Only className positions, not the prose explaining why the class is absent.
        return new RegExp(`className=(?:"|\\{)[^\`]*?\\b${utility}\\b`, 's').test(source)
      })
      .map((file) => file.replace(`${process.cwd()}/`, ''))

    expect(offenders).toEqual([])
  })
})
