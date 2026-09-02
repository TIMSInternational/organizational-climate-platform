# QuestionPool adaptive behaviour (#113) — DECIDED: defer

> ## The ruling — 2026-09-02, Federico
>
> **Option A. Question adaptation is NOT in the 16 November 2026 go-live scope.**
>
> It is deferred, not dropped: the decision to build, narrow or abandon it is deliberately left
> open and is revisited **after the PROCOMER pilot has produced real response volume**, which is
> also the first moment "question effectiveness" can be measured rather than guessed.
>
> - **Owner of the revisit:** Federico.
> - **Revisit trigger:** first closed PROCOMER survey cycle with responses (post-16 Nov).
> - **Recommended sequence when revisited, unchanged from §6:** C next, B after the pilot,
>   **D not without a psychometric answer to §4.**
>
> **This is a scope reduction against a binding requirement**, and under
> `docs/requirements/README.md:18-20` it needs the client's sign-off — it is not an engineering
> call. **It must be stated to PROCOMER now, not discovered at UAT.** §8 is the statement to
> take to them.
>
> **#113 is closed as decided.** The four acceptance criteria are ruled on in §9. #119 is
> *not* blocked on this issue and never was (§2.5); deferring #113 does not park #119.
>
> **What this ruling does not do:** it does not unblock or resolve #67 items 1 and 2 (the
> monthly AI cost ceiling, and sign-off on dropping turnover prediction — §5). Under Option A
> nothing in scope trips that gate, so those two remain open and are simply not on the go-live
> path.

---

## The original framing, written 2026-09-01

Written 2026-09-01 against main `1ef86b8`, from greps over this repository and a read of the
legacy checkout at `../climate-project`. Every number below is a command and its output, not a
recollection. Nothing in this lane changed code: **#113's four acceptance criteria are all
documentation** — they ask for a decision to be established and recorded, not for an engine to
be built.

**Short answer up front.** Nothing of QuestionPool exists here (0 grep hits). The issue asks
for a decision to be made "from real production data", and there is no production data and none
is coming. The owner's parity rule ("everything migrates") does not settle this issue, because
**the legacy feature was never working**: its 704-line "AI engine" makes zero inference calls
and picks generated questions with `Math.random()`. So there is nothing to port, and the real
question is whether to *build*, for the first time, a feature the client's requirements do
contractually name. That question is open, it is Federico's (and probably PROCOMER's), and
§6 states it with options and consequences.

---

## 1. The measured absence

Run from the repository root. Reproduced here so the next reader does not re-derive it.

| Command | Result |
|---|---|
| `grep -rn "QuestionPool\|question-pool\|questionPool" src web/src services tests \| wc -l` | **0** |
| `grep -rni "adaptive" src web/src services tests \| wc -l` | **0** |
| `grep -rn "QuestionEffectiveness\|question-effectiveness\|questionEffectiveness" src web/src services tests \| wc -l` | **0** |

Zero hits across the backend, the web app, the tracking service and every test project. There
is no entity, no `DbSet`, no EF configuration, no migration, no endpoint, no component and no
i18n key. This is not "partially built" or "built and unrouted" — it is absent.

Two adjacent measurements matter for §6, because they say the *foundations* are absent too:

| Command | Result |
|---|---|
| `grep -rn "Anthropic\|claude-opus\|claude-haiku\|OpenAI\|Cohere" src services --include="*.cs" --include="*.csproj" \| wc -l` | **1** |
| `grep -rn "IsAiGenerated\s*=" src --include="*.cs" \| grep -v "Migrations/"` | **1 hit** |

The single AI hit is a *comment* at `src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs:1315`
saying "no inference client was ever built -- there is no Bedrock or Anthropic call". There is
no AI SDK package reference anywhere in the solution.

The single `IsAiGenerated` writer is `QuestionBankEndpoints.cs:1122`, which hard-codes
`IsAiGenerated = false`. The column exists, is queried at `QuestionBankEndpoints.cs:575`
(`CountAsync(i => i.IsAiGenerated, …)`), and **can never be true**, because nothing in the
codebase can set it. That count is a permanent zero by construction.

---

## 2. Six claims in the issue that are now false or superseded

The issue body and its two comments were written at different times against different facts.
Four of the six below are not opinions — they are claims a later decision voided.

### 2.1 "Check real data volume in the collections before anything else; an empty pool collection answers the question" — unsatisfiable

Also acceptance criterion 1, *"Real production usage established from data, not assumption."*

`docs/decisions/no-data-migration.md` (Federico, 2026-08-19) records that the legacy MongoDB
database "holds mock data, not production records worth preserving… There is no customer data
in it". **There is no production usage to establish, from that database or any other.** The new
platform started empty.

AC1 cannot be met as written. It must be rewritten or waived — and a reader who tries to
satisfy it will spend the time discovering what this paragraph already says.

### 2.2 "If dropped: record it, and exclude the entities from #154" — void

Also acceptance criterion 3, *"If dropped, excluded from the ETL scope."*

```
gh issue view 154 --json number,state,stateReason,closedAt
→ {"closedAt":"2026-08-19T15:44:24Z","number":154,"state":"CLOSED",
   "stateReason":"NOT_PLANNED","title":"Production data migration — MongoDB to Postgres ETL…"}
```

The ETL tool and its 201 tests were deleted the same day (`docs/decisions/no-data-migration.md`,
"What was deleted"). **There is no ETL scope**, so AC3 can be neither satisfied nor violated. It
is not a criterion any more; it is a fossil.

### 2.3 The first comment's verdict "DROP — the feature is orphaned UI" — superseded

The second comment reverses it: *"Decision reversed: MIGRATE — full parity."* A reader who stops
at the first comment reads a verdict the owner overturned.

Its **evidence**, however, holds — I re-measured it against the legacy checkout:

```
grep -rl "AdaptiveQuestionAnalytics" ../climate-project/src
→ .../src/components/question-pool/AdaptiveQuestionAnalytics.tsx   (itself only)

grep -rl "QuestionPoolDashboard" ../climate-project/src
→ .../src/components/question-bank/QuestionPoolDashboard.tsx       (itself only)
```

Each component is its own only reference: zero inbound. Both routes are reachable only from dead
UI. That fact is still true; only the conclusion drawn from it was reversed.

### 2.4 The parity premise, as applied here — the legacy feature was never working

The second comment's reason is *"The new repo must hold a fully working application before the
legacy stack is retired, so 'no consumer exists today' is not grounds to skip a feature."* That
rule is sound in general. It does not decide **this** issue, because the thing it would preserve
does not work. Measured against the legacy checkout:

| Measurement | Command | Result |
|---|---|---|
| Size of the "AI engine" | `wc -l ../climate-project/src/lib/adaptive-question-ai.ts` | **704 lines** |
| Outbound inference calls in it | `grep -cE "fetch\(\|axios\|api\.anthropic\|api\.openai" …` | **0** |
| Randomness in it | `grep -cE "Math\.random" …` | **2** (lines 660, 683) |
| AI SDK in legacy deps | `grep -iE "openai\|anthropic\|cohere\|bedrock\|tensorflow\|langchain" ../climate-project/package.json` | **no matches** |

Line 660 is the "generate a new question" path:

```js
return templates[Math.floor(Math.random() * templates.length)];
```

Line 683 is the effectiveness score: `score += Math.random() * 5; // Small randomization for diversity`.
Line 598 is the "reformulation": a string `.replace()`.

**Porting this at parity ships a random template picker and calls it AI.** The parity rule
therefore does not answer #113 — it re-poses it as "should we build this for the first time?",
which is the same conclusion `docs/superpowers/specs/2026-08-02-ai-provider-decision.md` reached
about the whole legacy `ai/*` surface: *"there is no parity obligation… it is 'build this for the
first time, if we want it.'"*

### 2.5 "It overlaps #119 — they are two routes to the same 'which question next' problem" — false as stated

They are two different mechanisms with different risk profiles:

- **#119** is deterministic branching over `QuestionConditionalLogic` — an entity that is
  **already migrated and live here** (`grep -rn "QuestionConditionalLogic" src --include="*.cs" |
  grep -v Migrations/` → 12 hits across 6 files, including the `DbContext` registration, an EF
  configuration, `SurveyEndpoints.cs` and `SurveyDuplication.cs`). Its own AC requires the
  adaptive path be *reconstructible from a stored response*.
- **#113** is text *generation* — combining, reformulating and inventing question wording.

`docs/superpowers/specs/2026-08-19-question-repositories-design.md:54` already says it:
QuestionPool is *"The AI question-adaptation engine — a different feature wearing a similar
name."* There is a boundary worth drawing, but it is not a duplication to resolve, and #119 is
not blocked on #113. Treating them as rivals has kept both parked.

### 2.6 "Entities: `QuestionPool`, `QuestionEffectiveness`" — undercounts the schema by half

`../climate-project/src/models/QuestionPool.ts` is 277 lines and registers **four** Mongoose
models, not two:

```
grep -nE "mongoose.model" ../climate-project/src/models/QuestionPool.ts
→ QuestionPool · QuestionEffectiveness · QuestionCombination · QuestionGeneration
```

plus three embedded interfaces (`IQuestionAdaptation`, `IAdaptationContext`,
`IDemographicContext`). Anyone sizing #113 from its own body sizes half the schema — which is
part of why it carries `size:M`.

> Correction to a neighbouring doc, recorded so it is not re-copied: the question-repositories
> design (line 54) lists the fourth model as `QuestionAdaptation`. `QuestionAdaptation` is an
> embedded **interface**, not a registered model; the fourth registered model is
> `QuestionGeneration`.

---

## 3. What the client actually contracted for

`docs/requirements/README.md:18-20` sets the standing rule: *"Requirements are binding…
Dropping any of them is a scope reduction that needs the client's sign-off — not an engineering
judgement call."* So the text below is not background; it is the contractual position, and
options B, C and D in §6 are all scope reductions against it.

`docs/requirements/TECH_SPEC.md:31-38`, §3 *Questionnaire System*:

> The platform maintains a pool of **200+ questions** covering climate, culture, and
> microclimates. **The AI dynamically adapts these questions by combining, reformulating, or
> generating new variations.** It has access to both historical and newly created questions for
> contextual adaptability.

It then names three scenarios explicitly:

| Scenario | The client's own example |
|---|---|
| **Combining** | Merge Q2 (Collaboration) + Q184 (Communication) → "How effectively do teams collaborate and communicate?" |
| **Reformulating** | Reword Q75 based on department demographics to align with local terminology |
| **New questions** | Generate a hybrid question from historical data + new admin-added questions |

And a workflow step (`TECH_SPEC.md:44`): *"Users complete adaptive questionnaires."*

The PRD repeats it four times, including `ORGANIZATIONAL_CLIMATE_PLATFORM_PRD.md:368` —
*"Question Adaptation: AI dynamically selects and modifies questions from 200+ question pool"* —
and `:301`, *"Question Library: 200+ curated questions with hierarchical categorization"*.

So this is not a half-built experiment the issue can quietly retire. It is a named, repeated,
binding requirement. **That is the finding that changes #113's character:** the issue frames the
question as "is this worth porting?", and the honest frame is "we owe this and have not started".

### How far the shipped surfaces are from it

The container is built and good. The contents and the intelligence are absent.

| What the requirement needs | What ships on `1ef86b8` | Gap |
|---|---|---|
| A pool of **200+ questions** | Two repositories, 7 entities (`QuestionRepositories.cs`, 226 lines), 23 routes (16 in `QuestionBankEndpoints.cs`, 7 in `QuestionLibraryEndpoints.cs`, 1,981 lines together), `/admin/question-bank` routed, the shared picker in both wizards. **No content.** No seeder for `QuestionLibraryItem` or `QuestionBankItem` exists in `src/` or `scripts/`. | The corpus is a **content** dependency, not an engineering one — and it currently has no delivery channel (see below) |
| AI **combines** questions | nothing | no inference client exists at all |
| AI **reformulates** questions | nothing | " |
| AI **generates** new variations | nothing | " |
| Users complete **adaptive** questionnaires | fixed-form delivery; `QuestionConditionalLogic` exists but is unevaluated (#119 open, `blocked`, `needs-design`) | the deterministic half is one design doc away; the generative half is not |
| Provenance of AI-authored items | `IsAiGenerated` column exists | single writer hard-codes `false`; permanently zero |

**The corpus has a dangling dependency worth surfacing on its own.**
`docs/decisions/survey-template-seed.md` deliberately refused to bake instrument content into
C#, on the sound reasoning that *"Instrument text belongs to the product owner and should arrive
through #154's loader or a reviewed admin action, not a literal in C#."* But **#154 is closed
NOT_PLANNED** — that loader no longer exists. So the 200+ questions currently have no owner and
no route into the product. Whatever is decided about adaptation, *the pool itself is a separate
open item*, and it is a prerequisite for every option except A.

---

## 4. The argument that has not been made yet, and should be

Every option below is usually debated on time and cost. There is a stronger objection to the
full requirement, and it comes from a decision this repository has **already taken and shipped**.

`docs/superpowers/specs/2026-08-19-question-repositories-design.md`, Decision 2, made
instantiation a COPY rather than a reference, for this reason:

> `question_responses.response_value` stores the answer against the question **as it was asked**.
> If a survey referenced a library row and someone later edited that row's text, every stored
> answer in every closed survey using it would silently change meaning, with no error and with
> row counts that reconcile exactly.

That principle protects *storage*. Generative adaptation attacks the same guarantee from the
other side, and copying cannot repair it:

- If the AI rewords Q75 per department (the client's own Reformulating example), then Department
  A and Department B **answered different questions**. Their scores are no longer comparable —
  and cross-department comparison is the product's primary output.
- If it rewords per period, this period is not comparable to last period, which is what
  `docs/decisions/prior-period-benchmark-linkage.md` exists to make possible.
- If it *combines* Q2 and Q184 into one item, that item belongs to two dimensions at once, and
  the dimension score it feeds is undefined.

This is a **measurement-validity** problem, not an engineering one, and no amount of build
quality solves it. It is also in direct tension with #119's own acceptance criterion
(*"Adaptation must be deterministic and reproducible for a given answer set, otherwise results
are not comparable across respondents"*) — the issue tracker has already written down the
principle that rules out the generative reading, in the neighbouring issue.

The honest framing for the client conversation is therefore **not** "we ran out of time". It is:
*the requirement as written would degrade the instrument the platform sells, and here is the
narrower version that delivers the visible benefit without breaking comparability.* That is
option C.

---

## 5. What is still gated on a human, upstream of all of this

`docs/superpowers/specs/2026-08-02-ai-provider-decision.md` still carries the status line
**"DRAFT — recommendation only. Requires explicit approval before any AI work starts"**, and it
names #111, #113 and #119 as blocked on it. Issue #67 is `CLOSED / COMPLETED`, but its final
comment ends: *"Items 3–5 are ready to build once the provider choice is approved. **Items 1 and
2 are yours.**"* — the monthly cost ceiling, and sign-off on dropping turnover prediction.

So **#67 is closed as an issue but unfinished as a decision**, and two of its five items are
still Federico's. Any option below except A trips this first. It is a five-minute decision
(a number and a yes/no) that is currently gating three issues.

---

## 6. The decision

> **Does the 16 November 2026 delivery (`docs/operational-readiness.md:1`) include AI question
> adaptation — and if so, in which of the three forms the client named?**

It is one question with four answers. All of B, C and D also require the 200+ question corpus,
which nobody currently owns (§3).

### Option A — Defer, with a date and a named owner *(recommended for 16 Nov)*

Record that question adaptation is not in the go-live scope; revisit after the pilot has
produced real response volume, which is also the first moment "effectiveness" means anything.

- **Consequence:** a documented scope reduction against a binding requirement — needs the
  client's sign-off under `docs/requirements/README.md:18-20`. It is not an engineering call,
  and it should be raised *now*, not discovered at UAT.
- **What follows:** rewrite #113's AC1 and AC3 (both unsatisfiable, §2.1/§2.2), set a revisit
  date, unblock #119 from #113 in the process. #111 and #119 keep their current status.
- **Size: zero engineering.** One client conversation, plus this document as its evidence.

### Option B — Build the deterministic half only (#119); drop generative adaptation

Evaluate `QuestionConditionalLogic` so respondents genuinely see branching questionnaires. This
satisfies the workflow step *"Users complete adaptive questionnaires"* and **none** of §3's three
scenarios, which are dropped with sign-off.

- **Consequence:** the strongest honest claim available without an AI provider — and it is
  demoable. Preserves comparability completely: every respondent still sees pinned question text.
- **What follows:** design doc first (#119 is `needs-design`), then a condition evaluator that
  **never evaluates stored condition strings as code** (#73's lesson, and #119's own AC), plus
  path reconstructibility from a stored response.
- **Size: M–L.** Realistically one full build+refute cycle. Not compatible with 16 Nov alongside
  the open readiness work; it is the first post-pilot item.

### Option C — Build reformulation only, admin-facing and human-approved

The narrowest generative slice: an admin viewing a question clicks "adapt for this department",
gets a suggested rewording with its reason, and **approves it before it can enter a survey**.
Never in the respondent path; never automatic.

- **Consequence:** delivers a visible, demonstrable instance of "the AI adapts questions" against
  the client's own Reformulating scenario, while §4's comparability problem stays bounded —
  a human decides whether a reworded item starts a new series. It touches question *text*, never
  employee responses, so it sidesteps the anonymization constraint entirely.
- **Honest caveat:** this is closer to #111's `question-bank/adapt` than to #113's engine. If
  chosen, **#113 should be closed in favour of #111** rather than built under this number.
- **What follows:** the first AI client in the repo (`Anthropic.Aws`, per the #67 doc), dispatch
  from `ClimateProject.Workers` not the request path, a hard in-code monthly cap, the
  tenant-isolation tests the #67 doc specifies (including the one proving the isolation test
  fails when scoping is removed), and graceful degradation so the question bank stays fully
  usable with AI unavailable.
- **Size: L**, and **gated on #67 items 1 and 2** (§5) before a line is written.

### Option D — Build the engine as the requirement describes

Combining + reformulating + generating, over a 200+ pool, in the respondent path.

- **Consequence:** this is the option to argue **against on the merits**, not on the calendar.
  Per §4 it undermines cross-department comparison, prior-period benchmarking, and dimension
  scoring — the platform's primary outputs. It also contradicts #119's determinism criterion,
  and it needs a defensible answer to "two respondents answered differently-worded questions;
  are their scores one series?" that nobody has yet.
- **What follows:** the corpus, the AI client, a determinism/reproducibility scheme for a
  generative system, a dimension-attribution rule for combined questions, an anonymity review,
  and a psychometric position on instrument stability that is genuinely outside engineering.
- **Size: XL**, and the sizing is the least of its problems. `size:M` on #113 is wrong under any
  reading except A.

### Recommendation

**A now, C next, B after the pilot, D not without a psychometric answer to §4.** Take A to the
client this week as an explicit, evidenced scope reduction — the evidence is §2.4 (there is
nothing to port) and §4 (the full version would damage the instrument). That is a much better
conversation than silence followed by a UAT gap, and it costs one meeting.

---

## 7. What this document deliberately did not do

No entity, `DbSet`, migration, endpoint or component was created. #113's four acceptance
criteria ask for a decision to be *established and recorded*; only the implementation behind
them is human-gated, and it is gated on §5 and on the choice in §6. Building an XL AI feature
weeks before a client go-live, to reach parity with 704 lines that call `Math.random()`, would
have been the wrong move under every reading of the issue.

**Gates run for this lane:** none. This lane touched one new Markdown file under `docs/` and no
code, so `dotnet build` / `dotnet test` / `npm run typecheck` had nothing to gate and were not
run.

---

## 8. The statement for PROCOMER

Drafted 2026-09-02 to satisfy the sign-off obligation in §3
(`docs/requirements/README.md:18-20`). Federico's to send, edit or replace — it is deliberately
written as a scope position rather than an apology, because per §2.4 and §4 that is what it is.

> **Adaptación de preguntas por IA — alcance para el 16 de noviembre**
>
> El `TECH_SPEC` §3 describe un motor que combina, reformula y genera preguntas sobre un banco
> de 200+. Esa funcionalidad **no forma parte de la entrega del 16 de noviembre**, y queremos
> decirlo ahora y no en la aceptación.
>
> Dos razones, en este orden:
>
> 1. **No existe nada que migrar.** El "motor de IA" del sistema anterior (704 líneas) no
>    realiza ninguna llamada de inferencia: selecciona plantillas con `Math.random()` y calcula
>    la "efectividad" sumando un número aleatorio. Portarlo daría la apariencia de la función
>    sin la función.
> 2. **La versión completa degradaría el instrumento.** Si la IA reformula una pregunta por
>    departamento, entonces dos departamentos respondieron preguntas distintas y sus resultados
>    dejan de ser comparables — y la comparación entre departamentos y entre periodos es el
>    producto principal de la plataforma.
>
> **Lo que sí está construido y entra el 16 de noviembre:** la biblioteca de preguntas con
> categorías jerárquicas bilingües, el selector compartido en ambos asistentes (encuestas y
> microclimas), y el banco de preguntas con su página de administración.
>
> **Propuesta de secuencia posterior al piloto**, para conversar: primero una adaptación
> *asistida y aprobada por un administrador* — la IA sugiere una reformulación, una persona la
> aprueba antes de que entre en una encuesta — que entrega el beneficio visible sin romper la
> comparabilidad. La adaptación automática en la ruta del encuestado requiere antes una
> definición metodológica sobre estabilidad del instrumento.

## 9. Ruling on the four acceptance criteria

Closed against the criteria, not against code. Two of the four were unsatisfiable as written and
are waived with the reason recorded, per §2.1 and §2.2.

| # | Criterion | Ruling |
|---|---|---|
| 1 | Real production usage established from data, not assumption | **WAIVED — unsatisfiable.** There is no production data and none is coming: `docs/decisions/no-data-migration.md` records that the legacy MongoDB held mock data, and the new platform started empty. The *absence* was established instead, by measurement: 0 grep hits for `QuestionPool`, `QuestionEffectiveness` and `adaptive` across `src`, `web/src`, `services` and `tests` (§1). |
| 2 | Explicit build/drop/defer decision recorded | **MET.** Defer, with owner and revisit trigger, in the ruling block above. |
| 3 | If dropped, excluded from the ETL scope | **VOID — not applicable.** The decision is defer, not drop; and there is no ETL scope to be excluded from. #154 is `CLOSED / NOT_PLANNED` and the tool was deleted 2026-08-19 (§2.2). |
| 4 | If built, boundary with #119 documented | **NOT APPLICABLE — not built.** The boundary is nonetheless recorded in §2.5, because the issue stated it wrongly: #119 is deterministic branching over `QuestionConditionalLogic`, which is already live here; #113 is text generation. They are not rivals and #119 is not blocked on #113. |

**Follow-on that outlives this issue:** the 200+ question corpus (§3) has no owner and no
delivery channel, and that is true under every option including this one. For PROCOMER's own
44–50 item instrument the channel now exists — `docs/runbooks/question-library-import.md`,
written for #423 on the same day. The wider corpus is still unowned.
