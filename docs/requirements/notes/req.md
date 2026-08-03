> **Ported client requirements document — the body below is verbatim.**
> Source: `climate-project/testsprite_tests/tmp/prd_files/req.md` @ `40fc19a` (2026-07-28,
> "Add existing Procomer climate platform application (baseline)").
>
> **Requirements in this document are binding.** Technical-stack prescriptions in it
> are **superseded** by this repository's .NET 10 + React 19 architecture.
> See [requirements/README.md](../README.md) for the full reading rules and provenance.

---

\*\*2.2 Demographics Management

Dynamic, Company-Specific Demographics: When creating a new company (as Super Administrator or Company Administrator), define all relevant demographic attributes—not just department.

Examples of demographics: gender; age group; work location (office/site); tenure in company; educational level; hierarchy/position; business unit/department; and any other company-specific attribute.

Data Entry Options:

Pre-load via CSV/Excel Upload: 90% of companies prefer supplying a file mapping each user to their demographic values, avoiding respondent entry.

Manual Setup in UI: Administrators define demographic categories and options directly in the platform before survey launch.

User Assignment & Survey Flow:

On invitation, each user account carries pre-assigned demographics.

Respondents enter only survey answers; demographics are auto-populated.

Reporting & Segmentation:

Dashboards, exports, and filters support all custom demographics.

Enables deep segmentation (e.g., compare scores by gender, tenure bracket, or educational level).
