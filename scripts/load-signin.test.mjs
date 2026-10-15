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
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

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
async function withStub(permits, fn, bodies) {
  const hits = [];
  const server = createServer((request, response) => {
    hits.push(request.url);
    if (bodies) {
      let raw = '';
      request.on('data', (chunk) => { raw += chunk; });
      request.on('end', () => { try { bodies.push(JSON.parse(raw)); } catch { bodies.push(raw); } });
    }
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
    assert.match(result.stdout, /60% of these attempts were throttled/);
  });
});

test('says plainly when nothing was refused', async () => {
  await withStub(1000, async (url) => {
    const result = await run(['--api', url, '--people', '25']);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /No request was rate limited at 25 from one address/);
  });
});

// The two things the production opt-in has to get right, because getting either wrong is how a
// load tool becomes an outage: the target is refused without the flag (above), and WITH the flag
// the attempts have to actually reach the password check or the number means nothing.
//
// `AuthEndpoints.cs:69` answers an unknown identifier before `passwordHasher.Verify`, so the
// default mode -- an address per attempt, nobody's -- never computes a hash. That is correct for
// measuring the limiter and useless for measuring capacity, and the tool now says which it did.

test('still refuses a non-local target when the flag is absent, whatever else is passed', async () => {
  await withStub(20, async (_url, hits) => {
    const result = await run([
      '--api', 'https://api.climate.timsint.com', '--people', '300', '--email', 'someone@example.com',
    ]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /must be localhost/);
    assert.match(result.stderr, /--confirm-production-load-test/);
    assert.deepEqual(hits, [], 'not one request may leave the process');
  });
});

test('the flag allows a non-local target, and says so before sending', async () => {
  // `.invalid` is reserved by RFC 2606 and guaranteed never to resolve, so this is
  // deterministic with no DNS and no listener: the attempts cannot connect. That they were
  // ATTEMPTED is the whole assertion -- the refusal path exits 2 before sending anything, so
  // a tally of network errors is proof the guard let them through.
  const result = await run([
    '--api', 'http://unreachable.invalid:1', '--people', '3',
    '--email', 'real@example.com', '--confirm-production-load-test',
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /this target is NOT local/);
  assert.match(result.stdout, /Nothing is written and no session is created/);
  assert.match(result.stdout, /status network error: 3/);
  // And no capacity claim about a run that reached nothing.
  assert.doesNotMatch(result.stdout, /throughput/);
});

test('every attempt in capacity mode uses the SAME real address, with a wrong password', async () => {
  const bodies = [];
  await withStub(1000, async (url, hits) => {
    const result = await run(['--api', url, '--people', '3', '--email', 'real@example.com']);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(hits.length, 3);
  }, bodies);
  // One address, repeated -- that is what makes every attempt pay a bcrypt verify instead of
  // short-circuiting at the unknown-identifier branch.
  assert.equal(bodies.length, 3);
  assert.ok(bodies.every((b) => b.email === 'real@example.com'), JSON.stringify(bodies));
  assert.ok(bodies.every((b) => b.password === 'not-a-password'), 'the password must stay wrong');
});

test('without --email it uses an address per attempt, and warns that it is not measuring capacity', async () => {
  const bodies = [];
  await withStub(1000, async (url) => {
    const result = await run(['--api', url, '--people', '4']);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /measures the limiter, NOT capacity/);
    // No throughput line: claiming sign-ins a second off requests that never hashed would be
    // a number ten times too high.
    assert.doesNotMatch(result.stdout, /throughput/);
  }, bodies);
  assert.equal(new Set(bodies.map((b) => b.email)).size, 4, 'a distinct address per attempt');
});

test('reports throughput only in capacity mode', async () => {
  await withStub(1000, async (url) => {
    const result = await run(['--api', url, '--people', '5', '--email', 'real@example.com']);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /as real@example\.com with a wrong password/);
    assert.match(result.stdout, /throughput\s+[\d.]+ password checks\/second/);
    assert.match(result.stdout, /no successful login or survey write is tested/);
  });
});


test('paced mode exports all results and separate check/throttle latency distributions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'climate-load-'));
  try {
    await withStub(2, async (url, hits) => {
      const output = join(dir, 'results.json');
      const start = Date.now();
      const result = await run(['--api', url, '--people', '4', '--rate', '10', '--output', output]);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(hits.length, 4);
      assert.ok(Date.now() - start >= 290, 'paced arrivals must not be a burst');
      const data = JSON.parse(await readFile(output, 'utf8'));
      assert.equal(data.people, 4);
      assert.equal(data.results.length, 4);
      assert.deepEqual(data.byStatus, {401: 2, 429: 2});
      assert.equal(data.passwordCheckLatency.count, 2);
      assert.equal(data.throttledLatency.count, 2);
      assert.equal(data.ratePerSecond, 10);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rejects fractional people and invalid pacing before sending requests', async () => {
  await withStub(10, async (url, hits) => {
    for (const args of [['--people', '1.5'], ['--rate=-1'], ['--rate', 'nope']]) {
      const result = await run(['--api', url, ...args]);
      assert.equal(result.code, 2);
    }
    assert.equal(hits.length, 0);
  });
});
