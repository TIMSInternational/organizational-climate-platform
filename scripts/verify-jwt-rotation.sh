#!/usr/bin/env bash
#
# Prove a JWT rotation actually happened, using the only evidence that can: a token minted
# BEFORE it. (#70, the two-phase rotation in scripts/rotate-tracking-jwt.sh.)
#
#   bash scripts/verify-jwt-rotation.sh capture   # BEFORE the phase-1 deploy finishes
#   bash scripts/verify-jwt-rotation.sh check     # after each deploy
#   bash scripts/verify-jwt-rotation.sh config    # read-only: is the old key still loaded?
#   bash scripts/verify-jwt-rotation.sh forget    # shred the stored token
#
# ## Why a script and not a curl one-liner
#
# Twice on 2026-09-28 a hand-off command carried a value meant to be filled in -- an address,
# then a bearer token -- and both were pasted verbatim. The second produced a 401 that looked
# like a failed rotation and was a malformed header. A script has no slot to paste into: it
# prompts, and it never echoes what it reads.
#
# ## Why the token has to be captured early, and cannot be re-obtained
#
# The phases only mean something against a token signed with the OLD key:
#
#   phase 1 (open)   deploy with the previous key accepted  -> the old token must still be 200.
#                    That is the overlap, and it is why rotating logs nobody out.
#   phase 2 (close)  deploy with the previous key removed   -> the same token must now be 401.
#                    THIS is what makes the rotation real. Until it 401s, the value you rotated
#                    away from still opens the door.
#
# A fresh login proves neither: after phase 1 it is signed with the NEW key, so it succeeds
# whether or not the old key still works. Once the phase-1 deploy takes traffic the old key is
# no longer the signing key and this evidence can never be obtained again -- so `capture` has to
# run while the previous revision is still serving.
#
# ## The token is a production credential, and this treats it as one
#
# It is written to a mode-600 file in $TMPDIR, outside the repository, never printed, never put
# on a command line (which would expose it in `ps` and in shell history), and `forget` shreds
# it. It expires on its own in one token lifetime (24h). Run `forget` when phase 2 is done.
#
set -euo pipefail

API="${API:-https://api.climate.timsint.com}"
REGION="${AWS_REGION:-us-east-1}"
SERVICE_STACK="${SERVICE_STACK:-climate-project-api-prod}"
EXPECT_ACCOUNT="${EXPECT_ACCOUNT:-747814092517}"
STORE="${STORE:-${TMPDIR:-/tmp}/climate-jwt-rotation-token}"
BASELINE="${BASELINE:-${STORE:-${TMPDIR:-/tmp}/climate-jwt-rotation-token}.commit}"
MODE="${1:-}"

die() { printf '\nERROR: %s\n\n' "$*" >&2; exit 1; }

command -v jq >/dev/null || die "jq is required."

case "$MODE" in
  capture)
    printf 'Signing in to %s and storing the token it mints, with the revision that minted it.\n' "$API"
    printf 'Nothing is echoed and nothing is written to your shell history.\n\n'
    # This wording used to say "a PRE-rotation token", which misread its second, equally useful
    # job: run AFTER a rotation it is the cheapest proof that the NEW key signs working tokens --
    # a check nothing else performs, because a broken signing key returns 401 and every alarm here
    # watches for 5xx and unauthenticated health.
    printf 'Before a rotation this is the evidence phase 2 needs. After one it proves the new key\n'
    printf 'signs working tokens, which no alarm can tell you.\n\n'

    # `read -r -s` keeps the password off the screen; neither value is ever passed as an
    # argument, only on stdin to curl via a here-doc, so it stays out of `ps`.
    printf 'email:    '
    IFS= read -r email
    printf 'password: '
    IFS= read -r -s password
    printf '\n\n'
    [ -n "$email" ] && [ -n "$password" ] || die "both are required."

    response="$(jq -nc --arg e "$email" --arg p "$password" '{email:$e,password:$p}' \
      | curl -sS --max-time 30 -X POST "$API/auth/login" \
          -H 'Content-Type: application/json' --data @- )"
    unset password

    token="$(printf '%s' "$response" | jq -r '.token // empty')"
    if [ -z "$token" ]; then
      die "no token in the response: $(printf '%s' "$response" | head -c 200)
A 401 here is a wrong password, not a rotation problem -- the phase-1 deploy has not removed
anything yet."
    fi

    umask 077
    printf '%s' "$token" > "$STORE"
    chmod 600 "$STORE"

    # Record WHICH revision minted it, not as a nicety but as the baseline `check` compares
    # against. Without it, a 200 from the pre-rotation revision -- which validates with the old
    # key because it IS the old deployment -- reads exactly like a working overlap. That happened
    # on 2026-09-28: the check said "THE OVERLAP IS REAL" while the deploy was still on step 5.
    commit="$(curl -sS --max-time 20 "$API/version" | jq -r '.commit // "unknown"' | cut -c1-8)"
    printf '%s' "$commit" > "$BASELINE"
    chmod 600 "$BASELINE"
    printf 'Captured %d characters, mode 600, at:\n  %s\n' "${#token}" "$STORE"
    printf 'Minted while %s was serving commit %s.\n\n' "$API" "$commit"
    printf 'If this is the pre-rotation capture: let the phase-1 deploy land, then run\n'
    printf '  bash %s check\n' "$0"
    printf 'If you were checking that logins work after a rotation: they do, and this token is a\n'
    printf 'live production credential -- run  bash %s forget  now.\n\n' "$0"
    ;;

  check)
    [ -f "$STORE" ] || die "no captured token at $STORE.
Run 'capture' BEFORE the phase-1 deploy takes traffic. After it does, the old key is no longer
the signing key and this evidence cannot be obtained again."

    token="$(cat "$STORE")"
    commit="$(curl -sS --max-time 20 "$API/version" | jq -r '.commit // "unknown"' | cut -c1-8)"

    # THE GATE. A status code only means something once the deploy has replaced the revision that
    # minted the token. Before that, the service still holds the old key as its SIGNING key and a
    # 200 says nothing about whether a previous key is accepted.
    if [ -f "$BASELINE" ]; then
      baseline="$(cat "$BASELINE")"
      if [ "$commit" = "$baseline" ]; then
        printf '\n%s is still serving %s -- the same revision that minted this token.\n\n' "$API" "$commit"
        printf 'INCONCLUSIVE. The deploy has not landed yet, so the running service still uses the\n'
        printf 'OLD key to sign AND to validate. A 200 here would only prove that the old deployment\n'
        printf 'accepts its own tokens, which was never in question.\n\n'
        printf 'Wait for the deploy to finish, then run this again.\n\n'
        exit 3
      fi
      printf '\nrevision moved %s -> %s since the token was minted.\n' "$baseline" "$commit"
    else
      printf '\nNo baseline commit recorded (token captured before this check existed).\n'
      printf 'Confirm yourself that the deploy has LANDED before trusting anything below: a 200\n'
      printf 'from the pre-rotation revision proves nothing.\n'
    fi

    # -o /dev/null: the body of an authenticated production response is not something to print.
    # The status code is the whole measurement.
    status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 \
      -H "Authorization: Bearer $token" "$API/profile")"

    printf '\n%s is serving commit %s\n' "$API" "$commit"
    printf 'the pre-rotation token -> HTTP %s\n\n' "$status"

    # Which phase are we in? The repository variable is the answer: phase 1 sets it, phase 2
    # clears it. Reading it turns two conditional readings into one verdict -- worth doing,
    # because the two runs are a day apart and "which phase was I in" is exactly what a person
    # gets wrong at that distance.
    phase=unknown
    if command -v gh >/dev/null 2>&1; then
      prev_arn="$(gh variable list --json name,value \
        --jq '.[]|select(.name=="TRACKING_JWT_SECRET_PREVIOUS_ARN").value' 2>/dev/null || true)"
      [ -n "$prev_arn" ] && phase=1 || phase=2
      printf 'TRACKING_JWT_SECRET_PREVIOUS_ARN is %s, so this is PHASE %s.\n' \
        "$([ -n "$prev_arn" ] && echo set || echo cleared)" "$phase"
    fi

    case "$status" in
      200)
        case "$phase" in
          1) printf '\nTHE OVERLAP IS REAL. A session from before the rotation still works, so\n'
             printf 'rotating logged nobody out. Phase 1 is correct and complete.\n\n'
             printf 'Next: wait one token lifetime (24h), then rotate-tracking-jwt.sh apply close,\n'
             printf 'deploy, and run this again -- it must read 401.\n\n' ;;
          2) printf '\nFAILURE. The previous key is CLEARED and a pre-rotation token still works, so\n'
             printf 'the key you rotated away from is still accepted and the rotation has bought\n'
             printf 'nothing. Did the phase-2 deploy actually run?\n\n' ;;
          *) printf '\nA pre-rotation token still works. That is correct after PHASE 1 and a FAILURE\n'
             printf 'after phase 2. Install gh, or check TRACKING_JWT_SECRET_PREVIOUS_ARN by hand.\n\n' ;;
        esac
        ;;
      401)
        case "$phase" in
          2) printf '\nTHE ROTATION IS REAL. The previous key is cleared and a token signed with it is\n'
             printf 'rejected. This is the result #70 was asking for.\n\n'
             printf 'Next: bash %s forget, and record the date in docs/security/rotation-inventory.md.\n\n' "$0" ;;
          1) printf '\nFAILURE. The previous key is still SET, so a pre-rotation token should work and\n'
             printf 'does not: the overlap never reached the service and every existing session has\n'
             printf 'been signed out. Confirm the variable was set BEFORE the deploy, then redeploy.\n\n' ;;
          *) printf '\nA pre-rotation token is rejected. That is success after PHASE 2 and a FAILURE\n'
             printf 'after phase 1. Install gh, or check TRACKING_JWT_SECRET_PREVIOUS_ARN by hand.\n\n' ;;
        esac
        ;;
      *)
        printf 'Neither 200 nor 401, so this says nothing about the keys. Is the deploy still\n'
        printf 'rolling, or is the service unhealthy?\n\n'
        ;;
    esac
    ;;

  config)
    # ---------------------------------------------------------------------------------------
    # The structural proof, and why it exists.
    #
    # The end-to-end proof is a pre-rotation token returning 401. It is the best evidence and it
    # is also fragile: it cannot be re-obtained once the phase-1 deploy lands, so `forget` run at
    # the wrong moment destroys it. That happened on 2026-09-28, before phase 2 had run.
    #
    # This is the proof that survives. The running service holds its keys in App Runner's
    # RuntimeEnvironmentSecrets; the app reads the previous key from TrackingJwtSecretPrevious
    # (JwtSigningKeys.cs, #508) and accepts nothing it was not given. So if that entry is absent
    # from the live service, the old key is not loaded and a token signed with it cannot validate
    # -- which is the same conclusion, reached from configuration rather than from a request.
    #
    # It is weaker in one specific way, stated rather than glossed: it shows the key is not
    # PRESENT, not that a request carrying one is rejected. tests/.../TrackingJwtRotationTests.cs
    # is what closes that gap, and it runs in CI.
    #
    # Read-only: describe-stacks and describe-service.
    # ---------------------------------------------------------------------------------------
    command -v aws >/dev/null || die "aws CLI not found."
    account="$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo unknown)"
    if [ "$account" != "$EXPECT_ACCOUNT" ]; then
      die "credentials are for account $account, not $EXPECT_ACCOUNT.
Set AWS_PROFILE=formmaps-deploy (or claude) and try again."
    fi

    arn="$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$SERVICE_STACK" \
      --query "Stacks[0].Outputs[?OutputKey=='ServiceArn'].OutputValue | [0]" --output text)"
    [ -n "$arn" ] && [ "$arn" != "None" ] || die "no ServiceArn output on $SERVICE_STACK."

    secrets_json="$(aws apprunner describe-service --region "$REGION" --service-arn "$arn" \
      --query 'Service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentSecrets' \
      --output json)"
    total="$(printf '%s' "$secrets_json" | jq 'length')"
    has_prev="$(printf '%s' "$secrets_json" | jq 'has("TrackingJwtSecretPrevious")')"

    printf '\naccount %s   service %s\n' "$account" "${arn##*/}"
    printf 'RuntimeEnvironmentSecrets entries: %s\n' "$total"
    printf 'TrackingJwtSecretPrevious:         %s\n\n' "$([ "$has_prev" = true ] && echo PRESENT || echo ABSENT)"

    if [ "$has_prev" = true ]; then
      printf 'THE OLD KEY IS STILL LOADED. The service was given a previous key, so a token signed\n'
      printf 'with the retired value is still accepted. Correct DURING the overlap (after phase 1);\n'
      printf 'after phase 2 and its deploy it means the rotation has not taken effect.\n\n'
      exit 2
    fi
    printf 'THE OLD KEY IS NOT LOADED. The service holds no previous key, so nothing signed with\n'
    printf 'the retired value can validate against it.\n\n'
    printf 'This is the structural proof, and it is not the same as a rejected request: it shows the\n'
    printf 'key is absent, not that a token carrying it 401s. That gap is closed by\n'
    printf 'tests/ClimateProject.IntegrationTests/Security/TrackingJwtRotationTests.cs, in CI.\n\n'
    exit 0
    ;;

  forget)
    if [ -f "$STORE" ]; then
      # Overwrite before unlinking: a bearer token left in a freed block is still a bearer token.
      dd if=/dev/urandom of="$STORE" bs=1 count=2048 conv=notrunc 2>/dev/null || true
      rm -f "$STORE" "$BASELINE"
      printf 'Shredded %s\n' "$STORE"
    else
      printf 'Nothing stored at %s\n' "$STORE"
    fi
    ;;

  *)
    die "usage: bash $0 capture|check|config|forget

  capture   sign in and store a pre-rotation token (run BEFORE the phase-1 deploy lands)
  check     report what that token does now -- 200 after phase 1, 401 after phase 2
  config    ask the RUNNING service whether it still holds a previous key (needs no token)
  forget    shred it"
    ;;
esac
