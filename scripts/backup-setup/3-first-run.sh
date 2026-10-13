#!/usr/bin/env bash
# Step 3 of 3: run the backup once by hand, watch it, and list what landed in S3. #512.
#   bash scripts/backup-setup/3-first-run.sh
set -euo pipefail

PROFILE=tims-new
REGION=us-east-2
ACCOUNT=795965600143
STACK=climate-project-db-backup-prod
REPO=TIMSInternational/organizational-climate-platform

got="$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text)"
if [ "$got" != "$ACCOUNT" ]; then
  echo "REFUSING: profile $PROFILE is account $got, expected $ACCOUNT." >&2
  exit 1
fi

before="$(gh run list --repo "$REPO" --workflow db-backup.yml --limit 1 \
  --json databaseId --jq '.[0].databaseId // 0')"
gh workflow run db-backup.yml --repo "$REPO" --ref main

# Wait for the dispatched run to appear (a new id), then watch it to the end.
run=""
for _ in $(seq 1 30); do
  run="$(gh run list --repo "$REPO" --workflow db-backup.yml --limit 1 \
    --json databaseId --jq '.[0].databaseId // 0')"
  [ "$run" != "$before" ] && break
  sleep 2
done
[ "$run" != "$before" ] || { echo "The run did not appear; check the Actions tab." >&2; exit 1; }
gh run watch "$run" --repo "$REPO" --exit-status

bucket="$(aws cloudformation describe-stacks --profile "$PROFILE" --region "$REGION" \
  --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='BackupBucketName'].OutputValue" --output text)"
aws s3 ls "s3://$bucket/climate/" --recursive --human-readable \
  --profile "$PROFILE" --region "$REGION"

aws cloudwatch describe-alarms --profile "$PROFILE" --region "$REGION" \
  --alarm-names climate-project-db-backup-stopped \
  --query 'MetricAlarms[0].[AlarmName,StateValue]' --output text

echo
echo "Then the production restore rehearsal (docs/decisions/database-backups.md):"
echo "  aws s3 cp s3://$bucket/<key from the list above> ~/climate-backups/ --profile $PROFILE"
echo "  scripts/db-restore-rehearsal.sh ~/climate-backups/<file>.dump climate_restore_prod_rehearsal"
