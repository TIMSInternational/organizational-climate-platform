/**
 * Check the 29 fixture files against what the API actually returns.
 *
 *   node scripts/fixture-drift.mjs [--journal .e2e/journal.jsonl]
 *
 * ## Why
 *
 * `scripts/shot-fixtures/*.json` describes ~60 endpoints and NOTHING has ever compared it
 * to the running API. Every screenshot this repository has ever produced was taken against
 * that description. If a fixture is missing a field the API returns, the screen was
 * photographed without it; if a fixture invents one, the screen was photographed with
 * something that does not exist. Either way the picture is of a product that is not this
 * one, and no test would notice, because the tests use the same fixtures.
 *
 * `e2e.mjs` records the SHAPE of every real response. This crosses the two.
 *
 * ## What it compares, and what it deliberately does not
 *
 * Shape only: which keys exist, whether a field is a list, what type each leaf is. A
 * fixture's VALUES are invented on purpose — "Northwind Logistics" is not supposed to be
 * in the database — so comparing them would produce a page of noise with the signal
 * buried in it.
 *
 * Matching reuses `compileFixtures`/`matchFixture` from the shot harness, so a fixture
 * key's `*` means here exactly what it means there. A second implementation of that
 * matching would be a second thing to get wrong.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { compileFixtures, matchFixture } from './shot-harness.mjs'
import { flatten, shapeOf } from './e2e-harness.mjs'

const WEB_ROOT = resolve(import.meta.dirname, '..')
const FIXTURE_DIR = resolve(WEB_ROOT, 'scripts', 'shot-fixtures')

const { values } = parseArgs({
  options: { journal: { type: 'string', default: '.e2e/journal.jsonl' } },
})

// ---- what the API really returned ----
const real = new Map()
const journalPath = resolve(WEB_ROOT, values.journal)
for (const line of readFileSync(journalPath, 'utf8').split('\n').filter(Boolean)) {
  for (const call of JSON.parse(line).apiCalls ?? []) {
    if (call.status >= 400 || !call.shape) continue
    real.set(`${call.method} ${call.path}`, call.shape)
  }
}

// ---- what the fixtures claim ----
const declared = []
for (const file of readdirSync(FIXTURE_DIR).filter((name) => name.endsWith('.json'))) {
  const body = JSON.parse(readFileSync(resolve(FIXTURE_DIR, file), 'utf8'))
  for (const fixture of compileFixtures(body)) {
    declared.push({ file, ...fixture })
  }
}

const drifted = []
const verified = []
const unfixtured = []
const exercised = new Set()

for (const [key, realShape] of real) {
  const [method, path] = key.split(' ')
  // ALL the fixtures that match, not the first.
  //
  // The 27 files are SCENARIOS, not one contract: `tracking-outage.json` is a deliberate
  // 503, `employee-empty.json` a deliberate "nothing has happened yet",
  // `distribution-empty.json` an empty distribution. Taking whichever matched first
  // compared a healthy response against an outage fixture and called the difference
  // drift — reporting six failures that were really "you matched the wrong scenario".
  //
  // The question worth asking is "does ANY fixture describe this response correctly?", so
  // every match is scored and the closest wins. A scenario fixture is by construction
  // further away, and drops out on its own without a blocklist of filenames to maintain.
  const candidates = declared.filter((fixture) =>
    fixture.method === method.toUpperCase() && fixture.regex.test(path))
  if (candidates.length === 0) {
    unfixtured.push(key)
    continue
  }

  const realKeys = new Set(flatten(realShape))
  const scored = candidates.map((candidate) => {
    const fixtureKeys = new Set(flatten(shapeOf(candidate.body)))

  // An EMPTY array carries no shape. `distribution-empty.json` and `employee-empty.json`
  // are deliberate empty-state scenarios, and the local database has no demographic
  // fields or invitations — so one side is `fields[]` and the other is twelve
  // `fields[].something` paths. That is not drift, it is one side having nothing to say,
  // and reporting it buried the three real findings under forty lines of noise.
  //
  // So a prefix that is empty on either side is dropped from BOTH. What survives is a key
  // both sides actually described.
    const emptyPrefixes = [...fixtureKeys, ...realKeys]
      .filter((key) => key.endsWith('[]'))
      .map((key) => key.slice(0, -2))
    const uninformative = (key) => emptyPrefixes.some((prefix) => key.startsWith(`${prefix}[].`) || key === `${prefix}[]`)

    const missing = [...realKeys].filter((k) => !fixtureKeys.has(k) && !uninformative(k))
    const invented = [...fixtureKeys].filter((k) => !realKeys.has(k) && !uninformative(k))
    return { candidate, missing, invented, distance: missing.length + invented.length }
  })

  const best = scored.sort((a, b) => a.distance - b.distance)[0]
  exercised.add(`${best.candidate.file}::${best.candidate.method} ${best.candidate.regex}`)

  if (best.distance === 0) verified.push(key)
  else drifted.push({ key, file: best.candidate.file, missing: best.missing, invented: best.invented, alternatives: candidates.length })
}

const log = (line) => process.stdout.write(`${line}\n`)

log(`fixture-drift: ${real.size} live responses, ${declared.length} fixture entries in ${new Set(declared.map((d) => d.file)).size} files`)
log(`fixture-drift: ${verified.length} verified, ${drifted.length} drifted, ${unfixtured.length} live paths with no fixture\n`)

for (const drift of drifted.sort((a, b) => a.key.localeCompare(b.key))) {
  log(`DRIFT ${drift.key}  (closest of ${drift.alternatives}: ${drift.file})`)
  for (const key of drift.missing.slice(0, 12)) log(`  API returns, fixture lacks:  ${key}`)
  for (const key of drift.invented.slice(0, 12)) log(`  fixture invents:            ${key}`)
  const extra = drift.missing.length + drift.invented.length - 24
  if (extra > 0) log(`  … and ${extra} more`)
  log('')
}

if (unfixtured.length > 0) {
  log(`No fixture — these screens cannot be screenshotted with data:`)
  for (const key of unfixtured.sort()) log(`  ${key}`)
  log('')
}

const unexercised = declared.filter((d) => !exercised.has(`${d.file}::${d.method} ${d.regex}`))
log(`Unexercised by this journal (${unexercised.length}) — not checked, not necessarily wrong.`)
process.exit(drifted.length > 0 ? 1 : 0)
