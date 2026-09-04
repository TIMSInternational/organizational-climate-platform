# Decision: the web is on Vercel at `climate.timsint.com`; the API is on App Runner with no custom domain (#160)

Recorded 2026-09-03 against production `e0896f9`, after the fact. #160's first acceptance
criterion asks for the hosting decision to live in `docs/decisions/`; until this file it did
not exist anywhere, while the decision itself had already been *made in the world* — the
domain resolves, the CORS allowlist names it, and the API's own `Email__AppBaseUrl` sends
recipients to it. This file writes down what was already true, and separates the parts that
are settled from the one part that is not.

Everything below is a measurement taken on 2026-09-03 with read-only credentials or from a
public network position. Nothing here required a Vercel, Namecheap or Google console.

---

## The decision, in one line

**The customer-facing web is a Vite SPA on Vercel, served at `https://climate.timsint.com`.
The API is AWS App Runner in account `747814092517`, addressed by its generated hostname
`https://bhgrdkd4gt.us-east-1.awsapprunner.com`, and it has no custom domain. DNS for
`timsint.com` is at Namecheap, not Route 53.**

## What is settled, and how each part was measured

| Claim | Measurement, 2026-09-03 |
|---|---|
| The web is live at `climate.timsint.com` over TLS | `curl -s -o /dev/null -w '%{http_code} %{remote_ip}' https://climate.timsint.com/` → `200 76.76.21.21`; the body carries `<title>Organizational Climate Platform</title>` |
| It is hosted by Vercel | `dig +noall +answer climate.timsint.com` → `climate.timsint.com. 1798 IN A 76.76.21.21` — Vercel's anycast address. The Vercel project is `climate`, team `federicos-projects-21f2ff63`, Root Directory `web/` (`README.md`, "Deployments") |
| It is reachable without an SSO interstitial | the `200` above is unauthenticated, from a machine with no Vercel session |
| It is the **only** exact origin the API allows | `gh variable list --env production` → `CORS_ALLOWED_ORIGIN = https://climate.timsint.com` (set `2026-08-19T04:15:37Z`). Preflight: `OPTIONS /version` with `Origin: https://climate.timsint.com` → `204` + `access-control-allow-origin: https://climate.timsint.com`; the same preflight with `Origin: https://organizational-climate-platform.vercel.app` → `204` with **no** such header |
| Previews are allowlisted separately | `CORS_ALLOWED_WILDCARD_ORIGIN = https://climate-*-federicos-projects-21f2ff63.vercel.app` |
| The API is App Runner, and has **no** custom domain | `aws --profile claude apprunner describe-custom-domains --service-arn arn:aws:apprunner:us-east-1:747814092517:service/climate-project-api-prod/126c3f282524450896385975cb3bcba9` → `"CustomDomains": []`, `"DNSTarget": "bhgrdkd4gt.us-east-1.awsapprunner.com"` |
| The API is live and current | `GET https://bhgrdkd4gt.us-east-1.awsapprunner.com/version` → `{"service":"climate-project-api","environment":"Production","commit":"e0896f99f132087c7b97a4a9129b4f2baf25db6a","builtAt":"2026-09-02T20:32:57Z"}`; `/health` → `200` |
| **DNS is at Namecheap, not Route 53** | `dig +noall +answer timsint.com NS` → `dns1.registrar-servers.com.`, `dns2.registrar-servers.com.` — Namecheap's nameservers. `aws --profile claude route53 list-hosted-zones --query "HostedZones[].Name"` → `[]`, and the same command on `--profile default` (dev account `795965600143`) also → `[]`. **Neither AWS account holds a hosted zone at all**, so no `aws route53 change-resource-record-sets` path exists for this domain in either account |
| TTLs are still the 1800 s class | `dig +noall +answer climate.timsint.com @dns1.registrar-servers.com` → `1797 IN A 76.76.21.21`. Cutover's Phase B asks for ≤ 300 s and was never executed |
| The domain is already load-bearing inside the API | `infra/aws/climate-project-api-prod-service.yml:280` sets `Email__AppBaseUrl: "https://climate.timsint.com"` — the host in every invitation link this product mails. The live service carries it (`aws --profile claude apprunner describe-service … RuntimeEnvironmentVariables` → `"Email__AppBaseUrl": "https://climate.timsint.com"`) |

### Why this is written as a *de-facto* decision

Nobody chose Vercel in a document. The SPA was on Vercel from the monorepo consolidation
onward, the custom domain was pointed at it, and the CORS variable was moved to match on
2026-08-19. Recording it now closes #160 criterion 1 and, more usefully, makes the *coupling*
below visible before someone changes one half of it.

---

## UNDECIDED: the API hostname

> ```
> UNDECIDED — the API's custom domain name.
>
>   Candidate: <PLACEHOLDER — e.g. api.climate.timsint.com>
>   Decided by: <PLACEHOLDER>
>   Date:       <PLACEHOLDER>
> ```
>
> This is the only open question in this file, and it is **human-only**: it needs a name
> somebody picks, plus a Namecheap console session to create the CNAME and the ACM
> validation records App Runner asks for. It cannot be measured into existence.
>
> Until it is decided, `#160` stays open at "half": the web has a domain, the API does not,
> and everything external addresses the API by a generated hostname that changes if the
> App Runner service is ever recreated.

### What that decision drags with it — read this before picking a name

An API hostname change is **not** a variable edit. Four things change in the same breath, and
three of them are build-time or deploy-time:

1. **`VITE_API_BASE_URL` is baked into the bundle at build time.** It is read as
   `import.meta.env.VITE_API_BASE_URL` in **64 files under `web/src`** (58 source files and 6
   `*.test.*` files; `grep -rl VITE_API_BASE_URL web/src | wc -l` → `64`, of which
   `grep -c test` → `6`). Across the whole repo the string appears in **86** files
   (`grep -rl VITE_API_BASE_URL --exclude-dir=node_modules --exclude-dir=.git . | wc -l`).
   There is **no single client module** that owns the value — e.g. `web/src/App.tsx:9`,
   `web/src/auth/LoginPage.tsx:77`, `web/src/auth/RegisterPage.tsx:53`,
   `web/src/auth/AuthLoadingPage.tsx:94` each read `import.meta.env` directly. The practical
   consequence is the one that matters: **changing the API hostname requires a Vercel
   rebuild and redeploy of the web, not a runtime setting change.** A running deployment
   cannot be repointed.
2. **`web/vercel.json` pins the current API hostname in its CSP.** The
   `Content-Security-Policy-Report-Only` header carries
   `connect-src 'self' https://bhgrdkd4gt.us-east-1.awsapprunner.com`. If the API moves and
   this file does not move with it, the browser reports a violation rather than returning an
   HTTP error — so the failure looks like neither DNS nor CORS. It is `Report-Only` today,
   which downgrades the failure to a console message; that is a mitigation, not a licence.
   **The safe order is to add the future hostname *alongside* the current one and ship that
   first**, which turns cutover into a DNS change instead of a synchronised two-system change.
3. **`CLIMATE_PROJECT_BASE_URL` on the `production` environment** is
   `https://bhgrdkd4gt.us-east-1.awsapprunner.com` (`gh variable list --env production`, set
   `2026-08-31T15:44:25Z`). It is how the tracking service addresses the climate API.
4. **`CORS_ADDITIONAL_ALLOWED_ORIGIN`** exists precisely for this transition and is **unset**
   today — `gh variable list --env production` lists nine variables and it is not among them.
   `infra/aws/README.md` records the rule: leave it unset and the template drops the index-1
   origin entirely rather than binding an empty one.

### The constraint that outranks the name

**`climate.timsint.com` must keep resolving.** It is the host in `Email__AppBaseUrl`, so it is
the host in every invitation, reminder, password-reset and report-share link this product has
already sent. Whatever the API is called, the *web* domain is not free to move.

## Consequences accepted

- The API is addressed by a generated hostname in production, in `web/vercel.json`, in
  `CLIMATE_PROJECT_BASE_URL`, and in `deploy-drift.yml`'s fallback. `infra/aws/README.md`
  records the escape hatch: set the `PROD_API_BASE_URL` repository variable and drift checking
  follows the new name.
- DNS changes are a registrar console action with a human in it. There is no
  infrastructure-as-code path to this zone from either AWS account, and this file does not
  pretend otherwise.
- TTLs stay at 1800 s until somebody executes cutover Phase B, which caps how fast any
  DNS-level revert propagates.

## How to reverse this

Moving the web off Vercel means: a new host for the SPA, an A/CNAME change at Namecheap, and
nothing else — `climate.timsint.com` is the contract, Vercel is an implementation detail
behind it. Moving the API off App Runner is the larger change, because the four couplings
above all name the App Runner hostname today; deciding the custom domain **first** is what
makes that reversible cheaply, which is the strongest argument for closing the UNDECIDED box
above sooner rather than at cutover.

## Related

- [`docs/runbooks/cutover.md`](../runbooks/cutover.md) — Phase B (TTL lowering), gates A11 and
  P4/P5/P6.
- [`docs/runbooks/legacy-dependencies.md`](../runbooks/legacy-dependencies.md) — rows 5 and 9,
  corrected 2026-09-03 against these same measurements.
- [`infra/aws/README.md`](../../infra/aws/README.md) — `CORS_ADDITIONAL_ALLOWED_ORIGIN`,
  `PROD_API_BASE_URL`, and the deploy path.
