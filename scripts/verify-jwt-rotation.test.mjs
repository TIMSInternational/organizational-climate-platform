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
    if (req.url.startsWith('/version')) return send(200, { commit: state.commit ?? COMMIT });
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

/** A gh that reports TRACKING_JWT_SECRET_PREVIOUS_ARN as set or cleared, so `check` can tell
 *  phase 1 from phase 2 without the reader having to remember which they are in. */
function ghStub(prevArn) {
  const dir = mkdtempSync(join(tmpdir(), 'gh-stub-'));
  const body = JSON.stringify([{ name: 'TRACKING_JWT_SECRET_PREVIOUS_ARN', value: prevArn }]);
  writeFileSync(join(dir, 'gh'), `#!/usr/bin/env bash\nprintf '%s' ${JSON.stringify(body)} | jq -r '.[]|select(.name=="TRACKING_JWT_SECRET_PREVIOUS_ARN").value'\n`, { mode: 0o755 });
  return dir;
}

/** An aws that answers the three read-only calls `config` makes. */
function awsStub(hasPrevious, account = '747814092517') {
  const dir = mkdtempSync(join(tmpdir(), 'aws-stub-'));
  const secrets = hasPrevious
    ? '{"TrackingJwtSecretArn":"a","DatabaseConnectionStringSecretArn":"b","InternalApiKeySecretArn":"c","EmailSmtpUsernameSecretArn":"d","EmailSmtpPasswordSecretArn":"e","TrackingJwtSecretPrevious":"f"}'
    : '{"TrackingJwtSecretArn":"a","DatabaseConnectionStringSecretArn":"b","InternalApiKeySecretArn":"c","EmailSmtpUsernameSecretArn":"d","EmailSmtpPasswordSecretArn":"e"}';
  writeFileSync(join(dir, 'aws'), [
    '#!/usr/bin/env bash',
    'printf \'%s\\n\' "aws $*" >> "${STUB_LOG:-/dev/null}"',
    'case "$*" in',
    `  *"sts get-caller-identity"*) printf '%s\\n' '${account}' ;;`,
    "  *ServiceArn*) printf '%s\\n' 'arn:aws:apprunner:us-east-1:747814092517:service/climate-project-api-prod/126c3f28' ;;",
    `  *"apprunner describe-service"*) printf '%s\\n' '${secrets}' ;;`,
    'esac',
    'exit 0',
  ].join('\n'), { mode: 0o755 });
  return dir;
}

function run(mode, { api, store, stdin, baseline, ghDir } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [SCRIPT, mode], {
      cwd: REPO,
      env: {
        ...process.env,
        ...(api ? { API: api } : {}),
        ...(store ? { STORE: store } : {}),
        ...(baseline ? { BASELINE: baseline } : {}),
        ...(ghDir ? { PATH: `${ghDir}:${process.env.PATH}` } : {}),
      },
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
  assert.match(r.stderr, /usage: .*capture\|check\|config\|forget/);
  assert.match(r.stderr, /config\s+ask the RUNNING service/, 'the new mode must be documented in the usage');
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
  // The baseline is what lets `check` refuse to interpret a status code before the deploy lands.
  assert.equal(readFileSync(`${store}.commit`, 'utf8'), COMMIT.slice(0, 8), 'the serving commit must be recorded');
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

/** A captured token plus a baseline commit, ready for `check`. */
function stored(baselineCommit) {
  const store = freshStore();
  writeFileSync(store, TOKEN, { mode: 0o600 });
  const baseline = `${store}.commit`;
  if (baselineCommit) writeFileSync(baseline, baselineCommit, { mode: 0o600 });
  return { store, baseline };
}

test('THE GATE: while the deploy has not landed, no status code is interpreted', async () => {
  // 2026-09-28, for real: `check` printed "THE OVERLAP IS REAL" on a 200 that came from the
  // PRE-rotation revision, because the deploy was still on step 5 of 15. That revision signs AND
  // validates with the old key, so its 200 only proves it accepts its own tokens.
  const { store, baseline } = stored(COMMIT.slice(0, 8));
  await withStub({ commit: COMMIT, profileStatus: 200 }, async (api) => {
    const r = await run('check', { api, store, baseline });
    assert.equal(r.status, 3, 'inconclusive must not share an exit code with a verdict');
    assert.match(r.stdout, /INCONCLUSIVE/);
    assert.match(r.stdout, /still serving 649fd077 -- the same revision that minted this token/);
    assert.doesNotMatch(r.stdout, /OVERLAP IS REAL|ROTATION IS REAL/, 'it must not claim anything');
  });
});

test('once the revision has moved, a 200 with the previous key SET is the overlap working', async () => {
  const { store, baseline } = stored('649fd077');
  const ghDir = ghStub('arn:aws:secretsmanager:us-east-1:000000000000:secret:jwt-previous-test-fixture');
  await withStub({ commit: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555', profileStatus: 200 }, async (api) => {
    const r = await run('check', { api, store, baseline, ghDir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /revision moved 649fd077 -> aaaa1111/);
    assert.match(r.stdout, /is set, so this is PHASE 1/);
    assert.match(r.stdout, /THE OVERLAP IS REAL/);
    assert.match(r.stdout, /Phase 1 is correct and complete/);
    assert.ok(!r.stdout.includes(TOKEN));
  });
});

test('a 200 with the previous key CLEARED is a FAILURE, not a success', async () => {
  // Phase 2 removed the previous key and the old token still works: the value rotated away from
  // is still accepted, so the rotation bought nothing. The old wording called 200 "correct".
  const { store, baseline } = stored('649fd077');
  const ghDir = ghStub('');
  await withStub({ commit: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555', profileStatus: 200 }, async (api) => {
    const r = await run('check', { api, store, baseline, ghDir });
    assert.match(r.stdout, /is cleared, so this is PHASE 2/);
    assert.match(r.stdout, /FAILURE/);
    assert.match(r.stdout, /still accepted and the rotation has bought\nnothing/);
    assert.doesNotMatch(r.stdout, /THE OVERLAP IS REAL/);
  });
});

test('a 401 with the previous key CLEARED is the rotation being real', async () => {
  const { store, baseline } = stored('649fd077');
  const ghDir = ghStub('');
  await withStub({ commit: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555', profileStatus: 401 }, async (api) => {
    const r = await run('check', { api, store, baseline, ghDir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /THE ROTATION IS REAL/);
    assert.match(r.stdout, /rotation-inventory\.md/, 'it should say where to record it');
  });
});

test('a 401 with the previous key SET means everyone was signed out', async () => {
  const { store, baseline } = stored('649fd077');
  const ghDir = ghStub('arn:aws:secretsmanager:us-east-1:000000000000:secret:jwt-previous-test-fixture');
  await withStub({ commit: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555', profileStatus: 401 }, async (api) => {
    const r = await run('check', { api, store, baseline, ghDir });
    assert.match(r.stdout, /FAILURE/);
    assert.match(r.stdout, /every existing session has\nbeen signed out/);
    assert.match(r.stdout, /set BEFORE the deploy/);
    assert.doesNotMatch(r.stdout, /THE ROTATION IS REAL/);
  });
});

test('anything other than 200 or 401 is reported as saying nothing about the keys', async () => {
  const { store, baseline } = stored('649fd077');
  await withStub({ commit: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555', profileStatus: 503 }, async (api) => {
    const r = await run('check', { api, store, baseline });
    assert.match(r.stdout, /HTTP 503/);
    assert.match(r.stdout, /says nothing about the keys/);
    assert.doesNotMatch(r.stdout, /OVERLAP IS REAL|ROTATION IS REAL/);
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

test('config: a service that still holds a previous key says so, and exits 2', async () => {
  // Correct during the overlap. After phase 2 and its deploy, it means the rotation has not taken.
  const dir = awsStub(true);
  const r = await run('config', { ghDir: dir });
  assert.equal(r.status, 2, 'a "not done yet" answer must not share an exit code with success');
  assert.match(r.stdout, /TrackingJwtSecretPrevious:\s+PRESENT/);
  assert.match(r.stdout, /THE OLD KEY IS STILL LOADED/);
});

test('config: with no previous key it reports the structural proof AND its limit', async () => {
  // This is the proof that survives `forget`. It must not overclaim: absence of the key is not
  // the same as a request being rejected.
  const dir = awsStub(false);
  const r = await run('config', { ghDir: dir });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /TrackingJwtSecretPrevious:\s+ABSENT/);
  assert.match(r.stdout, /THE OLD KEY IS NOT LOADED/);
  assert.match(r.stdout, /not the same as a rejected request/, 'it must state what it does not prove');
  assert.match(r.stdout, /TrackingJwtRotationTests\.cs/, 'and point at what closes the gap');
});

test('config: the wrong account is refused, not answered', async () => {
  const dir = awsStub(false, '795965600143');
  const r = await run('config', { ghDir: dir });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /credentials are for account 795965600143/);
  assert.doesNotMatch(r.stdout, /OLD KEY IS NOT LOADED/);
});
