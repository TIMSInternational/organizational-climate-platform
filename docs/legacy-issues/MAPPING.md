# Old tracker -> new tracker mapping

The migration tracker was consolidated into `organizational-climate-platform` because the
previous tracker lived in `climate-project`, a repo scheduled for deletion. The old issues
were archived (see the sibling files in this directory) and then deleted.

Every old issue and where its content went:

| Old | Title | Disposition | Now tracked as |
|---|---|---|---|
| `climate-project#74` | wire trackingApi.ts into tracking-module UI pages | superseded | #125, #126 |
| `climate-project#73` | User.NodoId is a confirmed-dead column | superseded | #151 |
| `climate-project#68` | departments.manager_id has no FK constraint | superseded | #150, #168 |
| `climate-project#66` | tokens not value-compatible with climate-tracking | superseded | #153, #155 |
| `climate-project#62` | report-service.ts reads AIInsight via wrong model shape | superseded | #152 |
| `climate-project#61` | NotificationTemplate.evaluateCondition uses new Function() | superseded | #73 |
| `climate-project#60` | decommission legacy Next.js/MongoDB/Vercel stack | superseded | #65, #163, #164, #165, #166, #167 |
| `climate-project#59` | AWS deployment & cutover | superseded | #64, #156, #158, #159, #160, #161, #162 |
| `climate-project#58` | cross-cutting backend | superseded | #63 |
| `climate-project#57` | cross-cutting frontend | superseded | #53 |
| `climate-project#56` | tracking module integration | already complete — merged as 535e4f7 (Plan A) and ed6262d (Plan B) | — |
| `climate-project#55` | notifications domain | superseded | #55 |
| `climate-project#54` | reports & analytics domain | superseded | #54 |
| `climate-project#53` | action plans domain | already complete — merged as 774f8eb | — |
| `climate-project#52` | microclimates domain | already complete — core merged as 0e469be; the wizard/live/results/invitation surface was never in that scope and is now tracked separately | #127, #128, #129, #130, #131 |
| `climate-project#51` | surveys domain | superseded | #56, #57, #58, #59, #60, #61 |
| `climate-project#48` | auth & identity strategy | already complete — shipped: login/signup/google/refresh/admin-reset | — |
| `climate-project#47` | foundation scaffold | already complete — shipped: .NET solution, Supabase, React+Vite app | — |
| `climate-project#22` | sidebar nested-nav parked minors | superseded | #169 |
| `climate-project#21` | epic: outstanding work tracker | superseded | #51 |
| `climate-project#20` | resultado_anio_anterior_pct is always null | superseded | #89 |
| `climate-project#17` | epic: full stack migration | superseded | #51 |
| `climate-project#16` | audit Vercel build logs for exfiltration | superseded | #71 |
| `climate-project#15` | sandbox malware analysis of removed payload | superseded | #72 |
| `climate-project#14` | rotate all secrets from the malware incident | superseded | #70 |
| `climate-tracking#3` | GeneratePlanCodeAsync race window | already complete — fixed by replacing the COUNT(*)-based code generation with a Postgres sequence, merged ed6262d | — |
| `climate-tracking#2` | HallazgoCache is never populated | already complete — HallazgoCache removed entirely, replaced with an on-demand GetHallazgoByIdAsync call, merged ed6262d | — |
| `organizational-climate-platform#5` | GitHub Actions billing block | superseded | #68 |

## Coverage check

- Old issues retired: **28**
- New issues created: **121** (16 epics, 105 stories)
- Every retired issue above has either a replacement or a commit proving it was done.

