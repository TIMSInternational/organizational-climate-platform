# AI provider decision (issue #67)

**Status:** DRAFT — recommendation only. Requires explicit approval before any AI work starts.
**Blocks:** #92 (AI analysis endpoints), #111 (QuestionBank AI), #119 (adaptive questions), and the
stubbed sentiment/word-cloud in #128.

> **Addendum 2026-08-03.** Every technical claim below was re-verified against the current
> Claude API reference and holds — see [Verification](#verification-2026-08-03) at the end.
>
> **But the client's own requirements document was not consulted when this was written**, and it
> changes two of the open items. `climate-project/ORGANIZATIONAL_CLIMATE_PLATFORM_PRD.md`
> (v1.0, 2025-10-08, 1,233 lines) contains a 130-line **AI Implementation Strategy** section.
> It was never carried into this repository. See
> [What the PRD already requires](#what-the-prd-already-requires-2026-08-03).

---

## Finding that reframes this decision

**The legacy app's "AI" is largely simulated.** Before treating this as a migration, note what the
19 legacy `ai/*` routes actually contain:

- `src/lib/ai-service.ts` returns `Math.random() * 0.3 + 0.7` for effectiveness scores and fills
  templates by placeholder substitution.
- `src/lib/ai-feedback-loop.ts` returns, in its own comment, "mock model performance metrics."
- **`package.json` contains no AI SDK dependency at all** — no `openai`, no `@anthropic-ai/sdk`,
  no AWS SDK.
- The only provider named anywhere is **Cohere**, referenced in `src/lib/advanced-nlp.ts` and two
  NLP routes.

So there is **no parity obligation**. This is not "replace Cohere with X" — it is "build this for
the first time, if we want it." That materially changes the question, and it means scope reduction
is on the table in a way it wouldn't be for a real migration.

**Recommendation before anything else: treat the 19 legacy `ai/*` routes as a candidate for
deletion, not migration.** Build a small number of AI features we actually want, rather than
reproducing a surface that never worked.

---

## Recommendation

**Claude Platform on AWS**, with **Haiku 4.5 via the Batch API** for high-volume classification and
**Opus 5** for narrative generation.

### Why not plain Amazon Bedrock

Bedrock looks like the obvious choice — the backend already runs on AWS App Runner with an instance
role. But it fails on a requirement this specific product has:

| | Claude API (1P) | **Claude Platform on AWS** | Amazon Bedrock |
|---|---|---|---|
| **Message Batches API** | ✅ | ✅ | ❌ **not available** |
| Prompt caching | ✅ | ✅ | ✅ |
| *Automatic* prompt caching | ✅ | ✅ | ❌ |
| Auth | API key | **AWS SigV4 / IAM** | AWS SigV4 / IAM |
| Billing | Anthropic | **AWS Marketplace** | AWS |
| Feature parity | — | **same-day** | partner-operated, lags |
| Model IDs | `claude-opus-5` | `claude-opus-5` | `anthropic.claude-opus-5` |

**The Batch API is the whole argument.** Sentiment analysis runs on *every submitted survey
response* — the highest-volume, least latency-sensitive workload in the product. Batches give a
**50% cost reduction**, accept up to 100,000 requests per batch, and typically complete within an
hour (24h ceiling). That is an exact fit, and **Bedrock cannot do it.**

Claude Platform on AWS is Anthropic-operated with same-day API parity, so it keeps the AWS-native
IAM and Marketplace billing we want *and* keeps Batches. It is not the same thing as Bedrock.

> Note: Claude Platform on AWS is *not* the same as Bedrock. Bedrock is partner-operated (AWS runs
> the service, features lag, model IDs carry an `anthropic.` prefix). Don't add that prefix here.

### Model per workload

| Workload | Model | Why |
|---|---|---|
| Sentiment on each response | **Haiku 4.5** ($1 / $5 per MTok) via Batch → effectively $0.50 / $2.50 | Highest volume, simplest task, not latency-sensitive |
| Topic modelling / word cloud | **Haiku 4.5**, batched | Same shape as sentiment |
| Narrative insight generation (#86 `AIInsight`) | **Opus 5** ($5 / $25) | Low volume, high value, quality matters |
| Question recommendations (#111) | **Sonnet 5** ($3 / $15; intro $2 / $10 through 2026-08-31) | Middle ground |

### Where inference runs

**Queued into `ClimateProject.Workers`, never in the API request path.** Two reasons:

1. The Batch API is inherently asynchronous — results are polled, not awaited.
2. A synchronous LLM call inside `POST /surveys/{id}/responses` would put provider latency directly
   in front of the respondent, on the one page every employee touches (#120).

This aligns with the scheduled-jobs work already planned in #101 — same Workers project, same
execution-model decision about multi-instance safety.

### Client

Backend is .NET 10, so: `dotnet add package Anthropic.Aws`, then `new AnthropicAwsClient()`.
Requires `AWS_REGION` and `ANTHROPIC_AWS_WORKSPACE_ID` — **neither has a default**, and a missing
value throws at client construction. Model IDs are bare (`claude-opus-5`).

---

## Open items for the decision-maker

1. **Cost ceiling.** Needs a monthly number and a defined behaviour when hit. Recommendation:
   degrade to stub output and alert, never fail a survey submission.
2. **Turnover prediction (part of #92).** Predicting which employees may leave, from survey
   responses they gave in confidence, is ethically loaded. **Recommend dropping it** unless the
   client explicitly asks. It is not a neutral port — nothing working exists to port.
3. **Prompt/response retention.** Responses contain employee free-text. Decide what is logged and
   for how long, and how it interacts with GDPR erasure (#144).
4. **Tenant isolation.** Must be enforced and tested, not assumed — no prompt may mix companies.
5. **Prompt caching applicability.** Cache reads cost ~0.1×, writes 1.25× (5-min TTL). But the
   minimum cacheable prefix is **4096 tokens on Haiku 4.5** — a short classification prompt will
   silently not cache. Verify with `cache_read_input_tokens` before assuming savings.

## Acceptance criteria for #67

- [ ] Provider, model per workload, region and auth mechanism approved
- [ ] Cost ceiling and degradation behaviour recorded
- [ ] A spike proves one real call works from App Runner using the instance role
- [ ] Decision on dropping the 19 legacy `ai/*` routes vs. porting them
- [ ] Decision on turnover prediction
- [ ] #92 / #111 / #119 unblocked or explicitly re-scoped to remain stubbed

---

# Addendum — 2026-08-03

## What the PRD already requires

The legacy repository holds the whole-application requirements document this migration is
working from: `climate-project/ORGANIZATIONAL_CLIMATE_PLATFORM_PRD.md` (v1.0, 2025-10-08,
1,233 lines — Executive Summary, Personas, Core Features, Functional Requirements, User Stories
& Acceptance Criteria, **AI Implementation Strategy**, Technical Architecture, Roadmap, Success
Metrics, Risk Assessment). Companions: `TECH_SPEC.md`,
`MICROCLIMATE_REQUIREMENTS_VERIFICATION_REPORT.md`, and five files under
`testsprite_tests/tmp/prd_files/`.

**None of them exists in this repository.** That is the actual gap — not that the requirements
were never written.

Its **Technical Stack** subsections are obsolete and should be read as intent, not instruction:
they prescribe a Python NLP service (spaCy/NLTK), TensorFlow/PyTorch, Kafka, Redis, vector
databases, TensorFlow Serving, and Kubernetes. None of that exists in a .NET 10 + React stack,
and the recommendation above **replaces** it rather than implementing it. Worth stating
explicitly in the approval so nobody later reads the PRD as a contract for that architecture.

Its **requirements**, however, are binding and four are missing from this doc:

| PRD requirement (§ Data Privacy & AI Ethics unless noted) | Status here |
|---|---|
| **"AI processing on anonymized data only"** | **Absent.** This is a stated requirement, not an open question — it substantially answers open item 3 and constrains item 4. |
| **"Users can opt-out of AI features while maintaining core functionality"** | **Absent entirely.** Implies a per-user or per-company opt-out flag *and* that every AI-derived surface degrades gracefully when set. Not implemented anywhere in `src/`. |
| **"Explainable AI — clear explanations of AI recommendations"** | Absent. Affects the `AIInsight` shape (#86) — insights need to carry their basis, not just a conclusion. |
| **"Bias Detection — regular audits for algorithmic bias"** | Absent. An ongoing operational commitment, not a build task. |
| **"Attrition Prediction: Early warning system for potential turnover"** (§ Predictive Analytics) | **Directly contradicts open item 2.** |

### Open item 2 needs re-framing, not re-deciding

The doc says of turnover prediction: *"Recommend dropping it unless the client explicitly asks."*
**The client did explicitly ask — in writing, in the PRD.** The recommendation may well still be
correct, and the ethical concern is real and worth escalating: inferring attrition risk for named
employees from survey responses they gave in confidence is a different product from the one
respondents consented to, and it can suppress candid responses, which degrades every other
metric the platform produces.

But it must be presented as *"the PRD requires this; we recommend not building it, and here is
why"* — a documented scope reduction requiring client sign-off — not as an unrequested feature
being declined. Those are different conversations, and only one of them is honest about the
contractual position.

Note that the anonymization requirement and the attrition requirement are in tension with each
other: a per-employee early-warning system is hard to reconcile with "anonymized data only".
Raising that tension is probably the strongest argument available for dropping it, and it is the
client's own document making the argument.

## Resolving the five open items

### 1. Cost ceiling — recommended figures

Pricing verified 2026-08-03. Model of the dominant workload, sentiment on every free-text answer
(`QuestionResponse.ResponseText`, nullable — only answers with text incur cost):

| Assumption | Value | Basis |
|---|---|---|
| Prompt + response per classification | ~600 in / ~50 out tokens | Short instruction + one answer |
| Haiku 4.5 via Batch | $0.50 / $2.50 per MTok | $1 / $5 list, less the 50% batch discount |
| Cost per classification | **≈ $0.00043** | (600 × 0.5 + 50 × 2.5) / 1e6 |

That is **~2,300 classifications per dollar**, so sentiment is not the cost risk — narrative
generation on Opus 5 ($5 / $25) is, because it is invoked per report rather than per answer.

**Recommended ceiling: $200 / month**, allocated ~$50 sentiment + topic modelling, ~$120
narrative insight, ~$30 headroom. That covers roughly 100k classifications plus a few hundred
narrative reports — comfortably above any plausible pilot volume, and small enough that
breaching it means something is wrong rather than that the product grew.

**These numbers rest on stated assumptions, not measured traffic.** Before approval, replace the
token estimates with `count_tokens` measurements on ten real free-text answers, and replace
expected volume with the actual figure for the pilot cohort. The method is sound; the inputs are
placeholders.

**Behaviour at the ceiling** — confirming the doc's recommendation, with the mechanism specified:

- Enforce a **hard monthly cap in code**, checked before dispatch, not only an AWS budget alarm
  (an alarm notifies after the spend). Track spend from `usage` on every response.
- At 80%: warn. At 100%: stop dispatching AI work, alert, and serve the existing stub output.
- **Never fail a survey submission.** The respondent's write path must not depend on AI —
  the queue-not-request-path decision already guarantees this structurally, which is its main
  argument beyond latency.

### 2. Turnover prediction — see re-framing above

Recommendation unchanged (**don't build it**); the justification and the process change. Needs
explicit client sign-off as a documented scope reduction against the PRD.

### 3. Prompt/response retention — largely answered by the PRD

The PRD's "AI processing on anonymized data only" is the governing constraint, so this is mostly
implementation rather than decision:

- **Strip identifiers before the prompt is built.** Send answer text and the minimum context the
  task needs. No employee name, email, user ID, or single-person department slice.
- **Do not log prompts or responses containing employee free text.** Log token counts, model,
  latency, and a hash — enough to debug cost and behaviour without creating a second copy of the
  sensitive data in a system with different retention rules.
- **GDPR erasure (#144) becomes tractable** precisely because of this: if no prompt or log holds
  identifiable text, an erasure request touches application tables only, not AI logs or the
  provider. This is the cheapest possible answer to #144 and it is worth adopting for that reason
  alone.
- **Store derived output** (sentiment score, topics, insight text) against the existing entities
  with the same retention as the response it derives from — it is subject to the same erasure.
- **One decision genuinely remains:** whether derived aggregate output (department-level
  sentiment trend) survives erasure of a contributing individual response. Recommend **yes** for
  aggregates over a minimum cohort size, since they are no longer personal data — but that is a
  DPO-flavoured call, not an engineering one.

### 4. Tenant isolation — specification and required tests

Not a decision; a thing to build and prove. `Company` is already the tenant boundary
(`/api/internal/*` validates a `company_id` GUID on all five routes).

- Every AI request must be scoped to exactly one `Company`, resolved server-side from the
  authenticated principal — **never** from a client-supplied parameter.
- Batch requests: one `custom_id` per response, carrying the company ID. Batch results
  **arrive in any order** — key by `custom_id`, never by position. Mis-keying here is precisely
  how one company's text ends up attributed to another.
- No cross-company few-shot examples, benchmark text, or "best practice" corpora in a prompt.
  This directly limits the PRD's "cross-company learning to suggest proven solutions" — flag it
  as a conflict rather than resolving it silently.
- **Required tests**, mirroring the repo's guard-the-guard convention: a two-company fixture
  asserting no company-B text appears in a company-A prompt; a batch test with deliberately
  shuffled results asserting correct `custom_id` attribution; and a test proving the assertion
  fails if scoping is removed — otherwise the isolation test can pass vacuously.

### 5. Prompt caching — verified, and the doc's caution was right

The 4096-token minimum cacheable prefix on Haiku 4.5 is **confirmed**. The minimum is
per-model and **not monotonic across generations**, which is exactly the trap the doc anticipated:

| Model | Minimum cacheable prefix |
|---|---|
| **Opus 5** | **512 tokens** |
| Sonnet 5 | 1024 tokens |
| **Haiku 4.5** | **4096 tokens** |

So the picture splits by workload rather than applying uniformly:

- **Sentiment / topic modelling (Haiku 4.5): assume no caching.** A short classification prompt
  cannot reach 4096 tokens, and it fails **silently** — no error, just
  `cache_creation_input_tokens: 0`. Do not build a cost model that assumes cache savings here.
  The 50% batch discount is the real lever, and it is independent of caching.
- **Narrative insight (Opus 5): caching is very likely worthwhile.** At 512 tokens the minimum is
  low enough that a shared instruction preamble clears it easily. Reads cost ~0.1×; writes 1.25×
  (5-minute TTL) or 2× (1-hour), so break-even is two requests on the short TTL and three on the
  long one.
- **Verify empirically either way** via `usage.cache_read_input_tokens`. Zero across repeated
  identical-prefix requests means a silent invalidator — most likely a timestamp or company name
  interpolated into the prefix, which is easy to do accidentally when prompts are per-tenant.

## Verification — 2026-08-03

Checked against the current Claude API reference. Every claim in the original doc holds:

| Claim | Result |
|---|---|
| Message Batches **unavailable on Amazon Bedrock**, **available on Claude Platform on AWS** | ✅ Confirmed — the doc's central argument stands |
| Automatic prompt caching unavailable on Bedrock, available on Claude Platform on AWS | ✅ Confirmed |
| Batch: 50% discount, ≤100k requests per batch, typically <1h, 24h ceiling | ✅ Confirmed |
| Haiku 4.5 $1 / $5 · Sonnet 5 $3 / $15 (intro $2 / $10 through 2026-08-31) · Opus 5 $5 / $25 | ✅ All confirmed |
| Haiku 4.5 minimum cacheable prefix 4096 tokens | ✅ Confirmed |
| `dotnet add package Anthropic.Aws` → `new AnthropicAwsClient()` | ✅ Confirmed |
| `AWS_REGION` and `ANTHROPIC_AWS_WORKSPACE_ID` both required, no defaults, throw at construction | ✅ Confirmed |
| Bare model IDs on Claude Platform on AWS (no `anthropic.` prefix — that is Bedrock) | ✅ Confirmed |

Additional facts relevant to implementation, not in the original doc:

- **The App Runner instance role will work for the spike.** The client resolves AWS credentials
  through the standard chain, ending at assumed-role / instance metadata — so no static key is
  needed, which is also the right answer for #70 (nothing new to rotate).
- **A 403 means the request reached the server** — wrong `ANTHROPIC_AWS_WORKSPACE_ID` or a
  missing IAM action. Distinguish it from the construction-time throw for a missing region or
  workspace ID, which never leaves the process. Worth knowing before debugging the spike.
- **Haiku 4.5 does not support the `effort` parameter** (it errors), and takes the older
  `thinking: {type: "enabled", budget_tokens: N}` form rather than adaptive thinking. Prompt
  patterns written against Opus 5 will not transfer unchanged.
- **Haiku 4.5 has a 200K context window and a 64K max output**, not the 1M/128K of Opus 5 and
  Sonnet 5. Fine for per-answer classification; a constraint if answers are ever batched into
  one prompt.
- **Opus 5 runs thinking by default**, and `max_tokens` caps thinking *plus* response text
  together. Size `max_tokens` for narrative generation accordingly or responses truncate
  mid-answer.
- **Opus 5 can return `stop_reason: "refusal"`** with HTTP 200. Employee free text about
  workplace conflict is benign but not obviously so to a classifier. Check `stop_reason` before
  reading `content`, and treat a refusal as degraded output rather than an exception — the
  degrade-never-500 rule applies here too.
