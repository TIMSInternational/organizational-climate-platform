# AI provider decision (issue #67)

**Status:** DRAFT — recommendation only. Requires explicit approval before any AI work starts.
**Blocks:** #92 (AI analysis endpoints), #111 (QuestionBank AI), #119 (adaptive questions), and the
stubbed sentiment/word-cloud in #128.

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
