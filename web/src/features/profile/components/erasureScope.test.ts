import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  ERASURE_ANONYMISED_TABLES,
  ERASURE_DELETED_TABLES,
  ERASURE_MAP_DIVERGENCES,
  ERASURE_REDACTED_TABLES,
} from './privacyScope'

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
const CONTEXT = join(
  REPO,
  'src',
  'ClimateProject.Infrastructure',
  'Persistence',
  'ClimateProjectDbContext.cs',
)

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

/**
 * Entity name to table name, from every shape the map declares an entry in — the explicit
 * `new(...)` construction and both helper factories. Wider than `ENTRY` on purpose: this is
 * what resolves an erasure written against `db.SurveyAuditLogs` to a table name, and a delete
 * landing on a table the map declares through a helper must resolve too, not fall silently out
 * of the comparison.
 */
const ENTITY_TABLE = /\b(?:new|NotPersonal|Actor)\(\s*"(\w+)"\s*,\s*"(\w+)"/g

/** `public DbSet<SurveyAuditLog> SurveyAuditLogs => Set<SurveyAuditLog>();` */
const DBSET = /public\s+DbSet<(\w+)>\s+(\w+)\s*=>/g

/**
 * The one delete in `SubjectErasure` that names no table, because it *is* the table-agnostic
 * helper: `DeleteAsync<T>` issues the statement its callers built, and those call sites are
 * what the sweep below attributes. Spelled out rather than skipped, so that a *second*
 * unattributable delete fails this file instead of quietly not being counted.
 */
const TABLE_AGNOSTIC_DELETE = 'rows.ExecuteDeleteAsync'

/**
 * How a statement in `SubjectErasure` destroys rows. `DeleteAsync("Entity"` is the helper call
 * (which names its entity); the rest are the direct forms on a `DbSet`.
 */
const DELETE_VERBS = [
  /\bRemoveRange\s*\(/,
  /\bdb\.\w+\s*\.\s*Remove\s*\(/,
  /\bExecuteDeleteAsync\s*\(/,
  /\bExecuteDelete\s*\(/,
  /\bDeleteAsync\(\s*"/,
]

/**
 * C# with its comments removed.
 *
 * The sweep below reads code, and this file's code sits under long prose comments that discuss
 * deletion in words — "DELETED, not redacted", "#143's append-only interceptor refuses DELETE
 * on this table". Matching verbs against prose would attribute a delete to whatever table the
 * paragraph happened to mention. The stripper is itself guarded, from both ends, by
 * `strips the comments out of the erasure without stripping the code`.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/**
 * The tables `SubjectErasure` can be **shown** to delete, read out of the source rather than
 * taken from a declaration.
 *
 * ## Why this is the bound on `ERASURE_MAP_DIVERGENCES`
 *
 * A divergence lets this page contradict `SubjectDataMap`, which is the page's only source of
 * truth about erasure. Checked only as "`mapSays` still matches the map, and `anchor` is still
 * a substring of `SubjectErasure.cs`", that is an unbounded escape hatch: any string in a
 * 420-line file is a valid anchor, so an entry could claim *any* treatment for *any* table and
 * stay green — including the one claim that matters most, telling a subject a record is
 * destroyed when it survives, or survives when it is destroyed.
 *
 * So a divergence may only claim what this function can prove. It walks every statement in the
 * erasure, and for each one that destroys rows it resolves the table: from the entity named in
 * a `DeleteAsync("Entity", ...)` call, or from the `db.<DbSet>` the statement operates on, via
 * the context's own `DbSet` declarations and the map's entity-to-table names. Nothing here is
 * told which tables to look at.
 */
function tablesDeletedByErasure(erasure: string, map: string, context: string): string[] {
  const tableFor = new Map([...map.matchAll(ENTITY_TABLE)].map((m) => [m[1], m[2]]))
  const entityForSet = new Map([...context.matchAll(DBSET)].map((m) => [m[2], m[1]]))

  const tables = new Set<string>()
  for (const statement of withoutComments(erasure).split(';')) {
    if (!DELETE_VERBS.some((verb) => verb.test(statement))) continue

    const named = /\bDeleteAsync\(\s*"(\w+)"/.exec(statement)?.[1]
    const set = /\bdb\.(\w+)/.exec(statement)?.[1]
    const entity = named ?? (set === undefined ? undefined : entityForSet.get(set))

    if (entity === undefined) {
      // Not "skip it": an unattributable delete is the failure this sweep exists to catch.
      expect(
        statement,
        'SubjectErasure destroys rows in a statement this test cannot attribute to a table, so '
          + 'the divergence bound below would not see it. Give the statement a DbSet or an '
          + 'entity name it can be read from.',
      ).toContain(TABLE_AGNOSTIC_DELETE)
      continue
    }

    const table = tableFor.get(entity)
    expect(
      table,
      `SubjectErasure deletes '${entity}', which SubjectDataMap does not name. The map is the `
        + 'record of what is held and what erasure does to it.',
    ).toBeDefined()
    tables.add(table!)
  }

  return [...tables].sort()
}

describe('the erasure scope the privacy page states', () => {
  const map = readFileSync(MAP, 'utf8')

  it('reads the map it is comparing against', () => {
    // Guard the guard. A regex that stopped matching would make every comparison below
    // pass vacuously, which is the one way this file could go green while being useless.
    expect(map).toContain('ErasureTreatment')
    expect([...map.matchAll(ENTRY)].length).toBeGreaterThan(10)
  })

  it('strips the comments out of the erasure without stripping the code', () => {
    // The instrument the delete sweep reads through, measured from both ends. Strip too
    // much and the sweep derives nothing — which agrees with a divergence list that has
    // invented an entry. Strip too little and a paragraph *about* deletion is read as a
    // delete against whatever table it happens to name.
    const stripped = withoutComments(readFileSync(ERASURE, 'utf8'))
    expect(stripped).toContain('ExecuteDeleteAsync')
    expect(stripped).not.toContain('DELETED, not redacted')
  })

  /**
   * The map's list for a treatment, with the known divergences applied: a table the code
   * treats differently is removed from the treatment the map declares and added to the one
   * `SubjectErasure` actually performs. With no divergences declared this is the map
   * verbatim, which is what it was before one was found.
   */
  function expectedFor(treatment: string): string[] {
    const parsed = tablesWithTreatment(map, treatment)
    const moved = parsed.filter(
      (table) => !ERASURE_MAP_DIVERGENCES.some((d) => d.table === table && d.mapSays === treatment),
    )
    const gained = ERASURE_MAP_DIVERGENCES.filter((d) => d.codeDoes === treatment).map((d) => d.table)
    return [...moved, ...gained].sort()
  }

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

    expect([...stated].sort()).toEqual(expectedFor(treatment))
  })

  /**
   * Every declared divergence is still real, checked from **both** ends, and — the part that
   * makes it a bound rather than a licence — checked against what `SubjectErasure` can be
   * *shown* to do rather than against what the entry says it does.
   *
   * A divergence is permission for this page to contradict `SubjectDataMap`, which is the
   * page's only source of truth about erasure. Checked only as "`mapSays` still matches the
   * map, and `anchor` is still a substring of `SubjectErasure.cs`", that permission is
   * unbounded: every string in that file is a valid anchor, so a second entry could be written
   * declaring `responses` **Deleted** — they are anonymised — and this file would stay green
   * while the page told a data subject their survey answers are destroyed. A privacy page that
   * can state anything about any table with a green suite is worse than no page.
   *
   * So `tablesDeletedByErasure` derives the treatment from the erasure's own statements, and a
   * divergence may only claim what that derivation proves. `Deleted` is the one treatment it
   * can prove today, which is deliberate: the alternative to an incomplete prover is a
   * declaration nobody checks. Anonymisation and redaction are field assignments spread over a
   * loop, so an entry claiming either is rejected outright, naming what would have to be built
   * first.
   *
   * The older checks stay, because they fail earlier and say more: correct the map and
   * `mapSays` stops matching; change the erasure to match the map and both the anchor and the
   * derivation go with it. Either way a human re-reads the page's copy instead of the page
   * quietly reverting to a claim that is false in the direction that matters most.
   */
  describe.each(ERASURE_MAP_DIVERGENCES)(
    'the declared divergence on $table',
    ({ table, mapSays, codeDoes, anchor }) => {
      it(`is still declared ${mapSays} by SubjectDataMap`, () => {
        expect(tablesWithTreatment(map, mapSays)).toContain(table)
        expect(tablesWithTreatment(map, codeDoes)).not.toContain(table)
      })

      it(`is still ${codeDoes} by SubjectErasure`, () => {
        expect(readFileSync(ERASURE, 'utf8')).toContain(anchor)
      })

      /**
       * An anchor is a quotation of the call that makes `codeDoes` true, so it has to be a
       * call against *this table's* own `DbSet`. Without this it can be any substring of the
       * file — a comment, a using directive, a word — which is no evidence about this table at
       * all.
       */
      it('anchors on a statement against that table’s own DbSet', () => {
        const entity = [...map.matchAll(ENTITY_TABLE)].find((m) => m[2] === table)?.[1]
        expect(entity, `${table} is not a table SubjectDataMap declares.`).toBeDefined()

        const set = [...readFileSync(CONTEXT, 'utf8').matchAll(DBSET)].find(
          (m) => m[1] === entity,
        )?.[2]
        expect(set, `${entity} has no DbSet on ClimateProjectDbContext.`).toBeDefined()

        expect(anchor).toContain(`db.${set}.`)
      })

      it(`is ${codeDoes} according to SubjectErasure’s own statements, not only to this entry`, () => {
        expect(
          codeDoes,
          `A divergence may not claim '${codeDoes}': the only treatment this file can derive `
            + 'from the erasure source is Deleted. Build the prover before declaring the '
            + 'divergence — an unprovable claim about a table is exactly what this bound exists '
            + 'to refuse.',
        ).toBe('Deleted')

        expect(codeDoes).not.toBe(mapSays)
        expect(
          tablesDeletedByErasure(readFileSync(ERASURE, 'utf8'), map, readFileSync(CONTEXT, 'utf8')),
        ).toContain(table)
      })
    },
  )

  /**
   * The divergence list is **closed**: exactly the tables `SubjectErasure` deletes, and no
   * others.
   *
   * The per-entry checks above bound what a declared divergence may claim. This bounds the
   * list itself, from the other side, and it is the assertion that cannot be satisfied by
   * writing more declarations. Every table the erasure destroys rows in must be a table the
   * map marks `Deleted` or a table a divergence says is deleted — so an invented entry has
   * nothing to match, and a real deletion that nobody declared has nothing to hide behind. It
   * is one comparison rather than two because a set equality fails in whichever direction
   * broke.
   *
   * This is also what keeps the sweep honest. If the statement parse stopped matching, the
   * derived set would shrink below the four tables the map itself marks `Deleted` and this
   * fails — a broken guard goes red rather than green.
   */
  it('declares every divergence the erasure source shows, and invents none', () => {
    const declared = ERASURE_MAP_DIVERGENCES.filter((d) => d.codeDoes === 'Deleted').map(
      (d) => d.table,
    )

    expect(
      tablesDeletedByErasure(readFileSync(ERASURE, 'utf8'), map, readFileSync(CONTEXT, 'utf8')),
    ).toEqual([...tablesWithTreatment(map, 'Deleted'), ...declared].sort())
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
   *
   * One caveat, on the `audit records are retained` row. The page no longer paraphrases the
   * whole of that limitation, because the second half of it — "survey_audit_logs keeps
   * everything except the denormalised copy of the actor's name and email" — is not what
   * `SubjectErasure` does; see `ERASURE_MAP_DIVERGENCES`. The page restates the half that is
   * true (`audit_logs` is untouched, and it names the table) and states the deletion
   * separately. The anchor is kept because the sentence is still the origin of the retention
   * argument the page makes, and because a reword should still send somebody back here.
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

  /**
   * `privacy.erasureAnonymisedUsers` — the account row's entry in the "kept, with the link to
   * you severed" list — promises "your department and manager are cleared". Two assignments in
   * `AnonymiseAccount` make that true, and both could be deleted with every other test in this
   * repository still green: no assertion anywhere read those columns after an erasure, and the
   * page would go on promising something that had stopped happening.
   *
   * "Worked in this team, reported to this person" is a fact about the individual, so this is
   * the same class of claim as the pseudonymised email beside it, not a detail. Held here as
   * the page's end of it; `GdprEndpointsTests.Erasure_clears_the_department_and_the_manager_the_page_says_it_clears`
   * holds the behavioural end, against a subject seeded with both.
   */
  it('still rests on the erasure clearing the department and the manager', () => {
    const erasure = readFileSync(ERASURE, 'utf8')
    expect(erasure).toContain('subject.DepartmentId = null')
    expect(erasure).toContain('subject.ManagerId = null')
  })
})
