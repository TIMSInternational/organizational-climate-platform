# Can a TIMS operator run a client from the screen? — walked 2026-11-08

**Measured against `main` at `f9a28832`** (= `origin/main` = production `/version`), on the local
stack with the database migrated to `20261103205507_BenchmarkGroups`. Additive, per the
`docs/audits/` convention: it supersedes nothing by editing; read it beside
`2026-10-31-frontend-completeness.md` (route-to-screen) and `2026-10-28-operations-gap.md`
(the October script kit).

## Why this one is different from the last three

The earlier audits asked *"does a route have a caller in `web/src`?"*. That question cannot see a
button that exists but does not appear, a form that exists for one role and not another, or a
page that silently shows less depending on something elsewhere on the screen. This audit
**walked the product in Chrome as a TIMS operator** — `super_admin`, company-less (the production
shape, #191), Spanish — through one engagement end to end: create the client, configure it, load
people, build a survey, distribute, chase, close, deliver. Every finding below is either **seen on
screen** or **cited to the line of code that causes it**, and several were checked both ways.

Two claims from a key-diff of the role-split views turned out wrong on screen (the super view has
its own demographic-field form and its own person editor). They are not in this document. Trust
the screen, then the code, never the diff.

Not covered: the respondent's side, the email bodies, the PDF content, a `company_admin` walked
end to end, mobile widths, and production data (local fixtures may differ — flagged where it matters).

## Status after the fixes — same day, branch `operator-handover-fixes`

Every row below has tests, and every new guarantee a **compiled mutation** that failed exactly its
named test (10 in all: 8 web, 2 server), restored byte-identical afterwards.

| Item | Fixed by | Evidence |
|---|---|---|
| A1 | `canAdministerSurvey` / `administersSurvey()` (survey's own company, never the header) on detail, distribution, questions editor; results admit a super admin with nothing selected; `useFollowCompany` moves the header to the survey's company; results read the **survey's** result bands (they read the header company's — a wrong-classification bug found while fixing A1); the questions editor's library reads the survey's company | `viewerCapabilities`, `useFollowCompany`, `AuthoringNext`, `SurveyLifecycle`, `SurveyResultsTenant` tests; 2 mutations |
| A2 | *Agregar persona* on the super admin's Usuarios; a true empty-company state | `SuperUsersView` tests; mutation |
| A3 | *Enviar código* on a code-less row: `POST …/invitations {userIds:[one]}`, confirmation naming the one recipient and the rule; the bulk confirmation now says it writes to everyone without a code; the chase rule reads the revoke-aware username | `SurveyRosterPanel`, `SurveyDistributionSend` tests; mutation |
| A4 | Setup, not code: full super admin homed in *TIMS International* (decided 2026-11-08) | measured, see A4 |
| B1 | A draft may name its company (`CreateSurveyDraftRequest.CompanyId`): a super admin any existing one, anyone else only their own | 6 integration tests; mutation |
| B2 | Switch *Abrir el enlace antes de la fecha de inicio* (`accessRules.activeOutsideSchedule`, merged field by field) + a warning when that is why the link is shut | `SurveyLinkOpensBeforeStart` tests; mutation |
| B3 | Survey choice on *Nuevo informe* (`filters.surveyIds`, default the latest); Informes names the client | reports tests; mutation |
| B4 | Logo upload: `PUT /admin/companies/{id}/logo` (PNG/JPEG/WebP read off the bytes, ≤ 512 KB) into table `company_logos` (migration `20261108074520_CompanyLogos`, one `CreateTable`), served at `GET /public/company-logos/{id}` (nosniff, sandboxed, year-cached by `?v=`), reached same-origin at `/logos/{id}` through `vercel.json` and the Vite proxy | 5 integration + 2 web tests; mutation |
| B5 | Decided: operators keep the switches; the guide says what they do | guide |
| B6 | A blank *Participantes previstos* stands for the chosen audience, said on the field before it is left blank | `wizardValues` tests; mutation |
| C | Client named on the wizard (every step), Informes, Departamentos; company files buttons follow the header; create-company form (sizes and countries as on the company page, the domain's permanence said) lands in the new company with a *Primeros pasos* checklist; roster *No ha empezado*; sentence-case buttons | page tests; mutation on the landing |

**Not built:** ESPH's 4-column status template (it copies its styles off a third client's workbook that
holds that client's people, and ESPH closes 2026-11-11; a decision for the next client's format, not a
fix), the *Idioma* column on Empresas, the owner company on template cards, and the survey page's
reminder count for per-survey surveys.

**Built later the same day** (second PR, after a ruling on the name column):

| | What | Evidence |
|---|---|---|
| D1 | Status workbook *Formato*: **Avance (formato ESPH)** — *Nombre completo*, *Porcentaje de Avance*, *Observaciones*, whole row coloured, *Total finalizadas* as a written value. **Ruled 2026-11-08: the name stays ONE column** (no guessed Apellidos). `?format=progress` on `GET /admin/companies/{id}/participation/export`; unknown formats refused (400); a survey without per-person state keeps the standard sheet | 6 `StatusWorkbookTests`, 3 `CompanyStatusExportTests`, dialog test |
| D2 | *Idioma* column on Empresas reads `Settings.Language` off `GET /admin/companies` (no audited PUT per row) | `CompanyEndpointsTests`, page test |
| D3 | Template owner: `companyName` on `GET /survey-templates`; the wizard's dropdown reads "Nombre · Empresa" / "· Global", the templates page chip names the company | `SurveyTemplateEndpointsTests`, `templateOwner` tests |
| D4 | Reminder count for per-survey surveys: `summary.keyReminders` (sum of `survey_credentials.reminder_count`) added to the invitations' count on the survey page and the dashboard card | `SurveyCredentialRemindTests`, `launch`/`compose` tests |

## Verdict

**Not yet.** The core is strong — the climate-workbook importer, the six-step survey wizard, the
roster, the person editor, the results page and the company settings page are clear, explain
themselves, and guard the irreversible steps. But three things stop a TIMS operator working alone,
and the first of them breaks the daily routine the operator guide teaches:

1. The distribution page silently drops the roster and every per-person button whenever the
   header company is not the survey's company.
2. A super admin cannot add one person.
3. There is no safe way to give **one** person a code on a live survey.

And one setup step comes before any of it: TIMS operators are full super admins (the ruling, and
confirmed by Federico on 2026-11-08), homed in a **TIMS International** company that production
did not have on 4 Nov — see A4.

---

## A. Handover blockers — fix before TIMS works alone

### A1. Distribution loses the roster, silently, when the header holds another client 🔴

`useDistributionModel.ts:124`:

```ts
const scoped = caps.canAuthorSurveys && scope.status === 'ready' && scope.companyId === survey.companyId
```

For a super admin `scope.companyId` is the **header's company selection**. "Todas las Encuestas"
is platform-wide and says so ("no depende de la selección"), so an operator reaches any client's
survey from it — and the header is very likely to hold a different client, because opening a
company from the Empresas list *sets* it ("Abrir una la convierte en la empresa activa de la
cabecera"). When they differ, `SurveyDistributionNextPage.tsx:384,392` render neither the
participation panel nor the roster, and the send controls go with them.

Seen on survey `01555e27` (Prueba Per Survey):

| Header company | What the Distribution page shows |
|---|---|
| Auditoria UI Cliente Nuevo | "1 personas invitadas"; a 1-row table with **no buttons**; no *Cambiar audiencia*, no *Crear enlace*, no *Enviar códigos*; nothing says why |
| Prueba Per Survey | "3 departamentos · 5 personas"; the full roster with *Enviar recordatorio / Entregar en mano / Retirar el código*, filters, search, *Descargar estado (CSV)*; *Cambiar audiencia*, *Crear enlace*, *Enviar códigos* |

The operator guide's first instruction — *"abra Distribución y busque a la persona… el botón de su
fila ya le dice qué hacer"* — fails exactly here. `useSurveyDetailModel.ts:82` carries the same
gate (it withholds the people list for *Editar audiencia*). The results page does **not** gate on
the header, so the product is inconsistent about it as well.

**Fix (S):** when a super admin opens a survey's pages, scope them to `survey.companyId` (either
treat a super admin as scoped, or move the header to the survey's company on open, as the
Empresas list already does).

### A2. *Agregar persona* is unreachable for a super admin 🔴

`UsersNextPage.tsx:16` renders `SuperUsersView` for a super admin and `AdminUsersView` for
everyone else. `AddPersonForm` is rendered only in `AdminUsersView.tsx:222`; `SuperUsersView.tsx`
has **0** references to it. On screen, a super admin's Usuarios page offers *Importación masiva*
and *Invitar persona* — never *Agregar persona* (one person, mails nothing). The guide lists
"agregar una persona" under what an operator may do during a live survey.

The workaround today is a one-row Excel through *Importación masiva*.

**Fix (S):** render `AddPersonForm` in `SuperUsersView`.

### A3. No safe way to give ONE person a code on a live survey 🔴

On the roster, a person without a code shows *Reenviar credenciales* **disabled** —
"Todavía no tiene código: se le envía con la invitación". The only other control is *Enviar
códigos*, whose confirmation (`es.json` `confirmCodesBody`) has no picker: *"Se enviará un código
por correo a quienes, de estas N personas, todavía no tengan uno."*

On a department-targeted survey that is the 28 Oct incident's shape: ESPH Clima's audience holds
~15 people who are not on ESPH's list, and a bulk send mails them. It is why
`esph-massiel-4nov.sh` existed (it posts `userIds: [ella]`, which the API already accepts —
`surveyDistribution.ts:282`).

**Fix (S–M):** an *Enviar código* button on a code-less row that sends `{ userIds: [id] }`.

### A4. Operator accounts: full super admin, homed in a TIMS company — a setup step, not a build ✅

**Access is settled:** every TIMS operator is a full `super_admin`
(`docs/decisions/tims-operators-hold-super-admin.md`; reaffirmed by Federico 2026-11-08). What
needed measuring was only **how the account is made**, entirely from the screen:

- an invitation needs a company and can never carry `super_admin` (`InvitationEndpoints.cs:59-66, 80`);
- promotion to super admin is a screen action (the person editor's *Rol*) and **keeps** the
  person's company (`UserEndpoints.cs:521-528`); no route can clear a company
  (`UpdateUserRequest` has no company field);
- production had no TIMS company on 4 Nov (only ESPH, Eagle, PROCOMER — measured then, not
  re-queried: production is off limits).

So the guide's recipe works **if** the colleague is invited into a TIMS company — and makes them
a super admin living inside a *client's* tenant if not. Does a super admin who keeps a home
company lose anything against the company-less shape? Measured locally on 2026-11-08 by promoting
`fede.admin@acme.test` (Acme) to `super_admin`, probing, and restoring it:

| Probe | Company-less super admin | Super admin homed in Acme |
|---|---|---|
| `GET /admin/companies` | 200 | 200 |
| `GET /surveys` | 50 surveys, 15 companies | 50 surveys, 15 companies |
| another tenant's participation · its status export | 200 · 200 | 200 · 200 |
| `GET /admin/system-settings` · `GET /audit/logs` | 200 · 200 | 200 · 200 |
| `POST /surveys/drafts` | **400** (B1) | **201** |

Identical reach, and the homed account can autosave a draft. In code, every server read of a
user's own company (`CompanyScope.OwnCompanyId`) sits in the non-super-admin branch
(`SurveyEndpoints.cs:243-247`, `SearchEndpoints.cs:210-215`, `SurveyTemplateEndpoints.cs`), and the
web never falls back to a super admin's own claim (`companyContext.ts:27`).

**The setup, once, from the screen:** Empresas → *Nueva empresa* "TIMS International". The domain
is required and unique (`CompanyEndpoints.cs:57-62, 82-85`); with `timsint.com`, a TIMS address can
self-register into it — as an *employee* of TIMS's own tenant, who sees nothing of any client — and
TIMS could later survey its own staff. Then, per colleague: that company's *Usuarios* → *Invitar
persona* → they accept and set their own password → their record → *Rol: Super administrador*.
Never promote someone who lives in a client's company.

Two edges: a homed operator's drafts are filed under the TIMS company rather than the client
(storage only — *Crear el borrador* still creates the survey in the header's company), and a
template created without a company would default to the TIMS company instead of global
(`SurveyTemplateEndpoints.cs:501`).

---

## B. Wrong or risky — fix soon

| # | Finding | Evidence | Size |
|---|---|---|---|
| B1 | **The wizard cannot save a draft for a company-less super admin** (Federico's production account; not an operator homed per A4, whose drafts save — 201). Step 2 shows *"Tu borrador no se está guardando"* and the raw English *"A user with no company cannot own a survey draft"*. A draft is filed under the **author's** company, not the client's (`SurveyDraftEndpoints.cs:207-215`). Final *Crear el borrador* still works (it posts to the header's company), so only the work in progress is at risk — a refresh loses it | seen; code; measured | M (server + full suite) |
| B2 | **A link/QR survey cannot open before its start date.** `activeOutsideSchedule` exists only in the API type (`surveyDistribution.ts`); no control renders it. Activated with a future start, the link says *"Este enlace no abre ninguna encuesta"* and the start date is frozen (409 `survey_start_frozen`). PROCOMER's demo needed `procomer-demo-qr-abrir-ya.sh` | code; script | S–M |
| B3 | **A shared report covers every survey of the company.** *Nuevo informe* asks title, description, type, format — no survey (`reports.ts:71-78`). The server already takes `filters.surveyIds` (`ReportEndpoints.cs:141-161`). For ESPH that is Clima, Teletrabajo and Contraloría in one document | seen; code | S |
| B4 | **The logo cannot be uploaded.** The *Logotipo · PNG o SVG* tile is a preview: 0 file inputs on the page. The field is a path to a file committed under `web/public/brand/`; a `data:` URI is accepted but capped at 500 characters (`BrandingValidation.cs:31-43, 84-86`). Every new client's logo needs a developer and a deploy | seen; code | L — needs a storage decision (CSP is `img-src 'self' data:`, and the logo also goes into emails) |
| B5 | **Every operator holds the platform-wide switches** — *Configuración del Sistema* can turn off sign-in for everyone but super admins, or turn on maintenance mode. **Decided 2026-11-08: TIMS operators get full super admin, switches included.** What remains is a sentence in the guide saying what those two switches do and that nobody touches them during a live survey | seen | guide |
| B6 | **Participantes previstos is blank by default**, and blank means no participation rate anywhere (EAGLE reads "sin lista de invitados"). Left open by the 28 Oct audit as a product decision; still open | seen | decision, then S |

## C. Confusing — the product is right underneath, the screen does not say so

- **Nothing names the client** on the wizard (all six steps, including *Revisión*), on *Informes*
  (eyebrow "CONFIGURACIÓN DE EMPRESA", and the header switcher disappears on that page), or on
  *Departamentos*. With several clients open in a day, the review step should say *"Para:
  <empresa>"*.
- **Two notions of "the chosen company"** on the surveys list: the header context (where *Nueva
  encuesta* creates) and the table's *Todas las empresas* filter (which gates *Estado de la empresa
  (Excel)* and *Auditoría de envíos*). And survey pages do not follow the survey's company — the
  header said *Auditoria UI Cliente Nuevo* while showing a *Prueba Per Survey* survey.
- **Create company**: no word that *Dominio* is permanent (anyone signing up with it lands in this
  company); *Tamaño* offers raw English codes (`startup`, `small`, `medium`, `large`, `enterprise`)
  where the detail page offers *Emergente … Corporativa*; *País* is free text there and a list here;
  after *Crear empresa* the form just closes — no confirmation, no redirect, no next steps, and the
  new client sits mid-list. The list's *Idioma* column reads *"en el detalle"* for every company.
- **Access mode defaults to one shared account**, and a change *"solo se aplica a las encuestas que
  se creen después"*. ESPH needed per-survey codes; an operator who builds the survey first is
  locked in. A setup checklist after creating a company would catch this, language, time zone,
  departments, demographic fields, people and brand in one place.
- **Templates do not show their owner company**, so the wizard's template list reads
  *"Instrumento de clima estándar (6 dimensiones)"* three times (local data; production may differ).
- **Roster copy contradicts itself**: *"Entró por última vez 19 oct"* beside the status *"No ha
  entrado"* (it means *has not started*).
- **Two audience numbers for one survey**: the detail page *Audiencia 1 · Respuestas 0 de 1*,
  Distribution *3 departamentos · 5 personas*. Possibly a stale stored count in this fixture —
  needs a check against a real survey before calling it a defect.
- ~~Invite dialog shows Tipo and Rol together~~ — **wrong, corrected the same day**: the form already
  hides *Rol* for an admin invitation (`InvitationForm.tsx:59`); the two *Rol* pickers seen belong to
  the email invitation and the shareable link.
- **Empty company, wrong empty state**: Usuarios says *"Nadie coincide con estos filtros"* when there
  are simply no people.
- **Sidebar order follows the mobile tab bar, not the operator's day** (`navSections.ts` comments
  say so): *Todas las Encuestas* is sixth in the workspace group; a client's Usuarios, Informes,
  Analítica and Campos are reachable only from cards on the company page.
- Spanish buttons in English title case: *"Enviar Invitación"*, *"Crear Enlace Compartible"*.
- The survey page's *"Ningún recordatorio enviado todavía"* reads invitation reminders
  (`2026-10-31-frontend-completeness.md` §3) — not re-measured here.

## D. Works well — do not re-audit

- **Importar Excel integral**: one workbook → company settings, fields, people, draft survey; the
  review creates nothing, shows *"Qué se enviará y cuándo"*, expands questions/fields/people, and
  requires an approval checkbox. This is the new-client wizard, and it is good.
- **The survey wizard**: six steps, live respondent preview, *"Nada se envía hasta el último
  paso"*, the access mode explained at step 3, a full review.
- **The survey page**: status with *Programar / Activar / Archivar / Cerrar*, each explained; the
  close confirmation says it cannot be reopened and what a half-done respondent loses.
- **The roster, when scoped**: state filters, search by name/email/username, per-person actions
  with the reminder history, CSV.
- **The person editor**: email change that says it sends nothing, role, department, manager,
  demographics, deactivate, and an account re-send the server guards for per-survey companies
  (`UserEndpoints.cs:56`).
- **Company settings**: language, time zone, access mode, result bands, licences, explained in place.
- **Demographic fields** (super view has its own inline *Nuevo campo* with the threshold warning).
- **Results**: score and trend, critical areas, "dónde mirar primero", PDF and CSV exports.
- **Giving the client its own admin**: *Invitar persona → Tipo: Administrador de empresa*.
- Microclimates, action plans, benchmarks, audit log, system health: clear empty states that say
  what to do next.

## E. Still outside the product

| Operation | Today | Kind |
|---|---|---|
| "Is this person on the client's list?" — the guard every ESPH send since 31 Oct was wrapped in. **Corrected the same day:** for a new client the product already does it — *Personas específicas* takes a pasted list of emails and names those not in the company or inactive (`PeoplePicker`, `matchPaste`), so the audience can BE the client's list; ESPH was department-targeted, which is why its guard lived in Python | `esph-verificar-lista-clima.py` + the `RENAMED` map. All nine ESPH scripts since 31 Oct called routes that **already have buttons**; what they added was this guard. The imported client list is still discarded (`ClimateWorkbookEndpoints.cs` has no `SaveChangesAsync`) | **build (L)** — the biggest safety gap left |
| The daily status in ESPH's 4-column template | `esph-manana.sh` | **decision** (ESPH: one *Nombre* column, or the split with its doubt column) |
| A client's own questionnaire file → questions | `build-instrument-from-workbook.mjs` / `import-question-library.mjs`; UI "deferred deliberately to after 16 Nov" (`question-library-import.md` §8). Workaround: retype into the integral template | build |
| Logo | developer commit | build + decision (B4) |
| Open a link before its start date | script (B2) | build |
| One person's code | script (A3) | build |
| Results in a client's own template; open-text themes | Eagle Python scripts | analysis deliverable, not an operation |
| Exclude a response · delete a person or company · reopen a closed survey | developer | **rulings** (`SurveyStatuses.cs:55` keeps `closed → active` absent on purpose) |

## F. Corrections the operator guide needs (`docs/runbooks/guia-operadores-tims.md`)

1. *"Para dar de alta a un compañero…"* — invite them from **TIMS International's** Usuarios, never
   a client's (A4). Done in the guide on 2026-11-08.
2. *"abra Distribución…"* — until A1 is fixed: **first choose the survey's company in the header**.
3. *"Se puede: … agregar una persona"* — not for a super admin until A2 is fixed.
4. Add: what to do when one person has **no** code (today: ask development — A3).
5. Add: a link/QR survey must be activated on or after its start date (B2).

## Recommended order

0. **A4 setup in production** (Federico, from the screen): create *TIMS International*, invite each
   operator there, promote to *Super administrador*.
1. **A1, A2, A3** — small, admin-only, and they are the guide's daily routine. Safe to ship during
   ESPH's live window (closes 2026-11-11 05:59Z) because no respondent-facing screen changes.
2. **Name the client** on the wizard review, Informes and Departamentos; **B3** report picker;
   **B2** open-before-start switch.
3. **A new-client checklist** after *Crear empresa* (redirect into the company; language, time zone,
   access mode, departments, fields, people, brand, first survey) and the create-form fixes.
4. **B1** draft autosave for operators (server change, full suite).
5. Decisions to take before building: **B4** logo storage, **B6** default for *Participantes
   previstos*, the **4-column** status format, and persisting the **client's list**. (A4 and B5
   were decided 2026-11-08: full super admin, homed in TIMS International.)

## Local state left by this walk

A company *"Auditoria UI Cliente Nuevo"* (`0c403f7e`, domain `auditoria-ui.test`) and a draft
survey *"Auditoria wizard prueba"* (`2a3fee0a`, in Prueba Per Survey) in the **local**
`climate_project` database, which was migrated from `20261020015946_SurveyCredentials` to `main`.
A pre-migration dump was taken first. The climate workbook was uploaded for **review only**; the
import was not confirmed and no *Enviar códigos* was sent (the dialog was cancelled).
