# Demo script — the local walkthrough, in Spanish, for a client audience

Written 2026-09-09 for the 10 September demo to PROCOMER / CLIO; **rewritten 2026-09-30 for
the 1 October demo** after a full drive-through of the local stack (`web/scripts/rehearse.mjs`
15/15, `web/scripts/e2e.mjs` 105/106 with the one skip checked by hand, every screenshot read).
Update the "what to avoid" list before reusing it: those items are rulings and data, not
defects, and they move.

## Where it runs, and why local

The demo runs on this laptop, not on `climate.timsint.com`, as **Grupo Meridiano S.A.** — a
Spanish-speaking tenant seeded through the endpoints on 9 September with
`scripts/seed-demo-company.mjs` + `scripts/seed-surveys.mjs` + `scripts/seed-local.mjs`, and
added to through the endpoints on 30 September (below). Five departments (Ingeniería,
Finanzas, Operaciones, Personas, Ventas), three closed waves of 24 responses each (Finanzas
under the floor, on purpose), two open surveys, four climate action plans, five tracking plans,
a live microclimate, two reports and two templates. Production carries the English demo
tenant, an empty question library and no tracking service, and its seeded role accounts must
not appear in front of a client (`uat-script.md` §8.4).

Three terminals, all blocking; a server that holds its terminal is running, not stuck:

```sh
cd src/ClimateProject.Api && dotnet run                                   # API, port 5080
cd services/tracking-api/src/ClimateTracking.Api && dotnet run            # tracking, port 5091
cd web && npm run dev                                                     # web, port 5173 (the ONE CORS origin)
```

`web/.env.local` must hold `VITE_API_BASE_URL=http://127.0.0.1:5080` and
`VITE_TRACKING_API_BASE_URL=http://localhost:5091`; Vite reads it at start, so restart Vite
after touching it. The tracking service's `ProcomerCompanyId` user-secret is pinned to
Grupo Meridiano (`16c97c29-07f8-4522-86fc-e6cc56298829`).

The AI step needs a Claude key in the API's user-secrets: `bash ~/Desktop/climate-demo/set-anthropic-key.sh`
asks for it hidden, tests it with one call before storing anything, and sets
`Intake:Ai:Provider=anthropic`. Restart the API after it. Without a key the importer still
works and says "La IA no está disponible en este momento" over a mapping read from the
headers.

Before the audience arrives, open `http://localhost:5173/login`, pick **Español** and
**Claro** in the bottom-right selectors, and log in once as each account so the token is fresh.

| Account | Password | Role | Use it for |
|---|---|---|---|
| `ana.rojas@meridiano.test` | `Demo1234!` | Administradora de empresa | the whole administrator story, and the AI import |
| `valeria.mora@meridiano.test` | `Demo1234!` | Empleada (Ingeniería) | **answering live (step 11)** — has answered nothing |
| `tomas.quesada@meridiano.test` | `Demo1234!` | Empleado (Ingeniería) | the spare, if step 11 is rehearsed again |
| `lucia.chaves@meridiano.test` | `Demo1234!` | Empleada (Ingeniería) | answered *Encuesta de Clima · Octubre* on 30 September (the rehearsal); Q4 still open for her |
| `luis.mora@meridiano.test` | `Demo1234!` | Líder (Ingeniería) | the team view and the floor |

`diego.solano` answered Q4 on 9 September. The 24 seeded respondents had their passwords
reset by the seeder and cannot log in; that is by design. Do not log in as `fede.super` in
front of the client: the platform overview lists every tenant and the system-status page
prints job internals. Do not log in as `sofia.vargas` either (see "What to avoid").

### What 30 September added, all through the endpoints the UI calls

- **Encuesta de Clima · Octubre** (`2d7190be-f8eb-44f6-bb7f-c927621625f0`) — a duplicate of
  the Q4 instrument, **anonymous**, with a client-facing description, open until 15 October.
  It exists because Q4 is *identified* (the seed made it so, so its responses carry a
  department) and shows "NO ANÓNIMA" on its answer screen, and an open survey that has
  answers cannot have its content edited (`SurveyEndpoints.UpdateAsync` answers 409).
- **Two open tracking plans**, `PA-2026-00004` (Operaciones · Reducir la carga de trabajo,
  15 Oct, Ana Rojas) and `PA-2026-00005` (Ingeniería · Plan de desarrollo de carrera, 9 Nov,
  Luis Mora). The tracking module's three seeded plans are all *cumplidos*, and wherever
  tracking is on, the dashboard's plans tile and the leader's plans panel read tracking — so
  they said "0 abiertos" beside four open climate plans.
- **Pulso semanal — ¿cómo va la semana?** (`05a1b4b7-378b-47ab-bb06-13e9908c9bfa`), a live
  microclimate open until 3 October 18:00. Both earlier ones are closed.
- The leftover *Pulso de compromiso* draft from 14 September was discarded, so the wizard
  opens clean.

## The walkthrough, in order

Each step names the screen, what is on it, and one sentence to say. The order goes from
"what the organisation looks like today" to "how a person answers" to "what happens next",
which is the story the product tells.

1. **Login** — `/login`. The photograph, one card, and a panel saying what the instrument
   measures and follows. There is no anonymity line here any more (removed on purpose in the
   "La sede" redesign, `a3bb7da5`): the promise is made once, in full, on the screen before
   anyone answers — say it at step 11. *"Entrar solo confirma que usted fue invitado."*

2. **Panel de Control (admin)** — `/dashboard`. Four tiles (clima 3,65; 24 respuestas;
   encuesta abierta Q4 3 de 24; **2 planes abiertos**), "Qué se movió", the map by group,
   "Qué necesita tu atención" (Operaciones, carga de trabajo 2,4), the cycle with Q4 and
   *Octubre* open, and the *Pulso semanal en vivo* card. *"Esto es lo que ve un
   administrador cada mañana: dónde está la organización y qué merece atención."* The plans
   tile counts the tracking module's plans (step 8), not the climate list (step 6).

3. **Todas las Encuestas** — `/surveys`. Two open (*Q4*, identified, 3 de 24; *Octubre*,
   anonymous), Q1–Q3 closed with 24 each, and one archived copy from 9 September (a survey
   with a response cannot be deleted; it is archived instead). Click **Resultados** on
   *Encuesta de Clima Q3*.

4. **Resultados** — `/surveys/38b2002f-66da-468d-b136-ec112ba3204b/results`. The screen to
   spend time on. Four tiles; "Dónde mirar primero"; the climate map with Spanish dimension
   headings; **Finanzas hatched** — under five respondents, never opened; Operaciones red.
   Click the Operaciones · Seguridad psicológica cell: the **Celda abierta** panel shows the
   question, the same question for the whole company, the other groups, and the plan that
   already attends it. *"Un grupo con menos de cinco respuestas nunca se abre: ni aquí, ni en
   un export, ni en un enlace compartido. Es la regla más importante del producto."*
   **Exportar informe (PDF)** and the **CSV** menu produce real files.

5. **Clima en el tiempo** — `/surveys/climate-trends`. Three closed waves by dimension, all
   six climbing. *"Una encuesta es una foto; tres son una tendencia."*

6. **Planes de Acción (clima)** — open it from the dashboard's **Abrir el plan** (or
   `/action-plans`). Four open plans, each tied to the cell it answers, and three cancelled.
   Open *Reducir la carga de trabajo en Operaciones*: the deadline, the finding it comes from
   (Operaciones · Carga de trabajo 2,4), the log. *"Cada hallazgo remite al plan que lo
   atiende."* The rail's **Planes de Acción** row leads to the tracking list instead (step 8)
   — that is the 21 August ruling, not a broken link.

7. **Usuarios → Importación masiva (la IA)** — `/admin/companies/16c97c29-07f8-4522-86fc-e6cc56298829/users`,
   button **Importación masiva**. Upload `~/Desktop/climate-demo/Planilla RRHH Meridiano - Sept 2026.xlsx`
   — an ordinary HR spreadsheet, not our template. It takes **about 30 seconds** the first
   time (a checklist runs while it reads); the same file again within 30 minutes is instant
   and labelled "reutilizado". It shows "Interpretado por IA", a Spanish summary, and the
   green panel **"La IA solo vio la estructura del archivo"** — which columns travelled as
   values and which only as masked samples. Then every column, every job title → role, every
   area → department, each with a confidence and a reason. *"La IA lee una planilla
   cualquiera sin ver a una sola persona; todo lo que propone se revisa antes de escribir
   nada."* **Do not press approve in Meridiano** — stop at the review.

8. **Vista Consolidada / Planes de acción (seguimiento)** — `/tracking` and `/tracking/planes`.
   Five plans in three nodos: two open (`PA-2026-00004`, `PA-2026-00005`, al día, 0 %) and three
   cumplidos at 100 %; the semáforo and **Exportar hoja**. *"El seguimiento por jefatura, con
   semáforo y fecha de compromiso, es el módulo que PROCOMER ya conoce."*

9. **Plantillas** — `/surveys/templates`. *Instrumento de clima estándar (6 dimensiones)* and
   *Pulso de compromiso*; **Vista previa** shows the bilingual questions. *"El instrumento de
   PROCOMER entra aquí, en ambos idiomas, cuando esté listo."*

10. **Nueva encuesta** — `/surveys/new`. Walk the five steps from the pulse template; stop at
    the review step, do not launch. *"Cinco pasos, nada se envía hasta el último."*

11. **Switch to the employee** — log out, log in as `valeria.mora`. Her dashboard features
    **Q4** first; click **Responder** on the row below it, *También abierta: Encuesta de
    Clima · Octubre*. The green **ANÓNIMA** banner is the promise — read it out: no name, no
    account, no IP, nobody can trace an answer back, not even an administrator. Answer the six
    questions and **Enviar mis respuestas**; end on the thank-you page ("se guardaron sin
    nada que lo identifique"). *"Así lo ve una persona: seis preguntas, cuatro minutos, y
    nada que la identifique."* **Do not go back to her dashboard afterwards:** an anonymous
    survey stays listed for its whole window, because knowing who answered is exactly what it
    promises not to know (`SurveyQueries.AssignedTo`).

12. **Switch to the leader** — `luis.mora`. Ingeniería against the organisation on the six
    dimensions; **El plan que atiende al equipo** (`PA-2026-00005`, Luis Mora); participation
    for both open surveys as "menos de 5 respuestas". *"Un líder ve su equipo, nunca a una
    persona."*

13. **Back to the admin: Informes** — `/admin/companies/16c97c29-07f8-4522-86fc-e6cc56298829/reports`.
    Two reports. **Compartir** is in each row's **⋯** menu: the dialog warns the link asks no
    password, sets an expiry (30 days by default) and lists the links already made. Do not press
    *Crear enlace* unless you mean it. **Descargar** hands over the file. *"Un informe se
    comparte por enlace con vencimiento, y lo que está protegido sigue protegido en el enlace."*

14. **Puntos de Referencia** — `/analytics/benchmarks`. Optional. The Q3 index (67) against
    the cohort median (68) by dimension; "Puntaje de calidad — sin calcular" is a score nobody
    has computed, not a bad one.

15. **Microclimas** — optional. *Pulso semanal — ¿cómo va la semana?* is live until 3 October:
    the live page counts responses as they arrive, keeps the words closed until five people
    answer, and shows a QR to project.

## What to avoid, and why

- **Q4's answer screen.** It says **NO ANÓNIMA** and shows the seed's description; answer
  *Octubre* instead (step 11).
- **`sofia.vargas` (supervisor).** Her dashboard opens with "Propuesta, pendiente de
  decisión" — the supervisor surface is still a proposal.
- **"meta 3,7".** It is a placeholder target in the code (`CLIMATE_TARGET`), not one the
  client set. If asked: the target is configurable per instrument once agreed.
- **Approving an import into Meridiano** (step 7). Stop at the review.
- **The bottom of a microclimate's results page.** It ends with "Análisis de sentimiento no
  está habilitado" — a scope ruling, not a defect.
- **Banco de preguntas.** Empty by design until PROCOMER's instrument is imported; the
  *Biblioteca de preguntas* is the populated one.
- **Notificaciones.** Empty locally — `.test` addresses are refused at every mail chokepoint.
- **The open surveys' results.** Under five responses, so everything is suppressed — the
  floor working, but it reads as "nothing here".
- **Google sign-in, `fede.super`, the platform overview and `/admin/system`.**
- **Acme's departments are in English**; Grupo Meridiano's are not. Stay on Grupo Meridiano.

## Resetting between rehearsals

`web/scripts/rehearse.mjs` walks every step above read-only — every context aborts any
request that is not a GET — one PNG per step into `web/.rehearsal/` (`web/docs/rehearsal.md`).
Run it with `--employee valeria.mora` so its step 10a shows a respondent who has not
answered. Answering is the one thing a rehearsal spends: `tomas.quesada` is the spare for
*Octubre*. After `lucia.chaves` answered it on 30 September, *Octubre* was still on her
dashboard — measured, and expected for an anonymous survey; whether a second answer from the
same account is accepted was not tested.

## If the API refuses to start

- `Missing ConnectionStrings:ClimateProject` — you ran with `--no-launch-profile`; the launch
  profile is what sets `Development` and loads the user-secrets. Plain `dotnet run`.
- The tracking API boots refusing `ProcomerCompanyId` — its user-secrets are missing;
  `docs/runbooks/` and `project_local_dev_stack` in the agent memory carry the five values.
- `address already in use` on 5091 or 5080 — that server is already running in another tab.
- Every request dies on CORS — Vite is not on 5173.
- Vite dies at start with a `SyntaxError` inside `node_modules/vite/dist/node/cli.js` —
  something was pasted into that file (it happened on 29 September). Compare it with
  `npm pack vite@8.2.0` and copy the pristine file back.
