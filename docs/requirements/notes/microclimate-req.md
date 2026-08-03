> **Ported client requirements document — the body below is verbatim.**
> Source: `climate-project/testsprite_tests/tmp/prd_files/microclimate-req.md` @ `40fc19a` (2026-07-28,
> "Add existing Procomer climate platform application (baseline)").
>
> **Requirements in this document are binding.** Technical-stack prescriptions in it
> are **superseded** by this repository's .NET 10 + React 19 architecture.
> See [requirements/README.md](../README.md) for the full reading rules and provenance.

---

This is what we found after reviewing the microclimate survey:

Organized Product Spec for the Dev Team
Overview

Enable Admins to create Micro‑climate / Climate / Culture surveys fully bound to a Company, with a curated Question Library, robust Targeting fed by company master data, and complete Scheduling (start/end + QR/URL), all with background autosave.

Roles & Permissions

Super Admin: Full access to all companies and surveys.

Company Admin: Access limited to their company’s data.

Editor / Operator (optional): Can draft surveys but may require approval to publish.

Step 1 — Basic Info

Fields

Survey Type: Micro‑climate | Climate | Culture (required)

Title (required)

Description (optional, multiline)

Company (required; searchable dropdown populated from Company directory)

Company Type (optional; if used by business rules)

Language: Spanish | English | Both (multilingual setup)

Behavior / Logic

Selecting Company pre‑loads default target data for Steps 3–4.

Validation: cannot proceed without Company and Title.

Autosave (background) every 5–10 seconds and on field blur.

Acceptance Criteria

Given a valid Company and Title, the survey can proceed to Step 2.

Autosave retains inputs after refresh or temporary disconnect.

Step 2 — Questions

Sources

Quick Add: Frequently used items.

Question Library: Hierarchical catalog of Categories → Questions (supports search, filters, tags).

Create New: Add new categories and questions on the fly (with metadata: category, dimension, scale, reverse‑coding flag, etc.).

Features

Bulk add by category.

Drag & drop re‑ordering.

Multilingual content (ES/EN) with side‑by‑side editing.

Versioning (track changes, author, timestamp).

Validation for duplicated items.

Acceptance Criteria

User can build a survey from Library and/or custom items.

All items maintain category linkage for analytics.

Step 3 — Targeting

Pre‑load from Company

Departments / Organizational Units

People list (Name, Email, Employee ID)

Demographics (location, role, seniority, etc.)

Data Management

Import CSV/XLSX (template provided), with column mapping and validation.

Manual add/edit records.

Filters to target sub‑groups (by dept, location, role, etc.).

De‑duplication on Email/Employee ID.

UI Clarification

Replace or redefine “Target Audience Preview” as a read‑only summary card showing counts by segment (e.g., 8 depts, 520 employees, 3 sites).

Acceptance Criteria

Upon selecting a Company in Step 1, relevant master data appears here.

Admin can refine the audience and see a clear summary.

Step 4 — Scheduling & Distribution

Fields

Start Date & Time (required; timezone‑aware)

End Date & Time (required; cannot be earlier than Start)

Reminders (optional): cadence and channels (email; optional WhatsApp/SMS later)

Distribution

URL (unique, tokenized link per user or open link with access rules)

QR Code (auto‑generated PNG/SVG for print and screen)

Behavior

Timezone defaults from Company; override per survey.

Expired surveys become read‑only for respondents.

Background autosave on schedule changes.

Acceptance Criteria

Publishing generates working URL and downloadable QR.

Respondents cannot access outside the scheduled window (unless overridden by Admin).

Non‑functional Requirements

Autosave / Background Sync: No loss of work if the page reloads or the user steps away.

Performance: Target < 2s for step transitions with 1k targets loaded.

Audit Trail: Who changed what and when (title, questions, audience, schedule).

Localization: ES/EN fully supported in UI and survey content.

Error Handling & UX

Clear inline errors (e.g., missing Company, invalid dates).

Graceful failure and retry for background sync.

Draft recovery banner after unexpected logout/session expiry.

Out of Scope (this iteration)

Advanced analytics dashboards (post‑response).

Multi‑brand themes.

SSO integration (note as future enhancement).

Open Questions

Should Company Type drive default category/question sets?

Will we support anonymous links vs. tokenized per respondent for micro‑climate?

Minimum viable demographics to preload (role, site, tenure?)

Required reminder policy and send‑limits?
