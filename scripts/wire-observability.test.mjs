// What these tests defend, and why they exist at all.
//
// On 2026-09-25 the observability stack was deployed, three probe alarms were wired, and the run
// was reported as done with the SNS subscription in PendingConfirmation. Nobody clicked. AWS
// deletes an unconfirmed email subscription after 3 days, so on 2026-09-28 the topic had ZERO
// subscribers -- 24 armed alarms firing into a void, which from the console looks MORE finished
// than the muted state it replaced.
//
// The instinct ("just re-run the deploy") does not work, and that is the sharp edge here.
// CloudFormation still records CriticalEmailSubscription as CREATE_COMPLETE with the ARN of a
// subscription AWS has deleted, every stack parameter is unchanged, so `deploy` builds an EMPTY
// changeset and prints "No changes to deploy. Stack is up to date" -- exit 0, nothing healed.
//
// So the script subscribes directly, and it must never again exit 0 on an empty topic. These
// tests drive the real script with a stubbed `aws` on PATH: no AWS account, no credentials, no
// writes, and they assert on the argv the script would actually have sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(REPO, 'scripts/wire-observability.sh');

const ACCOUNT = '747814092517';
const CRITICAL = `arn:aws:sns:us-east-1:${ACCOUNT}:climate-project-api-prod-alerts-critical`;
const CONFIRMED_ARN = `${CRITICAL}:0dc4fc5a-1c40-416d-bafa-c41de85d7b07`;

// A stand-in for the AWS CLI. It logs every invocation so a test can assert on what the script
// tried to do, and answers the handful of calls the script makes.
//
// STUB_SUBS models the topic's real behaviour over time:
//   empty        -> no subscriber, but a `sns subscribe` makes the next read PendingConfirmation,
//                   which is exactly what SNS does.
//   always-empty -> the subscribe never takes effect. The state alerting was actually in.
//   pending      -> a subscription exists and nobody has clicked.
//   confirmed    -> a real uuid ARN.
const STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_LOG"
args="$*"
case "$args" in
  *"sts get-caller-identity"*)
    printf '%s\\n' "$STUB_ACCOUNT"
    ;;
  *"sns list-subscriptions-by-topic"*)
    state="$STUB_SUBS"
    if [ "$state" = empty ]; then
      if grep -q 'sns subscribe' "$STUB_LOG"; then state=pending; else state=none; fi
    fi
    [ "$state" = always-empty ] && state=none
    if [ "$state" != none ]; then
      arn="$STUB_CONFIRMED_ARN"
      [ "$state" = pending ] && arn=PendingConfirmation
      case "$args" in
        *"[Protocol,Endpoint,SubscriptionArn]"*) printf 'email\\talerts@timsint.com\\t%s\\n' "$arn" ;;
        *) printf '%s\\n' "$arn" ;;
      esac
    fi
    ;;
  *"sns subscribe"*)
    printf 'pending confirmation\\n'
    ;;
  *"cloudformation describe-stacks"*)
    case "$args" in
      *ServiceId*)        printf '126c3f282524450896385975cb3bcba9\\n' ;;
      *CriticalTopicArn*) printf '%s\\n' "$STUB_CRITICAL" ;;
      *WarningTopicArn*)  printf '%s-warning\\n' "$STUB_CRITICAL" ;;
    esac
    ;;
  *"cloudformation deploy"*)
    # The real message from an unchanged stack, and the reason this script cannot trust it.
    printf 'No changes to deploy. Stack climate-project-observability-prod is up to date\\n'
    ;;
  *"cloudwatch describe-alarms"*)
    printf 'climate-project-api-prod-synthetic-probe-api-down\\t1\\n'
    ;;
esac
`;

function run(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wire-obs-'));
  const log = join(dir, 'calls.log');
  writeFileSync(log, '');
  writeFileSync(join(dir, 'aws'), STUB);
  chmodSync(join(dir, 'aws'), 0o755);

  const res = spawnSync('bash', [SCRIPT], {
    cwd: REPO,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      STUB_LOG: log,
      STUB_ACCOUNT: ACCOUNT,
      STUB_CRITICAL: CRITICAL,
      STUB_CONFIRMED_ARN: CONFIRMED_ARN,
      STUB_SUBS: 'empty',
      // Set explicitly so the script never shells out to `gh` for the repo variable.
      FALLBACK_EMAIL: 'alerts@timsint.com',
      AWS_PROFILE: 'stub',
      DRY: '0',
      CHECK: '0',
      ...env,
    },
  });
  return { ...res, calls: readFileSync(log, 'utf8') };
}

test('an expired subscription is recreated -- a re-deploy alone would not have', () => {
  const r = run({ STUB_SUBS: 'empty' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(
    r.calls,
    new RegExp(`sns subscribe --topic-arn ${CRITICAL} --protocol email --notification-endpoint alerts@timsint\\.com`),
    'the script must subscribe directly; CloudFormation records the deleted subscription as CREATE_COMPLETE and would build an empty changeset',
  );
});

test('a pending subscription is reported with its expiry date, never as done', () => {
  const r = run({ STUB_SUBS: 'empty' });
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout + r.stderr;
  assert.match(out, /NOT DONE YET/);
  assert.match(out, /\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/, 'the 3-day deadline must be a date, not the words "3 days"');
  assert.match(out, /CHECK=1 bash scripts\/wire-observability\.sh/, 'it must hand over the verifying command');
  assert.doesNotMatch(out, /^CONFIRMED/m, 'pending is not confirmed');
});

test('THE GATE: a run that ends with an empty topic fails, loudly', () => {
  // The 2026-09-25 regression, as a test. Armed alarms plus no subscriber must not be exit 0.
  const r = run({ STUB_SUBS: 'always-empty' });
  assert.equal(r.status, 1, `expected a failing exit, got ${r.status}\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /ZERO subscribers/);
  assert.match(r.stderr, /Do not report alerting as working/);
});

test('a confirmed subscription is left alone -- no duplicate, no fresh mail', () => {
  const r = run({ STUB_SUBS: 'confirmed' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /CONFIRMED/);
  assert.doesNotMatch(r.calls, /sns subscribe/, 'resubscribing a confirmed address sends mail for nothing');
});

test('CHECK=1 is read-only: it deploys nothing and subscribes to nothing', () => {
  const r = run({ CHECK: '1', STUB_SUBS: 'always-empty' });
  assert.equal(r.status, 1, 'an empty topic is a failure even in a read-only check');
  assert.doesNotMatch(r.calls, /cloudformation deploy/);
  assert.doesNotMatch(r.calls, /sns subscribe/);
  assert.match(r.stderr, /NO DELIVERY PATH/);
});

test('CHECK=1 separates the three states by exit code: 1 none, 2 pending, 0 confirmed', () => {
  assert.equal(run({ CHECK: '1', STUB_SUBS: 'always-empty' }).status, 1);

  const pending = run({ CHECK: '1', STUB_SUBS: 'pending' });
  assert.equal(pending.status, 2, 'PendingConfirmation must not pass as working alerting');
  assert.match(pending.stderr, /PENDING/);

  const confirmed = run({ CHECK: '1', STUB_SUBS: 'confirmed' });
  assert.equal(confirmed.status, 0, confirmed.stderr);
  assert.match(confirmed.stdout, /CONFIRMED/);
});

test('the wrong AWS account is refused before anything is written', () => {
  // The default profile on the dev machine is account 795965600143, where every read answers
  // about the wrong account and a describe reads as a missing resource.
  const r = run({ STUB_ACCOUNT: '795965600143' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Refusing to run: account is 795965600143, expected 747814092517/);
  assert.doesNotMatch(r.calls, /cloudformation deploy/);
  assert.doesNotMatch(r.calls, /sns subscribe/);
});

test('DRY=1 builds a changeset and executes nothing', () => {
  const r = run({ DRY: '1', STUB_SUBS: 'empty' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.calls, /--no-execute-changeset/);
  assert.doesNotMatch(r.calls, /sns subscribe/, 'a dry run must not send mail');
  assert.match(r.stdout, /critical topic: none/, 'a dry run should still say whether a delivery path exists');
});
