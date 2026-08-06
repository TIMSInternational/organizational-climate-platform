import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { readFileSync, globSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { compile } from 'tailwindcss'

/**
 * The table-overflow guard (#218).
 *
 * ## The defect it exists to stop coming back
 *
 * The base layer in `index.css` mirrors `ui/table.tsx` cell for cell, and for a
 * while that mirror included two rules it could not safely carry:
 * `table { width: 100% }` and `th { white-space: nowrap }`. In the component
 * those two sit *inside* `<div data-slot="table-container" class="overflow-x-auto">`,
 * so a table that outgrows its parent has somewhere to go. As element rules they
 * arrive without the container: the table is told to fill its parent and
 * forbidden to shrink, so it renders outside it.
 *
 * It shipped twice. #79's `HeatMap` was stretched until its coloured cells were
 * stranded against the right edge; #80 measured tables up to **150px outside the
 * content panel** at 320/390px on Users, Companies, Action Plans and Demographic
 * fields. Each was patched at the call site, which is why it happened a second
 * time.
 *
 * ## Why the assertions look the way they do
 *
 * `happy-dom` does no layout, so nothing here can measure an overflow — that part
 * is browser-only and is recorded as such in `src/styles/README.md`. What *is*
 * observable is the cascade: happy-dom resolves selectors and computes styles.
 * So this compiles **the real `src/index.css` through the real Tailwind
 * compiler** (the standard `utilityExistence.test.ts` sets), puts the output in
 * the document, and asks the DOM what a `<th>` actually computes to. That is a
 * step up from matching strings in the stylesheet source: a rule that stops
 * surviving the build, or that a later rule overrides, fails here and would not
 * fail a regex.
 *
 * The one transformation applied to the compiled CSS is flattening `@layer`
 * blocks, because happy-dom's parser drops layered rules entirely (probed: a
 * `th` rule inside `@layer base` computes to `""`). Flattening preserves the
 * outcome for what is asserted below — the compiler emits layers in cascade
 * order and nothing here is declared twice across two layers, so source order
 * gives the same winner. `computes the cell styling the design system documents`
 * is the canary: if flattening ever stopped reproducing the cascade, those
 * values would drift first.
 */

const WEB = process.cwd()
const SRC = join(WEB, 'src')
const NODE_MODULES = join(WEB, 'node_modules')
const ENTRY = join(SRC, 'index.css')

/** Resolves an `@import` the way Vite does. Same helper as `utilityExistence.test.ts`. */
async function loadStylesheet(id: string, basedir: string) {
  const candidates =
    id.startsWith('.') || id.startsWith('/')
      ? [resolve(basedir, id)]
      : [
          join(NODE_MODULES, id),
          join(NODE_MODULES, `${id}.css`),
          join(NODE_MODULES, id, 'index.css'),
        ]

  for (const path of candidates) {
    try {
      return { path, base: dirname(path), content: await readFile(path, 'utf8') }
    } catch {
      // Try the next candidate; a genuinely missing import throws below.
    }
  }
  throw new Error(`cannot resolve stylesheet "${id}" imported from ${basedir}`)
}

/** Unwraps `@layer name { ... }` in place, leaving the rules in source order. */
export function flattenLayers(css: string): string {
  let out = ''
  let index = 0

  for (;;) {
    const opener = /@layer\s+[^;{]*\{/g
    opener.lastIndex = index
    const hit = opener.exec(css)
    if (!hit) {
      out += css.slice(index)
      break
    }

    out += css.slice(index, hit.index)

    let depth = 1
    let cursor = opener.lastIndex
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === '{') depth++
      else if (css[cursor] === '}') depth--
      cursor++
    }
    out += css.slice(opener.lastIndex, cursor - 1)
    index = cursor
  }

  // `@layer theme, base, components, utilities;` — the ordering statement.
  return out.replace(/@layer[^;{]*;/g, '')
}

let stylesheet: string

/** Puts a stylesheet and some markup in the document, then computes styles. */
function renderWith(css: string, html: string) {
  document.head.innerHTML = `<style>${css}</style>`
  document.body.innerHTML = html
  return (id: string) => getComputedStyle(document.getElementById(id)!)
}

/** The common case: the real compiled `index.css`. */
function render(html: string) {
  return renderWith(stylesheet, html)
}

describe('table overflow', () => {
  beforeAll(async () => {
    const entry = await readFile(ENTRY, 'utf8')
    const compiled = await compile(entry, {
      base: SRC,
      loadStylesheet,
      async loadModule() {
        throw new Error('index.css is not expected to load a JS plugin')
      },
    })
    // The candidates `ui/table.tsx` writes, so the utilities it depends on are in
    // the output. `@source` scanning does not run through this API.
    stylesheet = flattenLayers(
      compiled.build(['w-full', 'w-auto', 'overflow-x-auto', 'whitespace-nowrap', 'border-collapse']),
    )
  }, 60_000)

  it('loads the real stylesheet', () => {
    // Guard the guard: an empty or unparsed stylesheet computes "" for everything,
    // which would make every assertion below pass for the wrong reason.
    expect(stylesheet.length).toBeGreaterThan(1000)
    const computed = render('<p id="p">x</p>')
    expect(computed('p').lineHeight, 'index.css sets p line-height from a token').toBeTruthy()
  })

  it('computes the cell styling the design system documents', () => {
    // The half of the mirror that stays in the element layer, and the canary for
    // the layer-flattening above. See src/styles/README.md's provenance table.
    const computed = render(
      '<table><thead><tr><th id="th">H</th></tr></thead><tbody><tr><td id="td">v</td></tr></tbody></table>',
    )
    expect(computed('th').fontSize).toBe('12px')
    expect(computed('th').padding).toBe('8px 12px')
    expect(computed('td').padding).toBe('10px 12px')
  })

  it('does not force a bare table to fill its container', () => {
    // `width: 100%` with nothing to scroll is half of the defect. A bare table
    // sizes to its content instead.
    const computed = render('<table id="t"><tbody><tr><td>v</td></tr></tbody></table>')
    expect(computed('t').width).not.toBe('100%')
  })

  it('does not force a bare th to refuse to wrap', () => {
    // The other half: nowrap makes min-content unbounded, so the table cannot
    // shrink into its parent no matter how narrow the viewport gets.
    const computed = render(
      '<table><thead><tr><th id="th">A long header</th></tr></thead></table>',
    )
    expect(computed('th').whiteSpace).not.toBe('nowrap')
  })

  it('lets an unbreakable run in a cell break rather than widen the table', () => {
    const computed = render(
      '<table><tbody><tr><td id="td">someone.with.a.long.address@example.com</td></tr></tbody></table>',
    )
    expect(computed('td').overflowWrap).toBe('break-word')
  })

  it('detects the rules it was written to reject', () => {
    // The companion the assertions above need: they are all `not.toBe`, so they
    // would also pass against a stylesheet that computes nothing at all. Feed the
    // pre-#218 rules to the same harness and it must see them.
    const computed = renderWith(
      'table { width: 100%; } th { white-space: nowrap; }',
      '<table id="t"><thead><tr><th id="th">H</th></tr></thead></table>',
    )
    expect(computed('t').width).toBe('100%')
    expect(computed('th').whiteSpace).toBe('nowrap')
  })

  it('keeps width and nowrap next to a scroll container in the primitive', () => {
    // The rules did not vanish; they moved to where they are safe. This is the
    // shape `ui/table.tsx` renders — asserted through the compiler, so a class
    // that stopped compiling (the failure `utilityExistence` exists for) is
    // caught here as a missing declaration rather than a passing string match.
    const computed = render(
      '<div id="c" class="w-full overflow-x-auto">' +
        '<table id="t" class="w-full border-collapse">' +
        '<thead><tr><th id="th" class="whitespace-nowrap">H</th></tr></thead>' +
        '</table></div>',
    )
    expect(computed('c').overflowX).toBe('auto')
    expect(computed('t').width).toBe('100%')
    expect(computed('th').whiteSpace).toBe('nowrap')
  })
})

/**
 * Every table in the app goes through `ui/table.tsx`.
 *
 * This is the part that makes the fix hold. Moving `w-full` into the primitive
 * only helps tables that use the primitive, and the element layer still styles a
 * bare `<table>` well enough that writing one looks correct — which is exactly
 * how #79 and #80 each arrived at their own local `overflow-x-auto`. A sweep is
 * the cheapest thing that fails a review instead of a phone.
 */

/**
 * A `<table>` *element*, not the word.
 *
 * The negative lookbehind is not decoration: `charts/HeatMap.tsx` opens with
 * ``## Rendered as a real `<table>` `` in its doc block, and prose about tables is
 * exactly what a file that renders one tends to contain. Requiring the tag not to
 * follow a backtick keeps the sweep pointed at JSX.
 */
const TABLE_ELEMENT = /(?<!`)<table[\s/>]/

const ALLOWED = [
  // The primitive itself is where the one `<table>` lives.
  join(SRC, 'components', 'ui', 'table.tsx'),
]

function sourceFiles(): string[] {
  return globSync('**/*.tsx', { cwd: SRC })
    .map((file) => join(SRC, file))
    .filter((file) => !file.endsWith('.test.tsx') && !ALLOWED.includes(file))
}

describe('table call sites', () => {
  it('sweeps the components', () => {
    // Guard the guard: an empty sweep passes the assertion below vacuously.
    expect(sourceFiles().length).toBeGreaterThanOrEqual(80)
  })

  it('renders no bare <table>', () => {
    const offenders = sourceFiles()
      .filter((file) => TABLE_ELEMENT.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file))
      .sort()

    expect(
      offenders,
      'A bare <table> has no scroll container, so a wide one renders outside the ' +
        'content panel instead of scrolling inside it (#218 — this shipped twice). ' +
        "Use `import { Table } from 'components/ui'`; plain <thead>/<tr>/<th>/<td> " +
        'children still work, the base layer styles them.',
    ).toEqual([])
  })

  it('detects a bare <table>', () => {
    // The sweep is a `toEqual([])`, so it passes if the detector never matches.
    expect(TABLE_ELEMENT.test('return <table>\n<tbody />\n</table>')).toBe(true)
    expect(TABLE_ELEMENT.test('<table className="w-auto">')).toBe(true)
    expect(TABLE_ELEMENT.test('<table />')).toBe(true)
    // And does not fire on the component, which is the whole point of the sweep.
    expect(TABLE_ELEMENT.test('<Table className="w-auto">')).toBe(false)
    // Nor on prose about tables — the exemption that HeatMap.tsx needs. Narrow on
    // purpose: only a backticked tag is skipped, so commenting out real JSX does
    // not slip past.
    expect(TABLE_ELEMENT.test(' * ## Rendered as a real `<table>`')).toBe(false)
    expect(TABLE_ELEMENT.test('// return <table><tbody /></table>')).toBe(true)
  })
})
