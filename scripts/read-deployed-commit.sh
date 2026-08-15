#!/usr/bin/env bash
# Print, on stdout, the git commit SHA the live service reports at GET /version.
#
# Why this is a script and not two copies of three lines: two workflows now ask the
# same question of the same endpoint for different reasons. deploy-prod.yml asks
# "did the rollout I just performed take effect?" and compares against GITHUB_SHA;
# .github/workflows/verify-deployed-commit.yml asks "has what is live fallen behind
# main?" and compares against origin/main. Only the comparison differs -- the
# endpoint, the JSON key and the ways the answer can be untrustworthy are identical,
# and it is those last two that are worth having in one place.
#
# Usage:  read-deployed-commit.sh <base-url> [body-output-path]
#
# Contract:
#   stdout  a single 40-hex commit SHA, and nothing else, so callers can capture it
#   stderr  the full /version body, so both callers keep runtime/builtAt in their logs
#   arg 2   optional path to write the raw body to, for a caller that also wants a
#           field other than .commit. Reading it back off stderr would work but would
#           mean a caller that redirects stderr also swallows the error message below.
#   exit 0  the service answered with a well-formed commit
#   exit 1  the service answered, but not with a commit SHA (see below)
#   exit 2  usage error
#   other   curl's own exit code, via `set -e` -- unreachable service, non-2xx, timeout
#
# The SHA-shape check is not defensive padding. BuildInfo.CommitSha reports the
# literal string "unknown" for any build that did not go through the Docker/CI path
# (see src/ClimateProject.Api/BuildInfo.cs), so "unknown" in production means an
# image built on somebody's laptop is serving traffic -- a finding, not a parse
# error. Without this check `jq -r '.commit'` hands that string on as though it were
# a commit and the caller reports a mundane mismatch instead.

set -euo pipefail

BASE_URL="${1:-}"
BODY_OUTPUT_PATH="${2:-}"
if [ -z "$BASE_URL" ]; then
  echo "usage: $0 <base-url> [body-output-path]" >&2
  echo "  e.g. $0 https://bhgrdkd4gt.us-east-1.awsapprunner.com" >&2
  exit 2
fi

URL="${BASE_URL%/}/version"

# -f so a 5xx is an error rather than a body to parse; --max-time so a hung service
# fails the step instead of the job's six-hour ceiling.
BODY="$(curl -sSf --max-time 30 "$URL")"
printf '%s\n' "$BODY" >&2
if [ -n "$BODY_OUTPUT_PATH" ]; then
  printf '%s\n' "$BODY" > "$BODY_OUTPUT_PATH"
fi

COMMIT="$(printf '%s' "$BODY" | jq -r '.commit // empty')"

if ! printf '%s' "$COMMIT" | grep -qE '^[0-9a-f]{40}$'; then
  echo "::error::$URL reported '${COMMIT:-<no commit field>}' where a 40-character commit SHA was expected. 'unknown' means the live image was built outside the CI/Docker path and carries no provenance; anything else means /version's shape changed." >&2
  exit 1
fi

printf '%s\n' "$COMMIT"
