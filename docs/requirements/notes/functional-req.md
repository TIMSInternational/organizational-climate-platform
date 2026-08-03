> **Ported client requirements document — the body below is verbatim.**
> Source: `climate-project/testsprite_tests/tmp/prd_files/functional-req.md` @ `40fc19a` (2026-07-28,
> "Add existing Procomer climate platform application (baseline)").
>
> **Requirements in this document are binding.** Technical-stack prescriptions in it
> are **superseded** by this repository's .NET 10 + React 19 architecture.
> See [requirements/README.md](../README.md) for the full reading rules and provenance.

---

Review of Points — Climate Survey Configuration (post-review)

Below I detail each finding, its impact, severity, recommendation, acceptance criteria, and test cases. (Ready to convert into tickets.)

1. Mandatory link to Company in Step 1 – Basic Info (P0)

Observed: There is no Company field/validation when creating a climate/micro-climate/culture survey.
Impact: “Orphan” surveys, analytics errors, and multi-company filtering issues.
Severity: High.
Recommendation: Company field (searchable dropdown) required; upon selection, pre-load data for Steps 3–4.
Acceptance Criteria: You cannot proceed without Company + Title; when Company is selected, departments/people are pre-loaded.
Test Cases:

(POS) Create with a valid Company → proceeds to Step 2.

(NEG) Omit Company → clear error and blocked progression.

2. Category/Question Catalog (Library) in Step 2 – Questions (P0)

Observed: Only “quick questions” and manual creation.
Impact: Low re-use, ES/EN inconsistencies, high configuration time.
Recommendation: Hierarchical Categories → Questions library, search, filters, tags, duplicate prevention, side-by-side ES/EN editing, versioning.
Acceptance Criteria: Allows building a survey from the Library and/or custom items; preserves category linkage for analytics.
Test Cases: Add by category; keyword search; prevent duplicates.

3. Targeting with Company-based pre-load and improved “Target Audience Preview” (P0)

Observed: No pre-load; “Target Audience Preview” is ambiguous.
Impact: Friction when segmenting; risk of large-scale delivery errors.
Recommendation: Pre-load Departments, People (Name/Email/ID), Demographics when Company is selected; allow CSV/XLSX Import with column mapping; de-dupe by Email/ID. Convert “Target Audience Preview” into a readable summary (counts by segment).
Acceptance Criteria: Upon selecting Company, data appears; audience can be filtered/adjusted; summary shows totals/segments.
Test Cases: Import with valid columns; detect duplicates; filter by dept/location.

4. Scheduling with end date and time (P0)

Observed: Only Start Date; End Date/Time is missing.
Impact: Links remain open indefinitely or require late manual closure.
Recommendation: End Date & Time fields (timezone-aware); validation Start < End; optional reminders.
Acceptance Criteria: Publishing creates an active window; outside that window, access is blocked (unless Admin override).
Test Cases: (NEG) End < Start → error; (POS) valid window → correct access behavior.

5. Distribution with URL + QR (P0)

Recommendation: Generate a QR code (PNG/SVG) in addition to a URL; support tokenized per-user links or anonymous links per policy.
Acceptance Criteria: Upon publishing, a URL and downloadable QR are generated; access respects the Step 4 window.
Test Cases: Scanning QR on mobile → opens the survey; expires at End time.

6. Autosave/Background Sync and session recovery (P0)

Observed: Work is lost when a call comes in/session expires; page kicks the user out.
Impact: High risk of data loss and user frustration.
Recommendation: Autosave every 5–10s and onBlur; draft recovery banner after re-login; session-expiry warning with countdown; local cache + server-side draft.
Acceptance Criteria: After close/refresh, the draft is restored; no content is lost.
Test Cases: Interrupt network for 3 minutes → content persists upon return.

7. Performance/Stability (freezes and visual “interference”) (P1)

Observed: Freezes on load; visual overlap.
Impact: Intermittent usage blocks.
Recommendation: Lazy loading, pagination on large lists, debounce for searches, tracing (Sentry/Logs), feature flags.
Acceptance Criteria: Step change time < 2s with 1k targets; no UI overlaps.
Test Cases: Profile with 1k employees → smooth navigation.

8. Error when creating Company (P1)

Observed: Company is not created; generic error.
Recommendation: Backend validations, actionable error messages, idempotent retries, domain uniqueness, auditing.
Acceptance Criteria: Create/edit shows clear confirmation; errors indicate field and root cause.
Test Cases: Duplicate domain → specific error; valid domain → success.

9. Email domain (not full address) (P1)

Recommendation: Validate that the field accepts domain only (e.g., company.com); if it detects user@company.com, show helper text and normalize.
Acceptance Criteria: Stores only the clean domain.
Test Cases: Enter an email → warning + correction.

10. Roles & Permissions (Super Admin / Company Admin / User) (P1)

Observed: Access cases where the user logs in without Super Admin permissions.
Recommendation: UI to see active role and switch (if applicable), clear scope policies; permission-elevation log.
Acceptance Criteria: Role determines visibility/actions; inconsistencies are logged.
Test Cases: Account with changed role → immediate reflection in permissions.

11. ES/EN Multilanguage (P1)

Recommendation: UI i18n; question content with ES/EN fields; missing-content validation; defined fallback.
Acceptance Criteria: Side-by-side editable view; preview in both languages.
Test Cases: Export/show the survey in ES and EN without “untranslated” strings.

12. Telemetry & Usage Analytics (P2)

Recommendation: FE/BE events (step viewed, saved, error, abandonment), basic funnel dashboards.
Acceptance Criteria: Events include user/company/survey; panel shows completion rates.
Test Cases: Simulate abandonment at Step 2 → event recorded.

Improvement Backlog (priority summary)

P0: (1) Company in Step 1, (2) Question Library, (3) Targeting pre-load, (4) End date/time, (5) URL+QR, (6) Autosave/recovery.
P1: (7) Performance/Stability, (8) Company creation errors, (9) Email domain, (10) Roles/Permissions, (11) Multilanguage.
P2: (12) Telemetry/analytics.

Suggested Tickets (JIRA-ready)

CLIMA-001: Add required Company field in Step 1 with preload to Steps 3–4.

CLIMA-002: Implement Question Library (Categories→Questions), search, tags, ES/EN.

CLIMA-003: Targeting preload + CSV import + dedupe + clear Audience Summary.

CLIMA-004: Scheduling end date/time with validation and reminders.

CLIMA-005: Distribution: generate URL & QR (PNG/SVG), tokenization options.

CLIMA-006: Background autosave + draft recovery + session expiry UX.

CLIMA-007: Performance improvements and visual overlap fixes.

CLIMA-008: Company creation: validations, actionable errors, idempotent retry.

CLIMA-009: Email domain-only validation with helper.

CLIMA-010: Roles/permissions clarity and audit trail.

CLIMA-011: Full ES/EN localization for UI and content.

CLIMA-012: Usage telemetry events and funnel dashboard.
