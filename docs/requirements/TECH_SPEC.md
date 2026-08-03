> **Ported client requirements document — the body below is verbatim.**
> Source: `climate-project/TECH_SPEC.md` @ `40fc19a` (2026-07-28,
> "Add existing Procomer climate platform application (baseline)").
>
> **Requirements in this document are binding.** Technical-stack prescriptions in it
> are **superseded** by this repository's .NET 10 + React 19 architecture.
> See [requirements/README.md](./README.md) for the full reading rules and provenance.

---

Climate Culture Platform – Technical Specification

1.  Overview & Purpose
    The Climate Culture Platform is designed to measure, analyze, and improve organizational culture
    through AI-driven questionnaires and adaptive evaluation. It addresses the critical business problem of
    fragmented cultural insights by enabling continuous assessment across departments and
    demographics. The system operates as a feedback loop: collect → analyze → recommend → act →
    re-measure.
2.  Roles & Permissions
    The platform defines four hierarchical roles with scoped permissions:
    Role
    Permissions
    SuperAdmin
    Company Admin
    Full system access, manage all companies, admins, departments, and data
    Manage company-wide evaluations, demographics, invites, and results
    Department Admin Manage evaluations and insights only for their department
    Evaluated User
    Complete assigned questionnaires, view personal results if enabled
3.  Questionnaire System
    The platform maintains a pool of 200+ questions covering climate, culture, and microclimates. The AI
    dynamically adapts these questions by combining, reformulating, or generating new variations. It has
    access to both historical and newly created questions for contextual adaptability.
    Scenario
    AI Adaptation Example
    Combining Questions
    Merge Q2 (Collaboration) + Q184 (Communication) → 'How effectively do teams collaborate and communicate?'
    Reformulating Questions Reword Q75 based on department demographics to align with local terminology
    New Questions
4.  Workflow Steps
    Generate hybrid question from historical data + new admin-added questions
5.  Admin creates or imports new questions into the pool.
6.  Admin sends invitation links to selected users.
7.  Users complete adaptive questionnaires.
8.  Demographics may be updated by admins before, during, or after completion.
9.  AI re-analyzes responses when demographics are changed.
10. Results can be filtered by demographics at each admin level.
11. Data Flows & User Interactions
    Survey responses flow into the AI engine → demographic filters are applied → insights generated →
    dashboards display scoped data depending on role permissions. Demographics edits trigger
    recomputation of insights, while scoping ensures admins only see authorized data.
12. Modules & Functional Components- Survey Module (Climate, Culture, Microclimates)- Adaptive Engine (AI-driven question selection)- Demographics Service (versioned edits + snapshots)- Invites & Audience Targeting- Insights Engine (AI/NLP)- Action Plans & Tracking- Dashboards & Report Center- Notifications
    Conclusion
    The Climate Culture Platform empowers organizations to measure and enhance their workplace culture
    with AI-driven adaptability, scoped insights, and continuous feedback loops. By aligning evaluation with
    demographics and role-based scoping, it ensures transparency, fairness, and actionable
    recommendations.
