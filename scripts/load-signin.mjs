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
 * ## Two different measurements, and the flag that picks between them
 *
 * By default every attempt uses an address nobody holds. `/auth/login` answers an unknown
 * identifier at `AuthEndpoints.cs:69` — **before** `passwordHasher.Verify` — so those
 * requests never pay for a bcrypt and come back in milliseconds. That measures the LIMITER,
 * which is what this tool was written for, and it is the right default.
 *
 * It does not measure capacity. To do that, pass `--email` with the address of an account
 * that really exists: a wrong password for a KNOWN user runs the full work-factor-12 verify
 * (~0.27 vCPU-seconds) and then returns 401, which is the same work a successful sign-in
 * does. Nothing is written — `LastLoginAt` is set only after a verify succeeds — no session
 * is created, and there is no account lockout to trip (`RateLimitPolicies`: *"It is a rate
 * limit, not an account lockout"*), so the same address can be used as many times as the
 * limiter allows.
 *
 *   node scripts/load-signin.mjs --people 300 --email you@example.com \
 *     --api https://api.climate.timsint.com --confirm-production-load-test
 *
 * ## Why the target is refused by default
 *
 * `--api` must be a localhost origin unless `--confirm-production-load-test` is passed.
 * A few hundred sign-in attempts at a deployed environment is a denial-of-service against
 * real respondents. The flag exists because the measurement is sometimes genuinely needed
 * and localhost cannot give it — a laptop is not a 1 vCPU App Runner instance — but it is
 * deliberately long, it is never implied by anything else, and the tool prints what it is
 * about to do before it does it. Check that nobody is answering first: App Runner's
 * `Requests` metric in CloudWatch, which costs nothing and reads no one's data.
 */

import { parseArgs } from 'node:util'
import { writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'

const { values } = parseArgs({
  options: {
    api: { type: 'string', default: 'http://localhost:5000' },
    people: { type: 'string', default: '300' },
    identifier: { type: 'string', default: 'carga' },
    // An address that really exists, so every attempt pays a full bcrypt verify. See the
    // header: without it the unknown-user short-circuit means no hash is ever computed.
    email: { type: 'string' },
    rate: { type: 'string', default: '0' },
    output: { type: 'string' },
    'confirm-production-load-test': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
})

if (values.help) {
  process.stdout.write(
    'usage: node scripts/load-signin.mjs [--api URL] [--people 300] [--email ADDRESS]\n'
      + '                                   [--confirm-production-load-test] [--rate requests/sec] [--output results.json]\n'
      + '\n'
      + '  Fires N concurrent POST /auth/login and tallies the answers. No valid credentials\n'
      + '  are used and nothing is written: 401 means the limiter let the request through to\n'
      + '  the password check, 429 means it did not.\n'
      + '\n'
      + '  --email ADDRESS   use an account that EXISTS, so each attempt pays a full bcrypt\n'
      + '                    verify. Without it an unknown identifier short-circuits before\n'
      + '                    the hash, which measures the limiter but not capacity.\n'
      + '  --confirm-production-load-test\n'
      + '                    allow a non-localhost --api. Check nobody is answering first.\n',
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
const local = host === 'localhost' || host === '127.0.0.1' || host === '::1'
if (!local && !values['confirm-production-load-test']) {
  process.stderr.write(`load-signin: refusing to point ${values.people} sign-in attempts at ${api}.\n`)
  process.stderr.write('load-signin: --api must be localhost. Production is collecting for a live client.\n')
  process.stderr.write('load-signin: pass --confirm-production-load-test if you have checked that nobody is answering.\n')
  process.exit(2)
}

const people = Number(values.people)
const rate = Number(values.rate)
if (!Number.isSafeInteger(people) || people < 1 || people > 10000) {
  process.stderr.write(`load-signin: --people must be a positive number, got ${values.people}\n`)
  process.exit(2)
}

if (!Number.isFinite(rate) || rate < 0 || rate > 1000) {
  process.stderr.write('load-signin: --rate must be requests/second between 0 (burst) and 1000\n')
  process.exit(2)
}

/** One attempt: the status the server gave and how long it took. */
async function attempt(index) {
  const started = performance.now()
  try {
    const response = await fetch(`${api}/auth/login`, {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      // The password is deliberately wrong in both modes: a real one would create a session
      // and prove nothing extra. What `--email` changes is whether the IDENTIFIER is one the
      // server can find, and therefore whether it reaches the bcrypt verify at all.
      body: JSON.stringify({
        email: values.email ?? `${values.identifier}-${index}@carga.test`,
        password: 'not-a-password',
      }),
    })
    await response.arrayBuffer()
    return { status: response.status, ms: performance.now() - started, retryAfter: response.headers.get('retry-after'), offsetMs: Date.now() - startedAt }
  } catch (error) {
    return { status: 0, ms: performance.now() - started, error: String(error?.message ?? error) }
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  const at = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[at]
}

const measuresCapacity = values.email !== undefined

const startedAt = Date.now()
const started = startedAt
process.stdout.write(`load-signin: ${people} sign-in attempts (${rate > 0 ? `${rate}/second` : 'burst'}) at ${api}\n`)
process.stdout.write(
  measuresCapacity
    ? `load-signin: as ${values.email} with a wrong password — each attempt pays a full bcrypt verify\n`
    : 'load-signin: as addresses nobody holds — measures the limiter, NOT capacity (see --email)\n',
)
if (!local) {
  process.stdout.write('load-signin: this target is NOT local. Nothing is written and no session is created.\n')
}

// All at once, from one address, which is the case being measured: an email blast lands and
// everyone opens it together.
const pending = []
for (let index = 0; index < people; index++) {
  if (rate > 0) {
    const delay = startedAt + index * 1000 / rate - Date.now()
    if (delay > 0) await sleep(delay)
  }
  pending.push(attempt(index))
  if (rate > 0 && index > 0 && index % 100 === 0) process.stdout.write(`  dispatched ${index}/${people}\n`)
}
const results = await Promise.all(pending)
const elapsed = (Date.now() - started) / 1000

const byStatus = new Map()
for (const result of results) byStatus.set(result.status, (byStatus.get(result.status) ?? 0) + 1)
const latencies = results.map((r) => r.ms).sort((a, b) => a - b)

const allowed = (byStatus.get(401) ?? 0) + (byStatus.get(200) ?? 0)
const limited = byStatus.get(429) ?? 0
const failed = results.length - allowed - limited

process.stdout.write('\n')
process.stdout.write(`  elapsed            ${elapsed.toFixed(1)}s\n`)
process.stdout.write(`  reached the check  ${allowed}   (401/200 responses; no successful-login assertion)\n`)
process.stdout.write(`  rate limited       ${limited}   (429 — throttled; source requires server evidence)\n`)
if (failed > 0) process.stdout.write(`  other              ${failed}\n`)
for (const [status, count] of [...byStatus].sort((a, b) => b[1] - a[1])) {
  process.stdout.write(`      status ${status || 'network error'}: ${count}\n`)
}
process.stdout.write(`  latency p50/p95    ${percentile(latencies, 50).toFixed(0)}ms / ${percentile(latencies, 95).toFixed(0)}ms\n`)
process.stdout.write('\n')

if (measuresCapacity && allowed > 0) {
  // Only when something actually got through. A throughput line computed over zero verifies
  // reads as "0 sign-ins a second", which is a capacity claim about a run that never reached
  // the service -- the tally above already says the requests failed, and this would argue
  // with it.
  //
  // The useful reading. Every 401 here cost a work-factor-12 verify, so the wall clock over
  // the attempts that got through is the service's real throughput for a sign-in, and the
  // p95 is what the slowest person in the burst waited.
  const perSecond = elapsed > 0 ? allowed / elapsed : 0
  process.stdout.write(
    `  throughput         ${perSecond.toFixed(1)} password checks/second (${(perSecond * 60).toFixed(0)}/minute)\n`,
  )
  process.stdout.write(
    '  A known account exercises password verification; no successful login or survey write is tested.\n',
  )
  process.stdout.write('\n')
}

if (limited > 0) {
  const share = ((limited / results.length) * 100).toFixed(0)
  process.stdout.write(
    `  ${share}% of these attempts were throttled.\n`
      + '  These requests did not complete sign-in. Correlate response headers, application\n'
      + '  rejection logs, and App Runner metrics before attributing the throttles.\n',
  )
} else {
  process.stdout.write(`  No request was rate limited at ${people} from one address.\n`)
}

if (values.output) {
  const group = (status) => results.filter(r => r.status === status).map(r => r.ms).sort((a,b) => a-b)
  const summary = (samples) => ({ count: samples.length, p50Ms: percentile(samples,50), p95Ms: percentile(samples,95), maxMs: samples.at(-1) ?? 0 })
  await writeFile(values.output, JSON.stringify({ startedAt: new Date(startedAt).toISOString(), api, people, ratePerSecond: rate, mode: measuresCapacity ? 'known-account-wrong-password' : 'unknown-account', elapsedSeconds: elapsed, byStatus: Object.fromEntries(byStatus), allLatency: summary(latencies), passwordCheckLatency: summary([...group(401), ...group(200)].sort((a,b)=>a-b)), throttledLatency: summary(group(429)), results }, null, 2) + '\n')
}
