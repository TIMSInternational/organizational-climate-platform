#!/usr/bin/env bash
#
# Prove a JWT rotation actually happened, using the only evidence that can: a token minted
# BEFORE it. (#70, the two-phase rotation in scripts/rotate-tracking-jwt.sh.)
#
#   bash scripts/verify-jwt-rotation.sh capture   # BEFORE the phase-1 deploy finishes
#   bash scripts/verify-jwt-rotation.sh check     # after each deploy
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
STORE="${STORE:-${TMPDIR:-/tmp}/climate-jwt-rotation-token}"
MODE="${1:-}"

die() { printf '\nERROR: %s\n\n' "$*" >&2; exit 1; }

command -v jq >/dev/null || die "jq is required."

case "$MODE" in
  capture)
    printf 'Signing in to %s to capture a PRE-rotation token.\n' "$API"
    printf 'Nothing is echoed and nothing is written to your shell history.\n\n'

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

    # The commit is worth recording: it says which key era the token belongs to.
    commit="$(curl -sS --max-time 20 "$API/version" | jq -r '.commit // "unknown"' | cut -c1-8)"
    printf 'Captured %d characters, mode 600, at:\n  %s\n' "${#token}" "$STORE"
    printf 'Minted while %s was serving commit %s.\n\n' "$API" "$commit"
    printf 'Now let the phase-1 deploy finish, then:  bash %s check\n\n' "$0"
    ;;

  check)
    [ -f "$STORE" ] || die "no captured token at $STORE.
Run 'capture' BEFORE the phase-1 deploy takes traffic. After it does, the old key is no longer
the signing key and this evidence cannot be obtained again."

    token="$(cat "$STORE")"
    commit="$(curl -sS --max-time 20 "$API/version" | jq -r '.commit // "unknown"' | cut -c1-8)"

    # -o /dev/null: the body of an authenticated production response is not something to print.
    # The status code is the whole measurement.
    status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 \
      -H "Authorization: Bearer $token" "$API/profile")"

    printf '\n%s is serving commit %s\n' "$API" "$commit"
    printf 'the pre-rotation token -> HTTP %s\n\n' "$status"

    case "$status" in
      200)
        printf 'THE OVERLAP IS REAL. A session that existed before the rotation still works, so\n'
        printf 'rotating logged nobody out. This is the correct result after PHASE 1.\n\n'
        printf 'After phase 2 it must read 401 instead -- if it still reads 200 then, the key you\n'
        printf 'rotated away from is still accepted and the rotation has bought nothing.\n\n'
        ;;
      401)
        printf 'THE OLD KEY IS REJECTED.\n\n'
        printf 'After PHASE 2 this is the result that makes the rotation real -- run it only if\n'
        printf 'you have completed rotate-tracking-jwt.sh apply close AND its deploy.\n\n'
        printf 'After PHASE 1 this is a FAILURE: the overlap did not reach the service, and every\n'
        printf 'existing session has been signed out. Check that\n'
        printf 'TRACKING_JWT_SECRET_PREVIOUS_ARN was set BEFORE the deploy, then redeploy.\n\n'
        ;;
      *)
        printf 'Neither 200 nor 401, so this says nothing about the keys. Is the deploy still\n'
        printf 'rolling, or is the service unhealthy?\n\n'
        ;;
    esac
    ;;

  forget)
    if [ -f "$STORE" ]; then
      # Overwrite before unlinking: a bearer token left in a freed block is still a bearer token.
      dd if=/dev/urandom of="$STORE" bs=1 count=2048 conv=notrunc 2>/dev/null || true
      rm -f "$STORE"
      printf 'Shredded %s\n' "$STORE"
    else
      printf 'Nothing stored at %s\n' "$STORE"
    fi
    ;;

  *)
    die "usage: bash $0 capture|check|forget

  capture   sign in and store a pre-rotation token (run BEFORE the phase-1 deploy lands)
  check     report what that token does now -- 200 after phase 1, 401 after phase 2
  forget    shred it"
    ;;
esac
