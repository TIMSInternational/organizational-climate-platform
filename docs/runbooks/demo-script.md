# Demo script — the local walkthrough, in Spanish, for a client audience

Written 2026-09-09 for the 10 September demo to PROCOMER / CLIO. Rehearsed the same evening
against the local stack with every screen below opened in Spanish, light and dark. Update the
"what to avoid" list before reusing it: those items are rulings and data, not defects, and
they move.

## Where it runs, and why local

The demo runs on this laptop, not on `climate.timsint.com`. Locally the tracking module is
visible, the data is Spanish, the closed survey has 24 responses in five departments, and
one of them sits under the privacy floor so the map has something honest to hatch. Production
carries the English demo tenant, an empty question library, and no tracking service; and its
seeded role accounts must not appear in front of a client (`uat-script.md` §8.4).

Three terminals, all blocking; a server that holds its terminal is running, not stuck:

```sh
cd src/ClimateProject.Api && dotnet run                                   # API, port 5080
cd services/tracking-api/src/ClimateTracking.Api && dotnet run            # tracking, port 5091
cd web && npm run dev -- --port 5173 --strictPort                         # web, port 5173 (the ONE CORS origin)
```

`web/.env.local` must hold `VITE_API_BASE_URL=http://127.0.0.1:5080` and
`VITE_TRACKING_API_BASE_URL=http://localhost:5091`; Vite reads it at start, so restart Vite
after touching it. The local database is on the `AddAuthorContentI18n` migration — the same
schema `main` carries since #457 — so a plain `dotnet run` from `main` works against it.

Before the audience arrives, open `http://localhost:5173/login`, pick **Español** and
**Claro** in the top-right selectors, and log in once as each account so the token is fresh.

| Account | Password | Role | Use it for |
|---|---|---|---|
| `fede.admin@acme.test` | `Local1234!` | Administrador de empresa | the whole administrator story |
| `fede.employee@acme.test` | `Local1234!` | Empleado | answering the open survey live |
| `fede.leader@acme.test` | `Local1234!` | Líder (Engineering) | the team view and the floor |

Do not log in as `fede.super` in front of the client: the platform overview lists a second
tenant (`Verify Co`) and the system-status page prints job internals.

## The walkthrough, in order

Each step names the screen, what is on it, and one sentence to say. The order goes from
"what the organisation looks like today" to "how a person answers" to "what happens next",
which is the story the product tells.

1. **Login** — `/login`. Clean, Spanish, the anonymity line under the button ("Iniciar
   sesión solo comprueba que usted fue invitado. Nunca se vincula con las respuestas que da").
   *"Entrar solo confirma la invitación; nunca se une a las respuestas."*

2. **Panel de Control (admin)** — `/dashboard`. Four tiles, the response-rate bars by
   department, the attention card naming Finance, the cycle list. *"Esto es lo que ve un
   administrador cada mañana: dónde está la organización y qué merece atención."* The
   attention card now reads "9 respuestas completadas entre las 6 personas de Finance en todas
   las encuestas"; say that the rate counts responses across every wave, not people.

3. **Todas las Encuestas** — `/surveys`. Seven surveys with Spanish titles, the status chips,
   the open Q4 wave at 1 of 24. Click **Resultados** on *Encuesta de Clima Q3*.

4. **Resultados** — `/surveys/fafbda45-b7e4-4134-b127-36c7d87462c0/results`. This is the
   screen to spend time on. Participation tiles; the climate map with Spanish dimension
   headings (*Seguridad psicológica, Carga de trabajo, Confianza, Reconocimiento, Desarrollo,
   Pertenencia*); **Finance hatched** — under five respondents, never opened; Operations red on
   two dimensions; the "Dónde mirar primero" list. Click an Operations cell to drill in.
   *"Un grupo con menos de cinco respuestas nunca se abre: ni aquí, ni en un export, ni en
   un enlace compartido. Es la regla más importante del producto."* The three export buttons
   produce real files (CSV of questions, CSV of the breakdown, PDF).

5. **Clima en el tiempo** — `/surveys/climate-trends`. Three closed waves by dimension, blue
   climbing out of red. *"Una encuesta es una foto; tres son una tendencia."*

6. **Planes de Acción** — `/action-plans`. Four plans with Spanish titles, tied to a
   department. Open one. *"Cada hallazgo remite al plan que lo atiende."*

7. **Vista Consolidada / Planes de acción (seguimiento)** — `/tracking` and
   `/tracking/planes`. The semáforo, the nodos, the Excel export. *"El seguimiento por
   jefatura, con semáforo y fecha de compromiso, es el módulo que PROCOMER ya conoce."*

8. **Plantillas** — `/surveys/templates`. Two templates: the six-dimension instrument and the
   five-question *Pulso de compromiso*. **Vista previa** shows the bilingual questions.
   *"El instrumento de PROCOMER entra aquí, en ambos idiomas, cuando esté listo."*

9. **Nueva encuesta** — `/surveys/new`. Walk the five steps from the pulse template; stop at
   the review step, do not launch. *"Cinco pasos, nada se envía hasta el último."*

10. **Switch to the employee** — log out, log in as `fede.employee`. `/dashboard` shows one
    open survey and what happened with the last one. Click **Empezar a responder** and answer
    the six questions; the progress bar and "Guardar y terminar después" are real.
    *"Así lo ve una persona: una encuesta abierta, seis preguntas, cuatro minutos."*

11. **Switch to the leader** — `fede.leader`. The Engineering team row across the six
    dimensions, the team's own participation. *"Un líder ve su equipo, nunca a una persona."*

12. **Back to the admin: Informes** — `/admin/companies/22cc8ed9-2e02-401a-8d52-52068ff5e6c0/reports`.
    Three reports; **Compartir** opens the public-link dialog with its expiry and its warning
    that the link asks no password. **Descargar** hands over the PDF. *"Un informe se comparte
    por enlace con vencimiento, y lo que está protegido sigue protegido en el enlace."*

13. **Puntos de Referencia** — `/analytics/benchmarks`. The Q3 index against the cohort
    median by dimension. Optional; it needs the audience to care about benchmarks.

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
- **Departments and nodos are in English** (Engineering, Finance, Operations, People, Sales).
  They are the demo tenant's own names, like a company's; the seed scripts match them by
  name, so they were not renamed.

## Resetting between rehearsals

The employee's answers to Q4 stay. To rehearse step 10 again, log in as a different seeded
employee — the `seedNN.*@acme.test` accounts have unrecorded passwords, so instead duplicate
the Q4 survey as the admin (**Duplicar** on its detail page), launch the copy, and answer
that. Nothing else in the walkthrough writes.

## If the API refuses to start

- `Missing ConnectionStrings:ClimateProject` — you ran with `--no-launch-profile`; the launch
  profile is what sets `Development` and loads the user-secrets. Plain `dotnet run`.
- The tracking API boots refusing `ProcomerCompanyId` — its user-secrets are missing;
  `docs/runbooks/` and `project_local_dev_stack` in the agent memory carry the five values.
- Every request dies on CORS — Vite is not on 5173.
