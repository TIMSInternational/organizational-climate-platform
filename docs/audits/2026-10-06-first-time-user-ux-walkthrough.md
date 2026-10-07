# A first-time user walks the whole product — 2026-10-06

**Commit measured:** `eedc85dd` (`feat/occ-brand`, = `main` `af20a73e` + the two OCC brand
commits). Local stack: web 5173, climate API 5080, tracking API 5091, all answering.
**60 declared routes** (`web/src/app/router.tsx`). Two passes: **106 role×route visits** against
the real API with real tokens, then a second pass adding the **18 routes the first pass never
visited**, the tracking module, phone width, dark theme and English. **~158 screens captured.**

**What this is.** A UX audit, not a bug hunt: where a person using this platform for the first
time would get lost, hesitate, or not know what to do next. It is additive to
`2026-09-24-remaining-work.md` and edits nothing. Every row below carries a `file:line`, a
command with its output, or a screen I read as a PNG.

**The one-sentence answer.** The writing on these screens is the best thing about them — the
floor of 5, the empty states and the employee's path are explained better than in most shipped
products — and the gap is not comprehension but **follow-through: three of the five roles land
on a page that shows them a number, a label or an error they cannot act on.**

---

## How this was measured

```
$ node scripts/e2e.mjs            # real API, real tokens, all five roles
e2e: 60 routes in router.tsx, 59 covered
e2e: 106 route visits — 97 pass, 0 warn, 7 broken, 2 skipped
```

All 7 "broken" are the tracking service answering `403`, which is the documented
`ProcomerCompanyId` pin, not a defect — `acme.test` is not the tracking tenant. **Checked
rather than assumed:** `curl localhost:5091/health` → `200`, and
`curl localhost:5091/api/mis-tareas -H "Bearer <employee>"` → `403`. The service is up and
refusing, which matters for finding 3.

Screens were then captured per role at 1440×900 against the same API and **read as images**,
because the suite has no layout engine. Two findings below exist only in pixels.

---

## 1. The leader and the supervisor are shown numbers they cannot open

This is the headline, and it is a **product decision that has been pending since 2026-08-17**
(`docs/decisions/leader-supervisor-scope.md`), not an engineering gap.

Measured against the running API as `fede.leader@acme.test`:

```
$ curl localhost:5080/dashboard/department-admin -H "Bearer <leader>"
  "memberCount":12, "activeSurveyCount":2,
  "openActionPlanCount":1, "overdueActionPlanCount":1,
  "activeSurveys":[{"title":"Licence e2e check",…},{"title":"Unmetered check",…}]

$ for each, same token:
  GET /action-plans?companyId=…   403
  GET /admin/users?companyId=…    403
  GET /surveys?companyId=…        403
```

So the leader's only screen tells them **one action plan is overdue** and names **two active
surveys**, and there is no screen anywhere in the product where they can open any of the three.
The decision doc predicted exactly this in August and called it "the one broken affordance";
it is still shipping.

**Where a person gets lost:** they read "1 atrasado", look for the way in, and there is none.
An alarm with no door is worse than no alarm, because it is read as the product being broken.

**What would fix it.** The decision, not the code — the doc's Option 2 step 1 is "one guard and
one filter away". Until it is taken, the cheapest honest fix is to stop printing a count the
reader cannot act on, or to print it with the reason it is not a link.

## 2. Six screens ship the word "PROPUESTA", five of them a company admin's

The walkthrough found the internal "pending decision" label rendered in production code on:

| role | screen |
|---|---|
| company_admin | `/admin/companies/:id/analytics` |
| company_admin | `/admin/companies/:id/demographic-fields` |
| company_admin | `/admin/question-bank` |
| company_admin | `/admin/question-library` |
| company_admin | `/analytics/ai-insights` |
| supervisor | `/dashboard` |

Rendered by five components via `t('…proposal')` (`SupervisorDashboardView.tsx`,
`AIInsightsNextPage.tsx`, `AnalyticsNextPage.tsx`, `QuestionLibraryNextPage.tsx`,
`QuestionBankNextPage.tsx`).

On the supervisor's dashboard it is at least explained — an amber note says
"Propuesta, pendiente de decisión" and why. **On the company_admin screens it is not**: the
eyebrow just reads `PROPUESTA · ACME CORPORATION` above the page title, with nothing saying what
is provisional (read in `walk/company_admin/analytics_ai-insights.png`).

**Why this matters now.** The TIMS rollout promotes a client company_admin. That person would
see "PROPUESTA" on five of their screens, unexplained, on a product their organisation is being
invoiced for. A reader cannot tell whether the *label*, the *numbers* or the *feature* is
provisional.

**What would fix it:** the supervisor's treatment (eyebrow plus a one-line note) applied to all
six, or the label dropped on the five that are not actually awaiting a ruling.

## 3. A refusal is dressed as an outage, with a Retry that can never succeed

Three of the five roles land on a page carrying this, and it is the **only English string in
106 screens**:

> Los planes que ejecutas — **No se pudieron leer tus planes: Request failed: 403**

Seen on `company_admin/dashboard`, `leader/dashboard`, `supervisor/dashboard` — all three are
landing pages. The dedicated tracking pages are worse:

> **No se pudo contactar el servicio de seguimiento.** El módulo de seguimiento no respondió.
> El resto de la plataforma sigue funcionando; vuelva a intentarlo en unos minutos. **[Retry]**

The service *did* respond — with `403`, measured above. The cause is a three-state model with
no room for "refused": `useMisTareasModel.ts:12` declares
`status: 'loading' | 'ready' | 'error'` and the bare `catch` at `:67-68` sends every failure to
the same branch. The page comment at `MisTareasNextPage.tsx:88-90` reasons correctly about a
*rejected fetch* — a stopped container, DNS, CORS — and a 403 is none of those.

**Where a person gets lost:** they press Retry, forever. Nothing tells them their company does
not have this module.

**Scope, honestly stated.** In production this card does not render today: the read is gated on
`trackingOn && capabilities.leadsANodo` (`useTeamDashboardModel.ts:103`) and
`VITE_TRACKING_API_BASE_URL` is blank in production, so tracking is off. **This is what every
non-Procomer tenant sees the day tracking deploys**, which is scheduled work.

**What would fix it:** the copy already exists — `es.json:1300` and `:1244` hold
`plansFailedNoReason` beside the `{error}` variants. Route a 403 to a "this module is not
enabled for your company" state and never interpolate `Error.message` into a screen.

## 4. The launch checklist can never read 4 of 4 for an invitation-only survey

The distribution page is one of the best screens in the product — a real launch checklist. But
on a draft it reads **"LISTA PARA LANZAR · 2 de 4 pasos · Falta el enlace público"**, and the
step it calls missing is a deliberate, correct configuration. The same card says so itself:
"Sin enlace público: la encuesta llega solo por invitación."

The arithmetic, from `web/src/features/surveys/next/authoring/launch.ts:208-218`:

```ts
{ id: 'link',       state: input.publicLink !== null ? 'done' : 'missing' },   // :210
{ id: 'reminders',  state: input.reminders  > 0     ? 'done' : 'idle'    },   // :212
readySteps = steps.filter(s => s.state === 'done' || s.state === 'idle')       // :217
```

`idle` already means "never blocking", and reminders use it. A public link does not — so
audience `done` + reminders `idle` = **2 of 4**, permanently, for the distribution model TIMS
actually used.

**Where a person hesitates:** an admin who wants invitation-only is told they are halfway done
and nudged toward minting a public link they deliberately do not want. A progress meter that
cannot be completed teaches people to ignore progress meters.

**What would fix it:** `state: 'idle'` for `link` when the survey is invitation-only, exactly as
reminders already do — one line, with the precedent two lines below it.

## 5. `?? 0` on an absent audience prints "1 de 0"

The company_admin dashboard's open-survey card reads:

> ENCUESTA ABIERTA · PRUEBA SIN LICENCIA — **1** de 0 · cierra el 31 dic

while the same survey's own detail page reads **"RESPUESTAS 1 de 44 · 2 %"** and
**"AUDIENCIA 44 personas"**. Two admin screens, one survey, two denominators.

```
web/src/features/dashboard/next/compose.ts:277        audience: first.targetAudienceCount ?? 0,
web/src/features/dashboard/next/super/derive.ts:112   audience: open.targetAudienceCount,
```

The super_admin sibling keeps the null; the company_admin path coerces it. This is the exact
anti-pattern `CLAUDE.md` names — "the classic leak is treating an absent count as `0`" — and
although here the absent value is the *audience* rather than the response count, so no
suppressed number is disclosed, it prints a reading that cannot be true: one response from an
audience of nobody.

**What would fix it:** drop the `?? 0` and render the dash the rest of the product already uses
for "not read".

## 6. Spanish plural agreement is unhandled, and the convention to fix it already exists

Read on screen: **"1 preguntas"** on `/surveys` (once per survey row, five rows),
`/microclimates/new`, `/microclimates/analytics`, `/surveys/:id/questions`; **"1 respuestas"**
on `/admin/companies/:id/analytics`, `/surveys/:id/questions`, and the **employee's own
dashboard** ("1 respuestas en 0 departamentos").

`src/i18n/translate.ts` does `{placeholder}` substitution only — there is no plural support.
The codebase already works around this with a manual `One`/`Many` key convention:

```
keys already using the One/Many convention:            161
templates that interpolate {count} before a plural noun: 201
```

So this is not a missing capability, it is 201 call sites that skipped an established pattern.

**Where a person hesitates:** nowhere badly — but for a Spanish-language instrument sold to a
Costa Rican institution, "1 preguntas" on the survey list is the kind of thing a client reads as
carelessness, and it is on the first admin screen they will open.

## 7. The reader is addressed as both *usted* and *tú*

All five of these were read as rendered text, not inferred from the catalogue:

| screen | address |
|---|---|
| employee `/dashboard` | "Hay una encuesta abierta para **usted**" |
| employee `/surveys/my` | "**Sus** respuestas no se muestran nunca" |
| employee `/settings/privacy` | "Qué guarda la plataforma sobre **ti** … **Tu** perfil" |
| leader `/dashboard` | "Cómo está **tu** equipo" |
| supervisor `/dashboard` | "Cobertura y cumplimiento de **tu** equipo" |

So one employee, in one session, is addressed formally on two screens and informally on the
third; and leaders get *tú* on the same dashboard where employees get *usted*. Across the
catalogue: **174 strings informal, 481 formal** of 6,525.

One string is a third register — `dashboard.exportFailed`: "Revisá tu conexión e intentá de
nuevo" is voseo, and it is reachable (the leader dashboard has the Exportar button).

**Correction to my own first reading.** I flagged the login screen for this and was wrong: the
router mounts `LoginNextPage` (`router.tsx:219`), not `src/auth/LoginPage.tsx`, and the rendered
screen is consistently formal ("Use el correo corporativo al que le llegó la invitación",
placeholder `nombre@empresa.com`). The catalogue strings I first cited —
`auth.emailPlaceholder` "Ingresa tu correo" and `auth.forgotPassword` — belong to an unmounted
component. **The login screen is fine.** Read the PNG.

**What would fix it:** pick one — *usted* for an institutional client — and sweep. Worth doing
before TIMS reads it.

## 8. The supervisor is told to answer a survey and given no way to

The supervisor's "Tus tareas" card lists **"Responder la Prueba de licencia"** with a due date.
It is not a link. `SupervisorDashboardView.tsx:321-341` renders the row as `<li>` with plain
`<span>`s and an explicitly inert square — the comment at `:330` says so: *"a to-do mark, not a
control"*.

The same job, for an employee, is a button: their dashboard's primary action is **"Empezar a
responder"**. So answering a survey is one click for an employee and a sidebar hunt for a
supervisor, who is also a respondent.

**What would fix it:** make the survey task row a link to `/surveys/:id/respond`. The receipt
work of 2026-10-05 already treats the supervisor as a respondent on this very card.

## 9. A draft offers "Activar" with a window that closed 21 days ago

On `/surveys/{draft}` the state card reads **"CERRÓ 15 sep 2026 · hace 21 días"** — past tense,
for a draft that never opened — beside **"Transición permitida: Programar · Activar ·
Archivar"**, all three live, with no warning that activating would open a survey already past
its end date.

Two separate problems in one card:

- **No warning on an expired window.** Nothing stops or cautions the admin.
- **Three transitions, no explanation.** "Programar" and "Activar" are adjacent secondary
  buttons of equal weight, and the difference between them is consequential — the TIMS runbook
  specifically requires *Programada*, **not** *Activa*. A first-time admin has nothing on screen
  to choose by. "Transición permitida" is state-machine language, not product language.

**What would fix it:** a one-line consequence under each verb ("Programar: se abre sola en la
fecha de inicio" / "Activar: recibe respuestas ahora"), and a guard when the end date is past.

## 10. AI insights: English findings, an untranslated slug, and nothing to review

`/analytics/ai-insights` says **"Qué hallazgo necesita su revisión"** and offers **no control at
all** — the walkthrough found zero buttons or links in `main`. "Revisado" is a static badge.

The two findings render in English on a Spanish screen — "Engagement dipped in Engineering",
"Engagement is trending down in Sales" — with the category as a raw lowercase slug,
`engagement`.

**Caveat I could not close locally:** these two rows are local data and I could not find the
seed that wrote them, so I cannot say whether a genuinely AI-generated finding would come back
Spanish. **Worth one check against the real generator before treating the language as a
defect**; the missing review control and the untranslated slug stand regardless.

## 11. Minor — the group heatmap is unreadable at 1440px, but only visually

On the super_admin dashboard the "Por grupo" matrix truncates **every** column header and
**every** row label: `SEGUR… CARGA… CONFI… RECON… DESAR… PERTE…` against
`Inversión y Enca… / Promoción Com… / Servicios Corpor…`. At a standard laptop width the
primary comparative view on the landing page cannot be read without hovering, and there is no
hover on touch.

**Scoped honestly:** this is visual only. The DOM carries the full labels and a per-cell
description ("Inversión y Encadenamientos, Seguridad psicológica: 3,7 — Área de oportunidad")
plus a "Datos del gráfico en forma de tabla" alternative. **It is not an accessibility defect.**

## 12. Minor — two pairs of near-identical nav labels

"Administración del Sistema" / "Configuración del Sistema" / "Estado del sistema", and "Banco de
preguntas" / "Biblioteca de preguntas". From the sidebar alone a newcomer cannot tell which to
click.

Largely mitigated already, and well: the bank page opens with an explicit "this page vs that
page" block and a cross-link, and its empty state reads *"Una pregunta entra aquí cuando alguien
la crea o la importa en el banco. El instrumento de PROCOMER se carga en la biblioteca, no
aquí."* The residual cost is one wrong click, once.

---

## What is good, and should not be touched

A fair audit records what works. These are the product's real strengths:

- **The floor of 5 is explained better than anywhere I have seen it.** Not just applied —
  reasoned, on screen, in the reader's language: *"Un punto es una persona. Un grupo bajo el
  umbral de 5 no dibuja sus puntos —contarlos sería decir el número— y sigue en la lista con su
  nombre."* The leader is told *"quedó por debajo del mínimo de 5 respuestas: no se publica
  ninguna lectura"*, the supervisor *"se muestra al llegar a 5"*, the results page *"ningún
  grupo llegó al umbral de 5"*. **The brief asked whether a leader understands what they may and
  may not see. They do.** This also closes the geometric-leak concern recorded on 2026-09-21:
  a protected group now draws no dots, and the screen says why.
- **The employee journey is genuinely good.** One orienting sentence — *"Hay una encuesta
  abierta para usted. Todo lo demás en esta página es lo que la empresa hizo con la anterior."*
  — one primary button, question count, a time estimate, a close date, "puede guardar y terminar
  después", and a "qué pasó con la anterior" block that closes the loop climate surveys usually
  leave open. **An employee can find and finish a survey unaided.**
- **Empty states explain themselves and point somewhere.** The question bank, microclimates,
  benchmarks and results pages all say *why* they are empty and what would fill them. The brief
  asked whether it is ever unclear why a screen is empty — with the exception of the tracking
  403 in finding 3, it is not.
- **Microclimates teaches its own concept** with a four-step strip (Crear → Compartir → Ver en
  vivo → Leer) before showing any data.
- **The distribution page is a real launch checklist**, and modulo finding 4 it answers the
  brief's third question: an admin can get from "I want to ask something" to "people are
  answering" without help.
- **i18n discipline is excellent** — one English string in 106 screens, and it is an
  interpolated exception, not a missing translation.

---

## Second pass — the coverage the first pass did not have

The first pass above swept **authenticated role routes only**. Challenged on whether that was
"all of the application", it was not. This section records what the second pass added, on the
same stack and the same commit. Totals across both: **~158 screens captured, ~19 read as
images**; the rest judged from extracted text and programmatic scans, which is a weaker
instrument and is why the two findings below were missed the first time.

### 13. What the first pass missed entirely

**18 of the 60 declared routes were never visited** — every anonymous entry point, the four
`/dev/*` pages, and the auth states. For a product whose respondents arrive by emailed link,
the untested set included the only doors they ever use.

Also never run: **`flows.mjs`**, the repository's own journey harness, which the brief named.

### 14. `flows.mjs` is stale against the redesign — 7 of 9 flows fail, and the app is fine

```
flows: 2 passed, 7 failed      (all 7: locator.fill / locator.waitFor timeouts)
```

**These are instrument failures, not product failures**, and the screenshots say so. The
harness drives the pre-redesign DOM; the `next/` pages replaced it.

- `02-employee-answer`: the screen shows question 1 of 6 answered, "4" selected, and
  **"✓ Guardado a las 13:17"** — autosave working. The harness then timed out.
- `01-survey-build-from-template`: step 1 of 5 complete, template applied, title auto-filled,
  and a live **"Vista del encuestado"** preview rendering. Failed on `locator.fill`.
- `07-admin-department`: the Departamentos page rendered in full — org chart, five cards,
  `protegido` hatching on the under-5 group, overdue plans in red.

**The consequence is the finding:** nobody has been able to run end-to-end journey
verification since the redesign, so no gate watches a journey. That is how a blank browser tab
(`2026-10-06`, the favicon) reached an open PR with twelve green checks.

### 15. A raw English error on an anonymous, public respondent screen

`/microclimates/{id}/respond` with an unknown id renders:

> No se pudo cargar esta sesión — **Microclimate not found**

Every sibling token route writes its own Spanish. This one prints the API's English string, on
a page reached from an emailed link by someone who has not signed in. It is the **third**
instance of the `Error.message`-on-screen pattern in finding 3, and the most exposed.

### 16. The mobile tab bar gives an admin three settings pages and hides their work

Measured at 390×844 as a company_admin: the bottom bar reads
**Panel de Co… · Configuraci… · Usuarios · Campos de… · Más**. "Todas las Encuestas" — the page
being viewed — is under "Más", as are Microclimas, Planes de Acción, Informes and Analítica.

The mechanism is exact: `leafNavItems` feeds the bar the first four leaves, and a
company_admin's ADMINISTRACIÓN section flattens `companySettings`, `users` and
`demographicFields` ahead of the entire Workspace section (`navSections.ts:477-490`). The file
already guards *new* Workspace rows against stealing a tab slot (`:211-214`), but the settings
sub-group precedes them structurally, so the guard never applies.

**Correctly scoped:** employee, leader and supervisor bars are right — the employee gets
Panel · Mis Encuestas · Mis Tareas · Notificaciones. This is an admin-only defect.

Also at 390px: on `/surveys` two different surveys both truncate to **"Encuesta de Cl…"** and
cannot be told apart.

### 17. What the second pass found to be GOOD

- **The dead-link copy is the best writing in the product.** `/survey-invitations/{bad}`:
  *"Puede que el enlace esté incompleto: algunos programas de correo cortan los enlaces largos
  en dos líneas."* It anticipates the actual real-world failure. For TIMS, where 15 people
  received emailed links, this is exactly right.
- **Invitation failure is properly modelled.** `next/invitation/derive.ts` maps each server
  refusal to its own translated terminal screen — *"Esta invitación caducó"*, *"Esta invitación
  ya se usó"*, *"No encontramos esta invitación"* — and an unrecognised refusal deliberately
  leaves the form standing rather than inventing a dead end. **The 2026-10-12 expiry is
  handled.** The only cost is that the page does not validate on mount, so a dead link is
  discovered after filling the form, not before. Minor.
- **The geometric privacy leak is closed in the primitive, not by accident.**
  `SignalPrimitives.tsx:105` sets `WITHHELD_DOTS = 7` — a constant — with the reasoning
  written above it: *"A dot per respondent **is** the count… a protected band draws a CONSTANT
  … its width carries no information."* I suspected a leak on seeing seven hollow dots beside
  "protegido" and the code refutes it.
- **The tracking module is strong**, and it explains its own permission boundary inline:
  *"Un plan nuevo nace en Ingeniería: es el único nodo en que puedes crear."*
- **Mobile has no horizontal overflow** on any of the nine pages measured.
- **English is complete and well written**; dark theme renders correctly.
- **The `/dev/*` routes do not ship.** `import.meta.env.DEV` (`router.tsx:177`) eliminates
  them: `chart-gallery` and `dev/signal` are absent from `dist`. Only their i18n strings remain
  in the catalogue chunk — bundle weight, not reachability.

### 18. Correction — tracking is addressed as *tú* throughout

Finding 7 understates the split. The whole tracking module is informal (*"los planes en que te
nombraron"*, *"tu nodo"*, *"puedes crear"*), so the divide is roughly module-by-module rather
than screen-by-screen.

## Third pass — every identity, every state, every control

Challenged again on whether "everything" had been checked, a third pass built the denominator
rather than asserting one.

**9 identities** (the five `fede.*` on `acme.test`, plus `ana.rojas`, `luis.mora`,
`sofia.vargas`, `diego.solano` on `meridiano.test`, where the tracking module answers 200) ×
every reachable route × **state variants** for the status-dependent routes (survey
draft/active/closed, microclimate active/closed).

```
204 page loads · 9 identities
1,635 interactive controls inventoried  (853 buttons, 610 links, 172 inputs)
0 console errors across all 204 pages
80 safe controls clicked; 8 dialogs opened — all 8 dismissed cleanly with Escape
```

**Zero console errors on 204 pages** is the headline positive. The only 4xx/5xx seen were the
known tracking tenant pin and `404 GET /surveys/{id}/distribution`, which is semantic —
`{"message":"This survey has no distribution configured yet."}` — and correctly handled by the
page.

### 19. Closing a survey is irreversible, unconfirmed, and leaves no trace

**I found this by doing it.** The interaction sweep clicked a button labelled **"Cerrar"** on
the detail page of two live `acme.test` surveys. Both are now `closed`, their end dates reset
from 31 Dec to today, and **they cannot be reopened**:

```
GET /surveys/{id}  ->  "allowedStatusTransitions": ["archived"]
SurveyStatusActions.tsx:25  — "`closed -> active` is illegal because reopening a survey means…"
```

The control is `SurveyDetailNextPage.tsx:342`, `onClick={() => onTransition(status)}` — **no
confirmation dialog, no undo, no typed confirmation**. It sits as a plain secondary button
under the label "Transición permitida", beside "Duplicar" and "Resultados", at the same visual
weight as both.

**Why this is the most consequential finding here.** A company administrator who misclicks
"Cerrar" on a live survey permanently ends data collection for everyone still to answer. On the
TIMS survey that is 15 people and a cycle that cannot be re-run. The action is one click, it
is silent, and the product offers no way back.

**What would fix it:** a confirmation step naming the consequence ("Se cierra para las N
personas que aún no han respondido. No se puede reabrir."), and visual separation from the
non-destructive actions beside it.

### 20. The supervisor dead end, proved at runtime

Finding 8 was read from the component. The third pass proved it by behaving like a person:

```
survey : Q4 Climate Survey (open), 6 questions, pending for sofia.vargas (supervisor)
primary CTA on DASHBOARD: MISSING
falling back to /surveys/my … CTA on /surveys/my: FOUND  ->  /surveys/{id}/respond
```

A supervisor whose own dashboard says "Responder la Q4 Climate Survey" has **no control on
that page** to start it. She must find "Mis Encuestas" in the sidebar unaided.

### 21. The core loop works end to end

Completed on the local stack as `sofia.vargas`: six questions answered, submitted, and the
administrator's response count moved **3 → 4**. The confirmation screen answers the three
questions a respondent actually has:

> Gracias, sus respuestas fueron recibidas · RESPUESTAS REGISTRADAS 6 de 6 · Se informan como
> promedios por departamento. **Un grupo de menos de 5 personas nunca se informa.** … nadie
> puede ver llegar las respuestas una por una.

This is the verification the first two passes lacked. **The product's central function works.**

### 22. Toggle switches have no accessible name

`role="switch"` buttons with no `aria-label`, no `aria-labelledby` and no text content —
verified against the full accessible-name chain, not just `innerText`:

| route | unnamed switches |
|---|---|
| `/settings/notifications` | 4 |
| `/notifications` | 3 |
| `/admin/system-settings` | 2 |

On `/settings/notifications` the four rows are visibly labelled *Encuestas · Microclimas ·
Planes de acción · Recordatorios*, but the labels are not associated, so a screen reader
announces "switch, on" four times. `switch.tsx` has been a blind spot in this repo before (the
contrast guard that missed its track). 78 unnamed controls were counted in total across the
sweep. **Fix: `aria-labelledby` pointing at the row label.**

### 23. Verified NOT defects

- **The `/admin/question-library` "Ver" buttons work.** 11 `click-threw` entries were my
  locator matching four identical "Ver" labels; clicking a visible one opens the bilingual
  editor drawer (+9,767 chars of DOM). My first check used a 160-character text slice and
  missed it.
- **`404 /surveys/{id}/distribution`** is a semantic empty state, handled by the page.
- **`/dev/*` does not ship** — `import.meta.env.DEV` eliminates it from `dist`.

### 24. A super_admin with no company selected loses every authoring action, silently

Found from a real screenshot: a super administrator opened an active survey in production and
the only action offered was **Resultados**. No Distribución, no Duplicar, no status
transitions — and nothing on the page said why.

The cause is one line. `viewerCapabilities.ts:224`:

```ts
const adminWithCompany = isAdminRole(role) && scope.status === 'ready'
canAuthorSurveys: adminWithCompany        // gates Duplicar, Distribución, the transitions
canOpenResults:   role === SUPER_ADMIN || …   // NOT gated — which is why Resultados alone showed
```

A super_admin's company scope is `'needs-selection'` until they pick a tenant in the switcher,
so `canAuthorSurveys` is false. `SurveyDetailNextPage` gates the button on it
(`:139 {canAuthor && canDistribute(survey.status) && …}`) and **never branches on
`needs-selection`**, so the page renders complete and simply omits the actions.

**This is inconsistent, not inevitable.** At least eight pages handle the state properly and
say so — `DepartmentsNextPage`, `DashboardPage`, `ActionPlansListNextPage`,
`MicroclimateGate`, `MicroclimatesListPage` and others branch on `needs-selection` and render
a "choose a company" screen. The survey detail and distribution pages are the ones that do
not. The only hint on screen was a side note reading *"13 departamentos; el directorio no se
pudo leer."*

**Why it matters commercially:** this is the screen a super administrator uses to hand a
client their survey link. The feature appears not to exist. It cost a real conversation with a
real client, where the team concluded the platform could only send individual invitations.

**What would fix it:** branch on `scope.status === 'needs-selection'` the way the other eight
pages already do, or disable the actions with the reason attached rather than removing them.

### 25. FIXED in this branch — the share link and QR are now on screen

Findings 4 and 24 and the client conversation behind them share one cause: the public link was
reachable but not findable. Reaching the QR took **seven steps**, three behind a menu and two
behind nested disclosures.

**What changed**, built in the real app and read as rendered PNGs at 1440 and 390, light and
dark:

- **`SharePanel`** (`next/authoring/SharePanel.tsx`) — the link and its QR, on screen, with
  Copiar, Ocultar and Descargar PNG. Promoted ABOVE the launch checklist on Distribución, and
  it replaces the read-only `ENLACE PÚBLICO` text on the survey detail page (`stacked`, since
  that rail is ~20rem at every viewport where a `md:` breakpoint would claim otherwise).
- **One control hides both.** The first build gave the link its own "Ocultar" and left the QR
  showing. That hides nothing — the code IS the address — and the panel's own advice ("use
  «Ocultar»") would have been false the moment it was followed. The test caught it.
- **Copy and download never reveal anything**, so they stay available in either state. That is
  what lets the default flip without weakening the screen-share guard the old design was built
  around.
- **The checklist step is now a status line.** It had become a second copy of the same
  controls; two live copies on one page is how a reader stops trusting either.
- **The QR dialog and its menu item were deleted** as unreachable once the code was inline.
- **Finding 24 is fixed**: a super_admin with no company selected now gets
  *"Elija una empresa — … Elija una en el selector de empresa de la parte superior"* instead of
  a page that silently drops every authoring action. Existing copy, no new keys.

**Three tests were rewritten rather than deleted.** They asserted "never puts a character of
the token on screen until the reader asks", which the new policy deliberately reverses. Their
successor asserts the guarantee that still has to hold: one control takes the address AND the
code off screen together, and `Opciones del enlace` appears exactly once per page.

**Gates:** typecheck 0 · lint 0 (7 of 10, unchanged) · build 0 · authoring suite 97/97.

**Not done:** the per-row "Compartir" action on Todas las Encuestas. The list payload carries
no `publicLink` (`GET /surveys` returns id/title/status/counts only), so a row action needs a
lazy `GET /surveys/{id}/distribution` per open, with its own loading and error states. It is
the largest of the four and the least valuable now that the panel is two clicks away.

## What this audit did not cover

- **Tracking beyond its refusal.** Every tracking screen 403s for `acme.test`; the module's real
  screens need `ana.rojas@meridiano.test`. Findings 1 and 3 are about how that refusal reads,
  not about the module.
- **`/surveys/:id/respond` was skipped for four of five roles** by the harness (no id survives
  `fillParams` when the role cannot list surveys). I captured it separately for the employee at
  both 1440×900 and 390×844; it is correct and well-sized at both.
- **I did not submit a response.** The answering path was verified by reading the screen, not by
  writing data.
- **~19 of ~158 captured screens were read as images.** The rest were judged from extracted
  text and programmatic scans. Findings 15 and 16 were both invisible to that weaker
  instrument and were only found by looking.
- **No mutating flow was completed by hand** — no survey created end to end, no response
  submitted, no action plan created. `flows.mjs` attempts exactly these and its selectors are
  stale (finding 14), so this remains genuinely unverified by any instrument.
- **Supervisor and leader were not captured at phone width**; only employee and company_admin.
- **No keyboard-only or screen-reader pass**, and no slow-network or server-error sweep.
- Dark theme and English were spot-checked on three screens each, not swept.
- **Data this audit changed.** Two `acme.test` surveys — "Unmetered check" and "Licence e2e
  check" — were closed by the interaction sweep and **cannot be reopened** (finding 19);
  `scripts/seed-surveys.mjs` can recreate them. One response was submitted as `sofia.vargas`
  on the Meridiano Q4 survey (3 → 4) to prove the loop. Nothing in production was touched.
- **Mutating admin flows remain unexercised**: no survey was created through the wizard to
  launch, no action plan created, no invitation sent. The denylist that protected those is the
  same one that failed to protect "Cerrar".

---

## Suggested order

Decision first, then the three that a TIMS reader would hit:

1. **Finding 1** — the leader/supervisor ruling. Pending 7 weeks; everything else in their
   experience hangs off it. *Federico's call, not an engineering one.*
2. **Finding 2** — "PROPUESTA" on five company_admin screens, before a client admin is promoted.
3. **Finding 6 and 7** — plurals and *usted*/*tú*. Cosmetic individually, and together they are
   what a client reads as polish.
4. **Findings 4, 5, 8, 9** — each is a small, local change with the fix already named.
5. **Finding 3** — before tracking deploys, not after.
