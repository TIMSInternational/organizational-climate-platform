#!/usr/bin/env bash
#
# Deploy the alerting stack and wire the probe alarms to it, from a machine with an admin
# profile. (#158.)
#
# WHY THIS IS A SCRIPT AND NOT A COMMAND IN A RUNBOOK
#
#   The equivalent `aws cloudformation deploy` invocations are ~300 characters each. Pasted into
#   a terminal they wrap, and a wrapped line splits an argument from its flag -- which fails as
#   "argument --capabilities: expected at least one argument", or worse, silently drops a
#   --parameter-overrides entry so a parameter reverts to its template default. That happened
#   three times while wiring this, which is reason enough for a file.
#
# WHY NOT THE CI WORKFLOW
#
#   `.github/workflows/ops-deploy-observability.yml` is the intended home, and it cannot run yet.
#   Measured 2026-09-25, climate-project-github-deploy-prod carries no `sns`, `logs`, `cloudwatch`
#   or `lambda` actions, and `aws cloudformation deploy` creates resources with the CALLER's
#   permissions. Until that role is widened, this stack can only be deployed by a human who holds
#   AdministratorAccess. That gap is very likely why it sat undeployed for a month.
#
# USAGE
#
#   ./scripts/deploy-observability.sh plan
#   ./scripts/deploy-observability.sh apply
#
#   AWS_PROFILE must reach 747814092517 (formmaps-deploy or claude; NOT the default profile).
#   FALLBACK_EMAIL overrides the address alerts go to; otherwise the ALERT_FALLBACK_EMAIL
#   repository variable is used.

set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
EXPECTED_ACCOUNT="747814092517"
SERVICE_STACK="climate-project-api-prod"
OBS_STACK="climate-project-observability-prod"
PROBE_STACK="climate-project-synthetic-probe-prod"
OBS_TEMPLATE="infra/aws/climate-project-observability.yml"
PROBE_TEMPLATE="infra/aws/climate-project-synthetic-probe.yml"

MODE="${1:-}"
case "$MODE" in plan|apply) ;; *) echo "usage: $0 plan|apply" >&2; exit 1 ;; esac

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
say() { printf '  %s\n' "$*"; }

command -v aws >/dev/null || die "aws CLI not found"
[ -f "$OBS_TEMPLATE" ] || die "run this from the repository root ($OBS_TEMPLATE not found)"

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
[ "$ACCOUNT" = "$EXPECTED_ACCOUNT" ] || die "credentials are for $ACCOUNT, not $EXPECTED_ACCOUNT.
       Use AWS_PROFILE=formmaps-deploy (or claude). The default profile is a different
       account, where these stacks do not exist."

# ServiceId from the service stack's own output. Never hard-coded: it changes if the service is
# recreated, and a stale one points every metric filter at a log group that does not exist --
# a monitoring stack that deploys clean and watches nothing.
SERVICE_ID="$(aws cloudformation describe-stacks --region "$REGION" \
  --stack-name "$SERVICE_STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='ServiceId'].OutputValue | [0]" --output text)"
printf '%s' "$SERVICE_ID" | grep -Eq '^[0-9a-f]{32}$' \
  || die "ServiceId '$SERVICE_ID' is not 32 hex characters"

EMAIL="${FALLBACK_EMAIL:-}"
if [ -z "$EMAIL" ] && command -v gh >/dev/null; then
  EMAIL="$(gh variable list --json name,value --jq '.[]|select(.name=="ALERT_FALLBACK_EMAIL").value' 2>/dev/null || true)"
fi
[ -n "$EMAIL" ] || die "no fallback email. Set FALLBACK_EMAIL=… or the ALERT_FALLBACK_EMAIL repo variable."

TOPIC_ARN="arn:aws:sns:${REGION}:${ACCOUNT}:climate-project-api-prod-alerts-critical"

printf '\n== deploy-observability / %s ==\n' "$MODE"
say "account:    $ACCOUNT ($REGION)"
say "service id: $SERVICE_ID"
say "alerts to:  $EMAIL"
say "topic:      $TOPIC_ARN"

if [ "$MODE" = "plan" ]; then
  cat <<PLAN

  Would deploy, in order:

  1. $OBS_STACK  (never deployed before)
       ServiceId=$SERVICE_ID
       FallbackEmail=$EMAIL
       AlarmsEnabled=false        <- alarms created DARK; turn on after watching them
       TeamsWebhookUrl omitted    <- defaults to empty, so the Teams forwarder is DROPPED,
                                     not deployed inert. Email is the whole channel.

  2. $PROBE_STACK  (already live, re-deployed to wire it)
       AlarmTopicArn=$TOPIC_ARN
       Every other parameter already equals its template default -- verified 2026-09-25 --
       so passing only this one changes only this one.

  Then it re-reads every climate alarm and prints how many still notify nobody.

  Nothing is deployed by 'plan'.

PLAN
  exit 0
fi

printf '\nThis creates SNS topics and alarms in PRODUCTION.\n'
printf 'Type DEPLOY to continue: '
read -r confirm
[ "$confirm" = "DEPLOY" ] || die "aborted"

say "deploying $OBS_STACK ..."
aws cloudformation deploy \
  --region "$REGION" \
  --stack-name "$OBS_STACK" \
  --template-file "$OBS_TEMPLATE" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    "ServiceId=$SERVICE_ID" \
    "FallbackEmail=$EMAIL" \
    "AlarmsEnabled=false"

say "wiring $PROBE_STACK to the critical topic ..."
aws cloudformation deploy \
  --region "$REGION" \
  --stack-name "$PROBE_STACK" \
  --template-file "$PROBE_TEMPLATE" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    "AlarmTopicArn=$TOPIC_ARN"

printf '\n== result ==\n'
aws cloudwatch describe-alarms --region "$REGION" --alarm-name-prefix climate \
  --query "MetricAlarms[].[AlarmName,StateValue,length(AlarmActions)]" --output table

MUTE="$(aws cloudwatch describe-alarms --region "$REGION" --alarm-name-prefix climate \
  --query "MetricAlarms[].[length(AlarmActions)]" --output text | grep -cx 0 || true)"

cat <<NEXT

  $MUTE alarm(s) still notify nobody. The 22 from the observability stack are expected to,
  because they were deployed dark on purpose; the three synthetic-probe rows should now
  show 1.

  NEXT, and it is not optional:

    Click the confirmation link AWS just emailed to $EMAIL.
    An UNCONFIRMED subscription is silently discarded -- the exact failure #158 exists to
    end. Check for it with:

      aws sns list-subscriptions-by-topic --topic-arn $TOPIC_ARN --output table

    A SubscriptionArn of PendingConfirmation means nobody has clicked yet.

  Then, after a couple of days watching the dark alarms, re-run the first deploy with
  AlarmsEnabled=true to let the other 22 notify as well.

NEXT
