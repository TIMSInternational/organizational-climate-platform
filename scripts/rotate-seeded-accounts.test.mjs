/**
 * The rotation script's guard, argument handling and ordering — pure functions, no network.
 * `node --test scripts/`. The live proof (rotate then sign in with the new password; disable
 * then be refused) is recorded in the PR body, not here, because it needs a running API.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isProductionHost, preflight, parseCli, indexUsers, orderTargets, DEFAULT_EMAILS } from './rotate-seeded-accounts.mjs'

const env = { CLIMATE_ADMIN_EMAIL: 'fede.super@acme.test', CLIMATE_ADMIN_PASSWORD: 'x' }

test('production hosts are recognised; local and staging are not', () => {
  assert.equal(isProductionHost('https://bhgrdkd4gt.us-east-1.awsapprunner.com'), true)
  assert.equal(isProductionHost('https://climate.timsint.com'), true)
  assert.equal(isProductionHost('https://api.timsint.com/'), true)
  assert.equal(isProductionHost('http://localhost:5080'), false)
  assert.equal(isProductionHost('http://127.0.0.1:5130'), false)
  assert.equal(isProductionHost('https://climate-staging.example.com'), false)
  assert.throws(() => isProductionHost('not a url'), /not a URL/)
})

test('a production host is refused before any request unless the override is passed', () => {
  const values = parseCli(['--api', 'https://bhgrdkd4gt.us-east-1.awsapprunner.com', '--rotate'])
  assert.throws(() => preflight(values, env), (e) => e.preflight === true && /production host/.test(e.message))
  const overridden = parseCli(['--api', 'https://bhgrdkd4gt.us-east-1.awsapprunner.com', '--rotate', '--i-am-rotating-production'])
  assert.equal(preflight(overridden, env).mode, 'rotate')
})

test('exactly one mode, credentials from the environment only, no duplicate emails', () => {
  assert.throws(() => preflight(parseCli(['--api', 'http://localhost:5080']), env), /exactly one of/)
  assert.throws(() => preflight(parseCli(['--api', 'http://localhost:5080', '--rotate', '--disable']), env), /exactly one of/)
  assert.throws(() => preflight(parseCli(['--api', 'http://localhost:5080', '--rotate']), {}), /CLIMATE_ADMIN_EMAIL/)
  assert.throws(() => preflight(parseCli(['--api', 'http://localhost:5080', '--rotate', '--emails', 'a@x.test,A@x.test']), env), /duplicate/)
  assert.throws(() => parseCli(['--api', 'http://localhost:5080', '--rotate', '--password', 'p']), /Unknown option/)
  const cfg = preflight(parseCli(['--api', 'http://localhost:5080/', '--disable']), env)
  assert.equal(cfg.api, 'http://localhost:5080')
  assert.deepEqual(cfg.targets, DEFAULT_EMAILS)
  assert.equal(cfg.mode, 'disable')
})

const profile = { id: 'self-id', email: 'fede.super@acme.test', role: 'super_admin', companyId: null }
const listed = [{ company: { id: 'acme' }, users: [
  { id: 'u1', email: 'Leader@acme.test', role: 'leader', isActive: true },
  { id: 'u2', email: 'employee@acme.test', role: 'employee', isActive: false },
] }]

test('emails resolve case-insensitively; the acting account resolves from its profile', () => {
  const byEmail = indexUsers(profile, listed)
  assert.equal(byEmail.get('leader@acme.test').id, 'u1')
  assert.equal(byEmail.get('fede.super@acme.test').self, true)
  assert.equal(byEmail.has('nobody@acme.test'), false)
})

test('--rotate puts the acting account LAST; --disable never includes it; unknown emails are reported not guessed', () => {
  const byEmail = indexUsers(profile, listed)
  const rotate = orderTargets(['fede.super@acme.test', 'leader@acme.test', 'ghost@acme.test'], byEmail, 'rotate', profile.email)
  assert.deepEqual(rotate.plan.map((p) => p.email), ['leader@acme.test', 'fede.super@acme.test'])
  assert.deepEqual(rotate.unresolved, ['ghost@acme.test'])
  const disable = orderTargets(['fede.super@acme.test', 'leader@acme.test'], byEmail, 'disable', profile.email)
  assert.deepEqual(disable.plan.map((p) => p.email), ['leader@acme.test'])
  assert.deepEqual(disable.skippedSelf, ['fede.super@acme.test'])
})
