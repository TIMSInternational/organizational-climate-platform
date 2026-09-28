// deploy-staging.yml already refuses to run on an EMPTY variable. The failure this script exists
// to catch is the other one: a variable that is set and wrong. A secret ARN pointing at another
// account, or at a secret since deleted, passes the workflow's non-empty check and then fails in
// the middle of a deploy -- after the image is built and pushed -- with a CloudFormation error
// that names a resource rather than the variable at fault.
//
// That is not hypothetical here: staging's environment carries ARNs in account 795965600143
// while the repository-level AWS_ACCOUNT_ID is 747814092517.
//
// Stubs `gh`, `aws` and `jq` is real. No network, no account, no writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(REPO, 'scripts/staging-preflight.sh');
const ACCOUNT = '795965600143';

const ALL_VARS = [
  ['AWS_ACCOUNT_ID', ACCOUNT],
  ['CORS_ALLOWED_ORIGIN', 'https://staging.climate.timsint.com'],
  ['CORS_ALLOWED_WILDCARD_ORIGIN', 'https://climate-*.vercel.app'],
  ['TRACKING_JWT_SECRET_ARN', `arn:aws:secretsmanager:us-east-1:${ACCOUNT}:secret:jwt-aaa`],
  ['DATABASE_CONNECTION_STRING_SECRET_ARN', `arn:aws:secretsmanager:us-east-1:${ACCOUNT}:secret:db-bbb`],
  ['INTERNAL_API_KEY_SECRET_ARN', `arn:aws:secretsmanager:us-east-1:${ACCOUNT}:secret:key-ccc`],
];

const GH_STUB = `#!/usr/bin/env bash
printf '%s\\n' "gh $*" >> "$STUB_LOG"
case "$*" in
  *environments/staging/variables*) printf '%s\\n' "$STUB_ENV_VARS" ;;
  *environments/staging/secrets*)   printf '%s\\n' "$STUB_ENV_SECRETS" ;;
esac
exit 0
`;

const AWS_STUB = `#!/usr/bin/env bash
printf '%s\\n' "aws $*" >> "$STUB_LOG"
args="$*"
case "$args" in
  *"sts get-caller-identity"*) printf '%s\\n' "$STUB_ACCOUNT" ;;
  *"iam get-role"*)            [ "$STUB_NO_ROLE" = "1" ] && exit 254; printf 'role\\n' ;;
  *"describe-stacks"*EcrRepositoryUri*) printf '%s\\n' "$ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/climate-project-api-staging" ;;
  *"describe-stacks"*climate-project-api-staging*) exit 255 ;;
  *"secretsmanager describe-secret"*)
      # STUB_UNRESOLVABLE names one ARN fragment that does not exist in this account.
      case "$args" in
        *"$STUB_UNRESOLVABLE"*) [ -n "$STUB_UNRESOLVABLE" ] && exit 254 ;;
      esac
      printf 'secret\\n'
      ;;
esac
exit 0
`;

function run(env = {}, vars = ALL_VARS, secrets = ['MIGRATION_DATABASE_CONNECTION_STRING']) {
  const dir = mkdtempSync(join(tmpdir(), 'staging-pf-'));
  const log = join(dir, 'calls.log');
  writeFileSync(log, '');
  writeFileSync(join(dir, 'gh'), GH_STUB);
  chmodSync(join(dir, 'gh'), 0o755);
  writeFileSync(join(dir, 'aws'), AWS_STUB.replaceAll('$ACCOUNT', ACCOUNT));
  chmodSync(join(dir, 'aws'), 0o755);

  const res = spawnSync('bash', [SCRIPT], {
    cwd: REPO,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      STUB_LOG: log,
      STUB_ACCOUNT: ACCOUNT,
      STUB_NO_ROLE: '0',
      STUB_UNRESOLVABLE: '',
      STUB_ENV_VARS: JSON.stringify({ variables: vars.map(([name, value]) => ({ name, value })) }),
      STUB_ENV_SECRETS: JSON.stringify({ secrets: secrets.map((name) => ({ name })) }),
      ...env,
    },
  });
  return { ...res, calls: readFileSync(log, 'utf8') };
}

test('a fully provisioned staging passes', () => {
  const r = run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Preflight PASSED/);
});

test('a missing variable fails and names it', () => {
  const r = run({}, ALL_VARS.filter(([n]) => n !== 'DATABASE_CONNECTION_STRING_SECRET_ARN'));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /DATABASE_CONNECTION_STRING_SECRET_ARN\s+MISSING/);
  assert.match(r.stdout, /Preflight FAILED/);
  assert.doesNotMatch(r.stdout, /Preflight PASSED/);
});

test('the migration connection string must be a SECRET, not a variable', () => {
  const r = run({}, ALL_VARS, []);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /MIGRATION_DATABASE_CONNECTION_STRING\s+MISSING -- an environment SECRET/);
});

test('THE POINT: an ARN that is set but does not resolve fails here, not mid-deploy', () => {
  // deploy-staging.yml's own preflight passes this case -- the value is non-empty. Only asking
  // Secrets Manager whether it exists IN THIS ACCOUNT catches it.
  const r = run({ STUB_UNRESOLVABLE: 'db-bbb' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /DATABASE_CONNECTION_STRING_SECRET_ARN resolves\s+MISSING -- set, but no such secret/);
  assert.doesNotMatch(r.stdout, /Preflight PASSED/);
});

test('a missing deploy role fails: the workflow assumes it before anything else runs', () => {
  const r = run({ STUB_NO_ROLE: '1' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /iam role climate-project-github-deploy-staging\s+MISSING/);
});

test('wrong account: the GitHub side is still reported, the AWS side is NOT claimed', () => {
  // The staging account is the DEFAULT profile on this machine and production is not -- the
  // reverse of every other script here, so a silent wrong-account answer is easy to produce.
  const r = run({ STUB_ACCOUNT: '747814092517' });
  assert.equal(r.status, 2, 'a partial answer must not share an exit code with a pass or a fail');
  assert.match(r.stdout, /Credentials are for account 747814092517, but staging is 795965600143/);
  assert.match(r.stdout, /AWS side unchecked/);
  assert.doesNotMatch(r.stdout, /Preflight PASSED/);
  assert.doesNotMatch(r.calls, /iam get-role/, 'it must not check the wrong account and report on it');
});

test('it is read-only in both accounts', () => {
  for (const scenario of [{}, { STUB_ACCOUNT: '747814092517' }, { STUB_UNRESOLVABLE: 'db-bbb' }]) {
    const r = run(scenario);
    assert.doesNotMatch(r.calls, /cloudformation deploy|create-|put-|delete-|update-|gh variable set|gh secret set/,
      `a preflight must never write: ${r.calls}`);
  }
});
