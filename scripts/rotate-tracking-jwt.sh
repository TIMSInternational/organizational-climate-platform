#!/usr/bin/env bash
#
# Rotate TrackingJwtSecret without logging anybody out, and without any human or model ever
# seeing the value. (#70, using the overlap window shipped in #508.)
#
# WHY THIS SCRIPT EXISTS
#
#   The runbook's section A is correct and is nine manual steps, several of which involve a
#   production signing key. Every one of those steps is a chance to paste a secret into a
#   terminal that scrolls into a log, a file, or a chat window. This does the same nine steps
#   with the value moving AWS -> AWS: it is read into a shell variable, written straight back,
#   and never echoed, never redirected to a file, never passed as a command-line argument
#   (which would put it in `ps` output for every other process on the box).
#
#   That matters more than usual here. The key being rotated is very likely the one the
#   malware-compromised legacy app used: the migration spec said "reuse the actual secret value
#   too" (docs/legacy-issues/climate-project-issues.md:560), and the secret has exactly one
#   version, created 2026-07-31, LastRotated None. Treating it carelessly during the rotation
#   would be a poor joke.
#
# WHAT IT DOES NOT DO
#
#   It does not deploy. Applying the secret change is one step; making the service read it is a
#   `deploy-prod` dispatch, which stays a deliberate human action. The script tells you when.
#
# USAGE
#
#   ./scripts/rotate-tracking-jwt.sh plan   open    # show exactly what phase 1 would do
#   ./scripts/rotate-tracking-jwt.sh apply  open    # phase 1: new key live, old key accepted
#   ...wait one token lifetime (24h)...
#   ./scripts/rotate-tracking-jwt.sh plan   close   # show exactly what phase 2 would do
#   ./scripts/rotate-tracking-jwt.sh apply  close   # phase 2: old key stops working
#
#   AWS_PROFILE must reach account 747814092517. `formmaps-deploy` and `claude` both do;
#   the DEFAULT profile does not -- it is 795965600143, which is why a describe-secret there
#   returns ResourceNotFoundException and looks like a missing secret.

set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
EXPECTED_ACCOUNT="747814092517"
CURRENT_SECRET="climate-project-api/prod/tracking-jwt-secret"
PREVIOUS_SECRET="climate-project-api/prod/tracking-jwt-secret-previous"
GH_VAR="TRACKING_JWT_SECRET_PREVIOUS_ARN"

MODE="${1:-}"
PHASE="${2:-}"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
say() { printf '  %s\n' "$*"; }

case "$MODE" in plan|apply) ;; *) die "first argument must be 'plan' or 'apply'" ;; esac
case "$PHASE" in open|close) ;; *) die "second argument must be 'open' or 'close'" ;; esac

# ---------------------------------------------------------------------------
# Preflight. Every one of these has been a real failure on this project.
# ---------------------------------------------------------------------------

command -v aws >/dev/null || die "aws CLI not found"
command -v openssl >/dev/null || die "openssl not found"

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
if [ "$ACCOUNT" != "$EXPECTED_ACCOUNT" ]; then
  die "credentials are for account $ACCOUNT, not $EXPECTED_ACCOUNT.
       Set AWS_PROFILE=formmaps-deploy (or claude) and try again. The default profile is a
       different account, where this secret does not exist."
fi

aws secretsmanager describe-secret --region "$REGION" --secret-id "$CURRENT_SECRET" >/dev/null 2>&1 \
  || die "cannot see $CURRENT_SECRET in $ACCOUNT/$REGION"

printf '\n== %s / phase %s ==\n' "$MODE" "$PHASE"
say "account:  $ACCOUNT ($REGION)"
say "current:  $CURRENT_SECRET"
say "previous: $PREVIOUS_SECRET"

# ---------------------------------------------------------------------------
# PHASE 1 -- open the window
# ---------------------------------------------------------------------------
if [ "$PHASE" = "open" ]; then
  if [ "$MODE" = "plan" ]; then
    cat <<'PLAN'

  Phase 1 would:
    1. read the CURRENT value of the live secret (into a shell variable; never printed)
    2. store that value as the PREVIOUS secret, creating it if needed
    3. generate a fresh 64-byte key (openssl rand -base64 64)
    4. write the fresh key to the live secret
    5. print the PREVIOUS secret's ARN -- an identifier, not a credential -- and offer to set
       it as the TRACKING_JWT_SECRET_PREVIOUS_ARN repository variable

  Nothing is deployed. Until you dispatch deploy-prod, the running service still validates
  with the old key alone, which is a consistent and working state.

  After deploying, a session started BEFORE the rotation keeps working: that is the overlap.

PLAN
    exit 0
  fi

  printf '\nThis writes a new signing key to PRODUCTION Secrets Manager.\n'
  printf 'Type ROTATE to continue: '
  read -r confirm
  [ "$confirm" = "ROTATE" ] || die "aborted"

  # --secret-string with a value on the command line would expose it in `ps`. file:///dev/stdin
  # keeps it off the argument list, and the value never touches the filesystem.
  say "reading the current value..."
  OLD_VALUE="$(aws secretsmanager get-secret-value --region "$REGION" \
    --secret-id "$CURRENT_SECRET" --query SecretString --output text)"
  [ -n "$OLD_VALUE" ] || die "current secret is empty; refusing to rotate"

  say "storing it as the previous secret..."
  if aws secretsmanager describe-secret --region "$REGION" --secret-id "$PREVIOUS_SECRET" >/dev/null 2>&1; then
    printf '%s' "$OLD_VALUE" | aws secretsmanager put-secret-value --region "$REGION" \
      --secret-id "$PREVIOUS_SECRET" --secret-string file:///dev/stdin >/dev/null
  else
    printf '%s' "$OLD_VALUE" | aws secretsmanager create-secret --region "$REGION" \
      --name "$PREVIOUS_SECRET" \
      --description "The TrackingJwtSecret being rotated away from. TEMPORARY: clear it one token lifetime (24h) after the rotation, or the retired key still authenticates. See docs/security/rotation-runbook.md section A." \
      --secret-string file:///dev/stdin >/dev/null
  fi

  say "generating a fresh key..."
  NEW_VALUE="$(openssl rand -base64 64 | tr -d '\n')"

  say "writing it to the live secret..."
  printf '%s' "$NEW_VALUE" | aws secretsmanager put-secret-value --region "$REGION" \
    --secret-id "$CURRENT_SECRET" --secret-string file:///dev/stdin >/dev/null

  # Proof the two differ, without revealing either. Comparing hashes is the whole check:
  # a rotation that wrote the same value back would otherwise look identical to a real one.
  OLD_FP="$(printf '%s' "$OLD_VALUE" | openssl dgst -sha256 | awk '{print substr($2,1,12)}')"
  NEW_FP="$(printf '%s' "$NEW_VALUE" | openssl dgst -sha256 | awk '{print substr($2,1,12)}')"
  unset OLD_VALUE NEW_VALUE
  [ "$OLD_FP" != "$NEW_FP" ] || die "the new key matched the old one; nothing was rotated"
  say "old key fingerprint: $OLD_FP  (sha256, first 12 hex -- not the key)"
  say "new key fingerprint: $NEW_FP"

  PREV_ARN="$(aws secretsmanager describe-secret --region "$REGION" \
    --secret-id "$PREVIOUS_SECRET" --query ARN --output text)"

  cat <<NEXT

  Secrets are in place. The ARN below is an identifier, not a credential:

    $PREV_ARN

  Next, in order:

    1. gh variable set $GH_VAR --body "$PREV_ARN"
    2. gh workflow run deploy-prod.yml --ref main
    3. Confirm the overlap is real: a bearer token you obtained BEFORE step 2 must still
       return 200 from an authenticated endpoint. If it returns 401, the overlap did not
       reach the service -- check the variable before going near phase 2, because phase 2
       would then have nothing to close.

  Then wait 24 hours (JwtTokenService.TokenLifetime) and run: $0 apply close

NEXT
  exit 0
fi

# ---------------------------------------------------------------------------
# PHASE 2 -- close the window. This is the step that makes the rotation real.
# ---------------------------------------------------------------------------
if [ "$MODE" = "plan" ]; then
  cat <<'PLAN'

  Phase 2 would:
    1. clear the TRACKING_JWT_SECRET_PREVIOUS_ARN repository variable
    2. remind you to dispatch deploy-prod, which is what actually stops the old key working
    3. schedule the previous secret for deletion (7-day recovery window)

  Until step 2 is deployed, the retired key still authenticates. A rotation that stops here
  has bought nothing: the value you rotated away from still opens the door.

PLAN
  exit 0
fi

# ---------------------------------------------------------------------------
# The wait is a guard, not advice.
#
# Phase 2 stops the old key working. Run it before every old-key token has expired and those
# sessions are signed out -- which is the single harm the two-phase design exists to avoid, so
# "wait 24 hours" cannot live only in a sentence at the end of phase 1's output.
#
# On 2026-09-28 phase 2 was attempted FOUR MINUTES after phase 1. It was stopped by the account
# preflight above, because the shell had lost AWS_PROFILE -- luck, not design. Nothing in this
# script knew it was 23 hours early.
#
# The reference is the PREVIOUS secret's creation, which is when the rotation began. Note that the
# new key only started signing when phase 1's deploy landed, typically some minutes later, so the
# true floor is that much later again -- the message prints both so the operator can see the gap.
# ---------------------------------------------------------------------------
LIFETIME_HOURS="${TOKEN_LIFETIME_HOURS:-24}"
command -v python3 >/dev/null || die "python3 is required to compare timestamps."

created="$(aws secretsmanager describe-secret --region "$REGION" \
  --secret-id "$PREVIOUS_SECRET" --query CreatedDate --output text 2>/dev/null || true)"
[ -n "$created" ] && [ "$created" != "None" ] \
  || die "cannot read $PREVIOUS_SECRET. Has phase 1 (apply open) run at all?"

if ! wait_report="$(python3 - "$created" "$LIFETIME_HOURS" <<'PY'
import sys
from datetime import datetime, timedelta, timezone

created = datetime.fromisoformat(sys.argv[1])
if created.tzinfo is None:
    created = created.replace(tzinfo=timezone.utc)
hours = float(sys.argv[2])
now = datetime.now(timezone.utc)
elapsed = (now - created).total_seconds() / 3600
safe = created + timedelta(hours=hours)

print(f"  phase 1 began   {created.astimezone(timezone.utc):%Y-%m-%d %H:%M}Z")
print(f"  elapsed         {elapsed:.2f} h of {hours:g}")
print(f"  earliest close  {safe.astimezone(timezone.utc):%Y-%m-%d %H:%M}Z")
sys.exit(0 if elapsed >= hours else 3)
PY
)"; then
  printf '\n%s\n\n' "$wait_report" >&2
  if [ "${FORCE_CLOSE_EARLY:-0}" = "1" ]; then
    printf 'FORCE_CLOSE_EARLY=1: proceeding anyway. Every session still on the old key will be\n' >&2
    printf 'signed out, including any minted in the last %s hours.\n\n' "$LIFETIME_HOURS" >&2
  else
    die "too early to close. Closing now signs out every session still holding an old-key token,
which is exactly what the overlap exists to prevent. The clock that matters starts when phase 1's
DEPLOY landed -- a few minutes after the time above -- so add that gap if you want to be exact.

Wait, or set FORCE_CLOSE_EARLY=1 if signing everyone out is an accepted cost right now."
  fi
else
  printf '\n%s\n' "$wait_report"
fi

printf '\nThis retires the old key. Sessions still on it will be signed out.\n'
printf 'Type CLOSE to continue: '
read -r confirm
[ "$confirm" = "CLOSE" ] || die "aborted"

say "clearing $GH_VAR..."
if command -v gh >/dev/null; then
  gh variable set "$GH_VAR" --body "" || say "could not set it with gh; clear it in the UI"
else
  say "gh not found -- clear $GH_VAR manually"
fi

say "scheduling the previous secret for deletion (7-day recovery window)..."
aws secretsmanager delete-secret --region "$REGION" --secret-id "$PREVIOUS_SECRET" \
  --recovery-window-in-days 7 >/dev/null 2>&1 || say "no previous secret to delete"

cat <<NEXT

  Now dispatch the deploy that actually closes the window:

    gh workflow run deploy-prod.yml --ref main

  Then prove it closed, which a fresh login CANNOT do -- a green login looks identical
  whether the old key still works or not:

    the bearer token from before the rotation must now return 401.

  Only after that 401 should the rotation be ticked off in docs/security/rotation-inventory.md.

NEXT
