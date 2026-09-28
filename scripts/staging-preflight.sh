#!/usr/bin/env bash
#
# Will staging actually come up? (#156, and everything it gates: #161 UAT, #159 the rollback
# rehearsal, #162 the cutover.)
#
# WHY THIS EXISTS, given deploy-staging.yml already has a preflight
#
#   That one checks each variable is NON-EMPTY. This one checks each value RESOLVES. A secret
#   ARN that is set but points at a secret in the wrong account, or at one that was deleted,
#   passes the workflow's check and fails in the middle of a deploy -- after the image is built
#   and pushed, with a CloudFormation error that names a resource rather than the variable that
#   is wrong. Measured 2026-09-28: staging's own environment carries ARNs in account
#   795965600143 while the repository-level AWS_ACCOUNT_ID is 747814092517, so "which account is
#   this value for" is a live question here, not a hypothetical.
#
#   It also answers the question from a laptop, before dispatching anything.
#
# READ-ONLY. Every call is a get/describe/list. It changes nothing, in either account.
#
#   usage:  bash scripts/staging-preflight.sh
#
# Exit 0 means deploy-staging.yml has everything it needs. Non-zero lists what is missing.
#
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
REPO="${REPO:-TIMSInternational/organizational-climate-platform}"
ENVIRONMENT=staging
BOOTSTRAP_STACK=climate-project-api-staging-bootstrap
SERVICE_STACK=climate-project-api-staging
DEPLOY_ROLE=climate-project-github-deploy-staging

missing=0
note() { printf '  %-44s %s\n' "$1" "$2"; }
fail() { missing=1; note "$1" "MISSING -- $2"; }

command -v gh >/dev/null || { echo "gh is required: the GitHub environment is the source of truth for these values." >&2; exit 2; }
command -v jq >/dev/null || { echo "jq is required." >&2; exit 2; }

echo "=== the GitHub 'staging' environment ==="

# Read the environment's variables once. These are what the workflow actually expands -- reading
# them from anywhere else would be checking a different thing than the one that runs.
ENV_VARS_JSON="$(gh api "repos/$REPO/environments/$ENVIRONMENT/variables" 2>/dev/null || echo '{"variables":[]}')"
ENV_SECRETS_JSON="$(gh api "repos/$REPO/environments/$ENVIRONMENT/secrets" 2>/dev/null || echo '{"secrets":[]}')"

env_var() {
  printf '%s' "$ENV_VARS_JSON" | jq -r --arg n "$1" '.variables[]? | select(.name==$n) | .value' 2>/dev/null
}
has_env_secret() {
  printf '%s' "$ENV_SECRETS_JSON" | jq -e --arg n "$1" '.secrets[]? | select(.name==$n)' >/dev/null 2>&1
}

# Exactly the list deploy-staging.yml refuses to deploy without. Kept in the same order so the
# two can be diffed by eye when one of them changes.
for v in AWS_ACCOUNT_ID CORS_ALLOWED_ORIGIN CORS_ALLOWED_WILDCARD_ORIGIN \
         TRACKING_JWT_SECRET_ARN DATABASE_CONNECTION_STRING_SECRET_ARN INTERNAL_API_KEY_SECRET_ARN; do
  value="$(env_var "$v")"
  if [ -n "$value" ]; then
    note "$v" "set"
  else
    fail "$v" "set it on the staging environment (docs/runbooks/staging-provisioning.md step 1)"
  fi
done

if has_env_secret MIGRATION_DATABASE_CONNECTION_STRING; then
  note "MIGRATION_DATABASE_CONNECTION_STRING" "set (secret)"
else
  fail "MIGRATION_DATABASE_CONNECTION_STRING" "an environment SECRET, not a variable"
fi

STAGING_ACCOUNT="$(env_var AWS_ACCOUNT_ID)"
echo
echo "=== AWS account $STAGING_ACCOUNT ==="

if [ -z "$STAGING_ACCOUNT" ]; then
  echo "  cannot check the AWS side without AWS_ACCOUNT_ID." >&2
  echo
  echo "Preflight FAILED. deploy-staging.yml would refuse to run."
  exit 1
fi

# The account trap, in its staging form. On this machine the climate PRODUCTION account
# (747814092517) is the `claude`/`formmaps-deploy` profile and staging is the DEFAULT profile --
# the reverse of every other script here, which is exactly why it is worth saying out loud.
CURRENT_ACCOUNT="$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo unknown)"
if [ "$CURRENT_ACCOUNT" != "$STAGING_ACCOUNT" ]; then
  echo "  Credentials are for account $CURRENT_ACCOUNT, but staging is $STAGING_ACCOUNT."
  echo "  The GitHub side above is checked; the AWS side is not. Re-run with a profile on"
  echo "  $STAGING_ACCOUNT to check the rest:"
  echo
  echo "      AWS_PROFILE=<staging-profile> bash scripts/staging-preflight.sh"
  echo
  [ "$missing" -eq 0 ] || { echo "Preflight FAILED on the GitHub side (above)."; exit 1; }
  echo "GitHub side complete; AWS side unchecked."
  exit 2
fi

if aws iam get-role --role-name "$DEPLOY_ROLE" >/dev/null 2>&1; then
  note "iam role $DEPLOY_ROLE" "exists"
else
  fail "iam role $DEPLOY_ROLE" "the workflow assumes it via OIDC before anything else runs"
fi

if ECR_URI="$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$BOOTSTRAP_STACK" \
      --query "Stacks[0].Outputs[?OutputKey=='EcrRepositoryUri'].OutputValue | [0]" --output text 2>/dev/null)" \
   && [ -n "$ECR_URI" ] && [ "$ECR_URI" != "None" ]; then
  note "$BOOTSTRAP_STACK" "exists -> $ECR_URI"
else
  fail "$BOOTSTRAP_STACK" "the image has nowhere to be pushed"
fi

# The whole point of this script: a set-but-wrong ARN passes the workflow's non-empty check and
# fails mid-deploy. describe-secret is the cheapest way to prove the value is real AND in this
# account -- a secret in another account returns ResourceNotFoundException here, which reads as
# "missing" and is the correct verdict for a deploy that runs with these credentials.
for v in TRACKING_JWT_SECRET_ARN DATABASE_CONNECTION_STRING_SECRET_ARN INTERNAL_API_KEY_SECRET_ARN; do
  arn="$(env_var "$v")"
  [ -n "$arn" ] || continue
  if aws secretsmanager describe-secret --region "$REGION" --secret-id "$arn" >/dev/null 2>&1; then
    note "$v resolves" "yes"
  else
    fail "$v resolves" "set, but no such secret in $STAGING_ACCOUNT/$REGION"
  fi
done

if aws cloudformation describe-stacks --region "$REGION" --stack-name "$SERVICE_STACK" >/dev/null 2>&1; then
  note "$SERVICE_STACK" "already exists (a deploy would update it)"
else
  note "$SERVICE_STACK" "absent -- expected; the first deploy creates it"
fi

echo
if [ "$missing" -ne 0 ]; then
  echo "Preflight FAILED. deploy-staging.yml would refuse to run, or fail mid-deploy."
  echo "Nothing above was changed."
  exit 1
fi
echo "Preflight PASSED. deploy-staging.yml has everything it needs."
echo "Next: dispatch deploy-staging.yml, then the rollback rehearsal (#159) has an environment."
