#!/usr/bin/env bash
#
# Measure what a rollback costs the people using the service while it happens.
#
# #159 asks "what happens to in-flight requests". App Runner's documentation says a
# deployment is zero-downtime and does not publish a connection-drain timeout, so the
# only honest answer this project can give is a measured one. This is the instrument
# that produces it, and the rehearsal and the real incident use the SAME instrument --
# a number measured with a different tool than the one you will reach for at 3am is a
# number about the tool.
#
# It runs N concurrent workers hitting /ready at a fixed interval, and one watcher
# polling /version. It reports:
#
#   - total requests, and how many were not 200
#   - the LONGEST CONSECUTIVE FAILURE RUN, in seconds. This, not the failure count,
#     is the number that matters: 40 scattered failures across 10 minutes is a flaky
#     probe, 40 consecutive is a 40-second outage.
#   - the instant /version flipped, and how many failures fell within +/-15s of it.
#     That window is the swap; failures inside it are the in-flight answer, and
#     failures outside it are something else and must not be blamed on the rollback.
#
# WHAT IT DOES NOT MEASURE, said plainly: a request already in flight when the proxy
# moves. Every request here is short. If a long-running request (a report export, a
# bulk import) is severed mid-flight this will not see it -- to test that, start one
# by hand immediately before the swap and watch whether it completes.
#
# Usage:
#   scripts/rollback-probe.sh <base-url> <duration-seconds> [interval] [workers] [outdir]
#
# Typical: start it, then in another terminal run scripts/rollback-api-image.sh.
#   scripts/rollback-probe.sh https://xxxx.us-east-1.awsapprunner.com 900 0.5 4

set -euo pipefail

BASE_URL="${1:-}"
DURATION="${2:-600}"
INTERVAL="${3:-0.5}"
WORKERS="${4:-4}"
OUTDIR="${5:-./rollback-probe-$(date -u +%Y%m%dT%H%M%SZ)}"

if [ -z "$BASE_URL" ]; then
  echo "usage: $0 <base-url> <duration-seconds> [interval] [workers] [outdir]" >&2
  exit 2
fi

mkdir -p "$OUTDIR"
READY_URL="${BASE_URL%/}/ready"
VERSION_URL="${BASE_URL%/}/version"
END_EPOCH=$(( $(date -u +%s) + DURATION ))

echo "probing  $READY_URL"
echo "watching $VERSION_URL"
echo "workers  $WORKERS at ${INTERVAL}s -> ~$(awk -v w="$WORKERS" -v i="$INTERVAL" 'BEGIN{printf "%.1f", w/i}') req/s"
echo "until    $(date -u -r "$END_EPOCH" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@$END_EPOCH" +%Y-%m-%dT%H:%M:%SZ)"
echo "output   $OUTDIR"
echo

# --- workers: one CSV each, epoch,status,seconds -----------------------------------
w=0
while [ "$w" -lt "$WORKERS" ]; do
  (
    out="$OUTDIR/probe-$w.csv"
    echo "epoch,status,seconds" > "$out"
    while [ "$(date -u +%s)" -lt "$END_EPOCH" ]; do
      # --max-time 15: above the 9.4s cold-start probe measured in #220, below the
      # 30s hang that was #220's signature. Same constant as the deploy canary, so a
      # slow probe means the same thing here as it does there.
      result="$(curl -s -o /dev/null -w '%{http_code},%{time_total}' --max-time 15 "$READY_URL" || echo '000,15')"
      echo "$(date -u +%s),$result" >> "$out"
      sleep "$INTERVAL"
    done
  ) &
  w=$(( w + 1 ))
done

# --- watcher: records the instant the served commit changes -------------------------
(
  out="$OUTDIR/version.csv"
  echo "epoch,commit" > "$out"
  last=""
  while [ "$(date -u +%s)" -lt "$END_EPOCH" ]; do
    commit="$(curl -sS --max-time 20 "$VERSION_URL" 2>/dev/null | jq -r '.commit // "unreachable"' || echo unreachable)"
    if [ "$commit" != "$last" ]; then
      echo "$(date -u +%s),$commit" >> "$out"
      echo "  [$(date -u +%H:%M:%SZ)] serving commit: $commit"
      last="$commit"
    fi
    sleep 2
  done
) &

wait

# --- summary -----------------------------------------------------------------------
echo
echo "=== rollback probe summary ==="

cat "$OUTDIR"/probe-*.csv | grep -v '^epoch' | sort -t, -k1,1n > "$OUTDIR/merged.csv"

TOTAL="$(wc -l < "$OUTDIR/merged.csv" | tr -d ' ')"
BAD="$(awk -F, '$2 != 200' "$OUTDIR/merged.csv" | wc -l | tr -d ' ')"
echo "requests:      $TOTAL"
echo "non-200:       $BAD"

if [ "$BAD" -gt 0 ]; then
  echo
  echo "status breakdown:"
  awk -F, '$2 != 200 {print "  " $2}' "$OUTDIR/merged.csv" | sort | uniq -c | sort -rn
fi

# Longest gap between consecutive successes, across all workers merged. This is the
# real availability number: the longest stretch during which a user retrying would
# have kept failing.
awk -F, '
  $2 == 200 { if (last != "" && $1 - last > gap) { gap = $1 - last; at = last } ; last = $1 }
  END {
    if (gap == "") gap = 0
    printf "longest gap between successful responses: %d s", gap
    if (at != "") printf " (starting at epoch %d)", at
    printf "\n"
  }
' "$OUTDIR/merged.csv"

# The swap window.
FLIPS="$(grep -vc '^epoch' "$OUTDIR/version.csv" 2>/dev/null || echo 0)"
if [ "${FLIPS:-0}" -gt 1 ]; then
  echo
  echo "commit changes observed:"
  grep -v '^epoch' "$OUTDIR/version.csv" | while IFS=, read -r e c; do
    echo "  $(date -u -r "$e" +%H:%M:%SZ 2>/dev/null || date -u -d "@$e" +%H:%M:%SZ)  $c"
  done

  FLIP_EPOCH="$(grep -v '^epoch' "$OUTDIR/version.csv" | tail -1 | cut -d, -f1)"
  echo
  awk -F, -v flip="$FLIP_EPOCH" '
    $1 >= flip - 15 && $1 <= flip + 15 { n++; if ($2 != 200) b++ }
    END { printf "in the 30s window around the swap: %d requests, %d non-200\n", n+0, b+0 }
  ' "$OUTDIR/merged.csv"
  echo
  echo "That last line is the in-flight answer #159 asks for, for THIS run."
  echo "Copy it into the measurement table in docs/runbooks/rollback.md, with the date."
else
  echo
  echo "No commit change observed during the probe window -- nothing was rolled back,"
  echo "or the rollback landed outside it. The failure numbers above are baseline noise,"
  echo "which is itself worth recording: a rollback that costs 4 failed requests means"
  echo "nothing until you know the steady state costs 0."
fi

echo
echo "raw data: $OUTDIR"
