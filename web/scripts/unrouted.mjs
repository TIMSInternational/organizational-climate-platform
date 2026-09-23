/**
 * List the source modules no route can reach, split by whether anything else still uses them.
 *
 *   node scripts/unrouted.mjs [--all]
 *
 * ## Why
 *
 * Twice a session has proposed deleting "dead" `auth/` files from a remembered list and been
 * wrong about which ones. On 2026-09-22 the list named `AuthShell.tsx` as dead while it was
 * LIVE — `AcceptInvitationNextPage` is routed, it rendered `AuthPending`, and that rendered
 * `AuthShell` — and missed three files that really were unreachable. Deleting from that list
 * would have broken the invitation screen's submit state.
 *
 * Grep cannot answer the question. A component's name appears in its own tests, in prose on
 * unrelated files, and in the doc block of the page that REPLACED it, so a name with twenty
 * hits can be reachable from nothing. Reachability from a real entry point decides it.
 *
 * ## The two buckets, and why the split is the point
 *
 * Its first version printed one list of 127 files and was a bad instrument: `src/test/setup.ts`
 * was on it (vite.config.ts names it in `setupFiles`, so nothing imports it) and so was
 * `navigation/roleCapabilities.ts` (imported by tests only). Neither is dead. A list that
 * cannot tell those from a retired page is a list nobody can act on.
 *
 *   UNROUTED, STILL TESTED  no route reaches it, but a test imports it. This is exactly the
 *                           category `app/router.tsx` rules on: the pages the `next/`
 *                           redesign replaced stay "unrouted and still tested, as the wiring
 *                           reference". Seeing a file here is the NORMAL state for them.
 *   UNROUTED AND UNUSED     nothing imports it at all — no route, no test. Test helpers wired
 *                           by config (`setupFiles`) surface here too, so this is a list to
 *                           read, not to delete from.
 *
 * Neither bucket is a verdict. Unreachable is the precondition for a deletion decision, never
 * the decision; `app/router.tsx` holds the ruling. Run this to learn the true set first.
 *
 * Bare specifiers are not followed, so a module reached only through a package alias or named
 * by config reads as unreferenced; everything in `src/` uses relative paths today. A dynamic
 * `import()` with a literal path IS followed, because `router.tsx` lazy-loads that way.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const ROUTE_ENTRIES = ['app/router.tsx', 'main.tsx', 'App.tsx']
const IS_TEST = (f) => /\.(test|spec)\.[jt]sx?$/.test(f)
const IS_SOURCE = (f) => /\.[jt]sx?$/.test(f)

/** Node's own resolution, narrowed to what this codebase actually writes. */
function resolveImport(from, spec) {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(from), spec)
  const candidates = [base, `${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')]
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null
}

/** `from '…'`, `import '…'` and `import('…')` alike; the capture is the specifier. */
function importsOf(file) {
  const source = readFileSync(file, 'utf8')
  return [...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)]
    .map((m) => resolveImport(file, m[1]))
    .filter(Boolean)
}

function closure(entries, { throughTests }) {
  const seen = new Set()
  const walk = (file) => {
    if (seen.has(file)) return
    seen.add(file)
    for (const target of importsOf(file)) {
      if (throughTests || !IS_TEST(target)) walk(target)
    }
  }
  entries.forEach(walk)
  return seen
}

function walkDir(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name)
    return e.isDirectory() ? walkDir(full) : IS_SOURCE(e.name) ? [full] : []
  })
}

const entries = ROUTE_ENTRIES.map((e) => join(SRC, e)).filter(existsSync)
if (entries.length === 0) {
  console.error(`no entry point found under ${SRC} — looked for ${ROUTE_ENTRIES.join(', ')}`)
  process.exit(1)
}

const files = walkDir(SRC)
const tests = files.filter(IS_TEST)
const routed = closure(entries, { throughTests: false })
// Every test is its own entry point: what the suite reaches is "still used", not "reachable".
const tested = closure(tests, { throughTests: true })

const all = process.argv.includes('--all')
const unrouted = files
  .filter((f) => !IS_TEST(f) && !routed.has(f))
  .filter((f) => all || !relative(SRC, f).startsWith('dev/'))
  .map((f) => relative(SRC, f))
  .sort()

const stillTested = unrouted.filter((f) => tested.has(join(SRC, f)))
const unused = unrouted.filter((f) => !tested.has(join(SRC, f)))

console.log(`entries:   ${entries.map((e) => relative(SRC, e)).join(', ')}`)
console.log(`reachable: ${routed.size} modules from a route, ${tested.size} from the suite`)
console.log(`unrouted:  ${unrouted.length}${all ? '' : ' (excluding dev/; pass --all for those)'}`)

console.log(`\n── UNROUTED, STILL TESTED (${stillTested.length}) ─────────────────────────────`)
console.log('   No route reaches these; the suite still does. See the ruling in app/router.tsx.')
for (const f of stillTested) console.log(`  ${f}`)

console.log(`\n── UNROUTED AND UNUSED (${unused.length}) ────────────────────────────────────`)
console.log('   Nothing imports these at all. Config-named files (vite setupFiles) land here too.')
for (const f of unused) console.log(`  ${f}`)

console.log('\nNeither list is a verdict — see the ruling in src/app/router.tsx.')
