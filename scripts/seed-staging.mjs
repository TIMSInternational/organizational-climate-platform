/**
 * Fill a STAGING environment with enough real data that UAT means something — and refuse,
 * loudly, to do it to production.
 *
 *   node scripts/seed-staging.mjs --api https://<staging-host> --email <admin> --password <pw>
 *   node scripts/seed-staging.mjs --api ... --dry-run          # check the target, seed nothing
 *
 * ## Why a wrapper rather than a third seed script
 *
 * `scripts/seed-surveys.mjs` already creates closed waves with real per-department scores and
 * the open survey, through the endpoints the UI calls, and it already takes `--api`. Writing a
 * second copy of that logic for staging would be two scripts to keep true about one product.
 * What staging actually needs that local does not is everything around the seeding:
 *
 *   1. **A refusal.** A seed pointed at production writes fabricated survey responses into a
 *      public institution's live system. The guard is not a hostname allowlist -- it ASKS the
 *      target what it is (`GET /version` -> `environment`) and refuses `Production`, so a new
 *      hostname, a custom domain or an alias cannot slip past a string match. The known
 *      production hosts are refused too, before any request, in case /version is unreachable.
 *   2. **A legible failure when the environment has no admin.** A freshly EF-migrated database
 *      has zero companies and zero users, and the product offers NO way to create the first
 *      one: `POST /auth/signup` resolves a company by email domain (404 on an empty database)
 *      and always mints `Roles.Employee`. That is step 8 of
 *      docs/runbooks/staging-provisioning.md, it is out-of-band SQL, and it must happen before
 *      this script can do anything. A 401 here means step 8, not a wrong password.
 *   3. **A privacy-floor report.** The floor is 5 respondents, applied at read time, and a
 *      segment under it yields no number anywhere. A staging environment whose every department
 *      is under 5 shows a tester nothing but hatching, and they would reasonably report the
 *      product as broken. A good UAT environment needs BOTH: departments above the floor, and
 *      at least one below it so suppression itself gets exercised.
 *
 * ## The tracking half is skipped unless asked for
 *
 * `scripts/seed-local.mjs` seeds the TRACKING module and needs a reachable tracking API. No
 * tracking service is deployed (P10 is three config values short), so it runs only when
 * `--tracking` is given rather than failing on a service that does not exist.
 */
import { parseArgs } from 'node:util'
import { spawn } from 'node:child_process'

const { values } = parseArgs({
  options: {
    api: { type: 'string' },
    email: { type: 'string' },
    password: { type: 'string' },
    /** Optional: seed the tracking module too. Omitted, the tracking half is skipped. */
    tracking: { type: 'string' },
    /** Check the target and report, seed nothing. */
    'dry-run': { type: 'boolean', default: false },
    marker: { type: 'string', default: '[seed-staging]' },
    /** Only for a non-production environment that /version cannot describe. Never for prod. */
    'i-know-what-this-is': { type: 'boolean', default: false },
  },
})

/** The floor, from the product's own rule. A segment under this yields no number anywhere. */
const PRIVACY_FLOOR = 5

/**
 * Hosts that are production, refused before any network call. The /version check below is the
 * real guard -- this list is what protects against /version being down at the wrong moment.
 */
const PRODUCTION_HOSTS = [
  'api.climate.timsint.com',
  'climate.timsint.com',
  'bhgrdkd4gt.us-east-1.awsapprunner.com',
]

const die = (message) => {
  console.error(`\nERROR: ${message}\n`)
  process.exit(1)
}

for (const required of ['api', 'email', 'password']) {
  if (!values[required]) die(`--${required} is required.\n\nusage: node scripts/seed-staging.mjs --api <url> --email <admin> --password <pw>`)
}

const API = values.api.replace(/\/$/, '')

async function json(url, init = {}, token) {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
  const body = await response.text()
  if (!response.ok) {
    const error = new Error(`${init.method ?? 'GET'} ${url} -> ${response.status} ${body.slice(0, 300)}`)
    error.status = response.status
    throw error
  }
  return body ? JSON.parse(body) : {}
}

// ---------------------------------------------------------------------------------------------
// 1. Refuse production. Twice, by two different means.
// ---------------------------------------------------------------------------------------------
const host = new URL(API).host
if (PRODUCTION_HOSTS.includes(host)) {
  die(`${host} is a PRODUCTION host. This script seeds fabricated survey responses; it must never run against the system a client uses.`)
}

console.log(`target   ${API}`)

let environment = null
try {
  const version = await json(`${API}/version`)
  environment = version.environment ?? null
  console.log(`version  commit ${String(version.commit).slice(0, 8)}  environment ${environment}`)
} catch (error) {
  console.log(`version  unreachable (${error.message.slice(0, 80)})`)
}

if (environment === 'Production') {
  die(`${API}/version reports environment "Production". Refusing.\nThe hostname did not match the known production list, which means that list is out of date -- add ${host} to PRODUCTION_HOSTS in this script.`)
}
if (environment === null && !values['i-know-what-this-is']) {
  die(`could not read ${API}/version, so this script cannot prove the target is not production.\nFix the endpoint, or pass --i-know-what-this-is if you are certain it is a throwaway environment.`)
}

// ---------------------------------------------------------------------------------------------
// 2. Prove there is an administrator, and say what to do when there is not.
// ---------------------------------------------------------------------------------------------
let adminToken
try {
  const login = await json(`${API}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ email: values.email, password: values.password }),
  })
  adminToken = login.token
  if (!adminToken) die(`${API}/auth/login returned 200 with no token.`)
} catch (error) {
  if (error.status === 401 || error.status === 404) {
    die(`${values.email} cannot sign in (${error.status}).

On a freshly migrated staging database this is EXPECTED and it is not a wrong password: the
database has zero companies and zero users, and the product cannot create the first one --
POST /auth/signup resolves a company by email domain (404 when there are none) and always mints
an Employee. The first administrator has to be made out of band.

Do docs/runbooks/staging-provisioning.md step 8 first, then re-run this.`)
  }
  throw error
}

const profile = await json(`${API}/profile`, {}, adminToken)
const companyId = profile.companyId
if (!companyId) die(`${values.email} has no company. Seed with a company_admin, not a super_admin without a company.`)
console.log(`admin    ${values.email}  company ${companyId}`)

// ---------------------------------------------------------------------------------------------
// 3. Seed, through the endpoints the UI calls.
// ---------------------------------------------------------------------------------------------
const runScript = (script, args) =>
  new Promise((resolve, reject) => {
    console.log(`\n--- node ${script} ---`)
    const child = spawn(process.execPath, [script, ...args], { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`))))
  })

const credentials = ['--api', API, '--email', values.email, '--password', values.password]

if (values['dry-run']) {
  console.log('\nDRY RUN: the target is checked and is not production. Nothing was seeded.')
} else {
  await runScript('scripts/seed-surveys.mjs', credentials)
  if (values.tracking) {
    await runScript('scripts/seed-local.mjs', [...credentials, '--tracking', values.tracking, '--marker', values.marker])
  } else {
    console.log('\n--- skipping scripts/seed-local.mjs: no --tracking given, and no tracking service is deployed (P10) ---')
  }
}

// ---------------------------------------------------------------------------------------------
// 4. The privacy floor, which decides whether a tester sees anything at all.
// ---------------------------------------------------------------------------------------------
const { departments } = await json(`${API}/admin/departments?companyId=${companyId}`, {}, adminToken)
const { users } = await json(`${API}/admin/users?companyId=${companyId}`, {}, adminToken)

const byDepartment = new Map()
for (const d of departments ?? []) byDepartment.set(d.id, { name: d.name, members: 0 })
for (const u of users ?? []) {
  const entry = byDepartment.get(u.departmentId)
  if (entry) entry.members += 1
}

console.log(`\n--- the privacy floor is ${PRIVACY_FLOOR} respondents, applied at read time ---`)
let above = 0
let below = 0
for (const { name, members } of [...byDepartment.values()].sort((a, b) => b.members - a.members)) {
  const verdict = members >= PRIVACY_FLOOR ? 'reports numbers' : 'SUPPRESSED on every screen'
  console.log(`  ${String(members).padStart(3)} members  ${name.padEnd(28)} ${verdict}`)
  if (members >= PRIVACY_FLOOR) above += 1
  else below += 1
}

console.log()
if (above === 0) {
  die(`no department reaches ${PRIVACY_FLOOR} members, so every segment on every screen will be suppressed.
A tester would see hatching everywhere and reasonably report the product as broken. Add members
and re-run, or the UAT script (#161) is being run against an environment that cannot show a number.`)
}
console.log(`${above} department(s) will report numbers and ${below} will be suppressed.`)
if (below === 0) {
  console.log(`\nNOTE: nothing is under the floor, so UAT will never exercise suppression. That is the
behaviour a client is most likely to query ("why is this empty?"), and it is worth having one
small department so a tester sees it deliberately rather than in production.`)
}
console.log('\nDone.')
