# Giving the API `api.climate.timsint.com`

Closes the custom-domain half of **#160**, and the cutover runbook's **P4** ("The API has no
custom domain") together with its trap **P6** (`web/vercel.json` hardcodes the App Runner
hostname in its CSP).

Before this, everything external addressed the API as
`https://bhgrdkd4gt.us-east-1.awsapprunner.com` — a hostname AWS generated, visible to any
client in a network trace, and **not stable**: recreate the App Runner service and it changes.

**Status, measured 2026-09-14 18:43Z.** The domain is `active`; both certificate validation
records report `SUCCESS`; the certificate has finished rolling out to all five addresses; and
plain `curl https://api.climate.timsint.com/version` returns `200` with the same commit
(`cd14b197`) as the App Runner hostname, as do `/health` and `/ready`. The one step left is
**step 8** — the web bundle still calls the old hostname.

---

## What this cannot be

**There is no CloudFormation resource for an App Runner custom domain.** The template
reference has `AWS::AppRunner::Service` and `AWS::AppRunner::VpcConnector` and no
`::CustomDomain`; the operation is the `AssociateCustomDomain` API. So this does **not** go in
`infra/aws/climate-project-api-prod-service.yml` — it is a one-time CLI call plus DNS records,
and this file is where that procedure lives instead.

**It cannot be done entirely at Namecheap.** That was the original plan and it does not work;
see the next section. `climate.timsint.com` is now a Route53 hosted zone, delegated from the
Namecheap-hosted parent.

---

## Why the records are in Route53 and not at Namecheap

`timsint.com` is registered at, and served by, Namecheap:

```
$ dig +short NS timsint.com @1.1.1.1
dns1.registrar-servers.com.
dns2.registrar-servers.com.
```

App Runner asks for **two** certificate validation CNAMEs. The second one has two long
generated labels ahead of the domain:

```
_fb118df8ef370750ff82f39fb7fbf216.m8w0huowybwjrwrhkej8mtw2srpa0jz.api.climate.timsint.com
```

**Namecheap's Advanced DNS "Host" field accepts at most 60 characters.** The Host is the name
relative to the zone, so with the zone at `timsint.com` that record's Host is:

```
_fb118df8ef370750ff82f39fb7fbf216.m8w0huowybwjrwrhkej8mtw2srpa0jz.api.climate   = 77 chars
```

**Delegating deeper does not rescue it.** The two generated labels alone are already
`33 + 1 + 31 = 65` characters, so even a zone rooted exactly at `api.climate.timsint.com` —
the deepest zone that could hold the record at all — leaves a 65-character Host:

```
_fb118df8ef370750ff82f39fb7fbf216.m8w0huowybwjrwrhkej8mtw2srpa0jz              = 65 chars
```

65 > 60 at every depth. There is no arrangement of subdomains under which Namecheap can hold
this record. That is the finding that forced the delegation; it is a property of the
registrar's form, not of DNS.

The zone is **`Z058256939JG0YA4Y6FRY`**, name `climate.timsint.com.`, public, 6 records.

---

## Order of operations

The ordering below is the one that has no outage in it. **The NS rows go in before anything is
removed** — see "The trap in the ordering".

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

### 2. Create the Route53 hosted zone for `climate.timsint.com`

A **public** zone for the subdomain only. Note its four nameservers and its zone id.

### 3. Fill the zone **before** delegating to it

Put every record the subdomain needs into Route53 while Namecheap is still authoritative — the
zone is not being consulted yet, so this is invisible and reversible. Six records, as they
stand today:

| Name | Type | TTL | Value |
|---|---|---|---|
| `climate.timsint.com.` | A | 300 | `76.76.21.21` *(Vercel — the web app)* |
| `climate.timsint.com.` | NS | 172800 | the four `awsdns` nameservers |
| `climate.timsint.com.` | SOA | 900 | *(created with the zone)* |
| `api.climate.timsint.com.` | CNAME | 300 | `bhgrdkd4gt.us-east-1.awsapprunner.com.` |
| `_b325ceac….api.climate.timsint.com.` | CNAME | 300 | `_ec75a59c….acm-validations.aws.` |
| `_fb118df8….m8w0huow….api.climate.timsint.com.` | CNAME | 300 | `_21a12752….acm-validations.aws.` |

**The apex A record is the one that matters for uptime.** `climate.timsint.com` is the web app.
The moment delegation goes live, Route53 answers for it, and if this A record is not already
there the site goes dark.

### 4. Delegate: add the NS rows at Namecheap

At Namecheap, on `timsint.com`, add four **NS** records with Host `climate`, one per Route53
nameserver. Nothing is deleted in this step.

Confirm the parent is handing off, asking the parent directly so no cache is involved:

```sh
dig +norecurse NS climate.timsint.com @dns1.registrar-servers.com
```

Four `awsdns` NS records in the AUTHORITY section is the pass.

### 5. Only now, remove the superseded Namecheap rows

Once delegation resolves, the old `climate` A record and any `api.climate` rows at Namecheap
are dead weight — the parent no longer answers for that subtree. Delete them **after** step 4,
never before.

```sh
dig +norecurse A climate.timsint.com @dns1.registrar-servers.com +short   # empty = clean
```

### 6. Wait for validation, then for the certificate to reach the fleet

```sh
aws apprunner describe-custom-domains --region us-east-1 --service-arn "<arn>" \
  --query 'CustomDomains[].{D:DomainName,S:Status,V:CertificateValidationRecords[].Status}'
```

`active` with both validation records `SUCCESS` is the finish line for *validation*.
`PENDING_CERTIFICATE_DNS_VALIDATION` for more than ~30 minutes after the records propagate
means a validation record is wrong, or `www` was left enabled.

> **`active` does not mean every endpoint serves the new certificate yet.** The status flips
> before the certificate has rolled out across the addresses behind the hostname, and in that
> window a plain `curl` fails with
> `SSL: no alternative certificate subject name matches target host name` — which reads exactly
> like a misconfiguration and is not one. Measured on 2026-09-14 between 18:37Z and 18:43Z, the
> hostname resolving to five addresses: **1 of 5** served the new certificate on the first check,
> **4 of 5** a few minutes later, **5 of 5** by 18:43Z — inside about six minutes, with no action
> taken in between. Re-associating during that window would have been a mistake.
>
> Check per address rather than guessing:
>
> ```sh
> for ip in $(dig +short api.climate.timsint.com | grep -E '^[0-9]'); do
>   echo -n "$ip -> "
>   echo | openssl s_client -connect "$ip:443" -servername api.climate.timsint.com 2>/dev/null \
>     | openssl x509 -noout -subject
> done
> ```
>
> `CN=api.climate.timsint.com` on every address is settled. `CN=*.us-east-1.awsapprunner.com`
> on some of them is still rolling — wait, do not re-associate.

### 7. Prove the new host serves the same API

```sh
for p in /version /health /ready; do
  printf '%s ' "$p"
  curl -s -o /dev/null -w '%{http_code}\n' "https://api.climate.timsint.com$p"
done
curl -s https://api.climate.timsint.com/version; echo
curl -s https://bhgrdkd4gt.us-east-1.awsapprunner.com/version; echo
```

The two `/version` bodies must be identical. Both hostnames front the same service; a
difference means you are not looking at what you think you are.

### 8. Point the web at it (Vercel console) — **the step still outstanding**

Set `VITE_API_BASE_URL` to `https://api.climate.timsint.com` for the **Production**
environment **and trigger a redeploy**.

> **It is a build-time value, not a runtime one.** Vite inlines `import.meta.env.*` into the
> bundle, so changing the variable does nothing until a new build runs. This is the trap
> recorded in `docs/decisions/web-hosting.md`.

The CSP is already ready for it — `web/vercel.json` names both hostnames, and production is
serving that CSP today, so the order cannot break the browser either way.

Confirm the deployed bundle actually carries it — grep the bundle, do not trust the env screen:

```sh
curl -s https://climate.timsint.com/ | grep -o 'build-commit" content="[a-f0-9]\{8\}'
js=$(curl -s https://climate.timsint.com/ | grep -oE 'src="/assets/index-[^"]+\.js"' | cut -d'"' -f2)
curl -s "https://climate.timsint.com$js" | grep -c 'api\.climate\.timsint\.com'   # want > 0
curl -s "https://climate.timsint.com$js" | grep -c 'bhgrdkd4gt'                   # want 0
```

Measured 2026-09-14, before this step: `api.climate.timsint.com` **0** occurrences,
`bhgrdkd4gt` **83**. That is the signature of "the variable was never applied, or applied
without a rebuild".

### 9. Point the tracking service at it, when it deploys

The `CLIMATE_PROJECT_BASE_URL` GitHub variable feeds
`services/tracking-api`'s `ClimateProjectBaseUrl`. Set it to the new host in the same pass.
The tracking service cannot deploy at all yet for unrelated reasons — see
`docs/runbooks/tracking-*` and the three still-unset values — so this is a note for whenever
that unblocks, not a step in this procedure.

---

## The trap in the ordering

**Delegate before you remove.** On the first attempt the old Namecheap `climate` A record was
deleted *before* the NS rows were added. Between the two changes nothing anywhere was
authoritative for `climate.timsint.com`, and the production web site was down for the gap.

The safe order is the one above: fill the new zone (step 3), delegate (step 4), and only then
delete what the parent no longer serves (step 5). The old records are dead weight *after* the
delegation, not before it.

---

## What deliberately does **not** change

- **CORS.** `Cors__AllowedOrigins__*` allowlists the *browser origin* —
  `https://climate.timsint.com` and the Vercel preview pattern. The API's own hostname is not
  an origin of anything. Adding `api.climate.timsint.com` to that list would be meaningless.
  The allowlist is untouched.
- **`infra/aws/climate-project-api-prod-service.yml`.** See "What this cannot be".
- **The old hostname.** It keeps working, and `web/vercel.json`'s CSP names both.
- **The registrar.** `timsint.com` stays at Namecheap. Only the `climate` subtree moved.

## After it is live and settled

Drop `https://bhgrdkd4gt.us-east-1.awsapprunner.com` from the `connect-src` in
`web/vercel.json` — one line, one PR — so the CSP names only the domain the product actually
uses. Do it once the Network tab shows no traffic to the App Runner hostname, not before.

Note that the header is currently sent as `Content-Security-Policy-Report-Only`, so a CSP
mistake reports rather than blocks. Tightening `connect-src` is therefore safe to land, but it
also will not *protect* anything until the policy is switched to enforcing.
