// What this defends: a load tool whose whole job is to send a few hundred sign-in attempts at
// once. Pointed at a deployed environment that is a denial-of-service against real respondents
// -- Eagle is collecting on production until 20 Oct -- so the refusal is tested the way
// `seed-staging.test.mjs` tests its own: with a stub that records every path it was asked for,
// so "refused BEFORE any request" is asserted rather than assumed.
//
// It also measures the instrument. The tool's output is a split between the attempts the rate
// limiter let through and the ones it refused, and a tool that cannot count that split is worse
// than no tool: it would report a capacity problem that is not there, or miss the one that is.
// A stub answering 20 then 429 stands in for `RateLimitPolicies.Authentication`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(REPO, 'scripts/load-signin.mjs');

/** Runs the tool and collects what it printed and what it exited with. */
function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { cwd: REPO });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/**
 * A stand-in for the API's authentication limiter: the first `permits` attempts reach the
 * password check (401), every one after that is refused (429), exactly as a fixed window with
 * `QueueLimit = 0` behaves.
 */
async function withStub(permits, fn) {
  const hits = [];
  const server = createServer((request, response) => {
    hits.push(request.url);
    const allowed = hits.length <= permits;
    response.writeHead(allowed ? 401 : 429, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ message: allowed ? 'Invalid email or password' : 'Too many requests' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, hits);
  } finally {
    server.close();
  }
}

test('refuses a target that is not local, before sending anything', async () => {
  await withStub(20, async (_url, hits) => {
    const result = await run(['--api', 'https://api.climate.timsint.com', '--people', '300']);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /must be localhost/);
    // The point of the test: not one request left the process.
    assert.deepEqual(hits, []);
  });
});

test('refuses a people count that is not a positive number', async () => {
  const result = await run(['--api', 'http://localhost:9', '--people', '0']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /positive number/);
});

test('counts the split between the attempts let through and the ones refused', async () => {
  await withStub(20, async (url, hits) => {
    const result = await run(['--api', url, '--people', '50']);

    assert.equal(result.code, 0);
    assert.equal(hits.length, 50, 'every attempt should have been sent');
    assert.ok(hits.every((path) => path === '/auth/login'), 'all of them to /auth/login');

    // 20 reached the password check, 30 were refused before it. A tool that reported
    // "50 reached" would hide the launch-morning problem it exists to find.
    assert.match(result.stdout, /reached the check\s+20\b/);
    assert.match(result.stdout, /rate limited\s+30\b/);
    assert.match(result.stdout, /60% of these attempts were refused/);
  });
});

test('says plainly when nothing was refused', async () => {
  await withStub(1000, async (url) => {
    const result = await run(['--api', url, '--people', '25']);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /No request was rate limited at 25 from one address/);
  });
});
