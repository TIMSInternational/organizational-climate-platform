# Setting up a company's climate from the workbook

Written 2026-10-01. The client fills one Excel workbook — description, scales, questions and
people — and `scripts/import-climate-workbook.mjs` turns it into the company, its demographic
fields, its people (as invitations, with their demographics) and the survey as a **draft**,
each through the endpoint the UI calls. The first workbook was TIMS International's own
("Clima Organizacional TIMS 2026.xlsx", 15 people, 9 dimensions); it was imported into the
**local** stack on 2026-10-01. It has never been run against production.

## The form to hand a company

`scripts/fixtures/climate-workbook.template.xlsx` — the TIMS workbook with its people and its
two texts emptied, the formatting and the logo untouched (621 cells compared, 0 differences),
and every mention of TIMS in the questions replaced by `[Empresa]`. It contains no personal
data: no name, email, domain or author survives anywhere in the package.

| Sheet | What the company fills |
|---|---|
| DESCRIPCION | B6 the survey's description; B10 the invitation, first line `Asunto: …` |
| ESCALAS | the result bands (name, min, max, the Color cell's fill) and the answer scale (label, value) |
| PREGUNTAS | under each dimension title (a filled cell), its statements; "Preguntas abiertas" holds the open ones |
| DEMOGRAFICOS | one person per row from row 6: Nombre, Apellido, Correo, Puesto, then any demographic columns, and Área / Departamento |

A demographic column is created as a **list** when its values are words and as a **number**
when every value is a number. **A number field never splits results** — the product says so
("No divide resultados"). To break results down by age or tenure, write ranges in the
workbook ("18–29", "30–44", "45+") so the column becomes a list.

## Run it

```sh
# 1. Dry run: reads the workbook, lists every problem at once, prints what it would create.
node scripts/import-climate-workbook.mjs --file "<workbook>.xlsx" \
  --company-name "TIMS International" --domain timsinternational.net

# 2. Apply.
node scripts/import-climate-workbook.mjs --file "<workbook>.xlsx" \
  --company-name "TIMS International" --domain timsinternational.net --apply
```

`--api` (default `http://127.0.0.1:5080`), `--email` / `--password` (default the local
super_admin), `--company-id` instead of name+domain for an existing company, `--title` for the
survey (default `Clima Organizacional <company> <year>`).

**Re-running is safe.** The company is matched by domain or name, a field by its key, a person
by email (already invited or registered → left as they are), the survey by title. A second run
creates nothing.

**Production** is run by a person, not an agent (CLAUDE.md, "Production is off limits"): the
same command with `--api https://api.climate.timsint.com` and a production super_admin's
credentials. Production sends invitation emails when invitations are created — read the
invitation text in the dry run first.

## What it decides, and what it leaves to a person

- **Roles.** The workbook has no role column. A Puesto naming a director, manager, president or
  head (`director/a`, `gerente`, `presidente/a`, `jefe/a`) is invited as `leader`; everyone
  else as `employee`. The import cannot create a `company_admin`: promote one in Usuarios.
- **The survey is a draft.** Dates default to a week from now for three weeks. Review it, set
  the dates, create its distribution, and launch it in the product.
- **Anonymous.** The workbook's description promises confidentiality, so the survey is created
  anonymous. An anonymous survey stays on a person's list after they answer (it does not know
  who answered — `SurveyQueries.AssignedTo`).
- **Names** are sent, but an invitation keeps no name; a person's name appears when they register.
- **The result bands are read and validated but not applied**: the product has no band
  setting yet — results are coloured against the fixed `CLIMATE_TARGET` of 3,7
  (`web/src/features/dashboard/next/compose.ts:78`). Building the bands is the next piece of work.

## The floor of 5, measured on TIMS

15 people, so no department ever shows a number (the largest, Gerencia, has 4). The product's
own Campos demográficos screen reports **0 of 5 usable cuts**: Región, País and Género are
"Demasiado estrecho", Edad and Tiempo are numbers. Results are readable for the whole company,
and — only if nearly everyone answers — for Colombia (8), Centroamérica (6) and each gender. Say
so before launch: it is the product protecting fifteen people, not a fault.
