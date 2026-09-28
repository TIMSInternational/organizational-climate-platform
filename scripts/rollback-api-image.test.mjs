// The rollback is a P0 that has never run. #159 asks for it "tested not just written", and until
// now the script had no test at all while its two siblings in scripts/ did.
//
// A real rehearsal needs the staging environment (#156). These tests cover everything that does
// NOT need one: the refusals that fire before any AWS call, the ECR proof that must happen before
// a stack update, the fact that a dry run changes nothing, and -- the one that matters most -- the
// assertion that a rollback which lands without /version agreeing FAILS instead of reporting
// success. Production once sat 156 commits behind main with every signal green; that is the exact
// shape this block defends against, and ten minutes of deadline is why nobody had tested it.
//
// The real script runs against a stubbed `aws`, `curl` and `date` on PATH: no account, no
// credentials, no writes. Assertions are on the argv it would have sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(REPO, 'scripts/rollback-api-image.sh');

const SHA = 'bd7b0f91c9f2c5e58e510f05c7d6324d4acd0393';
const OLD_SHA = '649fd077dab17f22d1bfd1bb1544aeda25fd1e70';
const ECR = '747814092517.dkr.ecr.us-east-1.amazonaws.com/climate-project-api';

// The live stack's parameters, in the shape `describe-stacks --query 'Stacks[0].Parameters'`
// returns. Two of them are load-bearing for the re-pass assertion: a dropped parameter silently
// reverts to the template default, which is how a rollback could take CORS or a secret ARN with it.
const PARAMS = JSON.stringify([
  { ParameterKey: 'ServiceName', ParameterValue: 'climate-project-api-prod' },
  { ParameterKey: 'CorsAllowedOrigin', ParameterValue: 'https://climate.timsint.com' },
  { ParameterKey: 'DatabaseConnectionStringSecretArn', ParameterValue: 'arn:aws:secretsmanager:us-east-1:747814092517:secret:db-jgthiv' },
  { ParameterKey: 'HealthCheckPath', ParameterValue: '/ready' },
  { ParameterKey: 'ImageIdentifier', ParameterValue: `${ECR}:prod-${OLD_SHA}` },
]);

const STUB_AWS = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_LOG"
args="$*"
case "$args" in
  *"describe-stacks"*EcrRepositoryUri*) printf '%s\\n' "\${STUB_ECR_URI:-${ECR}}" ;;
  *"describe-stacks"*ServiceUrl*)       printf 'api.example-runner.amazonaws.com\\n' ;;
  *"describe-stacks"*Parameters*)       printf '%s\\n' "$STUB_PARAMS" ;;
  *"ecr describe-images"*)
      # The lifecycle policy keeps only the most recent 40 images, so an aged-out tag is a real
      # and expected failure -- the CLI exits non-zero and prints nothing.
      [ "$STUB_ECR_MISSING" = "1" ] && exit 254
      printf 'image exists\\n'
      ;;
  *"cloudformation deploy"*)            printf 'Successfully created/updated stack\\n' ;;
esac
exit 0
`;

// /version, as the service would answer it.
const STUB_CURL = `#!/usr/bin/env bash
printf '%s\\n' "curl $*" >> "$STUB_LOG"
printf '{"commit":"%s"}\\n' "$STUB_LIVE_SHA"
`;

function run(args, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rollback-'));
  const log = join(dir, 'calls.log');
  writeFileSync(log, '');
  writeFileSync(join(dir, 'aws'), STUB_AWS);
  chmodSync(join(dir, 'aws'), 0o755);
  writeFileSync(join(dir, 'curl'), STUB_CURL);
  chmodSync(join(dir, 'curl'), 0o755);

  const res = spawnSync('bash', [SCRIPT, ...args], {
    cwd: REPO,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      STUB_LOG: log,
      STUB_PARAMS: PARAMS,
      STUB_LIVE_SHA: SHA,
      STUB_ECR_MISSING: '0',
      VERIFY_DEADLINE_SECONDS: '2',
      VERIFY_INTERVAL_SECONDS: '1',
      ...env,
    },
  });
  return { ...res, calls: readFileSync(log, 'utf8') };
}

const BASE = [
  '--stack', 'climate-project-api-prod',
  '--bootstrap-stack', 'climate-project-api-bootstrap',
  '--region', 'us-east-1',
  '--target-sha', SHA,
];

test('a dry run is the default and changes nothing', () => {
  const r = run(BASE);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DRY RUN complete\. Nothing was changed/);
  assert.doesNotMatch(r.calls, /cloudformation deploy/, 'a dry run must not deploy');
});

test('--execute deploys the target image by its immutable tag', () => {
  const r = run([...BASE, '--execute']);
  assert.equal(r.status, 0, r.stderr);
  const deploy = r.calls.split('\n').find((l) => l.includes('cloudformation deploy'));
  assert.ok(deploy, `no deploy in:\n${r.calls}`);
  assert.match(deploy, new RegExp(`ImageIdentifier=${ECR.replace(/\./g, '\\.')}:prod-${SHA}`));
  assert.doesNotMatch(deploy, /prod-latest/, 'prod-latest is mutable and means "newest built", not "running"');
});

test('--execute re-passes every live parameter, because an omitted one reverts to the default', () => {
  const r = run([...BASE, '--execute']);
  const deploy = r.calls.split('\n').find((l) => l.includes('cloudformation deploy'));
  for (const p of ['ServiceName', 'CorsAllowedOrigin', 'DatabaseConnectionStringSecretArn', 'HealthCheckPath']) {
    assert.match(deploy, new RegExp(`${p}=`), `${p} was dropped from the rollback's parameter overrides`);
  }
});

test('a stack outside the allowlist is refused before any AWS call', () => {
  // A rollback is typed under pressure; a typo that resolves to another stack in the account is
  // worse than a refusal.
  const r = run(['--stack', 'climate-project-api-dev', '--bootstrap-stack', 'b', '--target-sha', SHA]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--stack must be one of/);
  assert.equal(r.calls.trim(), '', 'nothing should have been called');
});

test('a short SHA is refused before any AWS call', () => {
  const r = run([...BASE.slice(0, 6), '--target-sha', SHA.slice(0, 7)]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /must be a full 40-character commit SHA/);
  assert.equal(r.calls.trim(), '', 'nothing should have been called');
});

test('an image that has aged out of ECR is refused BEFORE the stack update', () => {
  // The bootstrap lifecycle policy keeps 40 images. Updating CloudFormation to a tag that no
  // longer exists leaves App Runner attempting a pull it can never satisfy -- with the rollback
  // lever already spent.
  const r = run([...BASE, '--execute'], { STUB_ECR_MISSING: '1' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /is not present in ECR repository/);
  assert.doesNotMatch(r.calls, /cloudformation deploy/, 'the update must not start');
});

test('a rollback whose /version never reports the target FAILS instead of claiming success', () => {
  // The whole point. CloudFormation returning and traffic moving are different events.
  const r = run([...BASE, '--execute'], { STUB_LIVE_SHA: OLD_SHA });
  assert.notEqual(r.status, 0, 'a rollout that did not take must not exit 0');
  assert.match(r.stderr, /still does not report/);
  assert.match(r.stderr, /the App Runner rollout did not take/);
  assert.doesNotMatch(r.stdout, /ROLLED BACK/);
});

test('a rollback that is actually serving the target reports it', () => {
  const r = run([...BASE, '--execute'], { STUB_LIVE_SHA: SHA });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ROLLED BACK/);
  assert.match(r.stdout, new RegExp(`serving ${SHA}`));
  // It must not imply it did the parts it deliberately does not do.
  assert.match(r.stdout, /the schema check/);
  assert.match(r.stdout, /the web layer \(Vercel\)/);
});
