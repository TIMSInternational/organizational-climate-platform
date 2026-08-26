import { describe, expect, it } from 'vitest'
import axe from 'axe-core'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  A11Y_TARGET,
  AA_NON_TEXT_CONTRAST,
  AA_TEXT_CONTRAST,
  AXE_RULES_MEASURED_ELSEWHERE,
  RADIX_FOCUS_TRAP_NODES,
  axeViolations,
} from './a11y'

/**
 * The target is recorded in two places, and this is what stops them drifting (#83).
 *
 * #83's first acceptance criterion is "target level recorded". The level lives in
 * `test/a11y.ts` because the harness has to read it; it also lives in
 * `docs/accessibility.md`, because that is where a person looks. A document that
 * says AA over a harness configured for A is worse than no document — it is a
 * claim nobody can act on and nobody can falsify. So the document is read here and
 * required to quote what the code actually runs.
 *
 * The disabled-rule list is pinned for the same reason. A rule can be silenced
 * only by editing `AXE_RULES_MEASURED_ELSEWHERE`, which fails this file, which
 * forces the reason into the diff a reviewer sees.
 */

const DOC = join(process.cwd(), 'docs', 'accessibility.md')

function doc(): string {
  return readFileSync(DOC, 'utf8')
}

describe('the accessibility target', () => {
  it('is WCAG 2.1 AA in the harness', () => {
    expect(A11Y_TARGET.standard).toBe('WCAG 2.1')
    expect(A11Y_TARGET.level).toBe('AA')
    // The 2.0 families are load-bearing, not decoration: `image-alt`, `label` and
    // `button-name` are all tagged wcag2a only, so a scope of just the 2.1 tags
    // would run the sweep with the three rules that matter most switched off.
    expect([...A11Y_TARGET.tags].sort()).toEqual(['wcag21a', 'wcag21aa', 'wcag2a', 'wcag2aa'])
  })

  it('is the same target the documentation states', () => {
    const text = doc()
    expect(text).toMatch(/\*\*WCAG 2\.1, level AA\.\*\*/)
    for (const tag of A11Y_TARGET.tags) {
      expect(text, `docs/accessibility.md does not mention the ${tag} scope`).toContain(tag)
    }
    // And it must not quietly claim more than the harness enforces.
    expect(text).toMatch(/\*\*AAA is deliberately not claimed\.\*\*/)
  })

  it('states the thresholds the contrast suites use', () => {
    expect(AA_TEXT_CONTRAST).toBe(4.5)
    expect(AA_NON_TEXT_CONTRAST).toBe(3)
    expect(doc()).toContain(`${AA_TEXT_CONTRAST}:1`)
    expect(doc()).toContain(`${AA_NON_TEXT_CONTRAST}:1`)
  })

  it('turns off exactly one rule, and says where that guarantee lives instead', () => {
    expect([...AXE_RULES_MEASURED_ELSEWHERE]).toEqual(['color-contrast'])
    for (const rule of AXE_RULES_MEASURED_ELSEWHERE) {
      expect(doc(), `docs/accessibility.md does not account for the disabled ${rule} rule`).toContain(
        rule,
      )
    }
    expect(doc()).toContain('src/styles/inkContrast.test.ts')
  })

  it('excludes exactly the two Radix focus-trap nodes, and says why', () => {
    expect([...RADIX_FOCUS_TRAP_NODES]).toEqual(['[data-radix-focus-guard]', '[data-aria-hidden]'])
    for (const selector of RADIX_FOCUS_TRAP_NODES) {
      expect(doc(), `docs/accessibility.md does not account for excluding ${selector}`).toContain(
        selector,
      )
    }
    // The exclusion is sound only because the trap is tested. Name the file, so a
    // reader following the argument can check it rather than take it on trust.
    expect(doc()).toContain('focusTrap.test.tsx')
  })
})

describe('the harness itself', () => {
  it('finds violations, and only inside what it was given', async () => {
    // Two claims in one specimen, because they fail in opposite directions. A
    // harness that scanned the whole document would report the sibling's missing
    // alt text against the container it was handed — which, in a suite of ~90
    // table-driven specimens sharing one `document.body`, would make every failure
    // message name the wrong specimen.
    const target = document.createElement('div')
    target.innerHTML = '<button type="button"></button>'
    const sibling = document.createElement('div')
    sibling.innerHTML = '<img src="/otro.png">'
    document.body.append(target, sibling)

    const ids = (await axeViolations(target)).map((violation) => violation.id)
    expect(ids).toContain('button-name')
    expect(ids).not.toContain('image-alt')

    target.remove()
    sibling.remove()
  })

  /**
   * The harness hands back everything axe found, at every impact.
   *
   * Every vacuity control in this baseline is built from `button-name`,
   * `image-alt` and `label` — and all three are `critical`. So a harness that
   * returned only critical violations would keep every one of those controls
   * green while going blind to every `serious` and `moderate` failure in the
   * whole sweep: `link-name` is serious, and a link with no accessible name in
   * the collapsed rail is precisely the failure #83 names in its scope.
   *
   * Rather than assert a list of impacts, this runs axe directly over the same
   * node with the same target and requires the harness to return *the same
   * findings*. That is the property — the harness may configure axe, it may not
   * quietly drop what axe reports — and it holds against a filter on impact, on
   * rule id, or on anything else somebody thinks of later.
   */
  it('hands back every violation axe found, at every impact', async () => {
    const node = document.createElement('div')
    // Two critical failures and two serious ones, so the comparison below is not
    // vacuous in either direction.
    node.innerHTML =
      '<button type="button"></button>' +
      '<img src="/logo.png">' +
      '<a href="/empresas"></a>' +
      '<ul><div>Elemento suelto</div></ul>'
    document.body.append(node)

    const fromHarness = (await axeViolations(node)).map((v) => `${v.impact} ${v.id}`).sort()
    const direct = await axe.run(
      { include: [node] },
      {
        runOnly: { type: 'tag', values: [...A11Y_TARGET.tags] },
        // The one rule the harness disables, disabled here too — otherwise this
        // would be measuring that exclusion rather than the filtering.
        rules: Object.fromEntries(
          AXE_RULES_MEASURED_ELSEWHERE.map((id) => [id, { enabled: false } as const]),
        ),
        resultTypes: ['violations'],
      },
    )

    expect(fromHarness).toEqual(direct.violations.map((v) => `${v.impact} ${v.id}`).sort())
    // …and the specimen really does carry both tiers, or "the same findings"
    // would be a comparison of two identical short lists of critical rules.
    expect(fromHarness.filter((found) => found.startsWith('critical')).length).toBeGreaterThan(0)
    expect(fromHarness.filter((found) => found.startsWith('serious')).length).toBeGreaterThan(0)
    expect(fromHarness.map((found) => found.split(' ')[1])).toContain('link-name')

    node.remove()
  })

  it('finds nothing in markup that is correct — the false-positive control', async () => {
    const clean = document.createElement('div')
    clean.innerHTML =
      '<label for="nombre">Nombre completo</label><input id="nombre" type="text">' +
      '<button type="button">Guardar</button><img src="/logo.png" alt="Climate">'
    document.body.append(clean)

    expect(await axeViolations(clean)).toEqual([])
    clean.remove()
  })
})
