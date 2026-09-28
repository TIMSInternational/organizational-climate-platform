// Phase 2 of the rotation is destructive in a specific way: it stops the old key working, so
// running it before every old-key token has expired signs those sessions out. That is the one harm
// the two-phase design exists to prevent, which makes "wait 24 hours" a guard rather than advice.
//
// It was advice until 2026-09-28, when phase 2 was attempted FOUR MINUTES after phase 1. It was
// stopped by the account preflight -- the shell had lost AWS_PROFILE -- which is luck, not design.
// Nothing in the script knew it was 23 hours early.
//
// These tests drive the real script against a stubbed aws, gh and openssl: no account, no
// credentials, no writes. They assert on the argv it would have sent, and above all that a refusal
// happens BEFORE anything destructive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(REPO, 'scripts/rotate-tracking-jwt.sh');
const ACCOUNT = '747814092517';

const AWS_STUB = `#!/usr/bin/env bash
printf '%s\\n' "aws $*" >> "$STUB_LOG"
args="$*"
case "$args" in
  *"sts get-caller-identity"*) printf '%s\\n' "$STUB_ACCOUNT" ;;
  *"describe-secret"*-previous*CreatedDate*) printf '%s\\n' "$STUB_PREVIOUS_CREATED" ;;
  *"describe-secret"*-previous*)
      # Absent when phase 1 has not run. Phase 1 uses this to decide create vs put.
      [ "$STUB_NO_PREVIOUS" = "1" ] && exit 254
      printf '{}\\n' ;;
  *"describe-secret"*) printf '{}\\n' ;;
  *"get-secret-value"*) printf 'OLD-SECRET-VALUE\\n' ;;
  *) printf '{}\\n' ;;
esac
exit 0
`;

const GH_STUB = `#!/usr/bin/env bash
printf '%s\\n' "gh $*" >> "$STUB_LOG"
exit 0
`;

function run(args, { env = {}, stdin = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rotate-jwt-'));
  const log = join(dir, 'calls.log');
  writeFileSync(log, '');
  for (const [name, body] of [['aws', AWS_STUB], ['gh', GH_STUB]]) {
    writeFileSync(join(dir, name), body);
    chmodSync(join(dir, name), 0o755);
  }
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [SCRIPT, ...args], {
      cwd: REPO,
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        STUB_LOG: log,
        STUB_ACCOUNT: ACCOUNT,
        STUB_PREVIOUS_CREATED: hoursAgo(1),
        STUB_NO_PREVIOUS: '0',
        ...env,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr, calls: readFileSync(log, 'utf8') }));
    child.stdin.end(stdin);
  });
}

const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString().replace('Z', '+00:00');

/** Nothing in this list may run before the wait and the confirmation are both satisfied. */
const DESTRUCTIVE = /delete-secret|put-secret-value|gh variable set/;

test('plan writes nothing, in either phase', async () => {
  for (const phase of ['open', 'close']) {
    const r = await run(['plan', phase]);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.calls, DESTRUCTIVE, `plan ${phase} must not write`);
    assert.match(r.stdout, /would/i);
  }
});

test('the wrong account is refused before anything is read or written', async () => {
  const r = await run(['apply', 'close'], { env: { STUB_ACCOUNT: '795965600143' } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /credentials are for account 795965600143, not 747814092517/);
  assert.doesNotMatch(r.calls, DESTRUCTIVE);
});

test('THE WAIT IS A GUARD: closing before one token lifetime is refused', async () => {
  // 2026-09-28: attempted 4 minutes after phase 1, and only the account preflight stopped it.
  const r = await run(['apply', 'close'], { env: { STUB_PREVIOUS_CREATED: hoursAgo(0.1) } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /too early to close/);
  assert.match(r.stderr, /signs out every session still holding an old-key token/);
  assert.match(r.stderr, /elapsed\s+0\.\d+ h of 24/);
  assert.match(r.stderr, /earliest close\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}Z/, 'it must name a date, not "24 hours"');
  assert.doesNotMatch(r.calls, DESTRUCTIVE, 'nothing may be cleared or deleted');
  // And it must refuse before even asking, so a reflexive CLOSE cannot get through.
  assert.doesNotMatch(r.stdout, /Type CLOSE to continue/);
});

test('one minute short is still short -- the boundary is not approximate', async () => {
  const r = await run(['apply', 'close'], { env: { STUB_PREVIOUS_CREATED: hoursAgo(23.98) } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /too early to close/);
  assert.doesNotMatch(r.calls, DESTRUCTIVE);
});

test('after the wait it proceeds, and only then does it clear and delete', async () => {
  const r = await run(['apply', 'close'], {
    env: { STUB_PREVIOUS_CREATED: hoursAgo(25) },
    stdin: 'CLOSE\n',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /elapsed\s+25\.\d+ h of 24/);
  assert.match(r.calls, /gh variable set TRACKING_JWT_SECRET_PREVIOUS_ARN/);
  assert.match(r.calls, /delete-secret/);
  assert.match(r.stdout, /must now return 401/, 'it must state the verification that makes it real');
});

test('the confirmation still stands after the wait: anything but CLOSE aborts', async () => {
  const r = await run(['apply', 'close'], {
    env: { STUB_PREVIOUS_CREATED: hoursAgo(25) },
    stdin: 'yes\n',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /aborted/);
  assert.doesNotMatch(r.calls, DESTRUCTIVE);
});

test('FORCE_CLOSE_EARLY is an explicit, loud override rather than a silent one', async () => {
  const r = await run(['apply', 'close'], {
    env: { STUB_PREVIOUS_CREATED: hoursAgo(0.1), FORCE_CLOSE_EARLY: '1' },
    stdin: 'CLOSE\n',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /FORCE_CLOSE_EARLY=1: proceeding anyway/);
  assert.match(r.stderr, /Every session still on the old key will be/);
  assert.match(r.calls, /delete-secret/, 'the override must actually override');
});

test('closing with no phase-1 secret at all says so instead of comparing nothing', async () => {
  const r = await run(['apply', 'close'], { env: { STUB_PREVIOUS_CREATED: '' } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Has phase 1 \(apply open\) run at all\?/);
  assert.doesNotMatch(r.calls, DESTRUCTIVE);
});
