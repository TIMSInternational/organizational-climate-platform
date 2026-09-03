/**
 * Rotate — or disable — the seeded role accounts, through the API.
 *
 *   CLIMATE_ADMIN_EMAIL=… CLIMATE_ADMIN_PASSWORD=… \
 *   node scripts/rotate-seeded-accounts.mjs --api <url> (--rotate | --disable) [--emails a,b,c] [--dry-run]
 *
 * ## Why
 *
 * docs/runbooks/cutover.md P14: five role accounts exist on production with one shared,
 * documented password, and the plan for them — "rotate them, or disable them and re-create
 * for UAT" — has had no owner and no tool. docs/decisions/seeded-accounts-rotation.md holds
 * the decision box. This is the tool; the decision is still Federico's.
 *
 * ## What it does, and through which endpoints
 *
 * - Signs in as the acting administrator (credentials from the ENVIRONMENT only — never a
 *   flag, so they cannot land in shell history) and reads `GET /profile` for its own id.
 * - Resolves each target email to a user id by walking `GET /admin/companies` →
 *   `GET /admin/users?companyId=…`. A company-less super_admin (production's shape, #191) is
 *   not listable that way; if it is the acting account it is resolved from /profile, otherwise
 *   it is reported UNRESOLVED and nothing is done to it.
 * - `--rotate`: `POST /auth/admin/reset-credentials {userId}` per account, which mints a
 *   12-character temporary password AND rotates the security stamp (every open session for
 *   that account ends now, not in 24 h — AuthEndpoints.cs, #284). The acting account, if it
 *   is a target, is rotated LAST because its token dies with it.
 * - `--disable`: `PUT /admin/users/{id} { isActive: false }`. Only a super_admin may flip an
 *   admin-role account (UserEndpoints.cs). The acting account is never disabled by this
 *   script — a script must not lock out the hand that runs it.
 *
 * The temporary passwords are printed ONCE to stdout and stored nowhere. Copy them into the
 * password manager before the terminal scrolls.
 *
 * ## The guard
 *
 * A host containing `awsapprunner.com` or `timsint.com` is production. The script refuses it
 * unless `--i-am-rotating-production` is also passed, and refuses BEFORE any request is made.
 * Local and staging hosts need no flag.
 */
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

export const DEFAULT_EMAILS = ['superadmin@nexadev.ai', 'companyadmin@nexadev.ai', 'leader@nexadev.ai', 'supervisor@nexadev.ai', 'employee@nexadev.ai']
const PRODUCTION_HOSTS = [/awsapprunner\.com$/i, /(^|\.)timsint\.com$/i]

const log = (line) => process.stdout.write(`${line}\n`)
const norm = (s) => (s ?? '').trim().toLowerCase()

class PreflightError extends Error { preflight = true }

export function isProductionHost(api) {
  let host
  try { host = new URL(api).hostname } catch { throw new PreflightError(`--api is not a URL: ${api}`) }
  return PRODUCTION_HOSTS.some((re) => re.test(host))
}

export function parseCli(argv) {
  return parseArgs({
    args: argv,
    options: {
      api: { type: 'string' },
      rotate: { type: 'boolean', default: false },
      disable: { type: 'boolean', default: false },
      emails: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'i-am-rotating-production': { type: 'boolean', default: false },
    },
  }).values
}

/** Everything that can be decided without a network call is decided here, first. */
export function preflight(values, env) {
  if (!values.api) throw new PreflightError('--api <url> is required')
  if (values.rotate === values.disable) throw new PreflightError('choose exactly one of --rotate or --disable')
  if (isProductionHost(values.api) && !values['i-am-rotating-production']) {
    throw new PreflightError(`${values.api} is a production host. This changes real passwords or locks real accounts. Re-run with --i-am-rotating-production if that is what you mean.`)
  }
  const email = env.CLIMATE_ADMIN_EMAIL
  const password = env.CLIMATE_ADMIN_PASSWORD
  if (!email || !password) throw new PreflightError('set CLIMATE_ADMIN_EMAIL and CLIMATE_ADMIN_PASSWORD in the environment (never as flags)')
  const targets = (values.emails ? values.emails.split(',') : DEFAULT_EMAILS).map(norm).filter(Boolean)
  if (targets.length === 0) throw new PreflightError('--emails resolved to an empty list')
  if (new Set(targets).size !== targets.length) throw new PreflightError('--emails contains a duplicate')
  return { api: values.api.replace(/\/$/, ''), email, password, targets, mode: values.rotate ? 'rotate' : 'disable', dryRun: values['dry-run'] }
}

async function call(api, path, init = {}, token) {
  const response = await fetch(`${api}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
  })
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = { raw: text.slice(0, 300) } }
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status} ${(body && body.message) || text.slice(0, 300)}`)
  return body
}

/** email → { id, role, companyId } for every user the acting admin can list, plus itself. */
export function indexUsers(profile, companiesWithUsers) {
  const byEmail = new Map()
  for (const { company, users } of companiesWithUsers) {
    for (const u of users) byEmail.set(norm(u.email), { id: u.id, role: u.role, companyId: company.id, isActive: u.isActive })
  }
  byEmail.set(norm(profile.email), { id: profile.id, role: profile.role, companyId: profile.companyId ?? null, isActive: true, self: true })
  return byEmail
}

/** Self last for --rotate (the token dies with it); self excluded for --disable. */
export function orderTargets(targets, byEmail, mode, selfEmail) {
  const resolved = []
  const unresolved = []
  for (const t of targets) {
    const hit = byEmail.get(t)
    if (!hit) { unresolved.push(t); continue }
    resolved.push({ email: t, ...hit })
  }
  const self = resolved.filter((r) => r.email === norm(selfEmail))
  const others = resolved.filter((r) => r.email !== norm(selfEmail))
  if (mode === 'disable') return { plan: others, unresolved, skippedSelf: self.map((s) => s.email) }
  return { plan: [...others, ...self], unresolved, skippedSelf: [] }
}

export async function run(values, env = process.env) {
  const cfg = preflight(values, env)
  const token = (await call(cfg.api, '/auth/login', { method: 'POST', body: JSON.stringify({ email: cfg.email, password: cfg.password }) })).token
  if (typeof token !== 'string' || token.length < 20) throw new Error('login answered without a token')
  const profile = await call(cfg.api, '/profile', {}, token)
  if (!profile || typeof profile.id !== 'string') throw new Error('GET /profile did not answer with an id')

  let companies = []
  if (profile.role === 'super_admin') companies = (await call(cfg.api, '/admin/companies', {}, token)).companies ?? []
  else if (profile.companyId) companies = [{ id: profile.companyId, name: profile.companyName ?? '' }]
  const companiesWithUsers = []
  for (const company of companies) {
    const users = (await call(cfg.api, `/admin/users?companyId=${encodeURIComponent(company.id)}`, {}, token)).users ?? []
    companiesWithUsers.push({ company, users })
  }
  const byEmail = indexUsers(profile, companiesWithUsers)
  const { plan, unresolved, skippedSelf } = orderTargets(cfg.targets, byEmail, cfg.mode, profile.email)

  log(`${cfg.mode} on ${cfg.api} as ${profile.email} (${profile.role}) — ${plan.length} account(s) planned, ${unresolved.length} unresolved`)
  for (const p of plan) log(`  ${p.email}  ${p.role}  ${p.id}${p.self ? '  (self — last)' : ''}${p.isActive === false ? '  (already inactive)' : ''}`)
  for (const u of unresolved) log(`  UNRESOLVED ${u} — not listable from this account (a company-less super_admin can only rotate itself: sign in as it)`)
  for (const s of skippedSelf) log(`  SKIPPED ${s} — this script never disables the account running it`)
  if (cfg.dryRun) { log('dry run: nothing changed'); return { ok: unresolved.length === 0, dryRun: true, plan, unresolved } }

  const results = []
  for (const p of plan) {
    if (cfg.mode === 'rotate') {
      const r = await call(cfg.api, '/auth/admin/reset-credentials', { method: 'POST', body: JSON.stringify({ userId: p.id }) }, token)
      if (!r || norm(r.email) !== p.email || typeof r.temporaryPassword !== 'string' || r.temporaryPassword.length < 8) {
        throw new Error(`reset-credentials for ${p.email} answered 2xx without the expected { email, temporaryPassword } (got ${JSON.stringify(r).slice(0, 120)})`)
      }
      results.push({ email: p.email, temporaryPassword: r.temporaryPassword })
    } else {
      const r = await call(cfg.api, `/admin/users/${p.id}`, { method: 'PUT', body: JSON.stringify({ isActive: false }) }, token)
      if (!r || r.isActive !== false) throw new Error(`disable for ${p.email} answered 2xx but isActive is ${r && r.isActive}`)
      results.push({ email: p.email, isActive: false })
    }
  }

  if (cfg.mode === 'rotate') {
    log('')
    log('TEMPORARY PASSWORDS — shown once, stored nowhere. Copy them now; every previous session of these accounts is already dead.')
    for (const r of results) log(`  ${r.email.padEnd(28)} ${r.temporaryPassword}`)
  } else {
    for (const r of results) log(`  disabled ${r.email}`)
  }
  return { ok: unresolved.length === 0, results, unresolved }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(parseCli(process.argv.slice(2))).then((r) => process.exit(r.ok ? 0 : 1), (e) => {
    log(`FAILED: ${e.message}`)
    process.exit(e.preflight ? 2 : 1)
  })
}
