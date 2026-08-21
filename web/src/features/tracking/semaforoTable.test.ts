import { describe, it, expect } from 'vitest'
import { readFileSync, globSync } from 'node:fs'
import { join } from 'node:path'

/**
 * **One shape table, one percentage conversion, for the whole tracking module.**
 *
 * This file is a source sweep rather than a behaviour test, because the failure it
 * guards against is invisible to behaviour tests by construction.
 *
 * #125 and #126 were built in parallel and each grew its own copy of the semáforo
 * vocabulary: two tables of state → glyph, two parsers, two state orders, and two
 * fraction→percentage conversions. Every surviving mutation the review found lived
 * in the gap between a pair of them, and each one passed the whole suite:
 *
 * - `SemaforoSummary` kept a private icon map, so the "three distinct silhouettes"
 *   guarantee proved in `semaforo.test.ts` covered the chips in the table and NOT
 *   the strip above them. The strip could be reduced to three bare coloured dots —
 *   no word, no shape — with 2910 tests green. WCAG 1.4.1, on the first thing a
 *   reader sees, on the element that gets printed in greyscale.
 * - The progress bars took the raw 0–1 fraction while the figures beside them took
 *   the converted percentage, because there were two conversions and only one of
 *   them was reached.
 *
 * A test per component cannot catch the NEXT one of these; only the absence of a
 * second table can. So: `semaforo.ts` owns the vocabulary, `SemaforoChip.tsx` is
 * the only component that maps a shape to a glyph, and nothing else in the feature
 * multiplies or divides by 100.
 */
const FEATURE = join(process.cwd(), 'src', 'features', 'tracking')

function sourceFiles(): string[] {
  return globSync('**/*.{ts,tsx}', { cwd: FEATURE }).filter(
    (file) => !/\.test\.tsx?$/.test(file),
  )
}

function read(file: string): string {
  return readFileSync(join(FEATURE, file), 'utf8')
}

/**
 * The file with its comments removed.
 *
 * These sweeps look for CODE, and every module here explains at length why the
 * thing being swept for is forbidden — `trackingUnits.ts` says "it used to carry
 * its own `fraction * 100`" and `PlanesAccionTable.tsx` says "never `* 100`
 * written out here". Scanning the raw text flags both as offenders, which would
 * make the guard fire loudest at the prose warning against the very thing it is
 * looking for. Stripping comments first is what makes a failure here mean
 * something.
 */
function code(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

describe('the tracking module has ONE semáforo table', () => {
  it('sweeps a directory that actually has files in it', () => {
    // Guard the guard: a broken glob would make every assertion below vacuous.
    const files = sourceFiles()
    expect(files.length).toBeGreaterThan(10)
    expect(files).toContain('semaforo.ts')
  })

  /**
   * `OctagonAlert`, `TriangleAlert` and `CircleCheck` ARE the three silhouettes.
   * A second module importing them is a second presentation table by definition —
   * that is exactly the shape `SemaforoSummary` had, and it is what let the strip
   * and the chips disagree about whether a state has a shape at all.
   */
  it('imports the semáforo glyphs in exactly one component', () => {
    const importers = sourceFiles().filter((file) =>
      /import\s*\{[^}]*\b(OctagonAlert|TriangleAlert)\b[^}]*\}\s*from\s*'lucide-react'/s.test(
        code(file),
      ),
    )

    expect(
      importers,
      'Only SemaforoChip.tsx may map a semáforo state to a glyph. A second icon ' +
        'map means the shape guarantee in semaforo.test.ts stops covering this ' +
        'component — render a <SemaforoChip> instead.',
    ).toEqual(['components/SemaforoChip.tsx'])
  })

  /**
   * The conversion. `toPercent` and `fromPercent` in `semaforo.ts` are the only
   * places a fraction becomes a percentage or the reverse; `trackingUnits.ts`
   * delegates to `toPercent` rather than scaling again.
   */
  it('scales between fractions and percentages in exactly one module', () => {
    const scalers = sourceFiles().filter((file) => /[*/]\s*100\b|\b100\s*\*/.test(code(file)))

    expect(
      scalers,
      'porcentajeAvance is a FRACTION on the wire and a PERCENTAGE on screen. ' +
        'Call toPercent/fromPercent from semaforo.ts — a second conversion is how ' +
        'a progress bar comes to be fed 0.15 while the figure beside it reads 15%.',
    ).toEqual(['semaforo.ts'])
  })

  /**
   * The state list. `SEMAFORO_ORDER` is worst-first and load-bearing: the counts
   * row and the consolidado columns both read left-to-right as "how much trouble
   * am I in". A second array literal of the three states can silently reorder or
   * drop one.
   */
  it('spells the three state names in exactly one module', () => {
    const spellers = sourceFiles().filter((file) =>
      /'Rojo'[\s\S]{0,80}'Amarillo'[\s\S]{0,80}'Verde'/.test(code(file)),
    )

    expect(
      spellers,
      'Import SEMAFORO_ORDER (and toSemaforoEstado) from semaforo.ts rather than ' +
        'writing the three wire values out again.',
    ).toEqual(['semaforo.ts'])
  })

  it('keeps the presentation record private to semaforo.ts', () => {
    // `semaforoPresentation()` is the accessor; exporting the bare record invites
    // a caller to index it and then to keep their own copy of a field from it.
    expect(read('semaforo.ts')).not.toMatch(/^export const PRESENTATION/m)
    expect(read('semaforo.ts')).toMatch(/export function semaforoPresentation/)
  })
})
