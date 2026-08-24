import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The screenshot fixture for the shared picker, checked against the contract the
 * component is typed against.
 *
 * ## Why this test exists
 *
 * `/dev/question-library` and the wizard shots are the only way anything in this
 * repository LOOKS at the picker — happy-dom has no layout engine, so the 2905-test
 * suite cannot see a screen. That makes this fixture an instrument, and an instrument
 * nobody checks is one that can be wrong while reporting success.
 *
 * It already was. The eNPS row was added to demonstrate a 0–10 scale, and its DETAIL
 * response was written without `type` while its LIST row said `likert`. Every test
 * still passed, because no test reads this file; the picker offered the row (the list
 * row's type is what `filterLibraryItems` filters on), then copied a question whose
 * type was `undefined`. In the wizard that renders as an EMPTY question-type select
 * and no scale block at all — so the one screenshot taken to prove the scale bounds
 * survive a pick was a photograph of them not surviving, and it looked fine.
 *
 * `QuestionLibraryItemDetail` extends `QuestionLibraryItem`, so `type` is required by
 * the TypeScript contract. A JSON fixture is not typechecked, which is exactly why the
 * declaration alone did not catch it.
 *
 * ## What is asserted
 *
 * The two things a hand-written fixture can get wrong silently: a detail row missing a
 * field the caller reads without checking, and a detail row DISAGREEING with the list
 * row of the same id. The second is the one that cannot be caught by reading either
 * half on its own.
 */

const FIXTURE = join(process.cwd(), 'scripts', 'shot-fixtures', 'question-library.json')

/** Fields `questionFromLibrary` reads off a detail with no fallback of its own. */
const REQUIRED_ON_DETAIL = ['id', 'textEn', 'textEs', 'type', 'options'] as const

interface Fixture {
  [key: string]: Record<string, unknown>
}

function load(): Fixture {
  return JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture
}

/** The explicit per-id detail entries, excluding the `*` catch-all. */
function detailEntries(fixture: Fixture): [string, Record<string, unknown>][] {
  return Object.entries(fixture).filter(
    ([key]) => key.startsWith('GET /admin/question-library/') && !key.endsWith('/*'),
  )
}

describe('the question library shot fixture', () => {
  it('gives every detail row the fields a picked question is built from', () => {
    const fixture = load()
    const missing: string[] = []

    // The `*` catch-all too: it is what answers every id without an explicit entry,
    // so a hole in it is a hole under most of the rows in the list.
    const wildcard = 'GET /admin/question-library/*'
    const all: [string, Record<string, unknown>][] = [
      ...detailEntries(fixture),
      [wildcard, fixture[wildcard]],
    ]

    for (const [key, body] of all) {
      for (const field of REQUIRED_ON_DETAIL) {
        if (body[field] === undefined) missing.push(`${key} -> ${field}`)
      }
    }

    expect(
      missing,
      'A detail row without one of these copies a broken question into the wizard, and ' +
        'the screenshot taken to check it shows the breakage as if it were the design.',
    ).toEqual([])
  })

  it('never lets a detail row disagree with the list row of the same id about type', () => {
    const fixture = load()
    const items = (fixture['GET /admin/question-library'] as unknown as {
      items: { id: string; type: string }[]
    }).items
    const listType = new Map(items.map((item) => [item.id, item.type]))

    const disagreements: string[] = []
    for (const [key, body] of detailEntries(fixture)) {
      const id = body.id as string
      const fromList = listType.get(id)
      // A detail fixture for an id the list never returns is unreachable through the
      // picker, which reads the list first. Worth naming rather than skipping.
      if (fromList === undefined) {
        disagreements.push(`${key} -> id ${id} is in no list row`)
        continue
      }
      if (body.type !== fromList) {
        disagreements.push(`${key} -> list says ${fromList}, detail says ${String(body.type)}`)
      }
    }

    expect(
      disagreements,
      'The picker FILTERS on the list row type and COPIES the detail row type. When ' +
        'they disagree, a row the wizard can render is offered and a question it ' +
        'cannot is what arrives.',
    ).toEqual([])
  })
})
