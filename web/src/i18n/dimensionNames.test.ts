import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import en from './en.json'
import es from './es.json'

/**
 * The server's dimension catalogue must say what these catalogues say.
 *
 * A question's category is authored free text, so the server has no name to print and used
 * to print the key: the PDF a customer opens said `workload` where every screen says Carga
 * de trabajo. `DimensionNames.cs` fixes that by carrying a copy of this block — and a copy
 * is exactly the thing this repository has already been bitten by. `EmailBranding.ProductName`
 * carried a doc comment asserting it matched `noHardcodedStrings.test.ts`, and it did not,
 * for as long as both existed, because the two live in different languages and different
 * test suites and nothing compared them.
 *
 * So they are compared. This reads the C# and fails in BOTH directions: a key added to the
 * catalogues and not to the server, a key the server invented, or a name that differs.
 */
const CS = join(
  process.cwd(),
  '..',
  'src',
  'ClimateProject.Application',
  'Reports',
  'Rendering',
  'DimensionNames.cs',
)

/** The `["key"] = "value",` entries of one named dictionary in that file. */
function csharpMap(source: string, field: 'English' | 'Spanish'): Record<string, string> {
  const start = source.indexOf(`> ${field} = new Dictionary`)
  expect(start, `no ${field} dictionary in DimensionNames.cs`).toBeGreaterThan(-1)
  const body = source.slice(start, source.indexOf('};', start))
  const out: Record<string, string> = {}
  for (const match of body.matchAll(/\["([^"]+)"\]\s*=\s*"([^"]*)"/g)) {
    out[match[1]!] = match[2]!
  }
  return out
}

describe('the server dimension catalogue', () => {
  const source = readFileSync(CS, 'utf8')

  it.each([
    ['English', en.surveyRespond.dimensions],
    ['Spanish', es.surveyRespond.dimensions],
  ] as const)('matches %s surveyRespond.dimensions exactly', (field, catalogue) => {
    expect(csharpMap(source, field as 'English' | 'Spanish')).toEqual({ ...catalogue })
  })
})
