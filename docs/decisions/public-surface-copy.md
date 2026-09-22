# Decision: the public surface says the promise once — RULED 2026-09-22

**Status: RULED.** Federico approved the "La sede" direction and then said the text *"is all
the same."* It was. This file records the measurement, the editorial rule that follows from
it, and the deck the implementation draws from. Owner: Federico.

## The measurement

`es.json` holds **6,141 strings. 89 of them state some version of the privacy promise.**

On the auth surface alone, five keys say it:

| key | |
|---|---|
| `auth.signInAssurance` | "Iniciar sesión solo comprueba que usted fue invitado. Nunca se vincula con las respuestas que da." |
| `auth.next.signInAssurance` | "En las encuestas anónimas, iniciar sesión solo comprueba que usted fue invitado; no se vincula con sus respuestas." |
| `auth.next.registerAssurance` | "En las encuestas anónimas, su cuenta solo comprueba que usted pertenece a su organización; no se vincula con sus respuestas." |
| `auth.next.accept.anonymityNote` | **byte-identical to `registerAssurance`** |
| `auth.next.stageBody` | "Cada respuesta cuenta en el conjunto y ninguna queda ligada a quien la escribió…" |

Five keys, **four distinct wordings, two of them the same bytes.** And the first design pass
made it worse: the stage line and the card's band said the same thing *on the same screen*.

## The rule

**A promise repeated is a promise doubted.** Say it once, in full, at the single moment it
is load-bearing — the instant before someone answers honestly — and on every other screen
say the thing that screen alone can say.

Slightly different wording each time is worse than repetition, because it reads as
imprecision about the one guarantee the product exists to make.

## Where the promise lives, and where it does not

| screen | what only it can say | the promise |
|---|---|---|
| `/login` | which address to use | **none** — a returning person has seen it |
| `/register` | am I eligible, and what do I become | **none** — the band carries ROLE instead |
| `/accept-invitation/:token` | what I am joining | one short line — it is first contact |
| `/s/:token` | which survey, how long, closes when | **the full statement, here** |
| `/auth/inactive` | why, who to ask, is my data gone | **none** — a line about answers is tone-deaf at a dead end |

Eyebrows survive only where they classify something the heading does not: `INVITACIÓN` and
`ENCUESTA` stay, `CLIMA ORGANIZACIONAL` over "Iniciar sesión" and `SU CUENTA` over "Esta
cuenta fue desactivada" are gone.

Measured after the rewrite: **38 distinct user-facing strings across the five screens, and
the only four that repeat are a field label, a password rule on the same field, and a
navigation link.** No repeated prose.

## The deck

English is British (`organisation`), matching the existing catalogue.

### The stage — a different information panel on every page

Two notes shaped this. *"Más profesional, info sobre el software o la empresa"* killed the
per-screen quips ("Le invitaron a unirse. Lleva un minuto.") — they addressed the visitor's
situation rather than telling anyone anything. *"Para cada página, información distinta"*
then killed the single constant panel that replaced them.

So the stage is one **system** — eyebrow, serif lead, a label→value rail — carrying a
**different slice of the software on each page**, chosen for who is standing there.

| page | eyebrow | lead | rail |
|---|---|---|---|
| `/login` | CLIMA ORGANIZACIONAL | Un instrumento de medición de clima laboral para instituciones. | **MIDE** Encuestas de clima por ciclo y microclimas de cinco minutos entre ciclos. · **SIGUE** Planes de acción con fecha, y el avance contra el periodo anterior. |
| `/register` | ACCESO | Cada persona entra con el rol que su organización le asigna. | **ROLES** Empleado, líder, supervisor y administración de empresa. · **ALCANCE** Cada rol ve el nivel que le corresponde: la organización, su equipo o lo suyo. |
| `/accept-invitation/:token` | EL CICLO | La medición es un ciclo, no un evento aislado. | **ENCUESTA** Una medición completa por ciclo, con preguntas agrupadas en dimensiones. · **MICROCLIMA** Pulsos de cinco minutos entre ciclos, para no esperar al siguiente. · **SEGUIMIENTO** Lo que se decide después queda como plan, con fecha. |
| `/s/:token` | CÓMO SE LEE | Su respuesta se suma a un promedio de grupo. | **ESCALA** Cada pregunta define su propia escala y su meta. · **RESULTADO** El promedio del grupo por dimensión, contra el periodo anterior. |
| `/auth/inactive` | ADMINISTRACIÓN | Cada organización administra sus propios accesos. | **QUIÉN** Una persona de su propia organización, no el proveedor de la plataforma. · **QUÉ CAMBIA** Un acceso desactivado deja de entrar; lo ya registrado no se borra. |

The stage never carries the privacy promise. That lives in the card bands only — one line at
the invitation, the full statement at `/s/:token`. Stage says what the software is, card says
what you do here, band says the promise once. No sentence appears twice.

### Three claims that were drafted and cut, because a grep refuted them

This is the part worth keeping. Each of these read as obviously true and was false:

| drafted | refuted by |
|---|---|
| naming the six dimensions (Colaboración, Liderazgo, Seguridad psicológica…) | they live in `dashboard/next/__fixture__.ts`, and `compose.ts:233` calls them *"the Dashboard artboard's columns"* — demo data, not a product constant. Dimensions are configured per company. |
| "de 1 a 5" | `scaleMin`/`scaleMax` travel per question on the payload (`surveys/next/derive.ts:421`); `?? 5` is only a fallback. The scale is per question. |
| action plans "con responsable y fecha" | `useActionPlansListModel.ts:82` — *"No plan has an owner: the entity has no such field (`ActionPlan.cs`). Real, not sample."* `ownerName` is always `null`. Only the date is real. |

An instrument that measures confidentiality cannot introduce itself with three invented
capabilities. Everything that survived is grounded in a route that exists, a field that
exists, or the product's own words (`microclimates.listDescription` is where "cinco minutos"
comes from).

**Still unverified: the operator line.** The artboards carry "Operado por TIMS International
para su organización." **Nothing in this repository names TIMS International** — that string
came from the checkout path, not the product. Confirm the exact legal or brand name, and
whether the operator belongs on a client-facing screen at all, before this ships.

### Bands

| key | es | en |
|---|---|---|
| `auth.register.roleNote` | Entra como **Empleado**. Quien administra su organización puede cambiar su rol. | You join as an **Employee**. Whoever administers your organisation can change your role. |
| `auth.accept.accountNote` | Su cuenta comprueba que pertenece a la organización. **No queda ligada a sus respuestas.** | Your account confirms you belong to the organisation. **It is never tied to your answers.** |
| `respond.anonymityFull` | Sus respuestas se guardan sin su nombre, su cuenta, su dirección IP ni su navegador. Si un dato dejara un grupo con menos de cinco personas, tampoco se guarda. | Your answers are stored without your name, your account, your IP address or your browser. If a detail would leave a group of fewer than five people, it is not stored either. |

### Everything else that changed

| key | es | en |
|---|---|---|
| `auth.register.subtitle` | Necesita un correo del dominio que su organización registró. | You need an email on the domain your organisation registered. |
| `auth.register.emailHelp` | Su organización se reconoce por el dominio. | Your organisation is identified by the domain. |
| `auth.passwordRule` | Ocho caracteres o más, con mayúscula, minúscula y número. | Eight characters or more, with an uppercase letter, a lowercase letter and a number. |
| `auth.accept.subtitle` | Elija una contraseña y queda listo. | Choose a password and you are set. |
| `auth.accept.emailHelp` | Solo si llegó por un enlace compartido. | Only if you arrived by a shared link. |
| `auth.inactive.subtitle` | Quien administra su organización desactivó su acceso. | Whoever administers your organisation turned off your access. |
| `auth.inactive.kept` | Sus datos siguen ahí. Si la reactivan, entra con el mismo correo. | Your data is still there. If they reactivate it, you sign in with the same email. |
| `auth.signIn.noAccount` | ¿No tiene cuenta? | Don't have an account? |

## Keys that stop being used

`auth.signInAssurance`, `auth.next.signInAssurance`, `auth.next.registerAssurance`,
`auth.next.accept.anonymityNote`, `auth.next.stageBody`.

**Leave them in both catalogues for now.** `catalogues.test.ts` enforces exact key parity
and the house rule is additive-never-reordered; `keysExist.test.ts` checks that every key
*used* exists, not that every key is used, so an unreferenced key is harmless. Remove them
in a separate tidy-up once nothing references them, both files in the same commit.

`auth.signInAssurance` is already only reachable from `LoginPage.tsx`, which **no route
renders** — every auth route resolves to the `next/` component.

## Two changes that are product decisions, not styling

- **Required/optional is inverted.** Every field carries a red asterisk today. Only the one
  genuinely optional field is now marked `opcional`; the rest are unmarked. This is the
  accessible convention and it removes red from the form entirely, which matters now that
  red means destructive (`palette-navy-not-purple.md`).
- **The invitation's email helper was two sentences and is now one.** It lost *"Una
  invitación personal ya trae su dirección"*, which restated what the `opcional` chip says.
