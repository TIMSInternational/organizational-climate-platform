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
#   usage:  bash scripts/wire-observability.sh           # deploy for real
#           DRY=1   bash scripts/wire-observability.sh   # build the changesets, execute nothing
#           CHECK=1 bash scripts/wire-observability.sh   # read-only: IS there a delivery path?
#
# CHECK=1 exits 0 only when a subscription is CONFIRMED, 2 when one is merely pending, and 1
# when the topic has no subscriber at all. It is the command to re-run after clicking the mail,
# and it writes nothing, so a read-only profile can answer it.
#
set -euo pipefail

export AWS_PROFILE="${AWS_PROFILE:-formmaps-deploy}"
REGION="${REGION:-us-east-1}"
OBS_STACK=climate-project-observability-prod
PROBE_STACK=climate-project-synthetic-probe-prod
SERVICE_STACK=climate-project-api-prod
# Prefer the repository variable over the literal: it is the same value the CI workflow reads,
# so the two cannot drift into alerting two different addresses. The literal stays as the last
# resort for a machine with no gh.
FALLBACK_EMAIL="${FALLBACK_EMAIL:-}"
if [ -z "$FALLBACK_EMAIL" ] && command -v gh >/dev/null 2>&1; then
  FALLBACK_EMAIL=$(gh variable list --json name,value \
    --jq '.[]|select(.name=="ALERT_FALLBACK_EMAIL").value' 2>/dev/null || true)
fi
FALLBACK_EMAIL="${FALLBACK_EMAIL:-alerts@timsint.com}"

# Refuse a placeholder. On 2026-09-28 a handoff wrote the command with `you@timsint.com` meant to
# be filled in, it was pasted verbatim, and the run succeeded: `gh variable set` took it, the
# stack took it, SNS took it, 24 alarms were armed, and the only subscriber on the critical topic
# was an address that will never confirm and expires in 3 days. Every layer accepted it because
# it is a syntactically valid address -- so the check has to be for the SHAPE of a stand-in, not
# for validity. Cheaper than another three-day countdown spent on nothing.
case "$FALLBACK_EMAIL" in
  you@*|your@*|your.*|*@example.*|*@domain.*|*'<'*|*'>'*|*YOUR*|name@*)
    echo "Refusing to run: FALLBACK_EMAIL is [$FALLBACK_EMAIL], which looks like a placeholder" >&2
    echo "rather than a mailbox somebody reads. Set the real address and re-run:" >&2
    echo >&2
    echo "    gh variable set ALERT_FALLBACK_EMAIL --body 'real.name@timsint.com'" >&2
    echo >&2
    echo "The subscription this creates is the ONLY path an alarm has to a human, and AWS" >&2
    echo "deletes it 3 days after creation if nobody clicks the mail." >&2
    exit 1
    ;;
esac
EXPECT_ACCOUNT=747814092517

# Armed, not dark. The 21 alarms in the observability stack were deployed AlarmsEnabled=false on
# 2026-09-25 to see whether they flap before anybody is paged. Measured 2026-09-28, three days
# later: all 24 read OK, and there has been NO state transition since 12:08 CDT on the 25th. The
# only seven that ever reached ALARM did it between 12:01 and 12:08 -- INSUFFICIENT_DATA ->
# ALARM -> OK, every one a job-*-stopped alarm going off before the first heartbeat of a freshly
# created stack landed. That is a creation artifact, not flapping, so the green-periods gate the
# runbook set is met. ALARMS_ENABLED=false puts them back to dark.
ALARMS_ENABLED="${ALARMS_ENABLED:-true}"

# The probe watched the raw App Runner hostname while every user reaches the API through
# api.climate.timsint.com (live since 2026-09-14, #484). A failure in the custom domain alone --
# DNS, the Route53 delegation, or the App Runner-managed certificate, which took three attempts
# to get right -- would leave all three probe alarms GREEN while the web app can reach nothing.
# Watching the custom domain covers strictly more than watching the App Runner host did: the
# domain fronts this same service, so if App Runner is down the domain in front of it is too.
# Ruled 2026-09-28.
#
# The other half lives on GitHub: ops-synthetic-probe.yml:87 and deploy-drift.yml:38 both read
# vars.PROD_API_BASE_URL with the same App Runner fallback. This script checks that variable at
# the end and prints the command rather than changing repository config behind your back.
PROBE_API_URL="${PROBE_API_URL:-https://api.climate.timsint.com}"

# DRY=1 stops short of executing: CloudFormation still builds and prices the changeset, so a
# template or parameter error surfaces exactly as it would on the real run.
DEPLOY_FLAGS=(--no-fail-on-empty-changeset)
[ "${DRY:-0}" = "1" ] && DEPLOY_FLAGS+=(--no-execute-changeset)

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# ---------------------------------------------------------------------------------------------
# The delivery path, and the three states it can be in.
#
# This is the only query that tells alerting's real state apart, and only the third is done:
#
#   (nothing)            the topic has NO subscriber. Every alarm fires into a void.
#   PendingConfirmation  nobody clicked. AWS DELETES IT AFTER 3 DAYS and it becomes the above.
#   arn:aws:sns:…:<uuid> confirmed. An alarm actually reaches a human.
#
# It reads worse than it looks from the console, where 24 armed alarms pointing at an empty
# topic look MORE finished than the muted state they replaced.
# ---------------------------------------------------------------------------------------------
delivery_state() {
  local topic="$1" arns
  arns=$(aws sns list-subscriptions-by-topic --topic-arn "$topic" --region "$REGION" \
    --output text --query "Subscriptions[].SubscriptionArn")
  if [ -z "${arns//[[:space:]]/}" ]; then
    echo none
  elif printf '%s\n' "$arns" | tr '\t' '\n' | grep -q '^arn:aws:sns:'; then
    echo confirmed
  else
    echo pending
  fi
}

show_subscriptions() {
  local topic="$1"
  aws sns list-subscriptions-by-topic --topic-arn "$topic" --region "$REGION" \
    --output text --query "Subscriptions[].[Protocol,Endpoint,SubscriptionArn]"
}

topic_arn() {
  local key="$1"
  aws cloudformation describe-stacks --stack-name "$OBS_STACK" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue" --output text
}

# ---------------------------------------------------------------------------------------------
# Why this subscribes directly instead of leaving it to the template.
#
# CloudFormation CANNOT heal an expired email subscription, and nothing in a deploy will tell
# you so. Measured 2026-09-28, three days after the stack was created:
#
#   describe-stack-resources  CriticalEmailSubscription  CREATE_COMPLETE  …:0dc4fc5a-1c40-…
#   get-subscription-attributes --subscription-arn …:0dc4fc5a-1c40-…
#       -> NotFound: Subscription does not exist
#   list-subscriptions-by-topic -> []
#
# AWS had deleted the real subscription out from under a resource CloudFormation still records
# as CREATE_COMPLETE. Because every stack parameter was already identical, `deploy` then built
# an EMPTY changeset, printed "No changes to deploy. Stack is up to date", exited 0 -- and
# recreated nothing. Re-running the deploy is not a fix for this failure; it is a way to be told
# everything is fine while alerting reaches nobody.
#
# `sns subscribe` is the right shape here because it is idempotent for email: an already
# confirmed endpoint returns its existing ARN and sends no mail, and a pending one re-sends the
# confirmation (which also restarts the 3-day clock, the one thing worth restarting).
#
# The drift this accepts, stated plainly: the subscription is then not the stack's to manage. If
# FallbackEmail ever changes, CloudFormation will replace its own (already absent) resource and
# leave the address subscribed here behind -- unsubscribe the old one by hand, or it keeps
# receiving alerts.
# ---------------------------------------------------------------------------------------------
reconcile_email_subscription() {
  local topic="$1" label="$2" state
  state=$(delivery_state "$topic")
  case "$state" in
    confirmed)
      echo "  $label  already confirmed -- nothing to do, no mail sent"
      ;;
    pending)
      echo "  $label  pending: nobody has clicked. Re-sending the confirmation to $FALLBACK_EMAIL"
      aws sns subscribe --topic-arn "$topic" --protocol email \
        --notification-endpoint "$FALLBACK_EMAIL" --region "$REGION" >/dev/null
      ;;
    none)
      echo "  $label  NO subscriber (expired, or never created). Subscribing $FALLBACK_EMAIL"
      aws sns subscribe --topic-arn "$topic" --protocol email \
        --notification-endpoint "$FALLBACK_EMAIL" --region "$REGION" >/dev/null
      ;;
  esac
}

# ---------------------------------------------------------------------------------------------
# CHECK=1 -- read-only. No deploy, no subscribe, no changeset.
# ---------------------------------------------------------------------------------------------
if [ "${CHECK:-0}" = "1" ]; then
  account=$(aws sts get-caller-identity --query Account --output text)
  if [ "$account" != "$EXPECT_ACCOUNT" ]; then
    echo "Refusing to run: account is $account, expected $EXPECT_ACCOUNT (AWS_PROFILE=$AWS_PROFILE)." >&2
    exit 1
  fi
  TOPIC=$(topic_arn CriticalTopicArn)
  [ -n "$TOPIC" ] && [ "$TOPIC" != "None" ] || { echo "No CriticalTopicArn output on $OBS_STACK -- the stack is not deployed." >&2; exit 1; }
  echo "account  $account   profile $AWS_PROFILE   region $REGION"
  echo "topic    $TOPIC"
  echo
  echo "subscriptions:"
  show_subscriptions "$TOPIC"
  echo
  case "$(delivery_state "$TOPIC")" in
    confirmed)
      echo "CONFIRMED -- an alarm on this topic reaches a human."
      exit 0
      ;;
    pending)
      echo "PENDING -- the confirmation mail to $FALLBACK_EMAIL has NOT been clicked." >&2
      echo "Alarms still reach nobody, and AWS DELETES this subscription 3 days after it was" >&2
      echo "created. Click the mail, then re-run this check." >&2
      exit 2
      ;;
    none)
      echo "NO DELIVERY PATH -- the critical topic has zero subscribers. Every alarm fires into" >&2
      echo "a void. Run: bash scripts/wire-observability.sh   (with an admin profile)" >&2
      exit 1
      ;;
  esac
fi

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
echo "== 1/5  $OBS_STACK  (AlarmsEnabled=$ALARMS_ENABLED) =="
aws cloudformation deploy \
  --region "$REGION" \
  --stack-name "$OBS_STACK" \
  --template-file infra/aws/climate-project-observability.yml \
  --capabilities CAPABILITY_NAMED_IAM \
  "${DEPLOY_FLAGS[@]}" \
  --parameter-overrides \
    ServiceId="$SERVICE_ID" \
    FallbackEmail="$FALLBACK_EMAIL" \
    AlarmsEnabled="$ALARMS_ENABLED"

if [ "${DRY:-0}" = "1" ]; then
  echo
  echo "DRY run: changeset built, nothing executed. Re-run without DRY=1 to apply."
  echo "The subscription state below is read live and is NOT changed by a dry run:"
  TOPIC=$(topic_arn CriticalTopicArn)
  if [ -n "$TOPIC" ] && [ "$TOPIC" != "None" ]; then
    echo "  critical topic: $(delivery_state "$TOPIC")   (none | pending | confirmed)"
  else
    echo "  the stack has no CriticalTopicArn output yet -- a real run creates the topic."
  fi
  exit 0
fi

echo
echo "== 2/5  topic arns =="
TOPIC=$(topic_arn CriticalTopicArn)
[ -n "$TOPIC" ] && [ "$TOPIC" != "None" ] || { echo "No CriticalTopicArn output on $OBS_STACK." >&2; exit 1; }
WARNING_TOPIC=$(topic_arn WarningTopicArn)
echo "TOPIC $TOPIC"

echo
echo "== 3/5  the email subscriptions -- CloudFormation cannot heal these (see above) =="
reconcile_email_subscription "$TOPIC" "critical"
if [ -n "$WARNING_TOPIC" ] && [ "$WARNING_TOPIC" != "None" ]; then
  reconcile_email_subscription "$WARNING_TOPIC" "warning "
fi

# Two overrides, and everything else carries over: `aws cloudformation deploy` sends
# UsePreviousValue=True for every template parameter NOT named in --parameter-overrides, so the
# probe's interval, latency threshold and log retention keep their live values rather than
# reverting to template defaults. Verified in the CLI's own source rather than assumed, because
# the runbook asserted the opposite: awscli/customizations/cloudformation/deploy.py:455-461 sets
# UsePreviousValue for the unnamed, and deployer.py:117-132 keeps it for an UPDATE (aws-cli
# 2.33.4). It is stripped only on a CREATE, where there is no previous value to use.
echo
echo "== 4/5  wire the three probe alarms, and point them at the host users actually use =="
aws cloudformation deploy \
  --region "$REGION" \
  --stack-name "$PROBE_STACK" \
  --template-file infra/aws/climate-project-synthetic-probe.yml \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    AlarmTopicArn="$TOPIC" \
    ApiBaseUrl="$PROBE_API_URL"

echo
echo "== 5/5  verify -- the action count must read 1, not 0 =="
aws cloudwatch describe-alarms --alarm-name-prefix climate --region "$REGION" \
  --output text --query "MetricAlarms[].[AlarmName,length(AlarmActions)]"

echo
echo "subscriptions on the critical topic:"
show_subscriptions "$TOPIC"
echo

# The gate. A run that ends with an empty topic has produced armed alarms that reach nobody,
# and that must not exit 0 -- reporting this state as done is precisely what failed on
# 2026-09-25 and cost three days.
# This stack now probes $PROBE_API_URL. The GitHub-side probe and the drift check follow
# vars.PROD_API_BASE_URL, so if that variable names a different host, one of them is watching
# something nobody uses. Advisory, never a gate: a machine without gh, or without a token, is
# still a machine that can deploy the stack.
if command -v gh >/dev/null 2>&1; then
  prod_var=$(gh variable list --json name,value \
    --jq '.[]|select(.name=="PROD_API_BASE_URL").value' 2>/dev/null || true)
  if [ -z "$prod_var" ]; then
    echo "vars.PROD_API_BASE_URL is unset, and that is now correct: ops-synthetic-probe.yml and"
    echo "deploy-drift.yml fall back to $PROBE_API_URL, the same host this stack probes."
  elif [ "$prod_var" != "$PROBE_API_URL" ]; then
    echo "NOTE: vars.PROD_API_BASE_URL is [$prod_var] but this stack probes $PROBE_API_URL. The"
    echo "      GitHub probe and deploy-drift follow the variable, so they are watching a"
    echo "      different host than these alarms. To make all three agree:"
    echo
    echo "          gh variable set PROD_API_BASE_URL --body \"$PROBE_API_URL\""
    echo
  fi
fi

STATE=$(delivery_state "$TOPIC")
case "$STATE" in
  none)
    echo "FAILED: the critical topic has ZERO subscribers after this run. The alarms are armed" >&2
    echo "and fire into a void. Do not report alerting as working." >&2
    exit 1
    ;;
  pending)
    # Put the expiry in the sentence, not a bullet at the end: the state decays back to broken
    # on its own. GNU date first, BSD date second -- this runs on a Mac and in CI.
    deadline=$(date -u -d '+3 days' '+%Y-%m-%d %H:%M UTC' 2>/dev/null \
      || date -u -v+3d '+%Y-%m-%d %H:%M UTC')
    cat >&2 <<EOF
NOT DONE YET, and this one has a deadline.

  A confirmation mail is waiting at $FALLBACK_EMAIL. Until somebody clicks it the alarms
  still reach NOBODY, and AWS DELETES the subscription -- taking the whole delivery path with
  it -- by about:

      $deadline

  Then prove it, with any profile on this account:

      CHECK=1 bash scripts/wire-observability.sh

  Exit 0 and the word CONFIRMED is the only evidence that alerting works. PendingConfirmation
  is not progress; it is a countdown.
EOF
    exit 0
    ;;
  confirmed)
    echo "CONFIRMED: the critical topic has a confirmed subscriber. Alerting reaches a human."
    exit 0
    ;;
esac
