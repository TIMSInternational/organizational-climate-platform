import axe, { type AxeResults, type Result } from 'axe-core'
import { expect } from 'vitest'

/**
 * The accessibility target this product is built to, and the axe harness that
 * enforces it (#83).
 *
 * ## Why the target is a value and not only prose
 *
 * #83's first acceptance criterion is "target level recorded". A target recorded
 * only in a document is a target nothing can fail against — the earlier UI review
 * parked its accessibility findings as "minors" and they were never fixed, which
 * is precisely what this file exists to make impossible. So the level lives here,
 * `docs/accessibility.md` quotes it, and `a11y.test.ts` fails if the two ever
 * disagree.
 *
 * ## Where it lives
 *
 * `src/test/`, beside `seqInkContrast.ts`, because nothing under `src/` imports
 * it: it is test infrastructure, not a module the bundle carries. `tsconfig.app`
 * still typechecks it, so a broken harness fails `npm run typecheck` rather than
 * failing quietly at test time.
 */

/**
 * ## The target
 *
 * **WCAG 2.1 level AA.** The customer is PROCOMER, a Costa Rican public
 * institution, and AA is the level public-sector procurement asks for. It is also
 * what the client's §7 describes in substance: staff with 30+ years' tenure and
 * low digital literacy, reading reports that get printed in greyscale, for whom
 * the semáforo is the primary signal — so 1.4.1 (Use of Colour), 1.4.3 (Contrast),
 * 2.1.1 (Keyboard) and 2.4.7 (Focus Visible) are the load-bearing criteria rather
 * than an abstract checklist.
 *
 * AAA is deliberately **not** claimed. Its 7:1 contrast floor would forbid the
 * 13px shell this product's density depends on, and a level claimed and not met is
 * worse than a level met.
 *
 * The four tag families are axe-core's spelling of exactly that scope. The 2.0 A
 * and AA tags are included because WCAG 2.1 subsumes 2.0 — dropping either would
 * leave `image-alt`, `label` and `button-name` unchecked while this file still
 * said "2.1 AA".
 */
export const A11Y_TARGET = {
  standard: 'WCAG 2.1',
  level: 'AA',
  tags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
} as const

/**
 * WCAG 1.4.3 for text below 18.66px (or 14pt bold) — which is every string in this
 * product. The shell body size is 13px and a chip's is 11px.
 */
export const AA_TEXT_CONTRAST = 4.5

/**
 * WCAG 1.4.11 (Non-text Contrast): focus indicators, control boundaries, and the
 * parts of a graphic a reader needs to tell one state from another.
 */
export const AA_NON_TEXT_CONTRAST = 3

/**
 * axe rules this harness turns off, with the reason and where the guarantee is
 * kept instead. **Pinned by `a11y.test.ts`** — a rule cannot be silenced by
 * editing the harness in passing, only by editing this list, which is a diff a
 * reviewer sees.
 *
 * Exactly one entry, and it is not an exemption:
 *
 * - `color-contrast` — axe measures it by compositing computed styles, and the
 *   Vitest environment is happy-dom (`vite.config.ts`), which has no layout or
 *   cascade engine. axe itself reports the rule *incomplete* rather than passing
 *   there, so leaving it on would buy nothing while implying it had been checked.
 *   Contrast is measured instead by reading `styles/tokens.css` directly:
 *   `styles/inkContrast.test.ts` covers the base ink × surface matrix and the
 *   focus ring, and the per-family suites that already existed cover the rest
 *   (`accentContrast`, `accentInkContrast`, `badgeVariantContrast`,
 *   `chipVariantContrast`, `divInkContrast`, `seqInkContrast`, `shellInkContrast`).
 */
export const AXE_RULES_MEASURED_ELSEWHERE = ['color-contrast'] as const

/**
 * The two nodes a Radix focus trap owns, excluded from the scan **by selector**
 * rather than by turning a rule off — so `aria-hidden-focus` still runs on every
 * other element on the page, including anything the product itself marks hidden.
 *
 * Both are flagged by `aria-hidden-focus`, and in both cases what axe is looking
 * at is the mechanism, not a defect:
 *
 * - `[data-radix-focus-guard]` — the zero-opacity, `pointer-events: none`
 *   sentinels Radix puts either side of a portalled overlay. They carry
 *   `tabindex="0"` *because* their job is to catch a Tab that reaches the end of
 *   the dialog and send focus back to the start of it. A guard with
 *   `tabindex="-1"` — axe's suggested repair — would not catch anything, and the
 *   trap would leak.
 * - `[data-aria-hidden]` — the rest of the application, which Radix marks
 *   `aria-hidden` while a modal is open. That is the required behaviour (the
 *   background must leave the accessibility tree), and the focusable content axe
 *   objects to is unreachable because the guards above trap focus. There is no
 *   spelling of a modal that satisfies both halves of this rule at once.
 *
 * An exclusion is only as good as the behaviour it assumes, so the assumption is
 * tested rather than asserted: `components/ui/focusTrap.test.tsx` drives Tab and
 * Shift+Tab around an open dialog and fails if focus ever lands outside it. If
 * Radix ever stops trapping, that file goes red — and this exclusion stops being
 * a claim nobody checked.
 */
export const RADIX_FOCUS_TRAP_NODES = ['[data-radix-focus-guard]', '[data-aria-hidden]'] as const

function disabledRules(): Record<string, { enabled: false }> {
  return Object.fromEntries(
    AXE_RULES_MEASURED_ELSEWHERE.map((id) => [id, { enabled: false } as const]),
  )
}

/**
 * Run axe over `container` at the target level and hand back what it found.
 *
 * `resultTypes: ['violations']` stops axe from building the `passes`/`incomplete`
 * node lists, which is most of its cost — with ~90 specimens in the primitive
 * sweep that is the difference between the suite staying inside its two minutes
 * and not.
 *
 * The container is attached to `document.body` if it is not already: axe walks up
 * to the document for landmark and duplicate-id context, and a detached fragment
 * silently yields nothing at all. `@testing-library`'s `render` already attaches,
 * so this only matters for a caller that built a node by hand.
 */
export async function axeViolations(container: Element): Promise<Result[]> {
  if (!container.isConnected) document.body.appendChild(container)
  const results: AxeResults = await axe.run(
    { include: [container], exclude: RADIX_FOCUS_TRAP_NODES.map((selector) => [selector]) },
    {
      runOnly: { type: 'tag', values: [...A11Y_TARGET.tags] },
      rules: disabledRules(),
      resultTypes: ['violations'],
    },
  )
  return results.violations
}

/** A violation as one readable block: which rule, why, and the offending markup. */
function describeViolation(violation: Result): string {
  const nodes = violation.nodes
    .map((node) => `      ${node.html}\n        ${node.failureSummary?.replace(/\n/g, '\n        ')}`)
    .join('\n')
  return `  [${violation.impact}] ${violation.id}: ${violation.help}\n${nodes}`
}

/**
 * Assert that `container` has no WCAG 2.1 AA violation.
 *
 * The message is built from axe's own `failureSummary` rather than from a bare
 * count, because "expected 1 to be 0" on a rule id is not something the next
 * person can act on at 3am.
 *
 * `label` names the specimen; with a table-driven sweep the assertion otherwise
 * reports only the rule, and the first question is always *which one*.
 */
export async function expectNoAxeViolations(container: Element, label: string): Promise<void> {
  const violations = await axeViolations(container)
  expect(
    violations.map((v) => v.id),
    violations.length === 0
      ? ''
      : `${label} has ${violations.length} WCAG ${A11Y_TARGET.level} violation(s):\n${violations
          .map(describeViolation)
          .join('\n')}`,
  ).toEqual([])
}
