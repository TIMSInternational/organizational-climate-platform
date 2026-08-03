#!/usr/bin/env bash
#
# Guard the guard (#70).
#
# `gitleaks` reporting "no leaks found" is only meaningful if it would have said
# something else had there been a leak. A misconfigured `.gitleaks.toml` — an
# over-broad allowlist, a typo in `extend.useDefault`, a rules file that failed to
# load — produces exactly the same clean output as a genuinely clean repository.
#
# So this asserts both directions, the same way the repo's other lint-shaped guards
# do (see web/src/i18n/noHardcodedStrings.test.ts and
# web/src/components/ui/tokenDiscipline.test.ts, which assert their own file counts
# so an empty sweep cannot pass vacuously):
#
#   1. a planted, unmistakably fake credential IS detected
#   2. the repository as it stands is clean
#
# Run locally, or in CI via the `secret-scan` job.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks not found on PATH." >&2
  echo "  macOS: brew install gitleaks" >&2
  echo "  other: https://github.com/gitleaks/gitleaks/releases" >&2
  exit 127
fi

echo "gitleaks $(gitleaks version 2>/dev/null || echo '(version unknown)')"

# ---------------------------------------------------------------------------
# 1. Detection check: does the scanner still fire on a known-bad value?
# ---------------------------------------------------------------------------
# Built outside the repository so a crash mid-run cannot leave a planted
# credential behind in the working tree.
PROBE_DIR="$(mktemp -d)"
trap 'rm -rf "$PROBE_DIR"' EXIT

# A throwaway 512-bit RSA key, generated solely to be detected here and never used
# for anything. Chosen over a fake AWS key on purpose: gitleaks' `private-key` rule
# is a structural marker match, whereas its `aws-access-token` rule applies an
# entropy threshold, which makes an obviously-fake AWS key an unreliable probe.
#
# Measured while writing this (gitleaks 8.30.1), rather than assumed. Using the AWS
# doc key `AKIA` + `IOSFODNN7EXAMPLE` fails to detect — it is allowlisted upstream —
# and so does an `AKIA` key with a pure-hex body, which falls below the entropy
# threshold. Both are what someone would naturally reach for as an "obviously fake"
# probe, and either would have left this check failing open while appearing to work.
#
# The PEM markers below are assembled from a variable rather than written literally.
# Spelled out in full, this file would itself trip the scanner it is verifying —
# which it did on the first run. Allowlisting this path in .gitleaks.toml would have
# fixed that too, but at the cost of permanently blinding the scanner to one file;
# keeping the source free of secret-shaped literals needs no allowlist at all.
pem_kind='RSA PRIVATE KEY'
printf '%s\n' \
  "-----BEGIN ${pem_kind}-----" \
  'MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu' \
  'KUpRKfFLfRYC9AIKjbJTWit+CqvjWYzvQwECAwEAAQ==' \
  "-----END ${pem_kind}-----" > "$PROBE_DIR/planted.txt"

echo -n "detection check ... "
if gitleaks dir "$PROBE_DIR" --config .gitleaks.toml --no-banner --redact >/dev/null 2>&1; then
  echo "FAIL"
  echo >&2
  echo "gitleaks did NOT flag a planted private key." >&2
  echo "The scanner is not working — a clean report from it means nothing." >&2
  echo "Check .gitleaks.toml: an over-broad allowlist entry or a failed rules load." >&2
  exit 1
fi
echo "ok (planted private key detected)"

# ---------------------------------------------------------------------------
# 2. Repository check: working tree and full history
# ---------------------------------------------------------------------------
echo -n "working tree    ... "
if ! gitleaks dir . --config .gitleaks.toml --no-banner --redact >/dev/null 2>&1; then
  echo "LEAK FOUND"
  echo >&2
  gitleaks dir . --config .gitleaks.toml --no-banner --redact -v >&2 || true
  exit 1
fi
echo "clean"

echo -n "git history     ... "
if ! gitleaks git . --config .gitleaks.toml --no-banner --redact >/dev/null 2>&1; then
  echo "LEAK FOUND"
  echo >&2
  echo "A secret is present in committed history. Removing it from the current" >&2
  echo "working tree is NOT sufficient — the blob remains reachable. Rotate the" >&2
  echo "credential first (it must be assumed compromised), then decide whether" >&2
  echo "history needs rewriting. See docs/security/rotation-inventory.md." >&2
  echo >&2
  gitleaks git . --config .gitleaks.toml --no-banner --redact -v >&2 || true
  exit 1
fi
echo "clean"

echo
echo "Secret scanning verified: detection works, repository is clean."
