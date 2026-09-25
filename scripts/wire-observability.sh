#!/usr/bin/env bash
#
# The missing half of #158, as a script rather than a paste.
#
# The runbook's command is ~400 characters on one line. Pasted into a terminal it wraps, zsh
# treats the wrap as end-of-command, and you get "Parameters: [FallbackEmail, ServiceId] must
# have values" followed by "command not found: --parameter-overrides". That happened twice on
# 2026-09-25 and cost more time than the deploy itself. Inside a file, backslash continuations
# are safe.
#
# Order matters and is the whole point: the probe alarms cannot be wired to a topic that does
# not exist yet, and climate-project-observability-prod is what creates it.
#
#   usage:  bash scripts/wire-observability.sh          # deploy for real
#           DRY=1 bash scripts/wire-observability.sh    # build the changesets, execute nothing
#
set -euo pipefail

export AWS_PROFILE="${AWS_PROFILE:-formmaps-deploy}"
REGION="${REGION:-us-east-1}"
OBS_STACK=climate-project-observability-prod
PROBE_STACK=climate-project-synthetic-probe-prod
SERVICE_STACK=climate-project-api-prod
FALLBACK_EMAIL="${FALLBACK_EMAIL:-alerts@timsint.com}"
EXPECT_ACCOUNT=747814092517

# DRY=1 stops short of executing: CloudFormation still builds and prices the changeset, so a
# template or parameter error surfaces exactly as it would on the real run.
DEPLOY_FLAGS=(--no-fail-on-empty-changeset)
[ "${DRY:-0}" = "1" ] && DEPLOY_FLAGS+=(--no-execute-changeset)

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# The default profile on this machine is a DIFFERENT AWS account (795965600143). Every
# read-only check run without AWS_PROFILE set answers about the wrong one, which is a very
# quiet way to be wrong.
account=$(aws sts get-caller-identity --query Account --output text)
if [ "$account" != "$EXPECT_ACCOUNT" ]; then
  echo "Refusing to run: account is $account, expected $EXPECT_ACCOUNT (AWS_PROFILE=$AWS_PROFILE)." >&2
  exit 1
fi
echo "account  $account   profile $AWS_PROFILE   region $REGION"

# Read live rather than trusting the literal in the runbook: a service redeploy replaces it,
# and every metric filter in the observability stack is keyed to this id.
SERVICE_ID=$(aws cloudformation describe-stacks --stack-name "$SERVICE_STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ServiceId'].OutputValue" --output text)
[ -n "$SERVICE_ID" ] && [ "$SERVICE_ID" != "None" ] || { echo "No ServiceId output on $SERVICE_STACK." >&2; exit 1; }
echo "ServiceId $SERVICE_ID"

echo
echo "== 1/4  $OBS_STACK  (AlarmsEnabled=false — these 22 alarms have never evaluated) =="
aws cloudformation deploy \
  --region "$REGION" \
  --stack-name "$OBS_STACK" \
  --template-file infra/aws/climate-project-observability.yml \
  --capabilities CAPABILITY_NAMED_IAM \
  "${DEPLOY_FLAGS[@]}" \
  --parameter-overrides \
    ServiceId="$SERVICE_ID" \
    FallbackEmail="$FALLBACK_EMAIL" \
    AlarmsEnabled=false

if [ "${DRY:-0}" = "1" ]; then
  echo
  echo "DRY run: changeset built, nothing executed. Re-run without DRY=1 to apply."
  exit 0
fi

echo
echo "== 2/4  critical topic arn =="
TOPIC=$(aws cloudformation describe-stacks --stack-name "$OBS_STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='CriticalTopicArn'].OutputValue" --output text)
[ -n "$TOPIC" ] && [ "$TOPIC" != "None" ] || { echo "No CriticalTopicArn output on $OBS_STACK." >&2; exit 1; }
echo "TOPIC $TOPIC"

# Only AlarmTopicArn is overridden; cloudformation deploy keeps previous values for every
# parameter not named, so the probe's thresholds and interval carry over untouched.
echo
echo "== 3/4  wire the three probe alarms (their 22-day gate is met) =="
aws cloudformation deploy \
  --region "$REGION" \
  --stack-name "$PROBE_STACK" \
  --template-file infra/aws/climate-project-synthetic-probe.yml \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides AlarmTopicArn="$TOPIC"

echo
echo "== 4/4  verify — the action count must read 1, not 0 =="
aws cloudwatch describe-alarms --alarm-name-prefix climate --region "$REGION" \
  --output text --query "MetricAlarms[].[AlarmName,length(AlarmActions)]"

echo
echo "subscriptions on the critical topic:"
aws sns list-subscriptions-by-topic --topic-arn "$TOPIC" --region "$REGION" \
  --output text --query "Subscriptions[].[Protocol,Endpoint,SubscriptionArn]"

cat <<EOF

Done. One thing is still manual and nothing can automate it:

  If SubscriptionArn above reads PendingConfirmation, the alarms STILL reach nobody.
  Open the SNS confirmation email sent to $FALLBACK_EMAIL and click it.

EOF
