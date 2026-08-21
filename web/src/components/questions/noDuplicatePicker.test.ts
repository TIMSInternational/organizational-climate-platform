import { describe, it, expect } from 'vitest'
import { readFileSync, globSync } from 'node:fs'
import { join } from 'node:path'

/**
 * #115's fifth acceptance criterion: **no duplicate picker implementation exists.**
 *
 * It is the only criterion on that issue that cannot be satisfied once and stay
 * satisfied. The library picker is needed by two epics — the survey builder (#58)
 * and the microclimate builder (#127) — and the issue says why it is its own story:
 * "shared components between two epics are exactly what gets duplicated when each
 * epic builds in isolation". A test is the only thing that still holds in six months.
 *
 * Two halves, because either alone is easy to defeat:
 *
 * 1. Exactly ONE module in `src/` may render a library picker.
 * 2. BOTH wizards must reach it, and reach it through the shared barrel rather than
 *    by deep-importing across a feature boundary — the deep import is the sentence
 *    that precedes someone copying the file.
 */

const SRC = join(process.cwd(), 'src')

function sourceFiles(): string[] {
  return globSync('**/*.{ts,tsx}', { cwd: SRC }).filter((file) => !/\.test\.tsx?$/.test(file))
}

function read(file: string): string {
  return readFileSync(join(SRC, file), 'utf8')
}

describe('the shared question picker', () => {
  it('is implemented exactly once', () => {
    const implementations = sourceFiles().filter((file) =>
      /(export\s+default\s+function|export\s+function)\s+QuestionLibraryBrowser\b/.test(read(file)),
    )

    expect(
      implementations,
      'The question picker must exist once, in components/questions/. A second ' +
        'implementation is #115’s fifth acceptance criterion failing.',
    ).toEqual(['components/questions/QuestionLibraryBrowser.tsx'])
  })

  it('is opened by BOTH wizards, through the shared barrel', () => {
    const wizards = [
      'features/surveys/pages/SurveyCreatePage.tsx',
      'features/microclimates/pages/MicroclimateCreatePage.tsx',
    ]

    for (const wizard of wizards) {
      const source = read(wizard)
      expect(source, `${wizard} does not import the shared picker`).toMatch(
        /import \{ QuestionLibraryBrowser \} from '(\.\.\/)+components\/questions'/,
      )
      expect(source, `${wizard} does not render the shared picker`).toContain(
        '<QuestionLibraryBrowser',
      )
    }
  })

  it('is never deep-imported past its barrel from a feature folder', () => {
    const offenders = sourceFiles()
      .filter((file) => file.startsWith('features/'))
      .filter((file) => /components\/questions\/QuestionLibraryBrowser/.test(read(file)))

    expect(
      offenders,
      'Import { QuestionLibraryBrowser } from components/questions instead: the ' +
        'barrel is what keeps the module path free to move.',
    ).toEqual([])
  })
})
