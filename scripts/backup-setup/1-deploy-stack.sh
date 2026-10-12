#!/usr/bin/env bash
# Step 1 of 3: create/update the backup stack (bucket, OIDC role, alarm). #512.
#   bash scripts/backup-setup/1-deploy-stack.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

PROFILE=tims-new
REGION=us-east-2
ACCOUNT=795965600143
STACK=climate-project-db-backup-prod
TOPIC_EXPORT=climate-project-observability-prod-critical-topic

got="$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text)"
if [ "$got" != "$ACCOUNT" ]; then
  echo "REFUSING: profile $PROFILE is account $got, expected $ACCOUNT." >&2
  exit 1
fi

# The alarm imports the critical topic. Check it is there before CloudFormation fails on it.
topic="$(aws cloudformation list-exports --profile "$PROFILE" --region "$REGION" \
  --query "Exports[?Name=='$TOPIC_EXPORT'].Value" --output text)"
if [ -z "$topic" ] || [ "$topic" = "None" ]; then
  echo "REFUSING: export $TOPIC_EXPORT not found. Deploy observability first." >&2
  exit 1
fi
echo "Alarm will notify: $topic"

aws cloudformation deploy --profile "$PROFILE" --region "$REGION" \
  --stack-name "$STACK" \
  --template-file infra/aws/climate-project-db-backup.yml \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset

aws cloudformation describe-stacks --profile "$PROFILE" --region "$REGION" \
  --stack-name "$STACK" --query 'Stacks[0].Outputs' --output table
echo "Next: bash scripts/backup-setup/2-set-github-vars.sh"
