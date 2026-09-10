# Demo script — the local walkthrough, in Spanish, for a client audience

Written 2026-09-09 for the 10 September demo to PROCOMER / CLIO. Rehearsed the same evening
against the local stack with every screen below opened in Spanish, light and dark. Update the
"what to avoid" list before reusing it: those items are rulings and data, not defects, and
they move.

## Where it runs, and why local

The demo runs on this laptop, not on `climate.timsint.com`, as **Grupo Meridiano S.A.** — a
Spanish-speaking tenant seeded through the endpoints on 9 September with
`scripts/seed-demo-company.mjs` + `scripts/seed-surveys.mjs` + `scripts/seed-local.mjs`:
five departments (Ingeniería, Finanzas, Operaciones, Personas, Ventas), 41 people with Costa
Rican names, three closed waves of 24 responses each (Finanzas under the floor, on purpose),
an open wave with a public link, four action plans, a live microclimate, two reports, two
templates, and the tracking module pinned to it. Production carries the English demo tenant,
an empty question library and no tracking service, and its seeded role accounts must not
appear in front of a client (`uat-script.md` §8.4).

Three terminals, all blocking; a server that holds its terminal is running, not stuck:

```sh
cd src/ClimateProject.Api && dotnet run                                   # API, port 5080
cd services/tracking-api/src/ClimateTracking.Api && dotnet run            # tracking, port 5091
cd web && npm run dev -- --port 5173 --strictPort                         # web, port 5173 (the ONE CORS origin)
```

`web/.env.local` must hold `VITE_API_BASE_URL=http://127.0.0.1:5080` and
`VITE_TRACKING_API_BASE_URL=http://localhost:5091`; Vite reads it at start, so restart Vite
after touching it. The tracking service's `ProcomerCompanyId` user-secret is pinned to
Grupo Meridiano (`16c97c29-07f8-4522-86fc-e6cc56298829`); to demo Acme's tracking data
instead, set it back to `22cc8ed9-2e02-401a-8d52-52068ff5e6c0`, recreate `climate_tracking`
and rerun `seed-local.mjs` as `fede.admin@acme.test`.

Before the audience arrives, open `http://localhost:5173/login`, pick **Español** and
**Claro** in the top-right selectors, and log in once as each account so the token is fresh.

| Account | Password | Role | Use it for |
|---|---|---|---|
| `ana.rojas@meridiano.test` | `Demo1234!` | Administradora de empresa | the whole administrator story |
| `carlos.mata@meridiano.test` | `Demo1234!` | Empleado (Ingeniería) | **answering the open survey live (step 10)** — has not answered Q4; signed up 9 September after the seed, so this password survives |
| `diego.solano@meridiano.test` | `Demo1234!` | Empleado (Ingeniería) | answered Q4 on 9 September; his dashboard shows what an employee sees after answering |
| `luis.mora@meridiano.test` | `Demo1234!` | Líder (Ingeniería) | the team view and the floor |
| `sofia.vargas@meridiano.test` | `Demo1234!` | Supervisora (Ingeniería) | the supervisor view |

The 24 seeded respondents had their passwords reset by the seeder and cannot log in; that is
by design. Do not log in as `fede.super` in front of the client: the platform overview lists
every tenant and the system-status page prints job internals.

Rehearsed the same evening with `web/scripts/flows.mjs` (nine role-played flows, eight pass;
the ninth needs a respondent who has not answered yet) and `web/scripts/e2e.mjs` on all five
roles, and once more step by step late that night with the ids below, which are Grupo
Meridiano's.

## The walkthrough, in order

Each step names the screen, what is on it, and one sentence to say. The order goes from
"what the organisation looks like today" to "how a person answers" to "what happens next",
which is the story the product tells.

1. **Login** — `/login`. Clean, Spanish, the anonymity line under the button ("Iniciar
   sesión solo comprueba que usted fue invitado. Nunca se vincula con las respuestas que da").
   *"Entrar solo confirma la invitación; nunca se une a las respuestas."*

2. **Panel de Control (admin)** — `/dashboard`. Four tiles, the response-rate bars by
   department, the attention card naming Ingeniería, the cycle list. *"Esto es lo que ve un
   administrador cada mañana: dónde está la organización y qué merece atención."* The
   attention card reads "19 respuestas completadas entre las 14 personas de Ingeniería en
   todas las encuestas: 136 por cada 100 personas, frente a 174 en toda la organización"; say
   that the rate counts responses across every wave, not people, and that Ingeniería is the
   largest department, which is why its rate is the lowest.

3. **Todas las Encuestas** — `/surveys`. Five rows: Q1 to Q3 closed, Q4 open at 1 of 24, and
   at the top an archived *Encuesta de Clima Q4 (abierta) (Copia)* — the 9 September
   rehearsal's copy, which cannot be deleted because it holds a response (the API refuses
   with "Archive it instead"). If it draws a question: an archived survey keeps its data and
   leaves every list that matters. Click **Resultados** on *Encuesta de Clima Q3*.

4. **Resultados** — `/surveys/38b2002f-66da-468d-b136-ec112ba3204b/results`. This is the
   screen to spend time on. Participation tiles; the climate map with Spanish dimension
   headings (*Seguridad psicológica, Carga de trabajo, Confianza, Reconocimiento, Desarrollo,
   Pertenencia*); **Finanzas hatched** — under five respondents, never opened; Operaciones red on
   two dimensions; the "Dónde mirar primero" list. Click an Operaciones cell to drill in.
   *"Un grupo con menos de cinco respuestas nunca se abre: ni aquí, ni en un export, ni en
   un enlace compartido. Es la regla más importante del producto."* The three export buttons
   produce real files (CSV of questions, CSV of the breakdown, PDF).

5. **Clima en el tiempo** — `/surveys/climate-trends`. Three closed waves by dimension, blue
   climbing out of red. *"Una encuesta es una foto; tres son una tendencia."*

6. **Planes de Acción** — `/action-plans`. Seven rows: four open plans with Spanish titles,
   three tied to a department, and three cancelled ones (the flow driver's residue, renamed
   on 9 September to plausible cancelled plans). Open an open one. *"Cada hallazgo remite al plan que lo atiende."*

7. **Vista Consolidada / Planes de acción (seguimiento)** — `/tracking` and
   `/tracking/planes`. The semáforo, the nodos, the Excel export. *"El seguimiento por
   jefatura, con semáforo y fecha de compromiso, es el módulo que PROCOMER ya conoce."*

8. **Plantillas** — `/surveys/templates`. Two templates: *Instrumento de clima estándar (6
   dimensiones)* and the five-question *Pulso de compromiso*. **Vista previa** shows the bilingual questions.
   *"El instrumento de PROCOMER entra aquí, en ambos idiomas, cuando esté listo."*

9. **Nueva encuesta** — `/surveys/new`. Walk the five steps from the pulse template; stop at
   the review step, do not launch. *"Cinco pasos, nada se envía hasta el último."*

10. **Switch to the employee** — log out, log in as `carlos.mata` (not `diego.solano`: he has
    already answered, and a person answers once). `/dashboard` shows the open survey. Click **Empezar a responder** and answer
    the six questions; the progress bar and "Guardar y terminar después" are real.
    *"Así lo ve una persona: una encuesta abierta, seis preguntas, cuatro minutos."*

11. **Switch to the leader** — `luis.mora`. The Ingeniería team row across the six
    dimensions, the team's own participation. *"Un líder ve su equipo, nunca a una persona."*

12. **Back to the admin: Informes** — `/admin/companies/16c97c29-07f8-4522-86fc-e6cc56298829/reports`.
    Two reports; **Compartir** opens the public-link dialog with its expiry and its warning
    that the link asks no password, above the links already made (one active, five revoked
    on 9 September — the flow driver made one per run). **Descargar** hands over the PDF. *"Un informe se comparte
    por enlace con vencimiento, y lo que está protegido sigue protegido en el enlace."*

13. **Puntos de Referencia** — `/analytics/benchmarks`. The Q3 index against the cohort
    median by dimension. Optional; it needs the audience to care about benchmarks, and the
    reference table below the bars prints "Puntaje de calidad 0,00" for the one seeded
    reference, which is a score nobody has computed rather than a bad one.

## What to avoid, and why

- **The bottom of a microclimate's results page.** It ends with "Análisis de sentimiento no
  está habilitado" — an honest banner about a scope ruling (row 15 of the audit page), not a
  defect. Show the participation donut and the word bars, then move on.
- **Banco de preguntas.** Empty by design until PROCOMER's instrument is imported; the
  *Biblioteca de preguntas* is the populated one.
- **Notificaciones.** Empty locally — nothing has been sent because `.test` addresses are
  refused at every mail chokepoint, deliberately.
- **The open survey's results** (`Q4`). One response, so everything is suppressed. That is
  the floor working, but it reads as "nothing here". After step 10 it has two.
- **Google sign-in.** Not configured on any side and not on the login page; do not mention it.
- **`fede.super`**, the platform overview and `/admin/system` — see above.
- **Acme's departments are in English**; Grupo Meridiano's are not. Stay on Grupo Meridiano.

## Resetting between rehearsals

The employee's answers to Q4 stay, and a person answers once. `carlos.mata` is kept
unanswered for the demo; `diego.solano` answered on 9 September. To rehearse step 10 without
spending Carlos: as the admin, **Duplicar** the Q4 survey on its detail page and launch the
copy; answer the copy as Carlos at `/surveys/<copy id>/respond` — go straight to the URL,
because the dashboard's **Empezar a responder** points at the original; then close the copy
and archive it (a survey with a response cannot be deleted). The archived copy stays in the
admin list; that is what the one already there is. Nothing else in the walkthrough writes.

## If the API refuses to start

- `Missing ConnectionStrings:ClimateProject` — you ran with `--no-launch-profile`; the launch
  profile is what sets `Development` and loads the user-secrets. Plain `dotnet run`.
- The tracking API boots refusing `ProcomerCompanyId` — its user-secrets are missing;
  `docs/runbooks/` and `project_local_dev_stack` in the agent memory carry the five values.
- Every request dies on CORS — Vite is not on 5173.
