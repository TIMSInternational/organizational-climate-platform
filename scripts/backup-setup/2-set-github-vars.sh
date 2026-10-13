#!/usr/bin/env bash
# Step 2 of 3: copy the stack outputs into the repository variables db-backup.yml reads. #512.
#   bash scripts/backup-setup/2-set-github-vars.sh
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

out() {
  aws cloudformation describe-stacks --profile "$PROFILE" --region "$REGION" \
    --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
bucket="$(out BackupBucketName)"
role="$(out BackupRoleArn)"
case "$role" in
  "arn:aws:iam::$ACCOUNT:role/"*) ;;
  *) echo "REFUSING: role output '$role' is not in $ACCOUNT. Run step 1 first." >&2; exit 1 ;;
esac
[ -n "$bucket" ] && [ "$bucket" != "None" ] || { echo "REFUSING: no bucket output." >&2; exit 1; }

gh variable set DB_BACKUP_BUCKET --repo "$REPO" --body "$bucket"
gh variable set DB_BACKUP_ROLE_ARN --repo "$REPO" --body "$role"
gh variable list --repo "$REPO" | grep -E '^(DB_BACKUP_|AWS_ACCOUNT_ID)'
echo "Next: bash scripts/backup-setup/3-first-run.sh"
