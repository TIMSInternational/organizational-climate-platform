# Giving the API `api.climate.timsint.com`

Closes the custom-domain half of **#160**, and the cutover runbook's **P4** ("The API has no
custom domain") together with its trap **P6** (`web/vercel.json` hardcodes the App Runner
hostname in its CSP).

Today everything external addresses the API as
`https://bhgrdkd4gt.us-east-1.awsapprunner.com` — a hostname AWS generated, visible to any
client in a network trace, and **not stable**: recreate the App Runner service and it changes.

---

## What this cannot be

**There is no CloudFormation resource for an App Runner custom domain.** The template
reference has `AWS::AppRunner::Service` and `AWS::AppRunner::VpcConnector` and no
`::CustomDomain`; the operation is the `AssociateCustomDomain` API. So this does **not** go in
`infra/aws/climate-project-api-prod-service.yml` — it is a one-time CLI call plus DNS records,
and this file is where that procedure lives instead.

**DNS is not in Route53.** `dig +short NS timsint.com` answers
`dns1.registrar-servers.com` / `dns2.registrar-servers.com` — Namecheap. Every record below is
added in the registrar's console by hand. Nothing in this repository can create them.

---

## Order of operations

Steps 1–4 change nothing a user can reach: the old hostname keeps serving throughout, and the
web app is not re-pointed until step 5. There is no window in which the site is calling a host
that does not answer.

### 1. Associate the domain (production AWS write)

```sh
aws apprunner associate-custom-domain \
  --region us-east-1 \
  --service-arn "$(aws apprunner list-services --region us-east-1 \
      --query "ServiceSummaryList[?ServiceName=='climate-project-api-prod'].ServiceArn" \
      --output text)" \
  --domain-name api.climate.timsint.com \
  --no-enable-www-subdomain
```

> **`--no-enable-www-subdomain` is not optional.** `EnableWWWSubdomain` **defaults to `true`**.
> Left at the default, App Runner also tries to validate `www.api.climate.timsint.com`, which
> nobody will ever create a record for, so the association sits in
> `PENDING_CERTIFICATE_DNS_VALIDATION` forever and the cause is not obvious from the console.

The response carries `DNSTarget` and a `CertificateValidationRecords` array. Keep both.

### 2. Add the records at Namecheap

| Type | Host | Value |
|---|---|---|
| CNAME | `api.climate` | the `DNSTarget` from step 1 |
| CNAME | each `Name` in `CertificateValidationRecords` | its matching `Value` |

Namecheap's "Host" field is the name **relative to the zone**, so `api.climate`, not the FQDN.
Set the TTL to the lowest the registrar offers — the zone is on 1800 s today (cutover runbook
**P5**), which is also worth lowering ahead of go-live for the same reason #159 wants it.

### 3. Wait for validation

```sh
aws apprunner describe-custom-domains --region us-east-1 --service-arn "<arn>" \
  --query 'CustomDomains[].{Domain:DomainName,Status:Status}'
```

`ACTIVE` is the finish line. `PENDING_CERTIFICATE_DNS_VALIDATION` for more than ~30 minutes
after the records propagate means a validation record is wrong, or `www` was left enabled.

### 4. Prove the new host serves the same API

```sh
for p in /version /health /ready; do
  printf '%s ' "$p"
  curl -s -o /dev/null -w '%{http_code} ' "https://api.climate.timsint.com$p"
  curl -sI "https://api.climate.timsint.com$p" | grep -i '^strict-transport\|^server' | tr -d '\r'
  echo
done
curl -s https://api.climate.timsint.com/version
```

The `commit` it reports must equal the one
`https://bhgrdkd4gt.us-east-1.awsapprunner.com/version` reports. Both hostnames front the same
service; a difference means you are not looking at what you think you are.

### 5. Point the web at it (Vercel console)

Set `VITE_API_BASE_URL` to `https://api.climate.timsint.com` for the **Production**
environment and redeploy.

> **It is a build-time value, not a runtime one.** Vite inlines `import.meta.env.*` into the
> bundle, so changing the variable does nothing until a new build runs. This is the trap
> recorded in `docs/decisions/web-hosting.md`.

Then confirm the deployed bundle actually carries it:

```sh
curl -s https://climate.timsint.com/ | grep -o 'build-commit" content="[a-f0-9]\{8\}'
# and in the browser: the Network tab's requests must go to api.climate.timsint.com
```

### 6. Point the tracking service at it, when it deploys

The `CLIMATE_PROJECT_BASE_URL` GitHub variable feeds
`services/tracking-api`'s `ClimateProjectBaseUrl`. Set it to the new host in the same pass.
The tracking service cannot deploy at all yet for unrelated reasons — see
`docs/runbooks/tracking-*` and the three still-unset values — so this is a note for whenever
that unblocks, not a step in this procedure.

---

## What deliberately does **not** change

- **CORS.** `Cors__AllowedOrigins__*` allowlists the *browser origin* — `https://climate.timsint.com`
  and the Vercel preview pattern. The API's own hostname is not an origin of anything. Adding
  `api.climate.timsint.com` to that list would be meaningless. The allowlist is untouched.
- **`infra/aws/climate-project-api-prod-service.yml`.** See "What this cannot be".
- **The old hostname.** It keeps working. `web/vercel.json`'s CSP now names **both**, so the
  order of steps 1–5 cannot break the browser either way.

## After it is live and settled

Drop `https://bhgrdkd4gt.us-east-1.awsapprunner.com` from the `connect-src` in
`web/vercel.json` — one line, one PR — so the CSP names only the domain the product actually
uses. Do it once the Network tab shows no traffic to the App Runner hostname, not before.
