#!/usr/bin/env bash
#
# Roll the climate-project API App Runner service back to a previously-built image.
#
# THIS IS THE MECHANISM FOR #159. Read docs/runbooks/rollback.md before running it.
#
# What it does, and nothing else: changes ONE CloudFormation parameter --
# ImageIdentifier -- on the service stack, re-passing every other parameter with the
# value the LIVE STACK currently holds. It does not build, it does not test, it does
# not touch the database, and it does not move the `*-latest` tag.
#
# ---------------------------------------------------------------------------------
# Why it re-passes the LIVE STACK's parameters and not the repository's variables
# ---------------------------------------------------------------------------------
# `aws cloudformation deploy` reuses a parameter's previous stack value when the
# parameter is omitted, which is why deploy-prod.yml passes all thirteen explicitly:
# for a DEPLOY, this repository is the source of truth, and an omitted parameter
# makes the live configuration a function of invisible prior state.
#
# A ROLLBACK inverts that. The thing you are trying to get back to is the
# configuration that was running five minutes ago, not the configuration main
# describes -- main may have changed a CORS origin, a secret ARN or an instance size
# since, and smuggling those in while an incident is running turns a one-variable
# change into an unknown-variable change. So this script reads the live stack's
# current parameters, prints every one of them, and overrides exactly ImageIdentifier.
#
# The consequence to know: if a bad *configuration* is what you are rolling back,
# this script will faithfully preserve it. Fix configuration by dispatching the
# normal deploy workflow with the repository variable corrected, not with this.
#
# ---------------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------------
#   scripts/rollback-api-image.sh --stack climate-project-api-prod --target-sha <40-hex>
#
# Dry run is the DEFAULT. Nothing is changed until --execute is passed.
#
#   --stack           climate-project-api-prod | climate-project-api-staging
#   --target-sha      the 40-character commit SHA to roll back to. The image tag is
#                     derived as <prefix>-<sha>; see --tag-prefix.
#   --tag-prefix      prod | staging. Defaults from --stack.
#   --bootstrap-stack defaults from --stack.
#   --region          defaults to us-east-1.
#   --execute         actually perform the stack update. Omit for a dry run.
#   --base-url        service base URL for the post-rollback /version assertion.
#                     Defaults to the stack's own ServiceUrl output.
#
# Exit codes: 0 rolled back (or dry run printed), 1 refused/failed, 2 usage error.

set -euo pipefail

REGION="us-east-1"
STACK=""
BOOTSTRAP_STACK=""
TAG_PREFIX=""
TARGET_SHA=""
BASE_URL=""
EXECUTE=0

# The two stacks this script is allowed to name. A rollback is typed under pressure,
# and a typo that resolves to some other stack in the account is a worse outcome than
# a refusal. Add a name here deliberately, never by parameterising it away.
ALLOWED_STACKS="climate-project-api-prod climate-project-api-staging"

die() { echo "ERROR: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --stack) STACK="${2:-}"; shift 2 ;;
    --bootstrap-stack) BOOTSTRAP_STACK="${2:-}"; shift 2 ;;
    --tag-prefix) TAG_PREFIX="${2:-}"; shift 2 ;;
    --target-sha) TARGET_SHA="${2:-}"; shift 2 ;;
    --base-url) BASE_URL="${2:-}"; shift 2 ;;
    --region) REGION="${2:-}"; shift 2 ;;
    --execute) EXECUTE=1; shift ;;
    -h|--help) sed -n '1,50p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -n "$STACK" ] || { echo "usage: $0 --stack <name> --target-sha <40-hex> [--execute]" >&2; exit 2; }
[ -n "$TARGET_SHA" ] || { echo "usage: $0 --stack <name> --target-sha <40-hex> [--execute]" >&2; exit 2; }

case " $ALLOWED_STACKS " in
  *" $STACK "*) ;;
  *) die "--stack must be one of: $ALLOWED_STACKS (got '$STACK')" ;;
esac

# A short SHA is the single most likely thing to be typed here, and it would produce
# an image tag that does not exist -- caught below by the ECR check, but caught here
# with a better message.
printf '%s' "$TARGET_SHA" | grep -qE '^[0-9a-f]{40}$' \
  || die "--target-sha must be a full 40-character commit SHA, not '$TARGET_SHA'. \
Read it from the deploy run that built the image, or from a previous /version response."

if [ -z "$TAG_PREFIX" ]; then
  case "$STACK" in
    *-prod) TAG_PREFIX="prod" ;;
    *-staging) TAG_PREFIX="staging" ;;
  esac
fi
if [ -z "$BOOTSTRAP_STACK" ]; then
  case "$STACK" in
    climate-project-api-prod) BOOTSTRAP_STACK="climate-project-api-bootstrap" ;;
    climate-project-api-staging) BOOTSTRAP_STACK="climate-project-api-staging-bootstrap" ;;
  esac
fi

TEMPLATE_FILE="$(cd "$(dirname "$0")/.." && pwd)/infra/aws/climate-project-api-prod-service.yml"
[ -f "$TEMPLATE_FILE" ] || die "template not found at $TEMPLATE_FILE (run this from a checkout)"

echo "=== rollback-api-image ==="
echo "stack:            $STACK"
echo "bootstrap stack:  $BOOTSTRAP_STACK"
echo "region:           $REGION"
echo "target sha:       $TARGET_SHA"
echo "template:         $TEMPLATE_FILE"
echo "mode:             $([ "$EXECUTE" -eq 1 ] && echo EXECUTE || echo 'DRY RUN (pass --execute to apply)')"
echo

# ---------------------------------------------------------------------------------
# 1. Resolve the ECR repository and PROVE the target image still exists.
# ---------------------------------------------------------------------------------
# The bootstrap stack's lifecycle policy keeps the most recent 40 <prefix>-* images
# and expires the rest, so the rollback horizon is the last 40 deploys of that
# environment -- not forever. An expired tag is the one failure this script must
# catch before it starts a stack update, because a CloudFormation update to a
# nonexistent image leaves App Runner attempting a pull it cannot satisfy.
ECR_REPOSITORY_URI="$(aws cloudformation describe-stacks \
  --region "$REGION" --stack-name "$BOOTSTRAP_STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='EcrRepositoryUri'].OutputValue | [0]" \
  --output text)"
[ -n "$ECR_REPOSITORY_URI" ] && [ "$ECR_REPOSITORY_URI" != "None" ] \
  || die "could not read EcrRepositoryUri from $BOOTSTRAP_STACK"

ECR_REPOSITORY_NAME="${ECR_REPOSITORY_URI##*/}"
TARGET_TAG="${TAG_PREFIX}-${TARGET_SHA}"
TARGET_IMAGE="${ECR_REPOSITORY_URI}:${TARGET_TAG}"

echo "--- checking that $TARGET_TAG still exists in ECR ---"
if ! aws ecr describe-images --region "$REGION" \
      --repository-name "$ECR_REPOSITORY_NAME" \
      --image-ids "imageTag=${TARGET_TAG}" \
      --query 'imageDetails[0].{pushedAt:imagePushedAt,digest:imageDigest,tags:imageTags}' \
      --output table 2>/dev/null; then
  die "image tag '$TARGET_TAG' is not present in ECR repository '$ECR_REPOSITORY_NAME'.
The lifecycle policy keeps only the most recent 40 ${TAG_PREFIX}-* images
(infra/aws/climate-project-api-bootstrap.yml), so a target older than that is gone and
the rollback becomes a rebuild. List what is available with:
  aws ecr describe-images --region $REGION --repository-name $ECR_REPOSITORY_NAME \\
    --query 'reverse(sort_by(imageDetails,&imagePushedAt))[].{pushed:imagePushedAt,tags:imageTags}' --output table"
fi
echo

# ---------------------------------------------------------------------------------
# 2. Read the live stack's parameters and note what is currently running.
# ---------------------------------------------------------------------------------
PARAMS_JSON="$(aws cloudformation describe-stacks --region "$REGION" \
  --stack-name "$STACK" --query 'Stacks[0].Parameters' --output json)"

CURRENT_IMAGE="$(printf '%s' "$PARAMS_JSON" \
  | jq -r '.[] | select(.ParameterKey=="ImageIdentifier") | .ParameterValue')"

echo "--- currently deployed (per the stack) ---"
echo "ImageIdentifier: ${CURRENT_IMAGE:-<none>}"
echo
echo "--- every other parameter, re-passed verbatim ---"
printf '%s' "$PARAMS_JSON" | jq -r '.[] | select(.ParameterKey!="ImageIdentifier") | "  \(.ParameterKey)=\(.ParameterValue)"'
echo

if [ "$CURRENT_IMAGE" = "$TARGET_IMAGE" ]; then
  die "the stack already names $TARGET_IMAGE. Nothing to roll back.
If the SERVICE is running something else, the stack has drifted -- that is what a
break-glass 'aws apprunner update-service' leaves behind. Check with:
  aws apprunner describe-service --region $REGION --service-arn <arn> \\
    --query 'Service.SourceConfiguration.ImageRepository.ImageIdentifier'"
fi

# Build the parameter-overrides array. NUL-free read loop rather than mapfile, so
# this runs on the bash 3.2 that ships with macOS. Values legitimately contain
# spaces ("0.25 vCPU") and are legitimately empty (the optional CORS origins, whose
# emptiness is load-bearing -- see the template's Conditions).
PARAM_OVERRIDES=()
while IFS= read -r line; do
  [ -n "$line" ] && PARAM_OVERRIDES+=("$line")
done < <(printf '%s' "$PARAMS_JSON" | jq -r '.[] | select(.ParameterKey!="ImageIdentifier") | "\(.ParameterKey)=\(.ParameterValue)"')
PARAM_OVERRIDES+=("ImageIdentifier=${TARGET_IMAGE}")

echo "--- the command ---"
echo "aws cloudformation deploy \\"
echo "  --region $REGION \\"
echo "  --stack-name $STACK \\"
echo "  --template-file $TEMPLATE_FILE \\"
echo "  --capabilities CAPABILITY_NAMED_IAM \\"
echo "  --no-fail-on-empty-changeset \\"
echo "  --parameter-overrides \\"
for p in "${PARAM_OVERRIDES[@]}"; do
  echo "    '$p' \\"
done
echo
echo "NOT run: any EF Core migration. A rollback is code-only by design; the schema"
echo "is a separate, deliberate decision -- docs/runbooks/rollback.md section 4."
echo "NOT moved: the ${TAG_PREFIX}-latest tag. It still points at the image you are"
echo "rolling AWAY from, which is correct: it means 'newest built', not 'running'."
echo

if [ "$EXECUTE" -ne 1 ]; then
  echo "DRY RUN complete. Nothing was changed. Re-run with --execute to apply."
  exit 0
fi

# ---------------------------------------------------------------------------------
# 3. Execute.
# ---------------------------------------------------------------------------------
START_EPOCH="$(date -u +%s)"
echo "--- executing at $(date -u +%Y-%m-%dT%H:%M:%SZ) ---"
aws cloudformation deploy \
  --region "$REGION" \
  --stack-name "$STACK" \
  --template-file "$TEMPLATE_FILE" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides "${PARAM_OVERRIDES[@]}"

STACK_DONE_EPOCH="$(date -u +%s)"
echo "CloudFormation update returned after $((STACK_DONE_EPOCH - START_EPOCH))s."

# ---------------------------------------------------------------------------------
# 4. Assert the SERVICE is actually serving the target commit.
# ---------------------------------------------------------------------------------
# CloudFormation returning is not the same event as traffic moving. This is the same
# assertion deploy-prod.yml makes after a rollout, and for the same reason: production
# once sat 156 commits behind main with every signal green, because "the deploy
# succeeded" and "the new code is serving" are different claims.
if [ -z "$BASE_URL" ]; then
  SERVICE_URL="$(aws cloudformation describe-stacks --region "$REGION" \
    --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='ServiceUrl'].OutputValue | [0]" --output text)"
  [ -n "$SERVICE_URL" ] && [ "$SERVICE_URL" != "None" ] || die "could not read ServiceUrl from $STACK"
  BASE_URL="https://${SERVICE_URL}"
fi

echo "--- waiting for $BASE_URL/version to report $TARGET_SHA ---"
DEADLINE=$(( $(date -u +%s) + 600 ))
while [ "$(date -u +%s)" -lt "$DEADLINE" ]; do
  LIVE_SHA="$(curl -sS --max-time 20 "${BASE_URL%/}/version" 2>/dev/null | jq -r '.commit // empty' || true)"
  if [ "$LIVE_SHA" = "$TARGET_SHA" ]; then
    END_EPOCH="$(date -u +%s)"
    echo
    echo "ROLLED BACK. $BASE_URL is serving $TARGET_SHA."
    echo "Total wall clock, command issued -> target commit serving: $((END_EPOCH - START_EPOCH))s"
    echo
    echo "Record that number in docs/runbooks/rollback.md's measurement table."
    echo "Still outstanding, and NOT done by this script:"
    echo "  - the schema check (rollback.md section 4)"
    echo "  - the web layer (Vercel) if it also needs rolling back (rollback.md section 3)"
    exit 0
  fi
  echo "  /version reports '${LIVE_SHA:-<unreachable>}', waiting..."
  sleep 10
done

die "after 600s, $BASE_URL/version still does not report $TARGET_SHA.
The stack update may have succeeded while the App Runner rollout did not take.
Check the service's operation history:
  aws apprunner list-operations --region $REGION --service-arn <arn> --max-results 5"
