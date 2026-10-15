#!/usr/bin/env node
/**
 * How many people can sign in at once.
 *
 * ESPH mails 800 people at one moment and expects a few hundred of them to sign in within
 * minutes. `/auth/login` carries the tightest rate-limit class in the product
 * (`RateLimitPolicies.Authentication`: 20 requests per minute, `QueueLimit = 0`, partitioned
 * by CLIENT ADDRESS), and a utility company's staff answering from the corporate network
 * share very few public addresses. This measures what actually happens when N sign-in
 * attempts arrive from one address at once.
 *
 * **It needs no valid credentials, and that is the point.** The limiter runs as middleware,
 * before any password is checked, so a rejected request answers 429 and an allowed one
 * answers 401 — the split between those two IS the measurement, and nothing is created,
 * changed or signed in to. A wrong password is also exactly what a person who mistypes
 * theirs sends, which is the launch-morning case worth knowing about.
 *
 *   node scripts/load-signin.mjs --api http://localhost:5000 --people 300
 *
 * Against a LOCAL api only. `--api` must be a localhost or 127.0.0.1 origin; the script
 * refuses anything else, because pointing a few hundred sign-in attempts at a deployed
 * environment is a denial-of-service against real respondents, and production is collecting
 * for a live client.
 */

import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    api: { type: 'string', default: 'http://localhost:5000' },
    people: { type: 'string', default: '300' },
    identifier: { type: 'string', default: 'carga' },
    help: { type: 'boolean', default: false },
  },
})

if (values.help) {
  process.stdout.write(
    'usage: node scripts/load-signin.mjs [--api http://localhost:5000] [--people 300]\n'
      + '\n'
      + '  Fires N concurrent POST /auth/login and tallies the answers. No valid credentials\n'
      + '  are used and nothing is written: 401 means the limiter let the request through to\n'
      + '  the password check, 429 means it did not.\n',
  )
  process.exit(0)
}

const api = values.api.replace(/\/$/, '')
const host = (() => {
  try {
    return new URL(api).hostname
  } catch {
    return null
  }
})()

// A few hundred sign-in attempts is a denial-of-service anywhere a real respondent is
// answering. This tool is local-only, enforced here rather than written down in a comment.
if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
  process.stderr.write(`load-signin: refusing to point ${values.people} sign-in attempts at ${api}.\n`)
  process.stderr.write('load-signin: --api must be localhost. Production is collecting for a live client.\n')
  process.exit(2)
}

const people = Number.parseInt(values.people, 10)
if (!Number.isFinite(people) || people < 1) {
  process.stderr.write(`load-signin: --people must be a positive number, got ${values.people}\n`)
  process.exit(2)
}

/** One attempt: the status the server gave and how long it took. */
async function attempt(index) {
  const started = performance.now()
  try {
    const response = await fetch(`${api}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Deliberately wrong. The limiter answers before the password is read, so a real
      // credential would prove nothing extra and would create a session.
      body: JSON.stringify({ email: `${values.identifier}-${index}@carga.test`, password: 'not-a-password' }),
    })
    return { status: response.status, ms: performance.now() - started }
  } catch (error) {
    return { status: 0, ms: performance.now() - started, error: String(error?.message ?? error) }
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  const at = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[at]
}

const started = Date.now()
process.stdout.write(`load-signin: ${people} concurrent sign-in attempts at ${api}\n`)

// All at once, from one address, which is the case being measured: an email blast lands and
// everyone opens it together.
const results = await Promise.all(Array.from({ length: people }, (_, index) => attempt(index)))
const elapsed = (Date.now() - started) / 1000

const byStatus = new Map()
for (const result of results) byStatus.set(result.status, (byStatus.get(result.status) ?? 0) + 1)
const latencies = results.map((r) => r.ms).sort((a, b) => a - b)

const allowed = (byStatus.get(401) ?? 0) + (byStatus.get(200) ?? 0)
const limited = byStatus.get(429) ?? 0
const failed = results.length - allowed - limited

process.stdout.write('\n')
process.stdout.write(`  elapsed            ${elapsed.toFixed(1)}s\n`)
process.stdout.write(`  reached the check  ${allowed}   (401/200 — the limiter let them through)\n`)
process.stdout.write(`  rate limited       ${limited}   (429 — rejected before any password was read)\n`)
if (failed > 0) process.stdout.write(`  other              ${failed}\n`)
for (const [status, count] of [...byStatus].sort((a, b) => b[1] - a[1])) {
  process.stdout.write(`      status ${status || 'network error'}: ${count}\n`)
}
process.stdout.write(`  latency p50/p95    ${percentile(latencies, 50).toFixed(0)}ms / ${percentile(latencies, 95).toFixed(0)}ms\n`)
process.stdout.write('\n')

if (limited > 0) {
  const share = ((limited / results.length) * 100).toFixed(0)
  process.stdout.write(
    `  ${share}% of these attempts were refused before their password was read.\n`
      + '  Everyone behind one public address shares that bucket, so a workforce answering\n'
      + '  from the corporate network is throttled together regardless of how much capacity\n'
      + '  the service has. Nothing downstream of sign-in was reached by those requests.\n',
  )
} else {
  process.stdout.write(`  No request was rate limited at ${people} from one address.\n`)
}
