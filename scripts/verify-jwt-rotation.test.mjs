// This script handles a production bearer token, and its whole job is to make a rotation's two
// phases distinguishable. So the tests cover two different kinds of guarantee:
//
//   SECURITY   the token must never reach stdout, stderr, or a command line. A credential printed
//              once is a credential in scrollback, in a paste, and in a transcript -- which is
//              exactly how the seeded production password ended up in three places on 2026-09-28.
//
//   MEANING    401 means opposite things in the two phases. After phase 1 it is a FAILURE (the
//              overlap did not reach the service and every session was signed out); after phase 2
//              it is the ONLY result that makes the rotation real. A script that prints a bare
//              status code leaves the reader to remember which, under pressure, a day apart.
//
// A stub HTTP server stands in for the API. Async spawn, not spawnSync: spawnSync would block the
// event loop this server runs on and the child would wait forever on a request that can never be
// served.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(REPO, 'scripts/verify-jwt-rotation.sh');

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.THIS-IS-THE-SECRET-TOKEN-VALUE.c2lnbmF0dXJl';
const COMMIT = '649fd077dab17f22d1bfd1bb1544aeda25fd1e70';

async function withStub(state, fn) {
  const server = createServer((req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url.startsWith('/version')) return send(200, { commit: COMMIT });
    if (req.url.startsWith('/auth/login')) {
      if (state.loginStatus && state.loginStatus !== 200) return send(state.loginStatus, { message: 'Invalid email or password' });
      return send(200, { token: TOKEN });
    }
    if (req.url.startsWith('/profile')) return send(state.profileStatus ?? 200, { id: 'u1' });
    return send(404, {});
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

function run(mode, { api, store, stdin } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [SCRIPT, mode], {
      cwd: REPO,
      env: { ...process.env, ...(api ? { API: api } : {}), ...(store ? { STORE: store } : {}) },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

const freshStore = () => join(mkdtempSync(join(tmpdir(), 'jwt-verify-')), 'token');

test('no mode prints usage and does nothing', async () => {
  const r = await run('');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage: .*capture\|check\|forget/);
});

test('capture stores the token and NEVER prints it', async () => {
  const store = freshStore();
  await withStub({}, async (api) => {
    const r = await run('capture', { api, store, stdin: 'companyadmin@nexadev.ai\ntest-password\n' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`Captured ${TOKEN.length} characters`));
    assert.match(r.stdout, new RegExp(`serving commit ${COMMIT.slice(0, 8)}`));
    // The guarantee. A credential printed once is a credential in scrollback and in a paste.
    assert.ok(!r.stdout.includes(TOKEN), 'the token leaked to stdout');
    assert.ok(!r.stderr.includes(TOKEN), 'the token leaked to stderr');
    assert.ok(!r.stdout.includes('test-password'), 'the password leaked to stdout');
  });
  assert.equal(readFileSync(store, 'utf8'), TOKEN, 'the token must be stored verbatim');
  assert.equal(statSync(store).mode & 0o777, 0o600, 'the store must be owner-only');
});

test('a failed login says wrong password, NOT a rotation problem', async () => {
  // Otherwise a 401 here reads as the rotation having broken something, when phase 1 has not
  // removed anything yet.
  const store = freshStore();
  await withStub({ loginStatus: 401 }, async (api) => {
    const r = await run('capture', { api, store, stdin: 'a@b.c\nwrong\n' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /wrong password, not a rotation problem/);
    assert.ok(!existsSync(store), 'nothing should be stored on a failed login');
  });
});

test('capture refuses an empty email or password instead of storing nothing useful', async () => {
  const store = freshStore();
  await withStub({}, async (api) => {
    const r = await run('capture', { api, store, stdin: '\n\n' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /both are required/);
  });
});

test('check without a captured token explains that the evidence cannot be recreated', async () => {
  // The trap this script exists for: after the phase-1 deploy takes traffic, a fresh login is
  // signed with the NEW key and proves nothing about whether the old one still works.
  const r = await run('check', { store: join(tmpdir(), 'definitely-not-here-' + Date.now()) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no captured token/);
  assert.match(r.stderr, /cannot be obtained again/);
});

test('200 is reported as the overlap being real, and says what phase 2 must show instead', async () => {
  const store = freshStore();
  writeFileSync(store, TOKEN, { mode: 0o600 });
  await withStub({ profileStatus: 200 }, async (api) => {
    const r = await run('check', { api, store });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /HTTP 200/);
    assert.match(r.stdout, /THE OVERLAP IS REAL/);
    assert.match(r.stdout, /correct result after PHASE 1/);
    assert.match(r.stdout, /After phase 2 it must read 401/);
    assert.ok(!r.stdout.includes(TOKEN), 'the token leaked');
  });
});

test('401 is reported as BOTH meanings, because it is the opposite verdict in each phase', async () => {
  const store = freshStore();
  writeFileSync(store, TOKEN, { mode: 0o600 });
  await withStub({ profileStatus: 401 }, async (api) => {
    const r = await run('check', { api, store });
    assert.match(r.stdout, /HTTP 401/);
    assert.match(r.stdout, /After PHASE 2 this is the result that makes the rotation real/);
    assert.match(r.stdout, /After PHASE 1 this is a FAILURE/);
    assert.match(r.stdout, /TRACKING_JWT_SECRET_PREVIOUS_ARN was set BEFORE the deploy/);
    assert.ok(!r.stdout.includes(TOKEN), 'the token leaked');
  });
});

test('anything other than 200 or 401 is reported as saying nothing about the keys', async () => {
  const store = freshStore();
  writeFileSync(store, TOKEN, { mode: 0o600 });
  await withStub({ profileStatus: 503 }, async (api) => {
    const r = await run('check', { api, store });
    assert.match(r.stdout, /HTTP 503/);
    assert.match(r.stdout, /says nothing about the keys/);
    assert.doesNotMatch(r.stdout, /OVERLAP IS REAL|makes the rotation real/);
  });
});

test('forget removes the stored token and is safe to run twice', async () => {
  const store = freshStore();
  writeFileSync(store, TOKEN, { mode: 0o600 });
  const first = await run('forget', { store });
  assert.equal(first.status, 0, first.stderr);
  assert.ok(!existsSync(store));
  assert.ok(!first.stdout.includes(TOKEN));
  const second = await run('forget', { store });
  assert.equal(second.status, 0, 'forget must be idempotent');
  assert.match(second.stdout, /Nothing stored/);
});
