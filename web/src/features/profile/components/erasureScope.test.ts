import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  ERASURE_ANONYMISED_TABLES,
  ERASURE_DELETED_TABLES,
  ERASURE_REDACTED_TABLES,
} from './ErasureRequestPanel'

/**
 * The privacy page's erasure statement, checked against the code that does the erasing.
 *
 * ## Why this test exists at all
 *
 * #137's third acceptance criterion is "erasure scope stated accurately, no overclaiming",
 * and the issue says why it is worded that way: telling a data subject that their survey
 * answers will be deleted, when the implementation anonymises them, is a false claim on the
 * one page whose entire value is that it can be believed. A page cannot be trusted to keep
 * that promise on its own — the promise lives in a React component and the behaviour lives
 * in `ClimateProject.Infrastructure.Gdpr`, in another language, in another build, behind
 * another test suite. Nothing connects them but this file.
 *
 * So the component states its scope as **three lists of table names**, and this reads the
 * map out of the C# source and compares them. Add a table to the map as `Deleted`, or move
 * one from `Redacted` to `Deleted`, and this goes red until the page has been updated to
 * say so.
 *
 * ## Why it parses the source instead of calling the API
 *
 * The map is a compile-time constant in a .NET assembly; there is no endpoint that serves it
 * to an unprivileged caller (`GET /gdpr/compliance-report` is `Roles.Admin`, and needs a
 * running server and a database besides). Reading the file is the only check that runs in
 * `npm test`, which is the harness CI always runs — `src/test/repoHygiene.test.ts` sweeps
 * the repository from here for exactly the same reason.
 *
 * The parse is guarded against itself: the number of entries the regex extracts is compared
 * against a plain count of the `ErasureTreatment.X` occurrences in the file, so an entry
 * written in a shape this regex does not match fails loudly rather than shrinking the set
 * that gets compared.
 */

// Vitest runs with `web/` as cwd, as in `repoHygiene.test.ts` and `noHardcodedStrings.test.ts`.
const REPO = resolve(process.cwd(), '..')
const MAP = join(REPO, 'src', 'ClimateProject.Application', 'Gdpr', 'SubjectDataMap.cs')
const ERASURE = join(REPO, 'src', 'ClimateProject.Infrastructure', 'Gdpr', 'SubjectErasure.cs')

/**
 * `new("Notification", "notifications", SubjectLink.Subject, ["UserId"],`
 * `    ExportTreatment.FullRecord, ErasureTreatment.Deleted,`
 *
 * The helper factories in the same file (`NotPersonal`, `Actor`) only ever produce
 * `NotApplicable` and `Retained`, so every entry with a destructive treatment is one of
 * these explicit constructions. The occurrence-count assertion below is what keeps that
 * true rather than merely believed.
 */
const ENTRY =
  /new\("\w+",\s*"(\w+)",\s*SubjectLink\.\w+,\s*\[[^\]]*\],\s*ExportTreatment\.\w+,\s*ErasureTreatment\.(\w+),/g

function tablesWithTreatment(source: string, treatment: string): string[] {
  const tables: string[] = []
  for (const match of source.matchAll(ENTRY)) {
    if (match[2] === treatment) tables.push(match[1])
  }
  return tables.sort()
}

function occurrences(source: string, treatment: string): number {
  return source.split(`ErasureTreatment.${treatment},`).length - 1
}

describe('the erasure scope the privacy page states', () => {
  const map = readFileSync(MAP, 'utf8')

  it('reads the map it is comparing against', () => {
    // Guard the guard. A regex that stopped matching would make every comparison below
    // pass vacuously, which is the one way this file could go green while being useless.
    expect(map).toContain('ErasureTreatment')
    expect([...map.matchAll(ENTRY)].length).toBeGreaterThan(10)
  })

  it.each([
    ['Deleted', ERASURE_DELETED_TABLES],
    ['Anonymised', ERASURE_ANONYMISED_TABLES],
    ['Redacted', ERASURE_REDACTED_TABLES],
  ])('names exactly the tables SubjectDataMap marks %s', (treatment, stated) => {
    const parsed = tablesWithTreatment(map, treatment)

    // Every entry carrying this treatment was actually reached by the parse — otherwise a
    // differently-formatted entry would drop out of `parsed` and the comparison would
    // agree with a page that is missing a table.
    expect(parsed.length).toBe(occurrences(map, treatment))
    expect(parsed.length).toBeGreaterThan(0)

    expect([...stated].sort()).toEqual(parsed)
  })

  /**
   * The four claims on the page that are not about a single table, each anchored to the
   * sentence in `SubjectErasure.KnownLimitations` it paraphrases. The API returns those
   * limitations verbatim in an erasure response — but only an administrator ever sees one,
   * so a self-service page has to restate them, and a restatement needs an anchor.
   *
   * If one of these phrases is reworded on the server, this fails and somebody re-reads the
   * page's copy. That is the intended outcome: the alternative is copy that quietly stops
   * being true.
   */
  it.each([
    ['responses are anonymised, not deleted', 'Survey responses are anonymised, not deleted'],
    ['audit records are retained', 'Audit records are retained under Art. 17(3)(b) and (e)'],
    ['the account row survives', 'The account row survives as a pseudonym'],
    ['free text is not scrubbed', 'Free text is not scrubbed'],
    ['email matching is tenant-scoped', 'Rows matched by email address are erased only inside the tenant'],
    ['the tracking session outlives the erasure', 'keeps authorising requests there until it expires'],
  ])('still rests on SubjectErasure saying %s', (_, phrase) => {
    expect(readFileSync(ERASURE, 'utf8')).toContain(phrase)
  })

  /**
   * The page tells the reader their sessions against this platform stop working. That is
   * only true because the erasure deactivates the account *and* rotates the security stamp
   * — `IsActive` alone is a mint-time check that a live token sails past.
   */
  it('still rests on the erasure deactivating the account and rotating its security stamp', () => {
    const erasure = readFileSync(ERASURE, 'utf8')
    expect(erasure).toContain('subject.IsActive = false')
    expect(erasure).toContain('subject.SecurityStamp = Guid.NewGuid()')
  })
})
