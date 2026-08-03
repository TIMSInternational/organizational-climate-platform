> **Ported client requirements document — the body below is verbatim.**
> Source: `climate-project/testsprite_tests/tmp/prd_files/General_Structure.md` @ `40fc19a` (2026-07-28,
> "Add existing Procomer climate platform application (baseline)").
>
> **Requirements in this document are binding.** Technical-stack prescriptions in it
> are **superseded** by this repository's .NET 10 + React 19 architecture.
> See [requirements/README.md](../README.md) for the full reading rules and provenance.

---

✅ 1. General Module Architecture
User Flow: from login → survey selection → response → results → action plans.

Main Components:

General Climate Survey (Survey Builder + Employee UI)

Real-Time Microclimates (Mentimeter-style live dashboards)

AI Insights Panel (results processing + AI-generated recommendations)

Action Plans & Follow-Up (KPIs, assignment, visual monitoring)

Hierarchical Dashboards (custom views for Super Admin, Admin, Leader, Supervisor, Employee)

Report Center (filters, downloads, dynamic charts)

Component Library (buttons, forms, cards, AI widgets, heatmaps, word clouds).

✅ 2. Figma Wireframes and Pages
Login / Sign-Up: with SSO, roles, corporate branding.

General Dashboard: sidebar + navbar, KPIs, AI alerts, interactive widgets.

Survey Builder: dynamic builder with question blocks, conditional logic.

Microclimates: real-time perception visualization by department.

AI Insights: panel with findings, risks, and recommendations.

Action Plan: creation and assignment of actions, KPI monitoring, feedback tracking.

Report Center: dynamic reports, filters, PDF/Excel export.

✅ 3. Roles and Permissions
Super Admin: global control, survey creation, benchmarking, access to all reports.

Company Admin: manages their organization, creates categories and questions, views dashboards by area.

Area Leader: views team reports and manages action plans.

Supervisor: tracks assigned tasks and KPIs.

Employee: answers surveys, views microclimates, and receives relevant feedback.

✅ 4. Evaluation Logic and Core Functionalities
Survey Types:

General Climate (annual or semi-annual)

Microclimates (instant perception)

Organizational Culture (alignment with values and purpose)

Scales and Question Formats: Likert, multiple-choice, ranking, open-ended.

Measured Variables: engagement, leadership, communication, compensation, development, cultural alignment, etc.

AI Processing: semantic analysis of open responses, engagement pattern detection, insight generation, and suggested action plans.

✅ 5. Action Plan and Monitoring
Action Creation with owners, deadlines, and KPIs.

Visualization through Kanban or timeline view.

Automated Alerts for overdue tasks.

Progress Reports with impact metrics.

✅ 6. Suggested Database Structure
Users: id, name, role, company_id, department_id, etc.

Surveys: id, title, type, start_date, end_date.

Questions: id, survey_id, text, question_type, options.

Responses: id, user_id, question_id, response, timestamp.

Insights: id, survey_id, ai_analysis, recommendations.

Action_Plans: id, leader_id, action, kpi, status, deadline.

✅ 7. Suggested API Endpoints
POST /api/users/register – Register a new user.

POST /api/surveys/create – Create a new survey.

GET /api/surveys/:id – Retrieve a survey.

POST /api/responses/submit – Submit responses.

GET /api/insights/:survey_id – Get AI-generated analysis.

POST /api/action-plans/create – Create an action plan.

PATCH /api/action-plans/:id – Update action plan status.

GET /api/reports/:company_id – Generate filtered reports.

✅ 8. Implementation Roadmap (3 Phases)
Phase 1 – Core Module

Build Survey Builder, role logic, and response storage.

Phase 2 – Dashboards and AI Insights

Integrate dashboards, dynamic charts, and AI engine for data analysis.

Phase 3 – Action Plans and Real-Time Microclimates

Develop action plan module with tracking and microclimate visualization.
