// What this defends: a seed script writes fabricated survey responses, and the environment it is
// pointed at is a command-line argument. Pointed at production it would put invented employee
// answers into a public institution's live system, and the screens built on them would then be
// "verified" against a fiction -- the exact failure docs/runbooks and CLAUDE.md warn about for
// SQL seeding, except worse, because it would be through the real endpoints and therefore valid.
//
// The refusal is tested two ways, because it is guarded two ways: a hostname list that fires
// before any network call, and asking the target what it is (`/version` -> environment).
//
// It also defends the two things that make a staging seed useful rather than merely finished: a
// 401 must explain that a fresh database has no administrator and cannot make one (step 8 of the
// provisioning runbook), and a seeded environment where every department is under the privacy
// floor of 5 must FAIL, because a tester would see nothing but hatching and reasonably report the
// product as broken.
//
// A stub HTTP server stands in for the API. No real environment is contacted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(REPO, 'scripts/seed-staging.mjs');

/**
 * A stand-in API. `state` decides what it answers, and `hits` records every path it was asked
 * for, so a test can assert a refusal happened BEFORE any request.
 */
async function withStub(state, fn) {
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(req.url.split('?')[0]);
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url.startsWith('/version')) {
      if (state.versionFails) return send(503, { message: 'nope' });
      return send(200, { commit: 'abcdef1234567890', environment: state.environment ?? 'Staging' });
    }
    if (req.url.startsWith('/auth/login')) {
      if (state.loginStatus && state.loginStatus !== 200) return send(state.loginStatus, { message: 'no' });
      return send(200, { token: 'stub-token' });
    }
    if (req.url.startsWith('/profile')) return send(200, { companyId: state.companyId ?? 'company-1' });
    if (req.url.startsWith('/admin/departments')) return send(200, { departments: state.departments ?? [] });
    if (req.url.startsWith('/admin/users')) return send(200, { users: state.users ?? [] });
    return send(404, { message: 'unknown' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`, hits);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

function run(api, extra = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      SCRIPT, '--api', api, '--email', 'admin@timsint.com', '--password', 'pw', '--dry-run', ...extra,
    ], { cwd: REPO });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

/** Five members in one department, three in another: above the floor and below it. */
const MIXED = {
  departments: [{ id: 'd1', name: 'Operaciones' }, { id: 'd2', name: 'Finanzas' }],
  users: [
    ...Array.from({ length: 6 }, (_, i) => ({ id: `u${i}`, departmentId: 'd1' })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: `f${i}`, departmentId: 'd2' })),
  ],
};

test('a known production hostname is refused before a single request is made', async () => {
  // No stub: if it tried to resolve or call anything, this would hang or throw rather than exit 1.
  const r = await run('https://api.climate.timsint.com');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /is a PRODUCTION host/);
  assert.doesNotMatch(r.stdout, /version/, 'it must not even ask');
});

test('the web origin is refused too, not just the API host', async () => {
  const r = await run('https://climate.timsint.com');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /is a PRODUCTION host/);
});

test('a host not on the list is still refused when /version says Production', async () => {
  // The real guard: a new hostname, a custom domain or an alias cannot slip past a string match.
  await withStub({ environment: 'Production' }, async (api, hits) => {
    const r = await run(api);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /reports environment "Production"\. Refusing/);
    assert.match(r.stderr, /add .* to PRODUCTION_HOSTS/, 'it should say the list is out of date');
    assert.ok(hits.includes('/version'), 'it asked');
    assert.ok(!hits.includes('/auth/login'), 'it stopped before authenticating');
  });
});

test('an unreadable /version refuses rather than assuming the target is safe', async () => {
  await withStub({ versionFails: true }, async (api) => {
    const r = await run(api);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /cannot prove the target is not production/);
  });
});

test('--i-know-what-this-is allows an undescribable target, but nothing overrides a Production answer', async () => {
  await withStub({ versionFails: true, ...MIXED }, async (api) => {
    const allowed = await run(api, ['--i-know-what-this-is']);
    assert.equal(allowed.status, 0, allowed.stderr);
  });
  await withStub({ environment: 'Production' }, async (api) => {
    const refused = await run(api, ['--i-know-what-this-is']);
    assert.equal(refused.status, 1, 'no flag may override an explicit Production answer');
    assert.match(refused.stderr, /Refusing/);
  });
});

test('a 401 explains that a fresh database has no administrator and cannot make one', async () => {
  // Otherwise this reads as a wrong password, and the actual cause -- signup resolves a company
  // by email domain and always mints an Employee -- is invisible.
  await withStub({ loginStatus: 401 }, async (api) => {
    const r = await run(api);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /cannot sign in \(401\)/);
    assert.match(r.stderr, /zero companies and zero users/);
    assert.match(r.stderr, /staging-provisioning\.md step 8/);
  });
});

test('THE UAT GUARD: every department under the floor is a failure, not a pass', async () => {
  // A tester looking at nothing but hatching would reasonably report the product as broken.
  await withStub({
    departments: [{ id: 'd1', name: 'Finanzas' }],
    users: Array.from({ length: 4 }, (_, i) => ({ id: `u${i}`, departmentId: 'd1' })),
  }, async (api) => {
    const r = await run(api);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no department reaches 5 members/);
    assert.match(r.stderr, /every segment on every screen will be suppressed/);
  });
});

test('a mix of above and below the floor passes, and reports both', async () => {
  await withStub(MIXED, async (api) => {
    const r = await run(api);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /6 members\s+Operaciones\s+reports numbers/);
    assert.match(r.stdout, /3 members\s+Finanzas\s+SUPPRESSED on every screen/);
    assert.match(r.stdout, /1 department\(s\) will report numbers and 1 will be suppressed/);
  });
});

test('an environment with nothing under the floor says so, because suppression then goes untested', async () => {
  await withStub({
    departments: [{ id: 'd1', name: 'Operaciones' }],
    users: Array.from({ length: 7 }, (_, i) => ({ id: `u${i}`, departmentId: 'd1' })),
  }, async (api) => {
    const r = await run(api);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /UAT will never exercise suppression/);
  });
});

test('a dry run seeds nothing', async () => {
  await withStub(MIXED, async (api, hits) => {
    const r = await run(api);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /DRY RUN: the target is checked and is not production\. Nothing was seeded/);
    assert.ok(!hits.some((h) => h.startsWith('/surveys')), 'no survey was created');
  });
});
