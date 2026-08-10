import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Guards the #149 decision record: `docs/decisions/legacy-dev-routes.md`.
 *
 * Two jobs, and the second is the reason this file was rewritten.
 *
 * **1. The record stays complete.** A parity audit is supposed to reconcile the legacy
 * `src/app/api/` scaffolding against that document, so a dropped row turns a recorded
 * decision back into an unexplained gap. Every route is pinned by name, by HTTP method,
 * and by which table it sits in.
 *
 * **2. The record stays free of disclosure detail.** The first version of this document
 * carried a per-route authorization column and per-handler descriptions of what an
 * unauthenticated caller could overwrite — published to a **public** repository, about an
 * application that is private and whose deployment status is still open. It was removed and
 * the branch deleted. The security findings live in `climate-project#75`, in the private
 * repository that holds the affected code.
 *
 * The disclosure guard below is deliberately crude — a keyword sweep rather than anything
 * clever — because the failure it prevents is someone helpfully re-adding an "Auth" column,
 * not an adversary evading a regex. It has a companion vacuity check, since a guard that
 * matches nothing passes for the wrong reason.
 */

const WEB = process.cwd()
const REPO_ROOT = resolve(WEB, '..')
const DECISION_RECORD = join(REPO_ROOT, 'docs', 'decisions', 'legacy-dev-routes.md')
const API_SOURCE = join(REPO_ROOT, 'src', 'ClimateProject.Api')

const READ_ONLY_ROUTES: Record<string, string> = {
  'test-check-company-ids': 'GET',
  'test-check-completion-times': 'GET',
  'test-check-responses': 'GET',
  'test-db': 'GET',
  'test-debug-report-object': 'POST',
  'test-generate-data': 'POST',
  'test-simple-report': 'POST',
  'test-report-filters': 'GET',
  'check-report-data': 'GET',
  'debug/users': 'GET',
  'debug/raw-users': 'GET',
  'debug/test-user-query': 'GET',
  'debug/session': 'GET',
}

const WRITING_ROUTES: Record<string, string> = {
  'test-fix-company-ids': 'POST',
  'seed-survey-data': 'POST',
  'debug/fix-user-email': 'POST',
  'test-mongoose-save': 'POST',
  'test-populate-report': 'POST',
  'test-update-report-filters': 'POST',
  'test-update-time-filter': 'POST',
  'create-test-report': 'POST',
  'test-report-creation': 'POST',
  'test-fresh-report': 'POST',
  'test-schema-validation': 'POST',
  'test-simple-save': 'POST',
  'test-minimal-report': 'POST',
  'test-simple-report-creation': 'POST',
  'test-minimal-seed': 'POST',
  'test-survey-creation': 'POST',
  'test-mixed-schema': 'POST',
}

const ADJACENT_ROUTES: Record<string, string> = {
  'admin/seed-data': 'POST, GET, DELETE',
  'admin/seed-data/users': 'POST',
  'admin/scope-test': 'POST, GET',
  'system/integration-tests': 'POST, GET',
}

/** The thirty whose names must never reappear as a .NET endpoint route. */
const CANONICAL_ROUTES = [...Object.keys(READ_ONLY_ROUTES), ...Object.keys(WRITING_ROUTES)]

/**
 * A route that IS mapped in the .NET API. Without it, the "no dev route reappeared" test
 * passes just as happily against an empty file list or a mis-resolved path.
 */
const PRESENT_ROUTE = '/admin/reports'

/** Three columns now, not four — the Auth column is gone on purpose. */
const TABLE_ROW = /^\| `([^`]+)` \| ([^|]+?) \| ([^|]+?) \|$/gm
const SECTION_HEADING = /^### (.+?) \((\d+)\)$/

const RECORD = readFileSync(DECISION_RECORD, 'utf8')

interface Row {
  route: string
  method: string
  reason: string
}
interface Section {
  heading: string
  declaredCount: number
  rows: Row[]
}

function sections(): Section[] {
  const found: Section[] = []
  let heading: string | null = null
  let declaredCount = 0
  let body: string[] = []

  const flush = (): void => {
    if (heading === null) return
    const rows = [...body.join('\n').matchAll(TABLE_ROW)]
      .map((m) => ({ route: m[1], method: m[2].trim(), reason: m[3].trim() }))
      .filter((r) => r.route !== 'Route')
    found.push({ heading, declaredCount, rows })
  }

  for (const line of RECORD.split('\n')) {
    const match = SECTION_HEADING.exec(line)
    if (match) {
      flush()
      heading = match[1]
      declaredCount = Number(match[2])
      body = []
    } else if (heading !== null) {
      body.push(line)
    }
  }
  flush()
  return found
}

function section(headingStartsWith: string): Section {
  const matches = sections().filter((e) => e.heading.startsWith(headingStartsWith))
  expect(matches, `exactly one section starting "${headingStartsWith}"`).toHaveLength(1)
  return matches[0]
}

const classifiedRows = (): Row[] => [...section('Read-only').rows, ...section('Writing').rows]

function csharpSources(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...csharpSources(path))
    else if (entry.name.endsWith('.cs')) files.push(path)
  }
  return files
}

describe('legacy dev routes: the #149 decision record', () => {
  it('classifies every legacy dev route exactly once, and nothing else', () => {
    const classified = classifiedRows()
      .map((r) => r.route)
      .sort()
    expect(classified).toEqual([...CANONICAL_ROUTES].sort())
    expect(new Set(classified).size, 'no route classified twice').toBe(classified.length)
  })

  const TABLES: Array<[string, Record<string, string>]> = [
    ['Read-only', READ_ONLY_ROUTES],
    ['Writing', WRITING_ROUTES],
    ['Adjacent scaffolding', ADJACENT_ROUTES],
  ]

  it.each(TABLES)('%s: rows, methods and the declared count all agree', (heading, expected) => {
    const table = section(heading)
    expect(table.rows).toHaveLength(table.declaredCount)
    expect(Object.fromEntries(table.rows.map((r) => [r.route, r.method]))).toEqual(expected)
  })

  it('gives every route a real reason, not just a name', () => {
    for (const row of [...classifiedRows(), ...section('Adjacent scaffolding').rows]) {
      expect(row.reason.length, `${row.route} needs a classification`).toBeGreaterThan(20)
    }
  })

  it('records the escalation by its tracking id and names an owner', () => {
    const escalation = RECORD.slice(RECORD.indexOf('## The security half'))
    expect(escalation).toContain('climate-project#75')
    expect(escalation, 'the private repo must be identified as private').toMatch(/private/i)
    // An owner, not merely the word "Owner" — a blank cell used to pass this.
    expect(escalation).toMatch(/\|\s*Owner\s*\|\s*@[A-Za-z0-9-]+\s*\|/)
  })
})

describe('legacy dev routes: the record carries no disclosure detail', () => {
  /**
   * This repository is public; the legacy application is not, and whether it is still
   * served from a public origin is the open half of `climate-project#75`. A per-route
   * authorization map here would be an attack map for a possibly-live system.
   */
  const FORBIDDEN: Array<[string, RegExp]> = [
    ['an Auth column', /^\|\s*Route\s*\|[^|]*\|\s*Auth\s*\|/m],
    ['a per-route auth verdict', /\|\s*(none|no auth)\s*\|/i],
    ['a count of unauthenticated handlers', /\b(twenty-eight|28)\b[^.\n]{0,60}\b(unauthenticated|no auth)/i],
    ['the phrase "unauthenticated caller/handler"', /unauthenticated (caller|handler|GET|POST)/i],
    // Deliberately narrow: "not gated"/"ungated" are verdicts about a specific legacy
    // handler. The forward-looking rule below the tables says "no route that skips
    // authorization on the grounds that it is temporary" — that is guidance for the new
    // API, not a disclosure about the old one, and an earlier draft of this pattern
    // matched it and failed the document it was written to protect.
    ['an "is not gated" verdict', /\bnot gated\b|\bungated\b/i],
    ['a committed credential', /TestPass123|password of `/i],
    ['an unfiltered-delete recipe', /deleteMany\(\{\}\)|no filter\b/i],
    ['cross-tenant phrasing that reads as an effect claim', /unscoped cross-tenant|across all tenants/i],
  ]

  it.each(FORBIDDEN)('does not contain %s', (_label, pattern) => {
    expect(RECORD).not.toMatch(pattern)
  })

  it('the forbidden patterns are real patterns, not typos that can never match', () => {
    // Vacuity control: every pattern above must match the text it was written to catch.
    // Without this, a mistyped regex would make the guard pass by matching nothing.
    const samples: Record<string, string> = {
      'an Auth column': '| Route | Method | Auth | Classification |',
      'a per-route auth verdict': '| `test-db` | GET | none | Dev-only. |',
      'a count of unauthenticated handlers':
        'Twenty-eight of the thirty perform no authentication or authorization of any kind.',
      'the phrase "unauthenticated caller/handler"': 'The other three deny an unauthenticated caller.',
      'an "is not gated" verdict': '**The GET is not gated at all** (`route.ts:414`)',
      'a committed credential': 'with a default password of `TestPass123!`, clearing all users',
      'an unfiltered-delete recipe': 'empties the collections outright — `deleteMany({})`, no filter.',
      'cross-tenant phrasing that reads as an effect claim':
        'Unscoped cross-tenant reassignment across all tenants.',
    }
    for (const [label, pattern] of FORBIDDEN) {
      expect(samples[label], `no sample for "${label}"`).toBeTruthy()
      expect(samples[label], `pattern for "${label}" matches nothing`).toMatch(pattern)
    }
  })
})

describe('legacy dev routes: none has reappeared in the .NET API', () => {
  const sources = csharpSources(API_SOURCE).map((path) => ({
    path,
    text: readFileSync(path, 'utf8'),
  }))

  it('reads a non-empty set of API sources', () => {
    // Vacuity control for the sweep below.
    expect(sources.length).toBeGreaterThan(10)
    expect(
      sources.some((s) => s.text.includes(PRESENT_ROUTE)),
      `expected to find ${PRESENT_ROUTE} — if this fails the sweep is looking at the wrong tree`,
    ).toBe(true)
  })

  it.each(CANONICAL_ROUTES)('%s is not mapped as an endpoint route', (route) => {
    // Match the route only where it would appear as a mapped path, so prose that merely
    // names it (SystemStatusEndpoints explains why `system/integration-tests` was dropped)
    // does not trip the guard.
    const mapped = new RegExp(`Map(Get|Post|Put|Patch|Delete|Methods)\\s*\\(\\s*"[^"]*${route}`, 'i')
    const offenders = sources.filter((s) => mapped.test(s.text)).map((s) => s.path)
    expect(offenders, `${route} reappeared as a .NET endpoint`).toEqual([])
  })
})
