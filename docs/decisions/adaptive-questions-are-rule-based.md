# Adaptive questions are rule-based, so #119 is not blocked (#119, and what it says about #67)

**Status: BLOCKING STATUS CORRECTED. #119 is not blocked on #67. A second finding below is
larger than the first.**

#119's own scope predicted this and asked for it to be verified rather than assumed:

> Partly blocked on #67: it needs establishing whether adaptation is rule-based (conditional
> logic, buildable now) or AI-driven (blocked). The `QuestionConditionalLogic` entity already
> exists, which suggests the rule-based path is the real one — **verify before assuming AI is
> needed at all.**

Verified. It is rule-based.

## Finding 1 — rule-based, on the shape of the entity itself

`src/ClimateProject.Domain/Entities/QuestionConditionalLogic.cs` is six fields:

```csharp
public Guid  QuestionId          { get; set; }
public Guid? ConditionQuestionId { get; set; }
public string? ConditionOperator { get; set; }
public string? ConditionValue    { get; set; }
public string? Action            { get; set; }
public Guid? TargetQuestionId    { get; set; }
```

That is a rule tuple — *when question X answers OP value, do ACTION to question Y*. There is
no embedding, no score, no model reference and nothing an inference call would populate. It is
already migrated, has its own EF configuration, is copied by `SurveyDuplication`, and is
classified in the GDPR `SubjectDataMap`.

**So #119 does not need an AI provider and is not blocked on #67.** Its first acceptance
criterion — "Rule-based vs AI-driven established, blocking status corrected" — is met by this
document. The `blocked` label should come off.

## Finding 2 — nothing evaluates it, on either end

This is the bigger one, and #119 does not currently say it.

Every file in `src/` that touches the entity, migrations and snapshots excluded:

| File | What it does |
|---|---|
| `Domain/Entities/QuestionConditionalLogic.cs` | declares it |
| `Infrastructure/Persistence/Configurations/QuestionConditionalLogicConfiguration.cs` | maps it |
| `Infrastructure/Persistence/ClimateProjectDbContext.cs` | the `DbSet` |
| `Api/Endpoints/SurveyEndpoints.cs` | writes and removes rows on save |
| `Application/Surveys/SurveyDuplication.cs` | copies rows when a survey is duplicated |
| `Application/Gdpr/SubjectDataMap.cs` | classifies it as not-personal |

**In `web/src` the count is zero.** No authoring UI creates a rule, and no respondent code
reads one. Nothing anywhere evaluates `ConditionOperator` to decide which question a person
sees.

So adaptive questions today are a persisted shape with no behaviour at either end: the schema
can hold a rule, the API will store and duplicate one, and nothing can create it or act on it.
This is the same class as the scheduled-report job that filters on `IsRecurring` while no API
path ever sets it — built on both sides, connected on neither.

What #119 actually needs is therefore an **evaluator and an authoring surface**, not a
provider. Its remaining scope stands as written, including the security constraint it already
carries from #73: *do not evaluate stored condition strings as code.* With this entity shape
that constraint is easy to honour — the operator is a value to switch on, never an expression
to execute.

## Finding 3 — #67 is closed, and closing it unblocked nothing

#92, #111 and #119 were all marked blocked on **#67, "DECISION: choose the AI provider, model
and cost ceiling"**. #67 is **CLOSED / COMPLETED**.

The artifact it produced, `docs/superpowers/specs/2026-08-02-ai-provider-decision.md`, opens:

> **Status:** DRAFT — recommendation only. **Requires explicit approval before any AI work
> starts.**
> **Blocks:** #92 (AI analysis endpoints), #111 (QuestionBank AI), #119 (adaptive questions),
> and the stubbed sentiment/word-cloud in #128.

Its approval checklist is unticked — `- [ ] Provider, model per workload, region and auth
mechanism approved` — and no approval is recorded anywhere in the repository. There is no
Bedrock or Anthropic call in `src/`; the single grep hit is a comment saying so.

**So the issue is closed and the decision is not made.** Anyone reading the tracker concludes
the AI work is unblocked; anyone reading the document learns it is not. #119 escapes this
because it turns out not to need AI at all. **#92 and #111 do not** — they are waiting on a
signature that nobody is aware is outstanding.

The document also records, in a 2026-08-03 addendum, that the client's own PRD contains a
130-line **AI Implementation Strategy** that "was never carried into this repository". That
belongs in the approval conversation.

## What this asks of Federico

```
Approve the AI provider recommendation?   ____  (approve | revise | drop the AI scope)
Decided by: ____
Date: ____
```

One signature settles the blocking status of #92 and #111. Dropping the AI scope settles it
just as well, and is a legitimate answer for a go-live in November.
