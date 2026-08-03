# Client requirements documents

The authoritative statement of **what the client asked for**. Ported verbatim from the legacy
repository so that migration work can be built and reviewed against the client's own words
instead of against inference from legacy code.

Until this port, none of it existed in this repository. That gap had a concrete cost: the #67
AI-provider decision document recommended dropping turnover/attrition prediction "unless the
client explicitly asks", when the client *had* explicitly asked — in the PRD's AI
Implementation Strategy section. See [The requirements no issue referenced](#the-requirements-no-issue-referenced).

---

## How to read these documents

**Two rules, and they matter more than anything else here.**

1. **Requirements are binding.** Functional requirements, user stories, acceptance criteria,
   priorities and scope statements are the contractual position. Dropping any of them is a
   scope reduction that needs the client's sign-off — not an engineering judgement call.

2. **Technical-stack prescriptions are superseded.** These documents were written before the
   rebuild onto .NET 10 + React 19. They variously prescribe Python/spaCy, TensorFlow,
   TensorFlow Serving, Kafka, Redis, vector databases, Kubernetes, MongoDB and Next.js. None of
   that binds this repository. Where a document says *what the system must do*, follow it; where
   it says *what technology to do it with*, ignore it.

The distinction is usually obvious per-section. The PRD's "Technical Architecture" section is
entirely superseded; its "Functional Requirements" and "User Stories & Acceptance Criteria"
sections are entirely binding.

**Do not edit the bodies.** Every file below is a verbatim copy under a provenance header. If a
requirement needs to change, that is a conversation with the client and then a new document —
not an edit here. Editing these destroys their value as a record of what was actually asked.

---

## Index

### Primary documents

| File | Lines | What it is |
|---|---|---|
| [ORGANIZATIONAL_CLIMATE_PLATFORM_PRD.md](./ORGANIZATIONAL_CLIMATE_PLATFORM_PRD.md) | 1233 | **The whole-application PRD.** v1.0, 2025-10-08. Executive Summary, Personas, Core Features, **Functional Requirements**, **User Stories & Acceptance Criteria**, **AI Implementation Strategy** (~130 lines), Technical Architecture, Roadmap, Success Metrics, Risk Assessment. The single most important document in this directory. |
| [TECH_SPEC.md](./TECH_SPEC.md) | 47 | Short platform spec: four-role permission model, the 200+ question pool and AI question-adaptation scenarios, demographics-edit-triggers-reanalysis rule, module list. Extracted from a PDF — numbering is mangled (items 5–11 are really sub-steps of §4 "Workflow Steps") and role/permission tables are flattened into loose lines. Read it for content, not structure. |
| [MICROCLIMATE_REQUIREMENTS_VERIFICATION_REPORT.md](./MICROCLIMATE_REQUIREMENTS_VERIFICATION_REPORT.md) | 730 | Requirements verification pass over the microclimate feature in the legacy application. |

### Review notes (`notes/`)

Five files that came from the legacy repo's `testsprite_tests/tmp/prd_files/`. They carry no
markdown headings and read as raw client/consultant notes — but they are **not** PRD subsets.
They are a later review round over the survey-configuration flow, and they carry
prioritisation, acceptance criteria and test cases that appear nowhere in the PRD.

| File | Lines | What it is | Why it matters |
|---|---|---|---|
| [notes/functional-req.md](./notes/functional-req.md) | 126 | 12 numbered findings over climate-survey configuration, each with impact, severity, recommendation, acceptance criteria and positive/negative test cases. Ends with a **P0/P1/P2 backlog** and a **JIRA-ready ticket list (`CLIMA-001`–`CLIMA-012`)**. | The only document here that states client **priorities** with acceptance criteria attached. |
| [notes/microclimate-req.md](./notes/microclimate-req.md) | 168 | Step-by-step product spec for the 4-step survey builder (Basic Info → Questions → Targeting → Scheduling & Distribution), plus non-functional requirements, error-handling UX, explicit **Out of Scope** list and four **Open Questions**. | The most implementation-ready spec in the directory. Also the only place that records what the client put *out* of scope. |
| [notes/req.md](./notes/req.md) | 23 | **§2.2 Demographics Management.** Company-specific dynamic demographic attributes; CSV/Excel pre-load "preferred by 90% of companies"; demographics pre-assigned at invitation so respondents answer only questions; all custom demographics filterable in dashboards and exports. | A distinct and load-bearing spec — the demographics model shapes the data schema, the invitation flow and every dashboard filter. |
| [notes/General_Structure.md](./notes/General_Structure.md) | 111 | Module architecture, roles and permissions, evaluation logic, suggested database structure, suggested API endpoints, 3-phase roadmap, intended Figma pages. | The client's own view of the module boundaries. The DB/API sections are *suggestions* and fall under the superseded-stack rule. |
| [notes/Genral_Flow.md](./notes/Genral_Flow.md) | 59 | Figma page structure, per-screen base layouts, five prototype flows, suggested visual style (per-module colour coding, Inter/Roboto). | Filename typo is the client's; preserved deliberately. Directly relevant to Batch 2's app shell and Batch 3's first pages. |

---

## What Batch 2 should build against

Batch 2 (`batch:2-foundation-b`) is the first batch with the PRD available to it. The mapping:

| Issue | Read first |
|---|---|
| #80 app shell | `notes/Genral_Flow.md` §2 (sidebar + navbar, per-screen layouts), `notes/General_Structure.md` §1 (module map) |
| #81 auth pages | `notes/Genral_Flow.md` (Login/Sign-Up: SSO, role selection, corporate branding), PRD user stories for authentication. Note `notes/microclimate-req.md` puts **SSO out of scope for that iteration** — reconcile before building it |
| #79 charts | `notes/Genral_Flow.md` §1 Component Library (word clouds, heatmaps, progress bars, AI alerts), PRD Success Metrics |
| #96/#97/#100/#101 notifications | `TECH_SPEC.md` §12 (Notifications module), `notes/functional-req.md` finding 4 (reminders), `notes/microclimate-req.md` Step 4 (reminder cadence and channels) |
| #83 a11y baseline | Not specified by the client. Engineering-owned; no requirement to reconcile |
| #73 security | PRD Risk Assessment; the anonymisation and opt-out requirements below |
| #82 PWA decision | Not specified by the client — genuinely a decision, not a requirement lookup |

---

## The requirements no issue referenced

Found in the PRD when it was finally read, and not traceable to any tracker issue at the time
of this port. Listed here so they stop being invisible:

- **"AI processing on anonymized data only."**
- **"Users can opt-out of AI features while maintaining core functionality."** Not implemented
  anywhere in `src/`.
- **Explainable AI** — insights must be able to say why they were produced.
- **Bias detection** — regular audits.
- **Attrition / turnover prediction** — explicitly requested. #67's decision document
  recommended dropping it *as if unrequested*; dropping it is a **PRD scope reduction** and
  needs client sign-off.

The first two in particular are architectural: an opt-out that preserves core functionality, and
an anonymised-data-only AI boundary, are both much cheaper to design in than to retrofit.

---

## Provenance and integrity

All eight files come from the legacy `climate-project` repository, last touched by commit
`40fc19a` ("Add existing Procomer climate platform application (baseline)", 2026-07-28).

**That is the same commit that imported the `tailwind.config.js` malware**
(see [../security/2026-07-30-tailwind-payload-analysis.md](../security/2026-07-30-tailwind-payload-analysis.md)),
so these files were checked rather than assumed safe before porting:

- **Zero payload markers.** No `eval`, `atob`, `fromCharCode`, `require(`, `<script`,
  `child_process` or `Buffer.from` in any of the eight. The only hits on a case-insensitive
  `eval` search are the words "evaluation" and "Evaluated" in ordinary prose.
- **No hidden long lines.** Maximum line length ranges from 116 to 344 characters across the
  set — normal prose and markdown tables. The malware hid behind a 2,184-byte whitespace run;
  nothing of that shape exists here.

### One source file was deliberately not ported

`climate-project/testsprite_tests/tmp/prd_files/ORGANIZATIONAL_CLIMATE_PLATFORM_PRD.md` is a
second copy of the PRD and was **skipped as having no unique content**.

This is worth recording precisely, because a naive check suggests otherwise: the two copies
differ by 458 diff lines, and even a whitespace-normalised hash differs. Both are misleading.
After stripping all whitespace and collapsing markdown separator-dash runs, the two copies are
**36,853 bytes each and differ in exactly 2 bytes** — an `_` where the other has a `*`, i.e.
markdown emphasis style. The root copy is the prettier-formatted canonical one and is the one
ported here. The 458-line diff is entirely table padding and `|---|` dash-run length.

---

## Related

- [../EXECUTION-PLAN.md](../EXECUTION-PLAN.md) — how the tracker issues get worked through
- [../security/rotation-inventory.md](../security/rotation-inventory.md) — credential rotation checklist
- The legacy repository is a **migration source, never a target.** Read from it; never commit
  into it.
