# Archived issues: TIMSInternational/climate-project

Frozen snapshot taken before the migration tracker was consolidated into
`organizational-climate-platform`. The original issues were deleted after this
archive was committed. Numbers below refer to the ORIGINAL repo numbering.

Total: 40 issues

---

## #13 — bug: /admin/companies throws "Maximum update depth exceeded" (React infinite render loop)

- **State:** CLOSED
- **Labels:** bug
- **Author:** tafurfede
- **Created:** 2026-07-30T16:39:49Z  **Closed:** 2026-07-30T20:45:28Z
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/13

## Description
`/admin/companies` throws a React "Maximum update depth exceeded" error (infinite render loop).

## What we know
- Confirmed present on `main` (`git show origin/main:src/app/admin/companies/page.tsx` has zero `useEffect` calls), so the loop is not in the page component itself.
- None of the recent UI-parity PRs (#9, #10, #11) touch any hook/state logic, so this predates that work.
- Root cause is likely in a shared hook or context the page consumes — not yet identified.

## Next steps
- Trace which shared hook/context `/admin/companies` consumes that could cause a render loop (candidates: data-fetching hooks, table/pagination state, or a context provider higher up the tree).
- Reproduce with React DevTools profiler or by bisecting which hook triggers the loop.

_Discovered while testing UI-parity work; tracked separately since it's unrelated to that effort._

---

## #14 — security: rotate all secrets exposed by the tailwind.config.js malware incident

- **State:** OPEN
- **Labels:** security
- **Author:** tafurfede
- **Created:** 2026-07-30T16:51:24Z  **Closed:** -
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/14

## Background
`tailwind.config.js` had ~16KB of obfuscated executable JS appended after `module.exports`, present since the very first baseline commit (`40fc19a`) and unchanged through every PR merged this whole engagement. Since `tailwind.config.js` is `require()`'d on every build/dev run, it executed on every local build/test run and every Vercel production deploy since baseline. The payload itself was removed (PR #7) — this issue tracks the still-outstanding cleanup.

## What's still needed
1. Rotate ALL secrets this dev machine or Vercel had access to: `MONGODB_URI`/DB credentials, `NEXTAUTH_SECRET`, `TRACKING_JWT_SECRET`, Vercel project env vars, GitHub tokens, any cloud/API keys.
2. This is the user's own responsibility (requires access to the actual secret stores), not something an agent can do — tracked here so it isn't forgotten.

## Why this can't wait for the stack migration
Migrating stacks doesn't undo already-executed code, doesn't retroactively secure credentials already exposed, and the payload stays live in git history/every clone regardless of what runs on top later.

---

## #15 — security: get isolated sandbox malware analysis of the removed tailwind.config.js payload

- **State:** OPEN
- **Labels:** security
- **Author:** tafurfede
- **Created:** 2026-07-30T16:51:25Z  **Closed:** -
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/15

## Background
The obfuscated payload found in `tailwind.config.js` (see #14, secret-rotation issue) was statically diffed and removed in PR #7, but never deobfuscated or executed — so what it actually did (data exfiltration, backdoor, credential theft, etc.) is still unknown.

## What's needed
- Proper malware analysis in an isolated sandbox (not this dev machine, not any machine with real credentials) of the payload before considering the incident fully closed.
- The original payload should still be recoverable from git history (pre-PR#7 commits on `tailwind.config.js`) if not archived elsewhere.

---

## #16 — security: audit Vercel build logs / outbound network activity since baseline for signs of exfiltration

- **State:** OPEN
- **Labels:** security
- **Author:** tafurfede
- **Created:** 2026-07-30T16:51:27Z  **Closed:** -
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/16

## Background
The `tailwind.config.js` payload (see #14) executed on every build/dev run and every Vercel production deploy since the very first baseline commit. Whether it actually did anything (network calls, data exfiltration) hasn't been checked.

## What's needed
- Audit Vercel build logs since baseline for anomalous network activity during builds.
- Check any available outbound-network monitoring/logs on this dev machine covering the same period, if such logs exist.

---

## #17 — epic: full stack migration to C#/.NET 10 backend + React (non-Next.js) frontend

- **State:** OPEN
- **Labels:** enhancement, epic
- **Author:** tafurfede
- **Created:** 2026-07-30T16:51:50Z  **Closed:** -
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/17

## What
Migrate climate-project's backend to C# / .NET 10, database to Supabase (Postgres), frontend to React (Vite + react-router, not Next.js), and hosting to AWS — mirroring the architecture already used by sibling products `formmaps-api`/`tims-ats-api` (clean-architecture `.Api/.Application/.Domain/.Infrastructure/.Workers` layers) and `climate-tracking` (same pattern, already live and BFF-integrated with this repo).

## Reference architecture (confirmed on disk 2026-07-30)
- Backend pattern: `formmaps-api`, `tims-ats-api`, `climate-tracking/services/api` — all follow `{Product}.Api/.Application/.Domain/.Infrastructure/.Workers` + `UnitTests`/`IntegrationTests`/`ContractTests`.
- Frontend pattern: `/Users/federicotafur/formmaps/apps/web`, `/Users/federicotafur/tims-suite/apps/web` — Vite + React + react-router (not the `formmaps-web`/`tims-ats-web` repos under this org, which are empty shells).
- Correction to earlier note: `tims-suite/apps/api` is Node/TypeScript, not .NET — not a backend reference.

## Strategy
Incremental / strangler-fig: new .NET + React + Supabase stack built and shipped domain-by-domain, running alongside the current Next.js/Mongo/Vercel stack until each piece is verified, rather than one big-bang cutover. AWS hosting decision and full cutover happen last (#58), after all domains are migrated.

## Sub-issues (dependency order)
1. #47 — Foundation scaffold (.NET solution, Supabase project, React+Vite app, CI skeleton)
2. #48 — Auth & identity strategy (replaces NextAuth)
3. #49 — Data model design (MongoDB → Supabase/Postgres schema, all ~30 models)
4. #50 — Org structure domain (Companies, Users, Departments, Admin)
5. #51 — Surveys domain (largest domain — survey builder, templates, question bank, distributions)
6. #52 — Microclimates domain
7. #53 — Action plans domain
8. #54 — Reports & analytics domain (also closes #20's prior-year-benchmark gap properly)
9. #55 — Notifications domain
10. #56 — Tracking module integration (climate-tracking is already .NET — integration, not a rewrite; also touches climate-tracking#2, climate-tracking#3)
11. #57 — Cross-cutting frontend (i18n, design-system tokens, routing, PWA decision)
12. #58 — Cross-cutting backend (audit log, GDPR, search, security, system settings, health — also drops the ~15 dev-only `test-*` API routes)
13. #59 — AWS deployment & cutover (also decides Supabase hosted-vs-self-hosted-on-AWS)
14. #60 — Decommission legacy stack (last, once everything else is verified live)

## Not yet decided (surface during #47/#48/#59)
- Supabase Auth vs. custom JWT via the new .NET API (must stay compatible with climate-tracking's existing JWT claim set).
- Supabase hosted cloud vs. self-hosted on AWS.
- AWS compute target for the API (ECS/Fargate vs. App Runner vs. Elastic Beanstalk) and the frontend (S3+CloudFront vs. Amplify).

## Before starting
- Should follow secret rotation (#14) — no reason to block on it, but don't let this migration become a reason to skip that cleanup.
- Each sub-issue gets its own brainstorming → spec → plan cycle before implementation starts (per the branch/PR workflow this repo already uses) — this epic is the map, not a green light to start coding everywhere at once.

---

## #18 — epic: UI Parity Phase 2 — 108-file card/box/text semantic-token sweep

- **State:** CLOSED
- **Labels:** enhancement, epic
- **Author:** tafurfede
- **Created:** 2026-07-30T16:51:52Z  **Closed:** 2026-07-30T19:47:18Z
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/18

## What
Full sweep across all 14 flagged directories (`dashboard/`, `tracking/`, `charts/`, `admin/`, `action-plans/`, `microclimate/`, `reports/`, `benchmarks/`, `alerts/`, `widgets/`, `onboarding/`, `surveys/`, `companies/`, `exports/`, `question-pool/` — ~108 files initially flagged by a grep for literal chrome colors/shadows/radii: `bg-white`, `bg-gray-*`, `text-gray-*`, `shadow-lg/xl/2xl`, `rounded-2xl/3xl`).

## Approach (already agreed)
Rule-based, not a fixed file list: for every hand-rolled box, swap in the Phase-1-fixed `Card`/`Badge`/`Button` primitives; drop literal Tailwind colors for semantic tokens; keep genuinely-meaningful data colors (chart series, status dots) untouched.

## Status: DONE — all 10 PRs merged 2026-07-30
Spec: `docs/superpowers/specs/2026-07-30-ui-parity-phase2-design.md`. 107 files across 11 directories converted (3 directories — `tracking/`, `companies/`, `exports/` — were already clean, 0 files needed). Each sub-plan went through build -> independent code review -> one fix wave (6 of 10 needed fixes) -> merge. `npx tsc --noEmit` clean on merged `main`.

Real bugs caught during review (not just missed greps): a dark-mode border-color contrast bug (charts), dead `bg-error`/`bg-warning`/`bg-info` CSS classes never wired into the Tailwind theme (misc), ~35 instances across 4 admin files missed because the original grep checked `gray-*` but not `slate-*`.

## Sub-issues (all closed via PR merge)
- [x] #23 — `dashboard/` (7 files) — PR #43
- [x] #24 — `charts/` (8 files) — PR #38
- [x] #25 — `admin/` (9 files) — PR #39
- [x] #26 — `action-plans/` (12 files) — PR #40
- [x] #27 — `microclimate/` part A (21 files) — PR #41
- [x] #28 — `microclimate/` part B (20 files) — PR #42
- [x] #29 — `reports/` (9 files) — PR #36
- [x] #30 — `benchmarks/` (4 files) — PR #34
- [x] #31 — `surveys/` (10 files) — PR #37
- [x] #32 — misc: `alerts/` + `widgets/` + `onboarding/` + `question-pool/` (7 files) — PR #35

### Comment — tafurfede — 2026-07-30T19:47:18Z

All 10 sub-issues merged to main 2026-07-30. tsc clean. Visual smoke-check still needed by a human (server verified serving correct HTML via curl, but browser PWA service worker can serve stale cached pages — see memory note).

---

## #19 — tech-debt: tims-suite shell/CSS port — parked minors from final review

- **State:** CLOSED
- **Labels:** tech-debt
- **Author:** tafurfede
- **Created:** 2026-07-30T16:51:53Z  **Closed:** 2026-07-30T21:40:08Z
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/19

Low-priority polish items parked during the tims-suite shell/CSS port (PR #8), deliberately not fixed at the time:

- [ ] Token-name drift between `theme.ts`/`generateCssVars.ts` — currently dead code, unused at runtime (`AdminThemeContext` hand-writes CSS vars directly, doesn't use `theme.ts`'s helpers). Either wire `theme.ts` up as the actual source of truth, or delete the drifted duplicate.
- [ ] `Sidebar.tsx`'s `ROLE_LABELS` map is hardcoded English (confirmed still present at `src/components/layout/Sidebar.tsx:25`) — same class of issue as an already-parked hardcoded sign-in string in `DashboardLayout.tsx`. Should go through the existing i18n/`useTranslations` pattern.
- [ ] Poppins font only applied to `Sidebar`, not `PageTopBar`/`MobileNav` (they inherit the Inter-based `--admin-font-family` fallback) — inconsistent typography across shell chrome.
- [ ] Dead token-library exports (`getThemeVars`, `applyThemeVars`, etc.) — only exercised by their own test, no production consumer. Candidate for deletion once confirmed truly unused.

---

## #20 — enhancement: resultado_anio_anterior_pct is always null — no prior-year benchmark linkage exists

- **State:** OPEN
- **Labels:** enhancement
- **Author:** tafurfede
- **Created:** 2026-07-30T16:52:24Z  **Closed:** -
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/20

## Background
`/internal/hallazgos` (`src/app/api/internal/hallazgos/route.ts:56`) always returns `resultado_anio_anterior_pct: null` — flagged in the original Plan 2a design work as a real product gap, not an implementer shortcut. There is no prior-year `Benchmark` linkage in the current schema, so there's no data to compute this from.

## What's needed
- Design a prior-year benchmark linkage in the data model (likely a `Benchmark` relation keyed by category+metric_name+year, or similar).
- Backfill/compute prior-year values where historical data exists.
- Wire the real value into `/internal/hallazgos` once the schema supports it.

## Related
climate-tracking#2 (HallazgoCache never synced) is a related but distinct gap in the same overall hallazgo data flow.

---

## #21 — epic: outstanding work tracker — climate-project + climate-tracking

- **State:** OPEN
- **Labels:** epic
- **Author:** tafurfede
- **Created:** 2026-07-30T16:52:45Z  **Closed:** -
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/21

Tracking issue linking every known gap, deferred item, and follow-up across both repos (climate-project + climate-tracking), so nothing gets lost across sessions. Individual issues are the source of truth; this is just the index.

## Bugs
- [ ] #13 — `/admin/companies` throws "Maximum update depth exceeded" (React infinite render loop)

## Security (tailwind.config.js incident)
- [ ] #14 — rotate all secrets exposed by the malware incident
- [ ] #15 — get isolated sandbox malware analysis of the removed payload
- [ ] #16 — audit Vercel build logs / outbound network activity since baseline

## Product gaps (tracking module)
- [ ] #20 — `resultado_anio_anterior_pct` always null, no prior-year benchmark linkage
- [ ] TIMSInternational/climate-tracking#2 — `HallazgoCache` never synced (dead code path)
- [ ] TIMSInternational/climate-tracking#3 — `GeneratePlanCodeAsync` accepted race window under concurrent creation

## Tech debt
- [ ] #19 — tims-suite shell/CSS port parked minors (token drift, hardcoded labels, font inconsistency, dead exports)
- [ ] #22 — sidebar nested-nav (PR #12) parked minors (test coverage, fidelity nits, collapsed-mode flyout, a11y idiom)

## Large initiatives
- [x] #18 — UI Parity Phase 2: 108-file card/box/text semantic-token sweep — DONE, all 10 PRs merged 2026-07-30
- [ ] #17 — full stack migration to C#/.NET 10 backend + React (non-Next.js) frontend (not yet scoped)

## Notes
- Update this checklist as new gaps surface or existing ones close.

---

## #22 — tech-debt: sidebar nested-nav — parked minors from PR #12's review

- **State:** OPEN
- **Labels:** tech-debt
- **Author:** tafurfede
- **Created:** 2026-07-30T17:02:11Z  **Closed:** -
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/22

Low-priority polish items parked during PR #12 (FormMaps-style expandable sidebar nav groups), deliberately not blocking merge:

- [ ] Nesting-mechanism test coverage only covers Tracking + Organization; Analytics, System Administration, and Survey Management groups have no dedicated nesting test (chevron renders, expand reveals children, auto-expand-on-active-route).
- [ ] Connector-line/row fidelity nits vs. the FormMaps reference: dead Tailwind classes fully overridden by inline styles, `rounded-md` (6px) vs. reference's 4px, sub-icon not centered in the same 16×16 column as parent icons (shifts sub-labels ~2px left), no hover affordance on any row.
- [ ] Expand state (`expanded`) is keyed by translated label rather than `href` — two groups sharing a translated label would toggle in lockstep. Not reachable today, but `href`-keying would be sturdier.
- [ ] Visual hierarchy is now mixed: a super admin's sidebar interleaves uppercase section headers with 5 header-less expandable groups. Worth a design pass — either give the groups a shared header, or fold remaining singleton sections into groups.
- [ ] Collapsed (icon-only) sidebar mode makes every non-first child of a group unreachable without first expanding the sidebar (9 destinations across the 5 groups). A hover flyout is the standard fix; the data shape (`sub[]`) already supports it.
- [ ] The chevron toggle is `<a href="#" role="button" aria-expanded>` rather than a real `<button>` — functionally correct (role override tested), but an imperfect a11y idiom (some browser/AT combos still expose anchor semantics, e.g. right-click "open link").

Ref: PR #12, final whole-branch review + fix-wave re-review.

### Comment — tafurfede — 2026-07-30T21:17:02Z

PR #46 addresses 4 of the 6 items here (a11y toggle → real button, href-keyed expand state, connector-line/row fidelity fixes, missing nesting test coverage for Analytics/System Administration/Survey Management). Does not close this issue.

Remaining open, deliberately deferred pending a design decision:
- Visual hierarchy pass (uppercase section headers interleaved with 5 header-less expandable groups)
- Collapsed-sidebar hover flyout for unreachable nested children (new UI behavior, not a minor fix)

### Comment — tafurfede — 2026-07-30T21:41:47Z

Reopening — GitHub auto-closed this on PR #46's merge (likely via title auto-linking), but only 4 of 6 items are done. 2 remain open, deliberately deferred pending a design decision: visual hierarchy pass, and the collapsed-sidebar hover flyout. See prior comment for detail.

---

## #23 — Phase 2: dashboard/ card sweep (7 files)

- **State:** CLOSED
- **Labels:** enhancement
- **Author:** tafurfede
- **Created:** 2026-07-30T17:46:05Z  **Closed:** 2026-07-30T19:37:47Z
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/23

Part of #18.

Plan: `docs/superpowers/plans/2026-07-30-ui-parity-phase2-dashboard.md`
Spec: `docs/superpowers/specs/2026-07-30-ui-parity-phase2-design.md`

Files: `CompanyAdminDashboard.tsx`, `DepartmentAdminDashboard.tsx`, `EvaluatedUserDashboard.tsx`, `GlobalSearch.tsx`, `SuperAdminDashboard.tsx`, `SurveyManagement.tsx`, `SurveyStatusIndicators.tsx` (all in `src/components/dashboard/`).

6 tasks (5 restyle + 1 final verification). `SuperAdminDashboard.tsx` has the most flagged lines (114) and the canonical gradient-hero example cited in the spec.

---

## #24 — Phase 2: charts/ card sweep (8 files)

- **State:** CLOSED
- **Labels:** enhancement
- **Author:** tafurfede
- **Created:** 2026-07-30T17:46:06Z  **Closed:** 2026-07-30T19:31:46Z
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/24

Part of #18.

Plan: `docs/superpowers/plans/2026-07-30-ui-parity-phase2-charts.md`
Spec: `docs/superpowers/specs/2026-07-30-ui-parity-phase2-design.md`

Files: `AnimatedPieChart.tsx`, `HeatMap.tsx`, `KPIDisplay.tsx`, `ParticipationTracker.tsx`, `RealTimeChartContainer.tsx`, `RecommendationCard.tsx`, `SentimentVisualization.tsx`, `WordCloud.tsx` (all in `src/components/charts/`).

4 tasks (3 restyle + 1 final verification). Highest-risk directory for accidentally flattening real chart-series data colors — several grep hits are legitimate data-color config entries (e.g. `KPIDisplay.tsx`'s neutral-gray as one of several selectable categories), explicitly classified in the plan, not touched.

---

## #25 — Phase 2: admin/ card sweep (9 files)

- **State:** CLOSED
- **Labels:** enhancement
- **Author:** tafurfede
- **Created:** 2026-07-30T17:46:08Z  **Closed:** 2026-07-30T19:37:41Z
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/25

Part of #18.

Plan: `docs/superpowers/plans/2026-07-30-ui-parity-phase2-admin.md`
Spec: `docs/superpowers/specs/2026-07-30-ui-parity-phase2-design.md`

Files: `BulkUserImport.tsx`, `CompanySettings.tsx`, `DepartmentHierarchy.tsx`, `ModernCompanyManagement.tsx`, `ModernDemographicsManagement.tsx`, `ModernDepartmentManagement.tsx`, `UserManagement.tsx`, `UserManagementDashboard.tsx`, `UserRoleManager.tsx` (all in `src/components/admin/`).

4 tasks (3 restyle + 1 final verification). Most files already use `Card` but fight it with override classNames (decorative gradients/glassmorphism) — the fix is stripping overrides, not wrapping in `Card` from scratch.

**Explicitly out of scope**: `/admin/companies`'s pre-existing "Maximum update depth exceeded" bug (#13) — restyle `ModernCompanyManagement.tsx` only, do not attempt that fix here.

---

## #26 — Phase 2: action-plans/ card sweep (12 files)

- **State:** CLOSED
- **Labels:** enhancement
- **Author:** tafurfede
- **Created:** 2026-07-30T17:46:09Z  **Closed:** 2026-07-30T19:31:49Z
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/26

Part of #18.

Plan: `docs/superpowers/plans/2026-07-30-ui-parity-phase2-action-plans.md`
Spec: `docs/superpowers/specs/2026-07-30-ui-parity-phase2-design.md`

Files: `ActionPlanCreator.tsx`, `ActionPlanDashboard.tsx`, `ActionPlanKanban.tsx`, `ActionPlanTimeline.tsx`, `AlertsPanel.tsx`, `BulkActionPlanCreator.tsx`, `CommitmentTracker.tsx`, `KPIEditor.tsx`, `ProgressTracker.tsx`, `QualitativeObjectiveEditor.tsx`, `TemplateSelector.tsx`, `UserSelector.tsx` (all in `src/components/action-plans/`).

5 tasks (4 restyle + 1 final verification). `ActionPlanKanban.tsx`, `AlertsPanel.tsx`, `CommitmentTracker.tsx` have status/severity color maps needing chrome-vs-data judgment — flagged explicitly in the plan for the executor to verify against the real status enum.

---

## #27 — Phase 2: microclimate/ card sweep — part A (21 files)

- **State:** CLOSED
- **Labels:** enhancement
- **Author:** tafurfede
- **Created:** 2026-07-30T17:46:35Z  **Closed:** 2026-07-30T19:31:53Z
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/27

Part of #18. Companion issue: part B (second half of the same directory, disjoint files) — see #28.

Plan: `docs/superpowers/plans/2026-07-30-ui-parity-phase2-microclimate-a.md`
Spec: `docs/superpowers/specs/2026-07-30-ui-parity-phase2-design.md`

Files (alphabetical `AudienceFilters.tsx` through `MicroclimateCreator.tsx`, all in `src/components/microclimate/`): `AudienceFilters.tsx`, `AudiencePreviewCard.tsx`, `AutosaveDemo.tsx`, `AutosaveIndicator.tsx`, `ColumnMapper.tsx`, `CSVImporter.tsx`, `DepartmentTargeting.tsx`, `DistributionPreview.tsx`, `DistributionTypeSelector.tsx`, `DraftRecoveryBanner.tsx`, `DraftRecoveryDemo.tsx`, `EnhancedInstructions.tsx`, `EnhancedMicroclimateResponseForm.tsx`, `EnhancedResponseHeader.tsx`, `LiveMicroclimateDashboard.tsx`, `LiveParticipationTracker.tsx`, `LiveResponseChart.tsx`, `LiveWordCloud.tsx`, `ManualEmployeeEntry.tsx`, `MicroclimateBuilder.tsx`, `MicroclimateCreator.tsx`.

`microclimate/` is the largest directory (41 files) — split alphabetically into two independent sub-plans so no single plan is unwieldy.

---

## #28 — Phase 2: microclimate/ card sweep — part B (20 files)

- **State:** CLOSED
- **Labels:** enhancement
- **Author:** tafurfede
- **Created:** 2026-07-30T17:46:37Z  **Closed:** 2026-07-30T19:37:44Z
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/28

Part of #18. Companion issue: part A (first half of the same directory, disjoint files) — see #27.

Plan: `docs/superpowers/plans/2026-07-30-ui-parity-phase2-microclimate-b.md`
Spec: `docs/superpowers/specs/2026-07-30-ui-parity-phase2-design.md`

Files (alphabetical `MicroclimateDashboard.tsx` through `WizardStepper.tsx`, all in `src/components/microclimate/`): `MicroclimateDashboard.tsx`, `MicroclimateDetailView.tsx`, `MicroclimateFinalResults.tsx`, `MicroclimateResponseForm.tsx`, `MicroclimateWizard.tsx`, `MicroclimateWizardDemo.tsx`, `MultilingualQuestionEditor.tsx`, `QRCodeGenerator.tsx`, `QuestionLibraryBrowser.tsx`, `QuestionPreviewModal.tsx`, `QuickAddPanel.tsx`, `RealTimeMicroclimateVisualization.tsx`, `ReminderScheduler.tsx`, `ScheduleConfig.tsx`, `SentimentVisualization.tsx`, `SortableQuestionList.tsx`, `TemplateSelector.tsx`, `UnifiedResponseFlow.tsx`, `ValidationPanel.tsx`, `WizardStepper.tsx`.

9 tasks (8 restyle + 1 final verification). `RealTimeMicroclimateVisualization.tsx`/`SentimentVisualization.tsx` are chart-like — keep real sentiment/response data colors.

---

## #29 — Phase 2: reports/ card sweep (9 files)

- **State:** CLOSED
- **Labels:** enhancement
- **Author:** tafurfede
- **Created:** 2026-07-30T17:46:38Z  **Closed:** 2026-07-30T19:37:34Z
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/29

Part of #18.

Plan: `docs/superpowers/plans/2026-07-30-ui-parity-phase2-reports.md`
Spec: `docs/superpowers/specs/2026-07-30-ui-parity-phase2-design.md`

Files: `AdvancedFilters.tsx`, `CustomTemplateCreator.tsx`, `ExportDialog.tsx`, `ReportBuilder.tsx`, `ReportComments.tsx`, `ReportList.tsx`, `ReportsDashboard.tsx`, `ReportViewer.tsx`, `ShareDialog.tsx` (all in `src/components/reports/`).

4 tasks (3 restyle + 1 final verification). `ExportDialog.tsx`/`ShareDialog.tsx` already use the real `Dialog` primitive correctly — just strip override classes fighting its defaults, no architecture change needed. No existing tests for any of these 9 files.

---

## #30 — Phase 2: benchmarks/ card sweep (4 files)

- **State:** CLOSED
- **Labels:** enhancement
- **Author:** tafurfede
- **Created:** 2026-07-30T17:46:39Z  **Closed:** 2026-07-30T19:31:41Z
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/30

Part of #18.

Plan: `docs/superpowers/plans/2026-07-30-ui-parity-phase2-benchmarks.md`
Spec: `docs/superpowers/specs/2026-07-30-ui-parity-phase2-design.md`

Files: `BenchmarkComparison.tsx`, `BenchmarkManager.tsx`, `GapAnalysisReport.tsx`, `TrendAnalysis.tsx` (all in `src/components/benchmarks/`).

Smallest sub-plan — gap-analysis/trend components color-code by severity/direction, apply the data-color exception carefully.

---

## #31 — Phase 2: surveys/ card sweep (10 files)

- **State:** CLOSED
- **Labels:** enhancement
- **Author:** tafurfede
- **Created:** 2026-07-30T17:46:41Z  **Closed:** 2026-07-30T19:37:38Z
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/31

Part of #18.

Plan: `docs/superpowers/plans/2026-07-30-ui-parity-phase2-surveys.md`
Spec: `docs/superpowers/specs/2026-07-30-ui-parity-phase2-design.md`

Files: `BinaryQuestionConfig.tsx`, `BinaryQuestionResponse.tsx`, `DemographicsSelector.tsx`, `DepartmentSelector.tsx`, `InvitationSettings.tsx`, `QRCodeGenerator.tsx`, `QuestionLibraryBrowser.tsx`, `SurveyProgressBar.tsx`, `SurveyResponseFlow.tsx`, `TabNavigationFooter.tsx` (all in `src/components/surveys/` **plural** — do not confuse with the separate `src/components/survey/` singular directory, which is out of scope).

4 tasks (3 restyle + 1 final verification).

---

## #32 — Phase 2: misc small directories sweep — alerts/widgets/onboarding/question-pool (7 files)

- **State:** CLOSED
- **Labels:** enhancement
- **Author:** tafurfede
- **Created:** 2026-07-30T17:46:42Z  **Closed:** 2026-07-30T19:37:31Z
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/32

Part of #18.

Plan: `docs/superpowers/plans/2026-07-30-ui-parity-phase2-misc.md`
Spec: `docs/superpowers/specs/2026-07-30-ui-parity-phase2-design.md`

Bundles 4 directories too small individually for their own sub-plan: `alerts/AIAlert.tsx`, `widgets/{ActionPlanSummaryWidget,ai-alert,heatmap,word-cloud}.tsx`, `onboarding/OnboardingTour.tsx`, `question-pool/AdaptiveQuestionAnalytics.tsx`.

3 tasks (2 restyle + 1 final verification). Found a real pre-existing bug in scope: `widgets/ai-alert.tsx` uses `bg-error`/`border-error`/`text-error` classes with no `--color-error` Tailwind mapping registered (dead styling) — plan routes these to the `destructive` token instead of inventing a new mapping.

---

## #47 — migration: foundation scaffold — .NET 10 solution, Supabase project, React+Vite app, CI skeleton

- **State:** OPEN
- **Labels:** epic, migration
- **Author:** tafurfede
- **Created:** 2026-07-30T21:55:56Z  **Closed:** -
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/47

## What
Stand up the empty skeletons all later migration work builds on. No feature logic yet.

- New .NET 10 solution mirroring `climate-tracking`/`formmaps-api`/`tims-ats-api`'s layered structure: `ClimateProject.Api`, `.Application`, `.Domain`, `.Infrastructure`, `.Workers` + `UnitTests`/`IntegrationTests`/`ContractTests` projects.
- New Supabase project (Postgres). Decide: hosted Supabase cloud vs. self-hosted on AWS (affects #13's AWS scope).
- New React frontend scaffold (Vite + react-router), mirroring `/Users/federicotafur/formmaps/apps/web` and `/Users/federicotafur/tims-suite/apps/web` conventions — NOT Next.js.
- CI/CD pipeline skeleton for both (build/test/lint gates only — deployment comes in the AWS issue).

## Blocks
Everything else in this epic depends on this.

## Not in scope
Any actual domain logic, schema, or auth — pure scaffolding.

Part of #17.

### Comment — tafurfede — 2026-07-30T22:01:47Z

## Design Spec

### Repo topology
Mirror the ecosystem convention (formmaps / formmaps-api are separate repos, tims-ats / tims-ats-api are separate repos): two **new** sibling repos, not a monorepo folder inside `climate-project`.
- `climate-project-api` — new .NET 10 backend.
- `climate-project-web` — new Vite + React frontend.
The existing `climate-project` repo stays as-is (Next.js/Mongo) until #60 decommissions it. This lets the strangler-fig strategy actually work — old and new stacks are fully independent deployables during the transition.

### Backend scaffold (`climate-project-api`)
Mirror `climate-tracking/services/api` exactly (confirmed via its actual `.csproj`/`Program.cs` 2026-07-30):
- Projects: `ClimateProject.Api`, `.Application`, `.Domain`, `.Infrastructure`, `.Workers`, `.UnitTests`, `.IntegrationTests`, `.ContractTests`.
- `<TargetFramework>net10.0</TargetFramework>`, `Nullable enable`, `ImplicitUsings enable`.
- API style: **Minimal APIs** with an `Endpoints/` folder (not MVC controllers) — matches `climate-tracking.Api`.
- ORM: EF Core + `Npgsql` provider, targeting Supabase's Postgres connection string (`ConnectionStrings:ClimateProject`).
- `Microsoft.AspNetCore.Authentication.JwtBearer` for auth (see #48 — same package/pattern climate-tracking already uses).

### Frontend scaffold (`climate-project-web`)
Mirror `/Users/federicotafur/formmaps/apps/web` and `/Users/federicotafur/tims-suite/apps/web`: Vite + React + react-router, TypeScript, Tailwind. Port the design-system tokens work is #57's job, not this issue's — this issue just needs the bare scaffold building and deploying an empty shell.

### CI skeleton
GitHub Actions: build+test gate on PR for both repos (`dotnet build`/`dotnet test` for the API, `npm run build`/`npm test` for the web app). No deployment yet — that's #59.

### Supabase
Create the Supabase project now (empty — schema comes from #49). Decide hosted-cloud vs. self-hosted-on-AWS here or defer to #59 — recommend deferring, since starting with hosted Supabase cloud is faster to unblock #48/#49 and the hosting decision doesn't need to be made until closer to production cutover.

### Out of scope
No domain logic, no schema, no auth implementation — pure scaffolding + CI. #48 and #49 build on top of this.

---

## #48 — migration: auth & identity strategy — replace NextAuth

- **State:** OPEN
- **Labels:** migration
- **Author:** tafurfede
- **Created:** 2026-07-30T21:55:57Z  **Closed:** -
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/48

## What
Decide and implement the new auth architecture: Supabase Auth vs. a custom JWT flow issued by the new .NET API. Must align with `climate-tracking`'s existing JWT claim set convention (single-tenant, role mapping — see project memory `project_tracking_module_decisions`), since climate-project and climate-tracking need to keep interoperating during the migration.

Replaces NextAuth entirely. Covers: login/signup, session/token refresh, role-based access (super_admin/company_admin/leader/supervisor/employee), password reset, and whatever Google OAuth support currently exists.

## Blocked by
#<foundation-issue>

## Blocks
Every domain issue (#4-#9) needs a working auth story before its endpoints/pages can be built against real users.

Part of #17.

### Comment — tafurfede — 2026-07-30T22:02:08Z

## Design Spec

### Decision: custom JWT issued by the new API, NOT Supabase Auth
Confirmed via `climate-tracking/services/api/src/ClimateTracking.Api/Program.cs` (2026-07-30): climate-tracking validates HS256 JWTs signed with a shared `TrackingJwtSecret`, reading raw `sub`/`role` claims (`options.MapInboundClaims = false`) plus tenant/plan checks via custom `IAuthorizationHandler`s (`MatchingTenantHandler`, `PlanAccessHandler`).

Confirmed via `climate-project/src/lib/auth.ts` (current NextAuth setup): the session cookie **is** that same HS256 JWT today — NextAuth's custom `encode()`/`decode()` overrides sign it directly with `TRACKING_JWT_SECRET`, claims `sub` (user id), `role`, `companyId`.

Supabase Auth would produce a different token shape (its own claims), breaking climate-tracking's contract unless heavily remapped. **Keep the existing claim shape and shared-secret pattern** — the new `ClimateProject.Api` becomes the token issuer instead of NextAuth, using the identical `sub`/`role`/`companyId` claims. This means **climate-tracking needs zero changes** for this migration.

### What the new API needs
- Login/signup endpoints issuing HS256 JWTs (same secret env var name, `TrackingJwtSecret`/`TRACKING_JWT_SECRET` — reuse the actual secret value too, so climate-tracking's validation keeps working unmodified).
- `Microsoft.AspNetCore.Authentication.JwtBearer` + `MapInboundClaims = false`, matching climate-tracking's setup — for internal consistency and because other TIMS services may eventually validate these tokens the same way.
- Password reset flow (currently exists in NextAuth — needs porting).
- Google OAuth (currently exists — check actual usage before committing to port it; may be low-usage enough to drop, needs a quick usage check, not a default-drop).
- Role model: `super_admin`, `company_admin`, `leader`, `supervisor`, `employee` (unchanged from current).
- Token storage on the new frontend: httpOnly cookie (matches current NextAuth pattern) vs. Authorization header + memory/localStorage — recommend httpOnly cookie for XSS protection, matching current behavior, unless `climate-project-web`'s Vite/react-router setup makes that awkward (needs a small spike during implementation, not a spec-time blocker).

### Supabase's own auth product
Not used for primary auth. If Supabase Auth features (magic links, social providers UI) are wanted later, that's a separate future decision — out of scope here to avoid the claim-shape conflict above.

### Blocked by
#47 (needs the API scaffold to build endpoints into).

### Blocks
Every domain issue (#50-#56) needs working login before their endpoints/pages are testable end-to-end.

### Comment — tafurfede — 2026-07-31T02:38:11Z

## Implementation Design (2026-07-30, supplements the design spec above)

Refines the locked-in decisions above into an implementation-level design, worked out via brainstorming session. Scope, architecture, and data flow below — ready for a plan.

### Scope decisions made this session
- **Schema sequencing**: #48 owns a minimal Postgres schema (Companies, Users, Role enum) via EF Core migrations, ahead of #49. #49 extends the same `DbContext` with the remaining ~35-40 tables rather than redesigning it.
- **Google OAuth**: ported with identical auto-provisioning behavior (auto-create Company by email domain, auto-create User with role `employee` on first Google login) — no usage-data check needed, default is to preserve current behavior.
- **Token lifetime**: fixed to 24h (current prod has a live bug — session says 24h, actual JWT `exp` is 240h/~10 days — new code uses the documented/intended 24h, not the buggy value).
- **Refresh**: a `/auth/refresh` endpoint issuing a fresh 24h token while the current one is still valid, re-reading `IsActive`/`Role`/`CompanyId` from the DB (not trusting the old token's values) so deactivation/role changes take effect immediately.
- **Password reset**: admin-driven only, porting `resetUserCredentials`/`getUserCredentialsForInvitation` as-is — no new self-service "forgot password" flow (no email infra exists yet for that).
- **Frontend**: #48 is backend-only. `climate-project-web` doesn't exist yet, so there's nothing to integrate a cookie-vs-header decision against — that's deferred to whichever issue starts frontend work.
- **Database**: local/dev Postgres for now (Docker Compose for dev, Testcontainers for integration tests) — no Supabase project provisioned yet. Swapping to real Supabase later is a connection-string change, not a code change.

### Architecture (mirrors climate-tracking's clean-architecture layering exactly)
```
ClimateProject.Domain
  Entities: Company, User, Role (enum: SuperAdmin, CompanyAdmin, Leader, Supervisor, Employee)

ClimateProject.Application
  Auth/
    IJwtTokenService        — issues + validates tokens
    AuthService              — login/signup/refresh/reset use-cases
    RoleNames / policies     — role constants, ASP.NET Core policy definitions

ClimateProject.Infrastructure
  ClimateProjectDbContext   — EF Core, snake_case tables (matches climate-tracking conventions)
  JwtTokenService           — JwtSecurityTokenHandler, HS256, TrackingJwtSecret
  PasswordHasher            — BCrypt, cost 12 (matches current)
  GoogleOAuthClient         — Google ID token verification

ClimateProject.Api
  POST /auth/login, /auth/signup, /auth/google, /auth/refresh, /auth/admin/reset-credentials
  Program.cs: AddJwtBearer — MapInboundClaims=false, ValidateIssuer=false, ValidateAudience=false,
              symmetric key from TrackingJwtSecret — identical to climate-tracking's Program.cs
```
This also means #48 sets up the JWT *validation* middleware every future domain issue (#50-56) needs — not just the auth endpoints themselves.

### Exact claim shape (confirmed against climate-tracking's `CurrentUser.cs`)
`sub`, `role`, `nodoId` (not `departmentId` — internal field name differs from claim name), `email`, `name`, `companyId`, `isActive`, `iat`, `exp`. No `iss`/`aud` (both validation checks are off on climate-tracking's side — do not add them).

### Data model
```
Company: Id (Guid), Name, EmailDomain (nullable), CreatedAt
User: Id (Guid), CompanyId (FK), Email (unique), Name, PasswordHash (nullable — null = OAuth-only,
      reuses the existing signal, no new AuthProvider field), Role (enum), NodoId (nullable string,
      plain field — no FK yet, org-structure modeling is #49/#50), IsActive, LastLoginAt, CreatedAt, UpdatedAt
```

### Error handling
- Invalid credentials → `401`, generic message (no user enumeration).
- OAuth-only account attempting password login → `401`, specific "use Google sign-in" message (safe to be specific here, not a credential-guessing vector).
- Expired/invalid JWT → `401` (ASP.NET Core's default JWT bearer challenge).
- Wrong role on admin endpoints → `403`.
- Google token verification failure → `401`, generic message.
- Duplicate email on signup → `409`.

### Testing
- Unit tests: `AuthService` logic in isolation (password branching, exact claim construction, role-policy checks).
- Integration tests (Testcontainers Postgres): full round-trips — signup → login → refresh → authenticated-endpoint-with-role-check — matching the existing `HealthEndpointTests.cs` pattern.
- **Cross-compatibility test**: issue a token via the new `JwtTokenService`, independently validate it using climate-tracking's exact `TokenValidationParameters` (same flags, same key) — proves byte-for-byte compatibility without needing climate-tracking's codebase in the test run. This is the test that would catch a claim-naming mismatch like `nodoId` vs `departmentId` before it ships.

Next: writing-plans for task breakdown.

### Comment — tafurfede — 2026-07-31T02:42:27Z

## Scope refinement (2026-07-30, found during plan-writing)

Reading the actual \`register/route.ts\` + \`validate-invitation/route.ts\` surfaced a real conflict in the design comment above: it said signup \"ports register/route.ts + validate-invitation/route.ts logic as-is,\" but the real flow depends on a full invitation system (tokens, \`employee_self_signup\` vs. direct-invite types, expiry/status), a \`Department\` entity with hierarchy, \`AuditLog\` writes, and a company-admin setup step — none of which fit a minimal Companies/Users schema.

**Resolved: #48's signup is narrowed to the simple \"legacy\" path only** — register with an email whose domain matches an existing Company, role defaults to \`employee\`, no department assignment, no audit log. Invitation-based signup (tokens, company-admin setup, department assignment) is explicit follow-up scope once #49's Department/Invitation/AuditLog entities exist.

Everything else in the design comment above (architecture, claim shape, login/refresh/Google OAuth/admin-reset, error handling, testing) is unchanged.

---

## #49 — migration: data model design — MongoDB collections to Supabase/Postgres schema

- **State:** CLOSED
- **Labels:** migration
- **Author:** tafurfede
- **Created:** 2026-07-30T21:55:58Z  **Closed:** 2026-08-01T03:33:23Z
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/49

## What
The architecturally hardest piece: redesign ~30 Mongoose models (see `src/models/*.ts`) as a relational Postgres schema in Supabase. This is not a 1:1 field translation — document-model patterns (embedded arrays, loose refs, schema-optional fields) need real relational modeling (foreign keys, junction tables, constraints).

Covers all domains: companies, users, departments, surveys (+templates/drafts/versions/distributions/invitations), question bank/library/pool/categories, microclimates (+templates/invitations), action plans (+templates), reports, benchmarks, demographics, notifications (+templates), audit logs, system settings.

Deliverables: ERD/schema design doc, EF Core migration tooling setup, and a migration/backfill strategy per collection (one-time dump-and-load vs. dual-write during a transition window — decide per domain based on write volume and downtime tolerance).

## Blocked by
#<foundation-issue>

## Blocks
All domain issues (#4-#9) — each needs its slice of this schema finalized before backend work starts.

Part of #17.

### Comment — tafurfede — 2026-07-30T22:05:21Z

## Design Spec

Read all 31 Mongoose models in `src/models/*.ts` and climate-tracking's actual EF Core layer (`ClimateTrackingDbContext.cs`, `Domain/Entities/*.cs`, `Infrastructure/Persistence/Configurations/*.cs`) to ground this in real conventions rather than generic ORM advice.

## Conventions to mirror (confirmed from climate-tracking)
- Entities are POCOs in `ClimateProject.Domain/Entities/*.cs`, `Guid Id` PK, rich domain methods (not anemic — e.g. `PlanDeAccion.RegistrarAvance()`), encapsulated mutable collections (private `List<T>` backing field + `IReadOnlyList<T>` public accessor).
- Mapping via Fluent API `IEntityTypeConfiguration<T>` classes in `ClimateProject.Infrastructure/Persistence/Configurations/`, applied with `modelBuilder.ApplyConfigurationsFromAssembly(...)` — not data annotations.
- Table/column names: `snake_case` (`builder.ToTable("planes_de_accion")`), even though C# properties are PascalCase.
- Enums stored as strings: `builder.Property(p => p.EstadoX).HasConversion<string>().HasMaxLength(20)`.
- Simple string-list fields (e.g. `involucrados_external_ids`) map to Postgres `text[]` columns with a GIN index, via a private-field mapping (`builder.Property<List<string>>("_field").HasColumnName(...).HasColumnType("text[]")` + `builder.Ignore(p => p.PublicAccessor)`) — **not** always a junction table. Use this for simple scalar arrays; use real junction tables only when the array holds relationships to other entities that need their own attributes or need to be queried independently.
- One migration per DbContext, timestamped filename (`20260729142701_InitialCreate.cs`) in `Infrastructure/Migrations/`.

## Pre-existing data-model issues found — resolve during migration, don't carry over faithfully
1. **Two competing `AIInsight` Mongoose models** registered under the same name: `models/Analytics.ts` exports one (`survey_id`/`company_id` snake_case, `confidence_score` 0–1) and `models/AIInsight.ts` exports a completely different one (`surveyId`/`companyId` camelCase, `confidenceScore` 0–100). Whichever file's `mongoose.model()` call runs first silently wins at runtime — this is a live bug, not an intentional variant. **Pick one shape** (recommend `AIInsight.ts`'s, since `Analytics.ts`'s `AnalyticsInsight` is the more actively-referenced aggregation type) before designing the `ai_insights` table.
2. **Three overlapping "question repository" systems**: `QuestionBank` (flat, single-language, AI-generated variations via `parent_question_id`), `QuestionLibrary` + `QuestionCategory` (hierarchical, bilingual en/es, versioned), `LibraryQuestion` (also hierarchical via `category_id` → `QuestionCategory`, also bilingual, also versioned — nearly identical to `QuestionLibrary` but a separate collection). Plus `QuestionPool`/`QuestionEffectiveness`/`QuestionCombination`/`QuestionGeneration` — a fourth, more experimental AI-adaptation system. **Before designing tables for this domain, confirm with the team which of these are actually live in production UI vs. abandoned iterations** — migrating all 4 systems as-is would be carrying forward real technical debt into the new schema. Flagging for #51 (surveys domain), not resolving here.
3. **`Report.ts` is a kitchen-sink schema**: half its fields are `Schema.Types.Mixed` (`sections`, `metadata`, `metrics`) holding report-generation output shaped ad hoc by report-generation code, not the schema. In Postgres this is a legitimate `jsonb` case (the shape genuinely varies by report type) — don't force it relational.

## Schema design by domain

### Org structure (companies, users, departments) — #50
- `companies` (id, name, domain unique, industry, size enum, country, is_active, subscription_tier enum, created_at, updated_at) + `company_branding` (1:1 or inline jsonb — small fixed shape, inline columns preferred: logo_url, primary_color, secondary_color, font_family, custom_css) + `company_settings` (1:1 inline columns — survey_frequency enum, microclimate_enabled, ai_insights_enabled, anonymous_surveys, data_retention_days, timezone, language).
- `users` (id, name, email unique, password_hash nullable, role enum, company_id FK nullable [super_admin has no company], department_id FK nullable, manager_id FK self-referencing nullable, is_active, last_login, consent_updated_at, created_at, updated_at) + `user_preferences` (1:1 inline: language, timezone, dashboard_layout, theme enum) + `notification_settings` (1:1 inline, or fold into user_preferences — small enough) + `user_consent` (1:1 inline: essential/analytics/marketing/personalization/thirdParty/demographics booleans) + `user_demographics` → **jsonb** (explicitly `strict: false` dynamic company-specific fields in Mongo — genuinely unstructured, keep jsonb).
- `departments` (id, name, company_id FK, description, parent_department_id FK self-referencing [replaces the computed `hierarchy.level`/`hierarchy.path` — recompute via recursive CTE or a materialized path column kept in sync on write, don't store `level`/`path` as Mongo does if a recursive query is fast enough at this scale; if not, keep `level int` + `path text` as denormalized columns like Mongo does], manager_id FK, employee_count int, is_active) + `department_settings` (1:1 inline: survey_participation_required, microclimate_frequency enum, auto_action_plans, notification email/slack/teams booleans).
- `user_invitations` (id, email, company_id FK, department_id FK nullable, invited_by FK users, invitation_token unique, invitation_type enum, role enum, status enum, expires_at, sent_at, opened_at, accepted_at, reminder_count, last_reminder_sent, metadata jsonb [small, genuinely variable request metadata], invitation_data jsonb [company_name/inviter_name/custom_message], demographics jsonb).
- `audit_logs` (id, user_id FK nullable, company_id FK, action enum, resource enum, resource_id text nullable, details jsonb, ip_address, user_agent, success bool, error_message, timestamp) — high write volume, append-only, no updates. `system_settings` (single-row table, same pattern as Mongo's singleton — id fixed or a `CHECK` constraint enforcing one row).

### Surveys (largest domain) — #51
- `surveys` (id, title, description, type enum, company_id FK, created_by FK users, start_date, end_date, status enum, response_count int, target_audience_count, version int, created_at, updated_at) + `survey_settings` (1:1 inline: anonymous, allow_partial_responses, randomize_questions, show_progress, auto_save, time_limit_minutes, response_limit, notification/invitation sub-settings — flatten, it's a fixed shape).
- `survey_department_targets` (survey_id FK, department_id FK) — junction table replacing `department_ids: string[]`.
- `questions` (id, survey_id FK, text, type enum, options text[], scale_min, scale_max, scale_label_min, scale_label_max, comment_required, comment_prompt, binary_comment_config jsonb [small nested config object, fine as jsonb], required bool, order int, category) + `question_conditional_logic` (1:1 per question, nullable: condition_question_id FK questions, operator enum, condition_value jsonb [union type], action enum, target_question_id FK) + `question_emoji_options` (question_id FK, emoji, label, value — junction, ordered).
- `survey_templates` (id, name, description, category enum, industry, company_size enum, is_public, created_by FK nullable, company_id FK nullable, usage_count, rating, tags text[], source_survey_id FK nullable, last_used) — questions/demographics/default_settings currently `Schema.Types.Mixed` "reusing" Survey's schema; in Postgres, template questions become real `template_questions` rows (same shape as `questions` but `template_id` FK instead of `survey_id`) rather than jsonb, so templates stay editable/queryable like real surveys.
- `survey_drafts` (id, user_id FK, company_id FK, session_id, current_step int, last_edited_field, auto_save_count, version, last_autosave_at, expires_at, is_recovered) + 4 step-data tables OR one `draft_data jsonb` column — recommend jsonb here (this is a wizard scratch-pad with TTL auto-delete, not queried relationally; forcing 4 relational tables for transient, self-describing wizard state adds migration cost for no query benefit). Postgres TTL needs a scheduled job (`pg_cron` or the `.Workers` project) since Postgres has no native TTL index like Mongo's `expireAfterSeconds`.
- `survey_versions` (id, survey_id FK, version_number, title, description, changes text[], reason, created_by FK, created_at) — `questions`/`demographics`/`settings` are Mongo `Mixed` snapshots; keep as jsonb here too (this table exists specifically to snapshot historical shape, so relational normalization defeats the purpose).
- `survey_distributions` (id, survey_id FK unique, access_type enum, public_url unique nullable, qr_code_url, qr_code_svg/png/pdf_url, tokenized_links_generated, regenerated_count, last_regenerated_at, last_regenerated_by FK, total_accesses, unique_visitors, last_accessed_at) + `access_rules` (1:1 inline: require_login, allow_anonymous, single_response, active_outside_schedule, allowed_domains text[], blocked_ips text[], max_responses) + `qr_customization` (1:1 inline).
- `survey_invitations` (id, survey_id FK, user_id FK, company_id FK, email, invitation_token unique, status enum, sent_at/opened_at/started_at/completed_at, reminder_count, last_reminder_sent, expires_at, metadata jsonb).
- `survey_audit_logs` (id, survey_id FK, action enum, entity_type enum, entity_id, changes jsonb [before/after/diff — genuinely need to store arbitrary shapes here], user_id FK, user_name, user_email, user_role, timestamp, ip_address, user_agent, session_id, metadata jsonb) — high write volume, append-only.
- `responses` (id, survey_id FK, user_id FK nullable [anonymous], session_id, company_id FK, department_id FK nullable, is_complete, is_anonymous, start_time, completion_time, total_time_seconds, ip_address, user_agent) + `question_responses` (response_id FK, question_id FK, response_value jsonb [union: string|number|string[]|boolean, genuinely polymorphic per question type], response_text, time_spent_seconds) + `response_demographics` (response_id FK, field, value jsonb). High write volume (every survey submission).
- **Question repository tables**: deferred pending the consolidation decision above (issue #2). Once decided, whichever system(s) survive get their own tables following the same `text_es`/`text_en` bilingual-column pattern already used by `QuestionLibrary`.

### Microclimates — #52
- `microclimates` (id, title, description, company_id FK, created_by FK, template_id FK nullable, status enum, response_count, target_participant_count, participation_rate) + `microclimate_targeting` (1:1 inline: role_filters text[], tenure_filters text[], custom_filters jsonb, include_managers, max_participants) + `microclimate_department_targets` (junction, replacing `department_ids`) + `microclimate_scheduling` (1:1 inline) + `microclimate_realtime_settings` (1:1 inline) + `microclimate_live_results` (1:1 inline: sentiment_score, engagement_level enum, top_themes text[], word_cloud_data jsonb [array of {text,value} — small, display-only], response_distribution jsonb).
- `microclimate_questions` (microclimate_id FK, text, type enum, options text[], required, order) — same shape family as survey questions; consider a shared `questions` polymorphic table (survey_id/microclimate_id/template_id, one non-null) if the domain modeling holds up during #51/#52 implementation, otherwise keep separate — decide during implementation planning, not here.
- `microclimate_ai_insights` (microclimate_id FK, type enum, message, confidence, timestamp) — small embedded array, real junction table since it's genuinely a list of discrete insight events.
- `microclimate_templates` (id, name, description, category enum, company_id FK nullable, created_by FK nullable, is_system_template, usage_count, is_active, tags text[]) + `microclimate_template_questions` (junction) + `microclimate_template_settings` (1:1 inline).
- `microclimate_invitations` (same shape as `survey_invitations` — id, microclimate_id FK, user_id FK, company_id FK, email, invitation_token unique, status enum, timestamps, reminder_count, expires_at, metadata jsonb).

### Action plans — #53
- `action_plans` (id, title, description, company_id FK, department_id FK nullable, created_by FK, due_date, status enum, priority enum, ai_recommendations text[], tags text[], template_id FK nullable, source_survey_id FK nullable, source_insight_id FK nullable).
- `action_plan_kpis` (id, action_plan_id FK, name, target_value, current_value, unit, measurement_frequency enum) — real junction, each KPI is independently updated.
- `action_plan_objectives` (id, action_plan_id FK, description, success_criteria, current_status, completion_percentage) — real junction.
- `action_plan_progress_updates` (id, action_plan_id FK, update_date, overall_notes, updated_by FK) + `action_plan_kpi_updates` (progress_update_id FK, kpi_id FK, new_value, notes) + `action_plan_objective_updates` (progress_update_id FK, objective_id FK, status_update, completion_percentage, notes) — this is an append-only audit trail of progress, worth full normalization since it's queried ("show progress over time for KPI X").
- `action_plan_templates` (id, name, description, category, company_id FK nullable, created_by FK, ai_recommendation_templates text[], tags text[], usage_count, is_active) + `action_plan_template_kpis` + `action_plan_template_objectives` (junctions, template variants of the above).

### Reports & analytics — #54
- `reports` (id, title, description, type enum, company_id FK, created_by FK, template_id nullable, status enum, format enum, file_path, file_size, generation_started_at/completed_at, generation_error, scheduled_for, is_recurring, recurrence_pattern, next_generation, shared_with text[], download_count, expires_at) + `filters` **jsonb** (time_filter/demographic_filters/department_filter/survey_types/survey_ids/benchmark_ids — genuinely varies by report type, keep as designed) + `config` **jsonb** (small fixed-shape flags, could go relational but low value) + `report_output` **jsonb** (sections/metadata/metrics/demographics/insights/recommendations — this is generated report content, not source-of-truth data; keep as the kitchen-sink jsonb it already is).
- `benchmarks` (id, name, description, type enum, category, source, industry, company_size, region, created_by FK, company_id FK nullable, is_active, validation_status enum, quality_score, metadata jsonb) + `benchmark_metrics` (benchmark_id FK, metric_name, value, unit, percentile, sample_size, confidence_interval_lower, confidence_interval_upper) — junction, each metric independently queried/compared. **This is where #20's `resultado_anio_anterior_pct` gap gets designed correctly**: add an explicit `benchmark_id`/`prior_period_benchmark_id` FK linkage from whatever computes department/company results, rather than the current unlinked null field.
- `analytics_insights` (id, survey_id FK nullable, company_id FK, department_id FK nullable, aggregation_type enum, metric_type enum, metric_name, metric_description, total_responses, calculation_date, is_current) + `analytics_metric_data` (insight_id FK, label, value, count, percentage) + `analytics_time_series` (insight_id FK, date, value, count) — junctions, genuinely tabular chart data.
- `ai_insights` (id, survey_id FK nullable, company_id FK, department_id FK nullable, type enum, category, title, description, confidence_score, priority enum, affected_segments text[], recommended_actions text[], supporting_data jsonb [genuinely arbitrary per insight type], is_acknowledged, acknowledged_by FK, acknowledged_at, expires_at) — **single consolidated table**, resolving issue #1 above.
- `demographic_fields` (id, company_id FK, field, label, type enum, options text[], required, order, is_active) — company-configurable form schema, stays relational.
- `demographic_snapshots` (id, survey_id FK, company_id FK, version, timestamp, created_by FK, reason, is_active) + `demographic_snapshot_entries` (snapshot_id FK, user_id FK, department, role, tenure, location, team, level, custom_attributes jsonb) + `demographic_snapshot_changes` (snapshot_id FK, field, old_value jsonb, new_value jsonb, changed_by FK, timestamp, reason) + `demographic_snapshot_metadata` (1:1 inline: total_users, departments_count, roles_distribution jsonb, tenure_distribution jsonb [genuinely dynamic key-value distributions]).

### Notifications — #55
- `notifications` (id, user_id FK, company_id FK, type enum, channel enum, priority enum, status enum, title, message, data jsonb [genuinely arbitrary per notification type], template_id FK nullable, scheduled_for, sent_at/delivered_at/opened_at/failed_at, failure_reason, retry_count, max_retries, metadata jsonb). High write volume, mostly-immutable after creation (status transitions only) — good `.Workers` project candidate for the delivery job climate-tracking's pattern already anticipates.
- `notification_templates` (id, name, type enum, channel enum, subject, title, content, html_content, company_id FK nullable, is_active, is_default, created_by FK) + `notification_template_variables` (junction: name, type enum, required, description, default_value jsonb) + `notification_personalization_rules` (junction: condition, modifications jsonb).

## Migration/backfill strategy

| Domain | Volume/mutability (inferred from API routes) | Strategy |
|---|---|---|
| Companies, Users, Departments, System Settings | Low volume, rarely mutated | One-time dump-and-load. Freeze writes on old stack for the cutover window (minutes), export, transform, load, verify counts/spot-check, cut over. |
| Surveys, Templates, Question repositories | Low-medium volume, mutated during authoring only (not after `active`) | One-time dump-and-load per company, staged (migrate a pilot company first, verify end-to-end in new stack, then batch the rest) — matches the strangler-fig per-domain rollout already planned. |
| Responses, Survey/Microclimate invitations, Microclimate live sessions | High volume, append-heavy, time-sensitive (active surveys accepting responses *during* the transition window) | **Dual-write** during a transition window: new API writes to both Mongo (old) and Postgres (new) for any survey/microclimate that's `active` at cutover time, until it naturally completes; net-new surveys created post-cutover go straight to Postgres only. Avoids losing in-flight responses. |
| Audit logs, Survey audit logs | High volume, append-only, immutable | One-time bulk load of historical data (no dual-write needed — audit logs are never queried live from the app in a way that requires zero-gap consistency), cut over write path atomically at deploy time. |
| Notifications | Medium volume, short-lived (mostly delivered/failed within hours) | Don't migrate historical notifications at all — they're transient by nature. Cut over the write path; anything in-flight on the old stack finishes there, new stack starts clean. |
| Reports (generated files) | Low volume, but has file artifacts (`file_path`) | Dump-and-load the metadata rows; decide separately whether generated report files themselves need copying to new storage or can stay in old storage referenced by URL until they expire (`expires_at` already exists on most). |

## EF Core tooling setup for `ClimateProject.Infrastructure`
Mirror climate-tracking exactly: `Persistence/ClimateProjectDbContext.cs` with one `DbSet<T>` per aggregate root, `Persistence/Configurations/*Configuration.cs` (one per entity, `IEntityTypeConfiguration<T>`), `modelBuilder.ApplyConfigurationsFromAssembly(...)`, single `Migrations/` folder with timestamped migration files generated via `dotnet ef migrations add`. Given the domain size here (~35-40 tables vs. climate-tracking's 7), expect the initial migration to be large — still keep it as one `InitialCreate` migration per the established convention rather than splitting artificially.

Part of #17.

### Comment — tafurfede — 2026-07-31T09:17:53Z

## Execution plan (2026-07-31)

#49 is too large for one plan (35-40 tables). Decomposing into 6 sequential subagent-driven-development plans, one per domain (org structure, surveys, microclimates, action plans, reports & analytics, notifications), same execution pattern as #48. **Scope: schema-design only** (EF Core entities/configs/migrations) — actual Mongo→Postgres backfill scripts get written per-domain closer to #59's real cutover, not now.

**Starting with org structure** (extends #48's existing minimal Companies/Users schema, blocks everything else):
- `Company`: add `Industry`, `Size` (enum), `Country`, `SubscriptionTier` (enum), `CompanyBranding`/`CompanySettings` (1:1 inline). Keep `EmailDomain` as-is (already unique-indexed).
- `User`: add `DepartmentId` (FK), `ManagerId` (FK self-ref), `ConsentUpdatedAt`, `UserPreferences`/`UserConsent` (1:1 inline), `UserDemographics` (jsonb).
- New: `departments` (hierarchy via recursive CTE, not denormalized level/path — resolving the spec's open question, department counts are small enough), `user_invitations`, `audit_logs`, `system_settings` (singleton).

Remaining 5 domains (surveys, microclimates, action plans, reports/analytics, notifications) follow in subsequent sessions, each gets its own comment here before its plan is written.

### Comment — tafurfede — 2026-08-01T03:33:21Z

Schema design is complete across all domains: org-structure, surveys, microclimates, action plans, reports & analytics, notifications — 51 tables, 97 FK constraints, all EF Core entities/configs/migrations merged to `climate-project-api` main. Closing; any remaining schema-level bugs found during domain implementation get filed as their own issues, not reopened here.

---

## #50 — migration: org structure domain — Companies, Users, Departments, Admin (backend + frontend)

- **State:** CLOSED
- **Labels:** migration
- **Author:** tafurfede
- **Created:** 2026-07-30T21:56:19Z  **Closed:** 2026-08-01T04:42:17Z
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/50

## What
Migrate the org-structure domain end to end: `.NET` API endpoints + React pages/components for company management (`/admin/companies`), user management, departments, and the admin shell itself.

Backend: `Company`, `User`, `Department`, `UserInvitation`, `SystemSettings`, `AuditLog` models → Supabase schema (per #49) + `.NET` API.
Frontend: admin pages, `ModernCompanyManagement`, user/department management, sidebar nav (`RoleBasedNav`) ported to react-router, current design-system tokens (`--admin-*` CSS vars, Poppins) carried over.

## Blocked by
#48 (auth), #49 (data model — this domain's slice)

Part of #17.

### Comment — tafurfede — 2026-07-30T22:06:55Z

## Design Spec

### Backend endpoints (`ClimateProject.Api/Endpoints/`)
Grouped by resource, mirroring current route surface (`src/app/api/{companies,users,departments,admin}/**`):

- **Companies**: `GET/POST /companies`, `GET/PATCH/DELETE /companies/{id}`, `PATCH /companies/{id}/settings`, `PATCH /companies/{id}/branding`, `POST /companies/{id}/resend-invitation`, `GET /companies/{id}/users`, `GET /companies/{id}/departments`, `GET /companies/{id}/demographics`.
- **Users**: `GET/POST /users`, `GET/PATCH/DELETE /users/{id}`, `PATCH /users/{id}/role`, `PATCH /users/{id}/consent-preferences`, `GET /users/by-emails`, `GET /users/export/csv`, `POST /admin/bulk-import`.
- **Departments**: `GET/POST /departments`, `GET/PATCH/DELETE /departments/{id}`, `GET /departments/for-targeting` (lightweight list for survey/microclimate targeting pickers).
- **Invitations**: `POST /invitations/company-admin`, `POST /invitations/employees`, `POST /invitations/resend`, `POST /invitations/shareable-link`.
- **System**: `GET/PATCH /system-settings` (single-row).
- **Demographics config**: `GET/PATCH /admin/demographics`, `POST /admin/demographics/bulk-upload` — company-level `demographic_fields` schema, not user data itself.

### Authorization
Current pattern is a simple inline check per route (`if (user.role !== 'super_admin') return 403`) — confirmed in `src/app/api/admin/companies/route.ts`. Replace with ASP.NET Core policy-based authorization: `[Authorize(Roles = "super_admin")]` (or a named policy if company_admin-scoped-to-own-company checks are needed, which several of these routes likely have — verify per-endpoint during implementation, not assumed here) rather than re-inlining the check in every handler.

### Frontend
Rebuild in `climate-project-web`, same page/component boundaries:
- `admin/companies` page → `ModernCompanyManagement.tsx` (2000+ lines — large component, consider splitting during the rewrite rather than porting as one file) + stats header cards.
- `UserManagement.tsx`, `UserManagementDashboard.tsx`, `UserRoleManager.tsx`, `BulkUserImport.tsx`.
- `ModernDepartmentManagement.tsx`, `DepartmentHierarchy.tsx`.
- Shell chrome this domain owns: `Sidebar.tsx`, `RoleBasedNav.tsx`, `AppShell.tsx`, `DashboardLayout.tsx`, `src/components/navigation/*` — but the actual theme/i18n/routing shell mechanics are #57's job; this issue just needs the *content* of these components (nav sections, role labels) rebuilt on top of #57's shell.

### Do not reintroduce: issue #13's infinite-render-loop pattern
Fixed 2026-07-30 (PR #44): `ModernCompanyManagement.tsx` had `const companies = data?.companies || []` — while a query is loading, `data` is `undefined`, so that fallback allocated a new array reference every render, cascading through an unmemoized `useMemo`/`useEffect` chain into an infinite `setState`-in-effect loop calling the parent's stats callback every render. When rebuilding the stats-header pattern (company/user counts, active/inactive breakdown) against the new API, memoize any `|| []`/`|| {}` fallback on its actual dependency (`useMemo(() => data?.x || [], [data])`), not inline at the call site.

### Blocked by
#48 (auth), #49 (data model — org structure schema, finalized above).

Part of #17.

### Comment — tafurfede — 2026-08-01T03:33:24Z

Progress: Slice 1 (Companies+Departments+admin shell) and Slice 2 (Users+invitations) merged to main. Slice 3 (system settings+demographics+bulk import) implementation in progress. Keeping open until Slice 3 merges.

### Comment — tafurfede — 2026-08-01T04:42:16Z

Org-structure domain complete across all 3 slices:

- **Slice 1** (Companies, Departments, admin shell) — merged.
- **Slice 2** (Users, invitations) — merged commit `2198f7d`/`e24ed28`. 8 tasks, 174 backend + 32 frontend tests.
- **Slice 3** (System settings, demographic fields, bulk CSV user import) — merged commit `17d1778`. 7 tasks, 27 agents, workflow run `wf_77d2eb4f-a91`, status CLEAN. 202 backend tests (23 unit + 179 integration), 49 frontend tests, all passing on merged main.

Closing this issue.

---

## #51 — migration: surveys domain — Surveys, templates, question bank, distributions (backend + frontend)

- **State:** OPEN
- **Labels:** migration
- **Author:** tafurfede
- **Created:** 2026-07-30T21:56:20Z  **Closed:** -
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/51

## What
The largest single domain. Migrate: `Survey`, `SurveyTemplate`, `SurveyDraft`, `SurveyVersion`, `SurveyDistribution`, `SurveyInvitation`, `SurveyAuditLog`, `QuestionBank`, `QuestionLibrary`, `QuestionPool`, `QuestionCategory`, `LibraryQuestion`, `Response` → Supabase schema (per #49) + `.NET` API + React pages (survey builder, distribution, response collection).

Likely worth its own decomposition once scoped (builder UI alone is substantial) — treat this issue as the entry point, split further during its own brainstorming pass.

## Blocked by
#48 (auth), #49 (data model — this domain's slice)

Part of #17.

### Comment — tafurfede — 2026-07-30T22:09:16Z

## Design Spec

Schema is finalized in #49's spec (surveys/questions/templates/drafts/versions/distributions/invitations/audit-logs/responses) — this spec covers the domain-specific decisions #49 deferred, plus backend/frontend scope.

## Question-repository consolidation — resolved
Checked actual import counts across `src/components`/`src/app` (2026-07-30):
- **`QuestionLibrary` + `QuestionCategory`: LIVE, primary system.** Imported by `SurveyCreationWizardNew.tsx`, `src/app/surveys/create/page.tsx` (the real survey creation flow), and `MicroclimateWizard.tsx`/`QuickAddPanel.tsx`. Backed by a full API surface: `question-library/{search,quick-add,bulk-add,categories,[id]}`.
- **`QuestionBank`: dead in the UI.** `QuestionBankManager.tsx` is only rendered from `src/app/question-bank/page.tsx` and `src/app/demo/question-bank/page.tsx` — **neither route appears anywhere in `useNavSections.ts`**, so it's unreachable from real navigation. The sibling `/demo/` route is a strong signal this was an experiment that never got wired in.
- **`LibraryQuestion` (the Mongoose model): fully dead.** Zero imports anywhere in the codebase, backend or frontend — the one grep hit was an unrelated local TypeScript interface of the same name inside `QuestionLibraryBrowser.tsx`, not the actual model. Confirms #49's suspicion.
- **`QuestionPool`: ambiguous, needs a product check before dropping.** `question-pool/{effectiveness,adaptive}` API routes exist and are real backend logic, but `QuestionPoolDashboard.tsx` has no page route or nav link. Possible it's invoked *programmatically* during survey creation (`surveys/check-adaptation`, `surveys/adaptive-questions` routes exist too) rather than through its own UI — **verify with the team whether adaptive question selection is a live feature before deciding to drop this**, don't assume dead just because there's no dashboard page.

**Recommendation**: migrate only `QuestionLibrary`/`QuestionCategory` as the `questions`-adjacent library tables. Drop `LibraryQuestion` outright. Hold `QuestionBank` and `QuestionPool` pending a product confirmation — don't design tables for them in the initial migration; add later if confirmed needed.

## Suggested further decomposition (for a future planning session — this issue stays the single entry point for now)
- **Survey authoring**: builder wizard, question library integration, templates, drafts/autosave.
- **Distribution & invitations**: QR codes, public links, tokenized invitations, reminders.
- **Response collection**: the public-facing response flow (`SurveyResponseFlow.tsx`), progress tracking, session expiry handling.
- **Results & analytics**: statistics/real-time-stats/results/export endpoints — arguably overlaps with #54, worth a boundary discussion when this gets split.

## Backend endpoint groups (mirroring current `src/app/api/surveys/**`)
CRUD (`surveys`, `[id]`), bulk ops, drafts (+ autosave/recovery), templates, search/scoped listing, statistics/real-time-stats/results/analytics/export, versions/history, duplicate, status transitions, invitations (+ reminders, invitation-settings), share/distribution, adaptive-questions/check-adaptation (pending the QuestionPool decision above), question-library (search/quick-add/bulk-add/categories).

## Frontend (mirroring current `src/components/surveys/*`)
Survey creation wizard (`SurveyCreationWizardNew`), question library browser, draft recovery banner, CSV import, demographics/department/company selectors, survey scheduler, invitation settings, QR code generator, response flow + progress bar + session expiry warning, binary-question config/response components.

## Migration notes
Per #49: surveys/templates are low-medium volume, one-time dump-and-load, staged per-company (pilot company first). **Responses and survey_invitations are high-volume and time-sensitive** — dual-write for any survey `active` at cutover time until it naturally completes; net-new surveys created after cutover go straight to the new stack.

## Blocked by
#48 (auth), #49 (data model), and the QuestionPool product decision above (blocks only that specific sub-piece, not the rest of the domain).

---

## #52 — migration: microclimates domain (backend + frontend)

- **State:** OPEN
- **Labels:** migration
- **Author:** tafurfede
- **Created:** 2026-07-30T21:56:21Z  **Closed:** -
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/52

## What
Migrate `Microclimate`, `MicroclimateTemplate`, `MicroclimateInvitation` → Supabase schema (per #49) + `.NET` API + React pages (live microclimate creation/participation, the "Live" badge/real-time feedback flow).

## Blocked by
#48 (auth), #49 (data model — this domain's slice)

Part of #17.

### Comment — tafurfede — 2026-07-30T22:07:43Z

## Design Spec

Schema per #49 (`microclimates`, `microclimate_targeting`, `microclimate_department_targets`, `microclimate_scheduling`, `microclimate_realtime_settings`, `microclimate_live_results`, `microclimate_questions`, `microclimate_ai_insights`, `microclimate_templates` + `_questions`/`_settings`, `microclimate_invitations`) — see #49 for full column lists.

## Current implementation inventory
- Models: `Microclimate.ts` (targeting/scheduling/real_time_settings/questions/live_results/ai_insights all embedded), `MicroclimateTemplate.ts`, `MicroclimateInvitation.ts` (status lifecycle: pending→sent→opened→started→participated, plus expired/bounced).
- API: 20 routes under `src/app/api/microclimates/**` — CRUD, `bulk`, `templates` (+`use`), `[id]/{insights,responses,status,live-updates,activate,export,export/pdf,export/csv,analytics}`, `invitations/{validate/[token],[id]/{participated,opened,started}}`.
- Frontend pages: `src/app/microclimates/{page,create,create-wizard,analytics,invitation/[token]}.tsx` + `[id]/{page,results,respond,live}.tsx`.
- Frontend components: `MicroclimateWizard(Demo)`, `MicroclimateBuilder`, `MicroclimateCreator`, `MicroclimateDashboard`, `LiveMicroclimateDashboard`, `RealTimeMicroclimateVisualization`, `MicroclimateResponseForm`/`EnhancedMicroclimateResponseForm`, `MicroclimateFinalResults`, `MicroclimateDetailView`.

## Real-time mechanism — confirmed
`LiveMicroclimateDashboard.tsx` and `RealTimeMicroclimateVisualization.tsx` both use a custom `useWebSocket` hook (`src/hooks/useWebSocket.ts`) built on **`socket.io-client`**, authenticated via the NextAuth session. This implies a `socket.io` server currently runs alongside the app (consistent with this repo's custom `server.js`, per project memory on local dev). `[id]/live-updates/route.ts` broadcasts updates to it.

**.NET equivalent: SignalR.** Add a `MicroclimateHub : Hub` in `ClimateProject.Api`, authenticated via the same JWT bearer scheme as #48 (SignalR supports JWT auth via query-string token on the WS handshake — standard pattern). Frontend swaps `socket.io-client` for `@microsoft/signalr`'s `HubConnectionBuilder`. Message shapes (`MicroclimateUpdate`, `LiveInsight` — currently in `src/lib/websocket.ts`) port over as C# DTOs / TS interfaces with the same fields, just a different transport client.

## Backend endpoint groups (`ClimateProject.Api/Endpoints/Microclimates`)
CRUD + bulk, templates CRUD + `use` (clone-into-new), `activate`/`status` (lifecycle transitions — port `isActive()`/`canAcceptResponses()` domain logic onto the `Microclimate` entity as methods, matching climate-tracking's rich-domain-model convention), `responses` (submission endpoint, high write volume during active sessions), `insights` (AI insight list — feeds `microclimate_ai_insights`, and per #54 should call the same AI-insight-generation path once `ai_insights` is consolidated there, not a separate implementation), `analytics`, `export`/`export/pdf`/`export/csv`, invitations sub-group (`validate/{token}`, `{id}/participated|opened|started`). `MicroclimateHub` (SignalR) separately for live push.

## Frontend
Port each page/component 1:1 into `climate-project-web`'s route structure (per #57's routing approach). `MicroclimateWizard`/`Builder`/`Creator` likely consolidate to fewer components during the port — worth a quick audit during implementation (not this spec) since `MicroclimateWizardDemo.tsx` looks like leftover demo code, confirm before porting.

## Dependency note
`microclimate_ai_insights` generation should reuse whatever AI-insight service #54 builds for the consolidated `ai_insights` table — don't build a parallel insight-generation path here. Sequence #52's insight-generation work after #54's `ai_insights` consolidation lands, or coordinate if built in parallel.

## Blocked by
#48 (auth), #49 (data model — this domain's slice), and effectively #54 for the AI-insights sub-feature specifically.

Part of #17.

---

## #53 — migration: action plans domain (backend + frontend)

- **State:** OPEN
- **Labels:** migration
- **Author:** tafurfede
- **Created:** 2026-07-30T21:56:22Z  **Closed:** -
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/53

## What
Migrate `ActionPlan`, `ActionPlanTemplate` → Supabase schema (per #49) + `.NET` API + React pages.

## Blocked by
#48 (auth), #49 (data model — this domain's slice)

Part of #17.

### Comment — tafurfede — 2026-07-30T22:07:47Z

## Design Spec

### Schema (from #49, plus one gap found)
`action_plans`, `action_plan_kpis`, `action_plan_objectives`, `action_plan_progress_updates` (+ `_kpi_updates`/`_objective_updates`), `action_plan_templates` (+ `_kpis`/`_objectives`) as designed in #49.

**Gap in #49's spec**: `ActionPlan.ts` has `assigned_to: string[]` (array of user IDs) — not mentioned in #49. Add `action_plan_assignees` (action_plan_id FK, user_id FK) junction table; used for `assigned_to`-scoped queries (dashboard widgets filter by assignee).

### Backend endpoint groups (mirroring current routes 1:1, minimal-API style)
- `GET/POST /action-plans`, `GET/PUT/DELETE /action-plans/{id}` — CRUD.
- `POST /action-plans/bulk`, `POST /action-plans/bulk-create` — current code has both; consolidate into one bulk-create endpoint during implementation unless they're genuinely different operations (needs a 2-min check, not resolved here).
- `POST /action-plans/{id}/progress`, `POST /action-plans/{id}/kpis` — sub-resource writes into the progress-update/KPI-update tables.
- `GET /action-plans/{id}/analytics`, `GET /action-plans/metrics`, `GET /action-plans/reports` — read-side aggregation endpoints.
- `GET /action-plans/{id}/export/pdf`, `/export/csv` — keep as-is; PDF/CSV generation is presentation-layer, not data-model-dependent.
- `GET /action-plans/alerts` — overdue/at-risk plan alerts (status/due_date query).
- `GET /action-plans/commitments` — commitment-tracking view scoped by `assigned_to` (uses the new junction table above) and timeframe.
- `POST /action-plans/follow-up-microclimates` — **cross-domain**: creates a `Microclimate` row from an action plan. Depends on #52's schema/endpoints existing; implement after #52, or stub/defer this one endpoint if #53 ships first.
- `GET/POST /action-plans/templates` — template CRUD.

### Frontend
Port `ActionPlanCreator.tsx`, `ActionPlanKanban.tsx`, `ActionPlanTimeline.tsx`, `BulkActionPlanCreator.tsx`, `ActionPlanDashboard.tsx`, `ActionPlanSummaryWidget.tsx` to the new React app (react-router pages + components), rebuilt against the new API — same UI/UX, new data layer.

### Cross-domain creation flow (integration point, not redesigned here)
`ActionPlanCreator.tsx` accepts optional `sourceInsight`/`sourceSurvey` props, pre-filling title/description/recommended-actions from an AI insight or survey, and writes `source_survey_id`/`source_insight_id` on create. This means #53's creator UI has a real dependency on #51 (surveys) and #54 (AI insights) existing first for that specific entry point — the plain manual-creation flow has no such dependency. Sequence: build #53's manual CRUD+Kanban first (unblocked by #48 alone), add the source-survey/source-insight creation entry point once #51/#54 land.

### Blocked by
#48 (auth), #49 (data model — this domain, now including the `assigned_to` gap above). Partial soft-dependency on #51/#54 for one creation flow (see above) and #52 for the follow-up-microclimates endpoint.

Part of #17.

---

## #54 — migration: reports & analytics domain — Reports, Benchmarks, AI Insights, Demographics (backend + frontend)

- **State:** OPEN
- **Labels:** migration
- **Author:** tafurfede
- **Created:** 2026-07-30T21:56:23Z  **Closed:** -
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/54

## What
Migrate `Report`, `Analytics`, `Benchmark`, `AIInsight`, `DemographicField`, `DemographicSnapshot` → Supabase schema (per #49) + `.NET` API + React pages/dashboards.

Note: `resultado_anio_anterior_pct` prior-year benchmark gap (#20) should be designed correctly in the new schema from the start, not carried over as a known gap.

## Blocked by
#48 (auth), #49 (data model — this domain's slice)

Part of #17.

### Comment — tafurfede — 2026-07-30T22:08:14Z

## Design Spec

### Schema (finalized in #49 — reproduced here for this domain)
`reports` + jsonb `filters`/`config`/`report_output`; `benchmarks` + `benchmark_metrics` junction; `analytics_insights` + `analytics_metric_data` + `analytics_time_series` junctions; `ai_insights` (consolidated — see below); `demographic_fields`; `demographic_snapshots` + `demographic_snapshot_entries`/`_changes`/`_metadata`. Full column lists in #49.

### AIInsight consolidation — corrected recommendation after checking actual usage
#49 recommended keeping `AIInsight.ts`'s shape "since `Analytics.ts`'s AnalyticsInsight is more referenced" — that compared the wrong pair (AnalyticsInsight is a different type from AIInsight). Checked actual consumers directly:
- `models/AIInsight.ts` (camelCase, `confidenceScore` 0-100, no `department_id`/acknowledgment/expiry fields): imported by 5 files — `microclimates/[id]/insights`, `microclimates/[id]/analytics`, `reports/[id]/export`, `export-service.ts`, `question-effectiveness-tracker.ts`. Frontend (`demo/action-plans/page.tsx`, `BulkActionPlanCreator.tsx`) reads `confidenceScore` (camelCase) — confirms this shape is what's actually rendered.
- `models/Analytics.ts`'s `AIInsight` (snake_case, `confidence_score` 0-1, has `department_id`/acknowledgment/`expires_at`): imported by 1 file — `report-service.ts`.

Both register `mongoose.model('AIInsight', ...)` under the same name — whichever loads first at runtime wins, so `report-service.ts`'s writes are likely already silently mis-cast against the wrong schema today (live bug, not intentional).

**Consolidated `ai_insights` design**: keep `AIInsight.ts`'s actively-used core shape (`type`, `category`, `title`, `description`, `confidence_score` **as 0-100** since that's what's actually consumed, `priority`, `affected_segments`, `recommended_actions`, `supporting_data`/`metadata` jsonb) as the base, but **merge in** `Analytics.ts`'s genuinely-additive fields (`department_id`, `is_acknowledged`/`acknowledged_by`/`acknowledged_at`, `expires_at`) since they add real product value and don't conflict with the base shape. `report-service.ts` needs its insight-creation code adapted to the merged shape during implementation — flag this explicitly in that migration's task list, it's not a mechanical port.

### Backend endpoint groups (`.NET` minimal API, `Endpoints/` folder per #47's convention)
- `ReportsEndpoints`: CRUD + `/filters`, `/configuration`, `/comparative-analysis`, `/templates`, `/{id}/comments`, `/{id}/schedule`, `/{id}/download`, `/{id}/public-link`, `/{id}/export`, `/{id}/share`. Report generation itself (populating `report_output` jsonb) is a good `.Workers` background-job candidate — matches the existing `status: generating|completed|failed|scheduled` state machine.
- `BenchmarksEndpoints`: CRUD + `/validate`, `/bulk`, `/analysis`, `/similar`, `/recommendations`, `/trends`, `/compare`, `/industry`, `/import`, `/categories`. `/compare` is where #20's fix lands — add explicit `benchmark_id`/`prior_period_benchmark_id` params instead of the current unlinked computation.
- `DemographicsEndpoints`: `/snapshots` CRUD, `/compare`, `/fields` CRUD + `/reorder`, `/rollback`, `/impact`, `/upload` + `/upload/preview`, `/template/csv`.
- `AnalyticsInsightsEndpoints` / `AiInsightsEndpoints`: read-mostly, `/acknowledge` action endpoint for the merged ack fields.

### Frontend pages/components (`climate-project-web`, react-router)
Port from `src/app/reports/page.tsx`, `src/app/benchmarks/page.tsx`, `src/app/shared/reports/[token]/page.tsx` (public share link — needs its own unauthenticated route), plus components: `ReportsDashboard`, `ReportBuilder`, `ReportViewer`, `ReportList`, `ReportComments`, `BenchmarkManager`, `BenchmarkCreator`, `BenchmarkComparison`, `GapAnalysisReport`. `demo/benchmarks/page.tsx` is a demo page — confirm it's not linked from production nav before deciding whether to port it.

### Blocked by
#48 (auth), #49 (data model — this domain's slice, now finalized above).

Part of #17.

---

## #55 — migration: notifications domain (backend + frontend)

- **State:** OPEN
- **Labels:** migration
- **Author:** tafurfede
- **Created:** 2026-07-30T21:56:25Z  **Closed:** -
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/55

## What
Migrate `Notification`, `NotificationTemplate` → Supabase schema (per #49) + `.NET` API (+ likely a `.Workers` project job for delivery) + React notification UI.

## Blocked by
#48 (auth), #49 (data model — this domain's slice)

Part of #17.

### Comment — tafurfede — 2026-07-30T22:08:17Z

## Design Spec

### Current implementation (confirmed 2026-07-30)
- Delivery channels: `email` (via Brevo, `src/lib/email-providers/brevo.ts` + `src/lib/email.ts`), `in_app`, `push`, `sms` declared in the schema — only email has a real provider wired up; `push`/`sms` appear to be schema-only/未implemented, confirm during implementation before porting stubs.
- Delivery is cron-triggered, not real-time: `src/app/api/cron/{send-reminders,process-reminders}` hit `POST /api/notifications/process`, which calls `notificationService.processPendingNotifications(limit)` (polls `status=pending AND scheduled_for<=now`).
- **Security smell in the current `process` route, don't carry over**: falls back to session auth if `INTERNAL_API_KEY` isn't set, and has a `NODE_ENV !== 'production'` bypass that allows unauthenticated processing in dev — the new `.Workers` service replaces this whole HTTP-triggered pattern, so this problem disappears by construction (see below).
- Frontend: `notification-dropdown.tsx` (bell/list UI) + `src/app/settings/notifications` (preferences page) + `useNotifications.ts` hook — polling-based (no websocket/SSE), with a manual in-flight-request dedup cache (`requestCache` keyed by `user.id-limit-page`) to avoid duplicate concurrent fetches. Worth keeping the polling model for v1 (no evidence of a real-time requirement) but the manual cache-dedup hack becomes unnecessary if the new frontend uses a proper data-fetching library (e.g. TanStack Query, already used elsewhere in the current app per `src/hooks/useCompanies.ts`) — its built-in request deduplication replaces this hook's hand-rolled version.
- **`NotificationTemplate.evaluateCondition` uses `new Function('return ' + evaluableCondition)()`** to evaluate personalization-rule conditions — a dynamic code-eval pattern on user/admin-authored template strings. Don't port as-is; replace with a small, safe expression evaluator (allow-listed operators/fields) or drop dynamic conditions in favor of a fixed set of condition types if usage is low (check actual template data before deciding).

### Backend (`ClimateProject.Api`)
Minimal-API `Endpoints/NotificationEndpoints.cs` + `NotificationTemplateEndpoints.cs`: CRUD on `notifications` (list/get/mark-read scoped to `user_id`), CRUD on `notification_templates` (admin-only), bulk send, analytics/engagement-tracking/delivery-optimization/forecast endpoints (these 4 exist today — confirm real usage vs. speculative/unused before porting; if genuinely used, they're read-side aggregation queries over the `notifications` table, straightforward once the schema lands).

### Background delivery (`ClimateProject.Workers`)
New standalone worker mirroring `ClimateTracking.Workers`'s actual convention (confirmed 2026-07-30: `Microsoft.NET.Sdk.Worker` project, `BackgroundService`-derived classes like `CacheSyncWorker`/`DailySemaforoWorker`, own `Program.cs`, references `.Application`+`.Infrastructure` directly — a separately deployed process, not hosted inside the Api). Add `NotificationDeliveryWorker : BackgroundService` — polls `notifications` where `status='pending' AND scheduled_for<=now`, renders via template, sends through Brevo, updates status/timestamps/retry_count. This properly replaces the current cron+HTTP-endpoint+auth-bypass pattern with a real background service — no more internal-API-key security surface for this at all.

### Frontend (`climate-project-web`)
Port `notification-dropdown.tsx` and the settings/notifications preferences page as-is (straightforward UI), replace `useNotifications.ts`'s hand-rolled cache with TanStack Query.

### Migration/backfill
Confirmed safe to skip history per #49 — checked for any feature reading notifications beyond a short recent window (settings page, dropdown, analytics endpoints) and found none that require historical continuity across the cutover; analytics/forecast endpoints operate on rolling windows, not all-time history.

### Blocked by
#47 (scaffold), #48 (auth — `user_id` scoping needs real auth), #49 (schema).

---

## #56 — migration: tracking module integration — replace BFF proxy with direct climate-tracking integration

- **State:** OPEN
- **Labels:** migration
- **Author:** tafurfede
- **Created:** 2026-07-30T21:56:49Z  **Closed:** -
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/56

## What
climate-tracking is already a `.NET` service with the same clean-architecture pattern — this is integration work, not a rewrite. Currently climate-project's Next.js API routes act as a BFF proxy to climate-tracking (Plan 3, PR #3). Once climate-project's own backend is `.NET`, decide whether the BFF layer is still needed or if the new React frontend should call climate-tracking more directly (shared auth via #48 makes this simpler than the current Next.js bridge).

Also revisit the two known climate-tracking gaps while touching this integration: `HallazgoCache` never synced (`climate-tracking#2`), `GeneratePlanCodeAsync` race window (`climate-tracking#3`).

## Blocked by
#48 (auth)

Part of #17.

### Comment — tafurfede — 2026-07-30T22:04:42Z

## Design Spec

### Current state
`climate-tracking` is its own separate .NET 10 service with its own Postgres database — **not** part of this migration's data model work (#49 only covers climate-project's own MongoDB collections). Today, climate-project's Next.js API routes act as a thin BFF proxy (`src/lib/tracking-api-client.ts`): forward the request to `TRACKING_API_BASE_URL` + path, passing through the shared HS256 JWT as the bearer token.

### What changes, what doesn't
climate-tracking's `Program.cs` already validates HS256 JWTs signed with a shared secret and does its own tenant/plan authorization (`MatchingTenantHandler`, `PlanAccessHandler` reading `companyId`/`role` claims) — confirmed 2026-07-30, see #48. Since #48 keeps the exact same claim shape and shared-secret pattern (just changes the issuer from NextAuth to `ClimateProject.Api`), **climate-tracking needs zero code changes.**

The only real question is whether `climate-project-web` (React) should:
- (a) keep a thin BFF proxy layer in `ClimateProject.Api` (mirrors current architecture, keeps the frontend only ever talking to one backend), or
- (b) call `climate-tracking`'s API directly from the browser, using the same JWT it already holds from `ClimateProject.Api` login (no proxy needed, since both services trust the same token).

**Recommend (b)** — direct calls from `climate-project-web` to climate-tracking, since the shared-token trust already makes the proxy redundant once both are separate services (the proxy's only value today is that climate-project is a monolith serving both UI and API on one origin; that constraint goes away once the frontend is its own deployable). Removing the proxy layer also removes a step of latency and a class of "proxy forwarding bugs" for free. Needs CORS configuration on climate-tracking's API to allow the new frontend's origin — confirm this is either already permissive enough or add it as part of this issue.

### Also in scope
Two known climate-tracking gaps, worth fixing while this integration is being touched (not because they're related to the migration itself, just efficient to batch):
- `climate-tracking#2` — `HallazgoCache` never synced.
- `climate-tracking#3` — `GeneratePlanCodeAsync` race window.

### Blocked by
#48 (auth — the shared-token pattern must be finalized/implemented first).

---

## #57 — migration: cross-cutting frontend — i18n, design-system tokens, routing, PWA decision

- **State:** OPEN
- **Labels:** migration
- **Author:** tafurfede
- **Created:** 2026-07-30T21:56:51Z  **Closed:** -
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/57

## What
Frontend concerns that cut across every domain page, not owned by any single domain issue:

- Port i18n (`TranslationContext`, `en.json`/`es.json`) to the new React app.
- Port the recently-finished design-system tokens (`--admin-*` CSS vars, Poppins, Twenty-CRM-density primitives from the UI-parity initiative — see project memory `project_ui_parity_status`) so the new app doesn't regress the polish just shipped.
- Next.js App Router → react-router: route structure, layouts, middleware-equivalent (auth guards, redirects).
- Decide: keep the PWA/service-worker (`public/sw.js`) in the new app, or drop it — current one already causes a known cache-hides-UI-changes gotcha in dev.

## Blocked by
#47 (foundation scaffold)

Part of #17.

### Comment — tafurfede — 2026-07-30T22:03:43Z

## Design Spec

### i18n
Current pattern: custom `TranslationContext` (`src/contexts/TranslationContext.tsx`) + `useTranslations(namespace)` hook + flat-nested JSON dictionaries (`src/messages/en.json`, `es.json`). This is framework-agnostic already (no Next.js-specific i18n routing used) — port as-is to `climate-project-web`: same context/hook shape, same JSON files, just re-wired to a plain `LocaleProvider` at the React root instead of relying on Next's app-router locale conventions (there don't appear to be any — locale seems to be user-preference-driven, not URL-based, so this should be a clean lift).

### Design-system tokens
Current source of truth (confirmed via this session's #19 work): `AdminThemeContext.tsx` hand-writes every `--admin-*` CSS var directly via `root.style.setProperty(...)` (colors, spacing implicit in Tailwind classes, not tokenized separately), reading only `colorsDark`/`colorsLight`/`getShadcnOverrides` from `src/styles/tokens/`. Port `AdminThemeContext.tsx` + `src/styles/tokens/{colors,index,generateCssVars}.ts` verbatim — this is already framework-agnostic (just React context + `document.documentElement.style`). Also port: Poppins font loading (`next/font/google` → swap for a standard `@font-face`/Google Fonts `<link>` or `@fontsource/poppins`, since Vite doesn't have `next/font`), `globals.css`'s `.admin-shell` scoped override rules, and the Tailwind config (`rounded-[4px]`-style arbitrary values, 13px base type, Twenty-CRM density — see project memory `project_ui_parity_status` for the full rationale trail).

### Routing
Next.js App Router (file-based, `src/app/**/page.tsx`) → react-router (route config, likely `createBrowserRouter`). Map 1:1 initially — same URL structure, same page components restructured as route elements. `middleware.ts` (auth guards, redirects) → react-router's loader/route-guard pattern or a top-level auth-check wrapper component, decided during implementation (not a spec-time architecture question, both are standard react-router patterns).

### PWA / service worker
**Recommend dropping it.** Current `public/sw.js` (cache-first for all same-origin GETs) has already caused a real dev-workflow gotcha this session (stale UI after merges, needs Incognito/unregister to see fresh state — see project memory `feedback_local_dev_environment`) and there's no evidence in this repo of an actual "add to homescreen"/offline-use requirement driving it. If there IS a real offline/installability requirement, re-add deliberately with a proper cache-invalidation strategy (versioned cache names, not cache-first-forever) rather than porting the current implementation as-is.

### Blocked by
#47 (scaffold exists to build into).

### Scope note
This issue is about the shell/cross-cutting layer only. Each domain issue (#50-#56) still needs its own page components rebuilt — this issue provides the shared chrome (theme, i18n, routing shell, nav) they render inside of.

---

## #58 — migration: cross-cutting backend — audit log, GDPR, search, security/rate-limiting, system settings, health checks

- **State:** OPEN
- **Labels:** migration
- **Author:** tafurfede
- **Created:** 2026-07-30T21:56:52Z  **Closed:** -
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/58

## What
Backend concerns not owned by a single domain: audit logging (`AuditLog`, `SurveyAuditLog`), GDPR endpoints, global search, security/rate-limiting middleware, system settings, health checks (`/api/health`).

Also: the ~15 `test-*` debug/scaffolding API routes under `src/app/api/` (test-report-*, test-survey-*, etc.) should NOT be migrated — confirm each is genuinely dev-only before dropping it.

## Blocked by
#47 (foundation scaffold), #49 (data model)

Part of #17.

### Comment — tafurfede — 2026-07-30T22:04:11Z

## Design Spec

### Drop entirely (confirmed dev-only scaffolding)
21 routes under `src/app/api/test-*` (`test-db`, `test-survey-creation`, `test-report-*`, `test-mongoose-save`, `test-schema-validation`, `test-minimal-seed`, etc.) — none of these are referenced by any production page, they're one-off debug endpoints accumulated during development. Do not port any of them. Confirm-by-grep during implementation that nothing in the frontend actually calls one before deleting (expected: nothing does), but default is drop.

### Port: GDPR compliance
Real endpoints exist, not stubs — `src/app/api/gdpr/{access,retention-cleanup,compliance-report,erasure}/route.ts`. These are genuine compliance features (data access requests, right-to-erasure, retention cleanup, compliance reporting) and must be ported faithfully, likely as a `GdprEndpoints` group in `ClimateProject.Api`. Depends on #49's schema for erasure/retention logic (cascading deletes / anonymization across the new relational tables, which is more precise than Mongo's loose refs — arguably an improvement).

### Port: Audit logging
`src/app/api/audit/{logs,report,export}/route.ts` — reads/reports/exports `AuditLog`/`SurveyAuditLog` records. Per #49, audit logs are high-volume/append-only — this is a straightforward EF Core read-side API once the schema lands.

### Port: Security
`src/app/api/security/config-check/route.ts` + `src/lib/rate-limiting.ts` (rate limiting logic exists as a shared lib currently, not just route-level). In .NET, rate limiting is a first-class ASP.NET Core middleware (`Microsoft.AspNetCore.RateLimiting`, built into .NET 7+) — replace the custom lib with the framework middleware rather than porting the JS logic 1:1.

### Port: System settings, health checks
`SystemSettings` model + its routes → straightforward EF Core CRUD. Health checks → ASP.NET Core's built-in `IHealthCheck`/`/health` endpoint pattern (matches what climate-tracking likely already has — check its `Program.cs` for the exact convention during implementation).

### Search
`src/app/api/search/` — needs its actual current implementation reviewed during implementation (not deeply inspected for this spec) to decide: Postgres full-text search (`tsvector`/`tsquery`, sufficient for most in-app search) vs. a dedicated search service (only justified if current search already does something Postgres FTS can't, e.g. fuzzy/semantic search — unconfirmed, check before deciding).

### Blocked by
#47 (scaffold), #49 (data model — audit/GDPR/settings all need their tables finalized).

---

## #59 — migration: AWS deployment & cutover — environments, secrets, DNS, monitoring, rollback plan

- **State:** OPEN
- **Labels:** migration
- **Author:** tafurfede
- **Created:** 2026-07-30T21:56:53Z  **Closed:** -
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/59

## What
Move hosting from Vercel (current Next.js deployment) to AWS for the new stack.

- Decide compute target for the `.NET` API (ECS/Fargate vs. App Runner vs. Elastic Beanstalk) and the React static frontend (S3+CloudFront vs. Amplify).
- Decide Supabase topology: hosted Supabase cloud (simplest) vs. self-hosted on AWS (more control, more ops burden) — affects #47's scope too.
- Secrets management (AWS Secrets Manager / Parameter Store), CI/CD deploy pipeline, custom domain + DNS cutover plan, monitoring/logging/alerting, and an explicit rollback plan for the cutover window.

## Blocked by
#47 (foundation scaffold) for the initial environment; effectively gates final cutover once all domain issues (#50-#55) are done.

Part of #17.

### Comment — tafurfede — 2026-07-30T22:02:55Z

## Design Spec

### Compute
- **API** (`climate-project-api`): AWS App Runner. Reasoning: climate-tracking-style .NET minimal APIs are stateless HTTP services with no special networking needs — App Runner gives container deploys with auto-scaling and less operational overhead than ECS/Fargate (no cluster/task-def management), and it's a good fit for a small team without dedicated DevOps. Revisit ECS/Fargate only if App Runner's cold-start/scaling limits become a real problem in practice.
- **Frontend** (`climate-project-web`): S3 + CloudFront. Static Vite build, no server-side rendering needed (client-side React) — this is the standard, cheapest pattern and matches what a Vite/react-router SPA needs (CloudFront handles the SPA fallback routing to `index.html`).

### Supabase topology
Hosted Supabase cloud, not self-hosted on AWS. Reasoning: self-hosting Supabase on AWS (Postgres + GoTrue + PostgREST + Realtime + Storage containers) is meaningfully more ops burden for a service that's already offered managed, and nothing in this migration needs Supabase's self-hosted-only features. Revisit only if data residency/compliance requirements surface that hosted Supabase can't meet.

### Secrets
AWS Secrets Manager for the API's runtime secrets (DB connection string, `TrackingJwtSecret`/shared JWT secret, any third-party API keys). Injected via App Runner's secret-reference support, not baked into images.

### CI/CD
Extend #47's build/test-only pipeline: on merge to main, build + push container image (API) and static bundle (frontend), deploy to a staging environment first, manual promotion to production. Mirror whatever climate-tracking's actual deploy pipeline does if it has AWS deployment already — worth checking before implementing (not yet confirmed as of this spec).

### DNS / cutover plan
Per-domain cutover, not all-at-once: as each domain issue (#50-#56) goes live on the new stack, route that domain's *traffic* to it behind a flag/subdomain first (e.g. `beta.` prefix or a feature-flag gate in the old Next.js app that proxies specific routes to the new API), verify in production with real users, then cut the main domain over path-by-path. Final full DNS cutover happens only after all domains are verified — that's what unblocks #60.

### Rollback plan
Keep the old Vercel/Next.js/Mongo stack fully running (not decommissioned) until the new stack has run in production for an explicit soak period (recommend minimum 2 weeks post-full-cutover) with no critical issues. DNS/routing changes should be revertible in minutes (keep old deployment warm, don't tear anything down early) — #60 is the only issue that actually deletes anything.

### Monitoring
CloudWatch for API/infra metrics + logs. Decide on an APM/error-tracking tool (e.g. Sentry, already possibly used in the current stack — check) before go-live, not deferred to post-launch.

### Blocked by
#47 (initial environment); effectively gates full cutover on #50-#56 all being done.

### Comment — tafurfede — 2026-07-31T01:27:12Z

**Progress update (2026-07-30):** First deploy slice done — the current health/version walking skeleton (`climate-project-api`) is live, dark, on AWS App Runner.

- Plan executed: `docs/superpowers/plans/2026-07-30-climate-project-api-prod-deploy.md` via subagent-driven-development (4 tasks + a final-review fix wave, all clean).
- Live: `https://bhgrdkd4gt.us-east-1.awsapprunner.com` — `/health` and `/version` verified. Nothing depends on it yet.
- Infra: CloudFormation bootstrap stack (ECR + OIDC deploy role) + service stack (App Runner), account `747814092517`/`us-east-1`. Deploy runbook committed at `infra/aws/README.md` in `climate-project-api`.
- **Known gap:** TIMSInternational's GitHub Actions billing is blocked account-wide, so `deploy-prod.yml`'s OIDC path has never run in CI — this deploy was done via local AWS CLI as an authorized workaround. Tracked separately in `climate-project-api#5`; not blocking further #59 work, just means CI-driven deploys aren't provable yet.

Remaining for #59's full scope: Secrets Manager wiring (once #48 adds a JWT secret to inject), S3+CloudFront for the frontend (no frontend exists yet), staging environment (deferred until there's something worth gating), custom domain/DNS, monitoring/alerting, and the final per-domain cutover once #50-#55 land.

---

## #60 — migration: decommission legacy Next.js/MongoDB/Vercel stack

- **State:** OPEN
- **Labels:** migration
- **Author:** tafurfede
- **Created:** 2026-07-30T21:56:54Z  **Closed:** -
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/60

## What
Final step once the new stack is live and verified in production: retire the old Next.js app, MongoDB database, and Vercel deployment. Archive or delete as appropriate; make sure nothing (e.g. cron jobs, webhooks, other services) still points at the old stack before deleting anything.

## Blocked by
Everything else in this epic (#47-#59) — this is the last issue to close.

Part of #17.

### Comment — tafurfede — 2026-07-30T22:03:18Z

## Design Spec

This is a checklist issue, not an architecture one — small spec, on purpose.

### Pre-conditions (must all be true before starting)
- [ ] All domain issues (#50-#56) live in production on the new stack, verified per #59's per-domain cutover process.
- [ ] Full DNS cutover complete and soaked per #59's rollback-plan minimum period with no critical issues.
- [ ] Nothing external still points at the old stack — audit: cron jobs (`src/app/api/cron/`), webhooks, any third-party integrations configured with old Vercel URLs, any hardcoded `TRACKING_JWT_SECRET`/env references on climate-tracking's side that assume the old issuer (should be none, per #48's design — verify).

### Decommission steps
1. Snapshot/export the MongoDB database (full dump) and store it somewhere durable (S3 Glacier or similar) before deleting anything — not for restoring the old stack, but as an audit-trail safety net.
2. Remove the Vercel project / deployment.
3. Archive (don't delete outright) the old `climate-project` Next.js repo — rename or mark read-only, keep git history.
4. Decommission the MongoDB cluster/instance.
5. Revoke any credentials/API keys that were only used by the old stack (tie into the still-outstanding secret rotation from #14 if any overlap).
6. Update this repo's README/docs and the project epic (#17) to point at the new repos (`climate-project-api`, `climate-project-web`) as the actual source of truth.

### Blocked by
Everything else in the epic (#47-#59) — last issue to close, by design.

---

## #61 — security: NotificationTemplate.evaluateCondition uses new Function() on stored, company-editable condition strings

- **State:** OPEN
- **Labels:** security
- **Author:** tafurfede
- **Created:** 2026-07-30T22:11:05Z  **Closed:** -
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/61

## What
`src/models/NotificationTemplate.ts:274` — `evaluateCondition()` runs `new Function('return ' + evaluableCondition)()` where `evaluableCondition` is built from `rule.condition`, a string stored on `notification_personalization_rules` (company-configurable notification-template personalization rules).

If template/personalization-rule editing is reachable by a company_admin (or anyone with template-management access), this is authenticated arbitrary server-side JS execution — not just a style smell.

## Also found nearby (lower severity, same file/route family)
`src/app/api/notifications/process/route.ts` — dev-mode auth bypass, but correctly gated by `process.env.NODE_ENV !== 'production'`, so not exploitable in production as written. Still fragile (depends on NODE_ENV being set correctly in every environment) — worth replacing with a real dev-only auth path rather than an inline bypass.

## Next steps
- Confirm who can actually edit `condition` strings (which roles reach the template/personalization-rule editing UI) to size the real blast radius.
- Replace `new Function()` with a safe expression evaluator (e.g. a small whitelisted DSL/expression parser) rather than raw JS eval.
- Clean up the dev-mode bypass pattern in `notifications/process/route.ts`.

Discovered 2026-07-30 while researching the #55 sub-issue of the stack-migration epic (#17) — filed separately since it's a real current bug, not migration-specific.

---

## #62 — bug: report-service.ts reads AIInsight via the less-used Analytics.ts model shape

- **State:** OPEN
- **Labels:** bug
- **Author:** tafurfede
- **Created:** 2026-07-30T22:11:06Z  **Closed:** -
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/62

## What
`src/models/AIInsight.ts` and `src/models/Analytics.ts` both register a Mongoose model under the same conceptual name (`AIInsight`) with **different shapes**: `AIInsight.ts` uses camelCase fields with `confidenceScore` 0-100; `Analytics.ts`'s `AIInsight` uses snake_case with `confidence_score` 0-1. Whichever file's `mongoose.model()` call runs first wins silently at runtime.

`src/lib/report-service.ts` imports `IAIInsight`/`AIInsight` from `@/models/Analytics` (confirmed via grep 2026-07-30), but a frontend-usage check (during #54's migration-spec research) found the camelCase/0-100 shape from `AIInsight.ts` has 5 real consumers vs. 1 for the `Analytics.ts` shape — meaning report-service.ts is very likely reading from the model that ISN'T the one the rest of the app actually populates/reads, so generated reports' AI-insights sections may already be silently wrong or empty in production.

## Next steps
- Confirm in production/staging whether report-generated AI-insights sections are actually populated correctly today.
- If confirmed broken: point `report-service.ts` at the `AIInsight.ts` shape (the more-consumed one) instead.
- This will get resolved properly as part of migration issue #54 (which consolidates both models into one `ai_insights` table), but is worth confirming/fixing independently since it may be a live production bug right now, not just migration cleanup.

Discovered 2026-07-30 while researching the #54 sub-issue of the stack-migration epic (#17) — filed separately since it's a real current bug, not migration-specific.

---

## #66 — climate-project-api tokens are structurally compatible with climate-tracking but not value-compatible yet

- **State:** OPEN
- **Labels:** -
- **Author:** tafurfede
- **Created:** 2026-07-31T05:03:03Z  **Closed:** -
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/66

Found during #48's final whole-branch review (2026-07-31).

**What works:** climate-project-api's issued JWTs are byte-for-byte structurally compatible with climate-tracking's validation — same claim names, same HS256/TrackingJwtSecret signing, same MapInboundClaims=false/no-iss-aud config. Verified with a dedicated cross-compatibility test (Task 2 of #48's plan) that validates an issued token using climate-tracking's exact TokenValidationParameters.

**What doesn't work yet:** the actual claim *values* won't resolve correctly against climate-tracking today:
- climate-project-api emits `sub`/`companyId` as fresh Postgres GUIDs (its own Users/Companies tables from #48's minimal schema).
- climate-tracking expects external string IDs (`PersonaExternalId`, `NodoExternalId`, tenant `companyId` matching its hardcoded `ProcomerCompanyId`) — see `CurrentUser.cs` and `MatchingTenantRequirement`.
- `NodoId` is never populated by climate-project-api's #48 auth work (always empty string) — nothing in #48 wires up org-structure/nodo assignment.

A climate-project-api-issued token would currently fail climate-tracking's tenant check (403) and its persona/nodo lookups would match nothing.

**Why this is fine for now:** #48 was deliberately scoped to just the auth *mechanism* (JWT shape/signing), not identity-value alignment — that's #49 (full Postgres data model, including proper external-ID handling) and #56 (tracking-module integration, dropping the BFF-proxy layer) territory. Filing this now so it's not silently assumed "already compatible" going into that work — needs an explicit identity-mapping decision (e.g. does climate-project-api mint its own GUIDs and climate-tracking gets updated to accept them, or does climate-project-api need to preserve/generate the same external-ID scheme climate-tracking expects) before #56 lands.

Part of #17.

---

## #68 — departments.manager_id has no FK constraint to users (org-structure schema gap)

- **State:** OPEN
- **Labels:** -
- **Author:** tafurfede
- **Created:** 2026-07-31T11:48:05Z  **Closed:** -
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/68

Found during #49 org-structure schema final review (2026-07-31). Plan's Task 1 (Department) noted the cross-entity FK to User would be added in Task 3 (User profile fields), but Task 3's spec never included a DepartmentConfiguration change — a plan self-contradiction, followed literally by the implementer. Result: a department can reference a nonexistent manager_id, and deleting that user leaves a stale reference. Fix: add .HasOne<User>().WithMany().HasForeignKey(d => d.ManagerId).OnDelete(DeleteBehavior.SetNull) to DepartmentConfiguration.cs + an additive migration. Part of #49.

---

## #73 — tech-debt: User.NodoId is a confirmed-dead column (tracking integration)

- **State:** OPEN
- **Labels:** -
- **Author:** tafurfede
- **Created:** 2026-08-01T13:22:09Z  **Closed:** -
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/73

## What

`User.NodoId` (added in org-structure Slice 2/3) has zero writers anywhere in climate-project-api's `src/` — confirmed via `grep -rn "NodoId = " src/`. The tracking-module integration plan (#56, Task 2) originally specified resolving `/api/internal/personas`'s `nodo_id` from this column (`u.NodoId ?? string.Empty`); the implementation deviated from that literal plan code because doing so would always emit an empty string. It instead resolves `nodo_id` via `User.DepartmentId -> TrackingIdentifiers.ExternalNodoId(department)`, which is correct and tested.

That deviation was verified correct in a final whole-branch review, but two follow-ups were never done at the time:
- No cleanup issue was filed for the dead column (this issue).
- No amendment was made to the plan doc itself recording the deviation (added retroactively in `docs/superpowers/plans/2026-08-01-tracking-integration-api.md`).

## Ask

Decide whether to:
1. Drop `User.NodoId` entirely (requires an EF Core migration + confirming no other reader depends on it), or
2. Repurpose it (e.g. as a cache/denormalization of the resolved external nodo id) — only if there's an actual read-performance reason to.

Until decided, do not add new writers to `User.NodoId`; keep using `User.DepartmentId` + `TrackingIdentifiers.ExternalNodoId` as the source of truth for a persona's nodo.

Part of #56.

---

## #74 — tech-debt: wire trackingApi.ts client into actual tracking-module UI pages

- **State:** OPEN
- **Labels:** -
- **Author:** tafurfede
- **Created:** 2026-08-01T13:24:57Z  **Closed:** -
- **Original URL:** https://github.com/TIMSInternational/climate-project/issues/74

## What

#56's climate-project-api-side plan (Task 4) explicitly scoped out building tracking-module UI pages ("no planes-de-acción list/detail/tablero/bitácora UI ... Building actual tracking pages is separate future scope") and shipped only the typed API client (`web/src/features/tracking/api/trackingApi.ts`) plus `VITE_TRACKING_API_BASE_URL`.

As of this writing that client has no caller anywhere in `web/src` outside its own tests, and can't be exercised end-to-end until climate-tracking adds CORS support (tracked separately as #56 Plan B). Each export now defaults `baseUrl` to `getTrackingApiBaseUrl()` (reading the env var) so at least the env var isn't purely decorative, and `trackingApi.live.test.ts` gives an opt-in way to verify the client against a real climate-tracking instance -- but there is still no real page consuming it.

## Ask

When the actual tracking-module pages (planes-de-acción list/detail, tablero, bitácora/mis-tareas) are built, wire them to `trackingApi.ts` and confirm the client actually works end-to-end against a real climate-tracking instance with CORS configured (not just against a stubbed fetch).

Part of #56.

---

