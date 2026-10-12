#!/usr/bin/env bash
# Point api.climate.timsint.com at the climate API in the NEW account (us-east-2).
#
# Run AFTER scripts/migrate-climate-to-new-account.sh has printed DONE. Written 2026-10-12.
#
# The climate.timsint.com Route53 zone (Z058256939JG0YA4Y6FRY) still lives in the OLD account
# and is still the zone the world resolves (Namecheap delegates to it), so the records are
# written there. Moving the ZONE itself to the new account is a later, separate step that
# needs a Namecheap NS change -- see feedback "delegate before you remove": copy every record
# into the new zone FIRST, change NS SECOND, delete the old zone LAST.
#
# Touches ONLY records under climate.timsint.com, and only UPSERTs -- nothing is deleted.
#
#   bash scripts/migrate-climate-dns.sh
set -euo pipefail

NEW_PROFILE=tims-new
OLD_PROFILE=claude
NEW_ACCOUNT=795965600143
OLD_ACCOUNT=747814092517
REGION=us-east-2
ZONE_ID=Z058256939JG0YA4Y6FRY
API_DOMAIN=api.climate.timsint.com
SERVICE_STACK=climate-project-api-prod

say() { printf '\n== %s\n' "$*"; }

say "0. Checking both accounts"
[ "$(aws sts get-caller-identity --profile "$NEW_PROFILE" --query Account --output text)" = "$NEW_ACCOUNT" ] || { echo "wrong new account" >&2; exit 1; }
[ "$(aws sts get-caller-identity --profile "$OLD_PROFILE" --query Account --output text)" = "$OLD_ACCOUNT" ] || { echo "wrong old account" >&2; exit 1; }
zone_name="$(aws route53 get-hosted-zone --profile "$OLD_PROFILE" --id "$ZONE_ID" --query HostedZone.Name --output text)"
[ "$zone_name" = "climate.timsint.com." ] || { echo "zone $ZONE_ID is $zone_name, not climate.timsint.com." >&2; exit 1; }

SERVICE_ARN="$(aws cloudformation describe-stacks --profile "$NEW_PROFILE" --region "$REGION" --stack-name "$SERVICE_STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='ServiceArn'].OutputValue | [0]" --output text)"
SERVICE_URL="$(aws cloudformation describe-stacks --profile "$NEW_PROFILE" --region "$REGION" --stack-name "$SERVICE_STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='ServiceUrl'].OutputValue | [0]" --output text)"
echo "service=$SERVICE_URL"

say "1. Associating $API_DOMAIN with the new service"
existing="$(aws apprunner describe-custom-domains --profile "$NEW_PROFILE" --region "$REGION" --service-arn "$SERVICE_ARN" \
  --query "CustomDomains[?DomainName=='$API_DOMAIN'].DomainName | [0]" --output text)"
if [ "$existing" != "$API_DOMAIN" ]; then
  aws apprunner associate-custom-domain --profile "$NEW_PROFILE" --region "$REGION" \
    --service-arn "$SERVICE_ARN" --domain-name "$API_DOMAIN" --no-enable-www-subdomain >/dev/null
fi

say "2. Waiting for App Runner to publish the certificate validation records"
records=""
for _ in $(seq 1 30); do
  records="$(aws apprunner describe-custom-domains --profile "$NEW_PROFILE" --region "$REGION" --service-arn "$SERVICE_ARN" \
    --query "CustomDomains[?DomainName=='$API_DOMAIN'].CertificateValidationRecords[] | [].[Name,Value]" --output text)"
  [ -n "$records" ] && break
  sleep 10
done
[ -n "$records" ] || { echo "no validation records after 5 minutes" >&2; exit 1; }

say "3. Writing validation records + the API CNAME into $zone_name (UPSERT only)"
changes="$(python3 - "$API_DOMAIN" "$SERVICE_URL" <<PY
import json, sys
api, target = sys.argv[1], sys.argv[2]
rows = [line.split("\t") for line in """$records""".strip().splitlines()]
changes = [{"Action": "UPSERT", "ResourceRecordSet": {"Name": n, "Type": "CNAME", "TTL": 300,
            "ResourceRecords": [{"Value": v}]}} for n, v in rows]
changes.append({"Action": "UPSERT", "ResourceRecordSet": {"Name": api, "Type": "CNAME", "TTL": 300,
                "ResourceRecords": [{"Value": target}]}})
print(json.dumps({"Comment": "climate API -> new account (2026-10-12)", "Changes": changes}))
PY
)"
aws route53 change-resource-record-sets --profile "$OLD_PROFILE" --hosted-zone-id "$ZONE_ID" \
  --change-batch "$changes" --query ChangeInfo.Status --output text

say "4. Waiting for the certificate (usually 5-30 minutes)"
for _ in $(seq 1 90); do
  status="$(aws apprunner describe-custom-domains --profile "$NEW_PROFILE" --region "$REGION" --service-arn "$SERVICE_ARN" \
    --query "CustomDomains[?DomainName=='$API_DOMAIN'].Status | [0]" --output text)"
  echo "  $(date +%H:%M:%S) $status"
  [ "$status" = "active" ] && break
  sleep 20
done

say "5. Checking the public name"
# App Runner reporting 'active' is not the same as serving the certificate (a trap measured on
# 14 Sep); only the request itself proves it.
for path in /health /ready /version; do
  printf '%-9s %s\n' "$path" "$(curl -s -o /dev/null -m 10 -w '%{http_code}' "https://$API_DOMAIN$path" || true)"
done
curl -s "https://$API_DOMAIN/version"; echo
