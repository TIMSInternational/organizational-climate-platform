> **Ported client requirements document — the body below is verbatim.**
> Source: `climate-project/testsprite_tests/tmp/prd_files/Genral_Flow.md` @ `40fc19a` (2026-07-28,
> "Add existing Procomer climate platform application (baseline)").
>
> **Requirements in this document are binding.** Technical-stack prescriptions in it
> are **superseded** by this repository's .NET 10 + React 19 architecture.
> See [requirements/README.md](../README.md) for the full reading rules and provenance.

---

Figma Structure
📌 Figma Pages
Overview & Architecture
• General diagram (based on the developed workflow).
• Module map and their interactions.
Module Wireframes
• General Climate Survey (Survey Builder + Employee UI).
• Microclimates (Real-Time) (Mentimeter-style screen).
• AI Insights Panel (results + AI recommendations).
• Action Plan & Follow-up (creation, assignment, KPI & feedback tracking).
• Hierarchical Dashboards (views for Super Admin, Admin, Leader, Supervisor, Employee).
• Report Center (filters, downloads, dynamic charts).
Component Library
• Buttons, forms, cards, charts, notifications.
• Widgets for word clouds, heatmaps, progress bars, AI alerts.

---

✅ 2. Base Layout per Screen
Screen Key Elements in Figma
Login / Sign-Up SSO, role selection, corporate branding.
Main Dashboard Sidebar + Navbar, KPIs, AI alerts, interactive widgets.
Survey Builder Dynamic constructor, question blocks, conditional logic.
Survey Execution (Employee) Clean UI, Likert scales, conditional questions, progress tracking.
Microclimate Live Real-time visualization (word clouds, animated charts).
AI Insights Panel Cards with findings, recommendations, trends.
Action Plan Manager Action table, responsible parties, KPIs, status (color-coded).
Follow-up Tracking Qualitative views (comments) + quantitative views (progress %).
Reports Filters, export options, comparative charts.

---

✅ 3. Figma Flow (Prototype Links)
The Figma prototype should simulate:

1. Start → Login → Role-specific Dashboard.
2. Admin → Creates Survey → Launches → Employee responds → AI processes → Admin receives insights.
3. Leader → Launches Microclimate → Live results → AI recommends actions.
4. Admin/Leader → Creates Plans → Tracking (KPIs + feedback) → AI adjusts and triggers follow-up microclimate.
5. Super Admin → Compares Benchmarks → Downloads Reports.

---

✅ 4. Recommended Figma Plugins
• Charts for Figma: for dynamic charts.
• Figmotion: for animations (useful to simulate live microclimates).
• Content Reel: to generate test data (users, demographics).
• AI-powered Icons: for consistent icons.

---

🎨 5. Suggested Visual Style
• UI: Clean, modern, and professional (inspired by Duolingo + Power BI-style dashboards).
• Color coding by module:
o Surveys: Blue
o Microclimates: Green
o AI Insights: Violet
o Action Plans: Orange
• Typography: Inter / Roboto.
