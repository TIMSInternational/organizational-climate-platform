#!/usr/bin/env bash
# Restore climate-project-api in the NEW AWS account, App Runner us-east-2.
#
# Written 2026-10-12, after the old account's App Runner service was deleted as part of the
# account migration and production went down. Climate ONLY -- nothing else in either account
# is read or touched. Email deliberately stays on the OLD account's SES (ruled 2026-10-12):
# the SMTP credentials are copied, the SES identity and the climate-project-smtp user stay.
#
# Why us-east-2: App Runner answers SubscriptionRequiredException in us-east-1 for the new
# account (measured 2026-10-12) and works in us-east-2. The database stays on Supabase
# us-east-1; nothing about it changes.
#
# Idempotent: every step re-runs safely. Prints no secret value at any point.
#
#   bash scripts/migrate-climate-to-new-account.sh
set -euo pipefail

NEW_PROFILE=tims-new
OLD_PROFILE=claude
NEW_ACCOUNT=795965600143
OLD_ACCOUNT=747814092517
REGION=us-east-2
OLD_REGION=us-east-1
BOOTSTRAP_STACK=climate-project-api-bootstrap
SERVICE_STACK=climate-project-api-prod
SERVICE_NAME=climate-project-api-prod
CORS_ORIGIN=https://climate.timsint.com
CORS_WILDCARD='https://climate-*-federicos-projects-21f2ff63.vercel.app'
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHA="$(git -C "$REPO_ROOT" rev-parse origin/main)"
LOCAL_IMAGE="climate-project-api:prod-${SHA}"

say() { printf '\n== %s\n' "$*"; }

# -- 0. Refuse to run against the wrong account. -------------------------------------------
say "0. Checking both accounts"
got_new="$(aws sts get-caller-identity --profile "$NEW_PROFILE" --query Account --output text)"
got_old="$(aws sts get-caller-identity --profile "$OLD_PROFILE" --query Account --output text)"
[ "$got_new" = "$NEW_ACCOUNT" ] || { echo "profile $NEW_PROFILE is account $got_new, expected $NEW_ACCOUNT" >&2; exit 1; }
[ "$got_old" = "$OLD_ACCOUNT" ] || { echo "profile $OLD_PROFILE is account $got_old, expected $OLD_ACCOUNT" >&2; exit 1; }
docker image inspect "$LOCAL_IMAGE" >/dev/null 2>&1 || { echo "local image $LOCAL_IMAGE not built yet" >&2; exit 1; }
echo "new=$got_new old=$got_old image=$LOCAL_IMAGE"

# -- 1. Bootstrap: ECR repository, image-pull role, GitHub deploy role. -----------------------
say "1. Bootstrap stack ($REGION)"
aws cloudformation deploy --profile "$NEW_PROFILE" --region "$REGION" \
  --stack-name "$BOOTSTRAP_STACK" \
  --template-file "$REPO_ROOT/infra/aws/climate-project-api-bootstrap.yml" \
  --capabilities CAPABILITY_NAMED_IAM \
  --tags Project=climate-project-api Environment=production \
  --no-fail-on-empty-changeset
out() {
  aws cloudformation describe-stacks --profile "$NEW_PROFILE" --region "$REGION" --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue | [0]" --output text
}
ECR_URI="$(out "$BOOTSTRAP_STACK" EcrRepositoryUri)"
ECR_ACCESS_ROLE="$(out "$BOOTSTRAP_STACK" AppRunnerEcrAccessRoleArn)"
echo "ecr=$ECR_URI"

# -- 2. Secrets: copied value-for-value, never printed. ---------------------------------------
say "2. Copying the five climate secrets ($OLD_REGION old -> $REGION new)"
SECRET_ARNS_FILE="$(mktemp)"
python3 - "$OLD_PROFILE" "$OLD_REGION" "$NEW_PROFILE" "$REGION" "$SECRET_ARNS_FILE" <<'PY'
import sys, boto3
old_p, old_r, new_p, new_r, out = sys.argv[1:]
old = boto3.Session(profile_name=old_p, region_name=old_r).client("secretsmanager")
new = boto3.Session(profile_name=new_p, region_name=new_r).client("secretsmanager")
names = {
    "TRACKING_JWT_SECRET_ARN": "climate-project-api/prod/tracking-jwt-secret",
    "DATABASE_CONNECTION_STRING_SECRET_ARN": "climate-project-api/prod/database-connection-string",
    "INTERNAL_API_KEY_SECRET_ARN": "climate-project-api/prod/InternalApiKey",
    "EMAIL_SMTP_USERNAME_SECRET_ARN": "climate-project-api/prod/email-smtp-username",
    "EMAIL_SMTP_PASSWORD_SECRET_ARN": "climate-project-api/prod/email-smtp-password",
}
lines = []
for var, name in names.items():
    value = old.get_secret_value(SecretId=name)
    kwargs = {"SecretString": value["SecretString"]} if "SecretString" in value else {"SecretBinary": value["SecretBinary"]}
    try:
        arn = new.create_secret(Name=name, Tags=[{"Key": "Project", "Value": "climate-project-api"}], **kwargs)["ARN"]
        state = "created"
    except new.exceptions.ResourceExistsException:
        arn = new.put_secret_value(SecretId=name, **kwargs)["ARN"]
        state = "updated"
    lines.append(f"{var}={arn}")
    print(f"  {state}: {name}")
open(out, "w").write("\n".join(lines) + "\n")
PY
# shellcheck disable=SC1090
. "$SECRET_ARNS_FILE"

# -- 3. Image: the one built from origin/main, pushed to the new ECR. -------------------------
say "3. Pushing image prod-$SHA"
aws ecr get-login-password --profile "$NEW_PROFILE" --region "$REGION" \
  | docker login --username AWS --password-stdin "${ECR_URI%/*}"
docker tag "$LOCAL_IMAGE" "$ECR_URI:prod-$SHA"
docker tag "$LOCAL_IMAGE" "$ECR_URI:prod-latest"
docker push "$ECR_URI:prod-$SHA"
docker push "$ECR_URI:prod-latest"

# -- 4. Service: every parameter explicit, as deploy-prod.yml passes them. --------------------
say "4. Service stack (autoscaling capped at 4)"
# A first create that fails leaves the stack in ROLLBACK_COMPLETE, which CloudFormation can
# neither update nor deploy over -- it must be deleted first. Only that exact state, only
# this stack, only in the new account: it holds nothing (a rollback removed every resource).
# Measured 2026-10-12: the first attempt failed while App Runner's subscription was still
# activating on the new account.
state="$(aws cloudformation describe-stacks --profile "$NEW_PROFILE" --region "$REGION" \
  --stack-name "$SERVICE_STACK" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo NONE)"
if [ "$state" = "ROLLBACK_COMPLETE" ]; then
  echo "  removing the failed first attempt ($SERVICE_STACK is $state)"
  aws cloudformation delete-stack --profile "$NEW_PROFILE" --region "$REGION" --stack-name "$SERVICE_STACK"
  aws cloudformation wait stack-delete-complete --profile "$NEW_PROFILE" --region "$REGION" --stack-name "$SERVICE_STACK"
fi
aws cloudformation deploy --profile "$NEW_PROFILE" --region "$REGION" \
  --stack-name "$SERVICE_STACK" \
  --template-file "$REPO_ROOT/infra/aws/climate-project-api-prod-service.yml" \
  --capabilities CAPABILITY_NAMED_IAM \
  --tags Project=climate-project-api Environment=production \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    ServiceName="$SERVICE_NAME" \
    EnvironmentName=production \
    AspNetCoreEnvironment=Production \
    ImageIdentifier="$ECR_URI:prod-$SHA" \
    EcrAccessRoleArn="$ECR_ACCESS_ROLE" \
    HealthCheckPath=/ready \
    Cpu="0.25 vCPU" \
    Memory="0.5 GB" \
    AutoScalingMaxSize=4 \
    CorsAllowedOrigin="$CORS_ORIGIN" \
    CorsAllowedWildcardOrigin="$CORS_WILDCARD" \
    CorsAdditionalAllowedOrigin="" \
    CorsAdditionalAllowedWildcardOrigin="" \
    TrackingJwtSecretArn="$TRACKING_JWT_SECRET_ARN" \
    TrackingJwtSecretPreviousArn="" \
    DatabaseConnectionStringSecretArn="$DATABASE_CONNECTION_STRING_SECRET_ARN" \
    InternalApiKeySecretArn="$INTERNAL_API_KEY_SECRET_ARN" \
    EmailSmtpUsernameSecretArn="$EMAIL_SMTP_USERNAME_SECRET_ARN" \
    EmailSmtpPasswordSecretArn="$EMAIL_SMTP_PASSWORD_SECRET_ARN"
SERVICE_URL="$(out "$SERVICE_STACK" ServiceUrl)"
SERVICE_ARN="$(out "$SERVICE_STACK" ServiceArn)"

# Ask App Runner itself, not CloudFormation: on 2026-10-12 the old stack still listed a
# service App Runner reported DELETED.
status="$(aws apprunner describe-service --profile "$NEW_PROFILE" --region "$REGION" \
  --service-arn "$SERVICE_ARN" --query Service.Status --output text)"
echo "service=$SERVICE_URL status=$status"

# -- 5. The same canary deploy-prod uses: 20 consecutive /ready 200s. ------------------------
say "5. Readiness canary on https://$SERVICE_URL/ready"
consecutive=0; deadline=$(( $(date +%s) + 600 ))
while [ "$consecutive" -lt 20 ]; do
  [ "$(date +%s)" -lt "$deadline" ] || { echo "canary timed out at $consecutive consecutive" >&2; exit 1; }
  code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "https://$SERVICE_URL/ready" || true)"
  if [ "$code" = "200" ]; then consecutive=$((consecutive + 1)); else consecutive=0; fi
  sleep 3
done
curl -s "https://$SERVICE_URL/version"; echo

# -- 6. Logs expire after 30 days (they never did). -------------------------------------------
say "6. 30-day retention on the service's log groups"
for group in $(aws logs describe-log-groups --profile "$NEW_PROFILE" --region "$REGION" \
    --log-group-name-prefix "/aws/apprunner/$SERVICE_NAME/" --query 'logGroups[].logGroupName' --output text); do
  aws logs put-retention-policy --profile "$NEW_PROFILE" --region "$REGION" \
    --log-group-name "$group" --retention-in-days 30
  echo "  30 days: $group"
done

say "DONE -- the API runs at https://$SERVICE_URL"
echo "Secret ARNs for the GitHub 'production' environment:"
cat "$SECRET_ARNS_FILE"
rm -f "$SECRET_ARNS_FILE"
echo
echo "Next: point api.climate.timsint.com at it (custom domain + DNS) -- the API is not"
echo "reachable at its public name until then."
