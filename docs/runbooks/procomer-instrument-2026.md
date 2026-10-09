# Loading PROCOMER's 2026 instrument

Written 2026-10-08, the day Diego Molina sent the final statements ("según lo solicitado
comparto la lista de enunciados finales de nuestro lado. Por favor considerar estas para el
DEMO"). It records what the file says, what the product does with it, and the two things a
person still has to decide. The general procedure is
[`question-library-import.md`](question-library-import.md); this file is the PROCOMER half of it.

## The source, pinned

| | |
|---|---|
| File | `PROCOMER 2026 ENCUESTA 57 ITEMS ENFOQUE ESTRATEGICO - FINAL 08102026.xlsx` |
| Committed as | `scripts/fixtures/procomer-2026-instrument.xlsx` (byte-identical) |
| sha256 | `097be9f5972472a21d62b94f80b92a9ccdf21c0f3c89baa5ab0518125618a925` |
| Sheet | `58 ITEMS FINAL`, header on row 4 |
| Wording column | **Q, "Versión Final para TIMS"** |

**Column Q, and only column Q.** The sheet carries four wording columns — `D` Enunciado
Estratégico, `E` Nueva Propuesta, `J` Enunciado Final Recomendado, `M` Enunciado después de
los 2 filtros — plus `P` Comentarios Marco Alfaro. `Q` is the last review round: it is non-blank
on all 59 rows, it equals `P` on the seven rows where Marco Alfaro proposed a rewrite rather
than writing "Aprobado" (items 18, 21, 46, 47, 48, 51, 52), and it equals `M` elsewhere.
`scripts/build-instrument-from-workbook.mjs` finds it by **header text, never by letter**, and
refuses to run if `--text-header` matches zero or more than one column — because the failure
mode of a hardcoded `Q` is silent: the import succeeds carrying an earlier review round.

## 57, 58 or 59?

All three numbers are in the client's own file, and the content settles it:

- the file name says **57** — that is the count of numbered items, `1`…`57`, none missing, none repeated;
- the sheet is named `58 ITEMS FINAL` and cell A1 says `58 PREGUNTAS DEFINITIVAS`;
- the sheet actually holds **59 statements**: the 57 numbered ones plus `VAL1` and `VAL2`,
  two "Validación" items about whether the respondent trusts the process.

The two validation items are asked exactly like the rest (Likert 1-5, approved, with a Tema and
a Dimensión), so all 59 are loaded. A respondent sees **59 questions**. If PROCOMER means 57 on
screen, the two validation items are what to drop — say so before the demo, not after.

## What the 59 are

| Tema | Items |
|---|---|
| Validación | 2 |
| I. Liderazgo y Gestión | 7 |
| II. Cultura, Valores y Propósito | 6 |
| III. Comunicación y Estrategia | 6 |
| IV. Ambiente y Bienestar | 5 |
| V. Trabajo en Equipo | 5 |
| VI. Desarrollo Continuo | 6 |
| VII. Compensación y Beneficios | 3 |
| VIII. Procesos y Claridad | 3 |
| IX. Seguridad Psicológica | 4 |
| X. Orientación al Cliente | 5 |
| XI. Diversidad, Equidad e Inclusión | 5 |
| Especiales | 2 |

57 Likert 1-5, one eNPS and one open question. The Tema becomes the question's `category`,
which is what the results screens group by; the Dimensión is carried on the library item.

**eNPS is a `rating` scored 0-10, not an eleven-option `multiple_choice`.** Only
`QuestionTypes.NumericScale` (likert, rating) gets a mean and a median out of
`SurveyAggregation.NumericStats`; an eNPS whose answers cannot be averaged is a question nobody
can report on. `SurveyAnswerValidation.ValidateChoice` falls back to the question's own
`scaleMin`/`scaleMax` when no option set is configured, so 0..10 validates.

## The two rulings

**Scale anchors — agreement, ruled by Federico 2026-10-08.** The file specifies only
"Likert 1-5" and supplies no anchor words in any language. Every statement is worded as an
agreement claim, so the ends read **"Totalmente en desacuerdo" / "Totalmente de acuerdo"**. The
alternative considered was TIMS's own shipped frequency scale (Nunca…Siempre,
`scripts/fixtures/climate-workbook.template.xlsx`), which reads wrong on items like "Me veo
trabajando en PROCOMER en los próximos años". eNPS gets "Nada probable" / "Totalmente probable".

**Ownership — company-owned, ruled by Federico 2026-10-08.** See
[`docs/decisions/procomer-instrument-load-path.md`](../decisions/procomer-instrument-load-path.md).
`CompanyId` is immutable after creation, so this one is permanent.

## English is a copy of the Spanish, deliberately

`/admin/question-library` refuses a blank `TextEn` — a half-translated tree renders blank for
one audience. No approved English wording of these statements exists: the Spanish is what
PROCOMER's COE reviewed, twice, word by word. So the Spanish is copied into both columns, the
same thing `import-climate-workbook.mjs`'s `both()` already does for TIMS's own instrument, and
a translation can be added later through `/admin/question-library`. The **survey** is created
`language: 'es'` with bare Spanish strings, so nothing there claims an English version exists.
Only the scale anchors get real English, because nobody supplied those in any language either.

## Run it

```sh
# 1. Rebuild the instrument from the workbook (only needed if the workbook changes).
node scripts/build-instrument-from-workbook.mjs \
  --file scripts/fixtures/procomer-2026-instrument.xlsx \
  --out  scripts/fixtures/procomer-2026-instrument.json \
  --instrument "PROCOMER — Clima Organizacional 2026 (57 ítems + 2 de validación)"

# 2. Load it into the question library, company-owned. Dry run first.
node scripts/import-question-library.mjs \
  --file scripts/fixtures/procomer-2026-instrument.json \
  --company-id <PROCOMER's guid> --email <super_admin> --password <…> --dry-run
node scripts/import-question-library.mjs \
  --file scripts/fixtures/procomer-2026-instrument.json \
  --company-id <PROCOMER's guid> --email <super_admin> --password <…>

# 3. Create the survey DRAFT from the same file. Dry run first (no --apply).
node scripts/create-survey-from-instrument.mjs \
  --file scripts/fixtures/procomer-2026-instrument.json \
  --company-id <PROCOMER's guid> \
  --title "Encuesta de Clima Organizacional PROCOMER 2026" \
  --start 2026-11-03 --end 2026-11-21 \
  --email <super_admin> --password <…> --apply
```

Add `--api https://api.climate.timsint.com` for production. **Production is run by a person,
not an agent** (CLAUDE.md). Neither script sends email and neither can publish a survey: the
importer only writes library rows, and the survey script never calls
`PUT /surveys/{id}/status`.

**Both are idempotent.** A second library run reports `0 created`; a second survey run finds the
survey by title and creates nothing. Both verify by reading back and comparing every row.

`--start`/`--end` are Costa Rica days (opens 08:00 on the first, closes 23:59 on the last,
UTC-6). Without them the draft opens a week out for three weeks — a placeholder, not a decision.

## What it decides, and what it leaves to a person

- **The survey is a draft.** Review it, then **Programar** — not Activar: a scheduled survey
  opens itself at its start date, an active one accepts answers at once whatever its dates.
- **Anonymous, with randomisation on.** `randomizeQuestions: true` carries both commitments
  from the 12 Aug minuta at once: the questions are asked in a random order AND the dimension is
  not shown, because `respondDimensions.ts` stops sectioning a randomised survey entirely.
  Override with `--randomize false` / `--anonymous false`.
- **Invitations, the audience and the schedule are untouched.** PROCOMER agreed each person gets
  their own link; that is "Enviar invitaciones" on a scheduled survey and it **emails real
  people**.
- **Unmetered.** No `--service-type`, so the survey spends no licence seats
  (`project_company_service_licenses`). Pass one if this survey is to be metered.

## Measured on the local stack, 2026-10-08

Against `PROCOMER — Demostración` (`procomer.test`, 43 users, 5 nodos of 12/9/8/7/6 — all above the floor of 5, so every one of them can appear in a breakdown):

- library: **72 rows created** (13 categories + 59 items); second run `0 created`; verify clean.
- survey: **59 questions**, every statement, type, scale, anchor and theme matching the
  instrument; second run created nothing.
- the respond screen reports **"59 preguntas, una a la vez. Unos 39 minutos."**
- the first question shown was item 19, not VAL1, and **no theme or dimension appeared anywhere**
  — randomisation and the hidden dimension both confirmed on screen.
- the 1-5 segments render with the agreement anchors under the ends.

## Five things to say to the client before the demo

1. **The eNPS scale does not fit a phone.** `SegmentedScale` was designed for five points; at
   eleven its row has a fixed minimum width of **459px** and does not shrink. Measured overflow:
   **+139px at 320px, +69px at 390px, +45px at 414px**, with no clipping ancestor — so on a
   phone **"9" and "10" sit off the right edge** until the respondent scrolls sideways. Those
   two are exactly the promoter scores, so the eNPS would read low for reasons that have nothing
   to do with PROCOMER. The 1-5 rows shrink correctly and are unaffected. Fixing it is a change
   to a shared primitive (wrap the row, or shrink the targets toward the 24px WCAG floor the
   component's own argument rejects) and has not been made.
2. **Nobody will ever read the answers to item 57.** Verbatim open text is never returned — not
   on a screen, not in the CSV, not in the PDF; the results surface gives word frequencies only,
   and `SurveyExport` refuses the raw-response export by name (#122). An open question that
   invites a written comment and then shows a word cloud is a conversation to have now.
3. **A nodo with fewer than 5 people will never appear in a breakdown.** On an anonymous survey
   `SurveyResponsePrivacy.DepartmentFor` records the department only when its company headcount
   is at least 5; below that the response is stored with no department at all. Diego still owes
   the real organisational structure — this is the constraint to give him before he fixes it.
4. **Resume works per browser, not per person.** With anonymous storage the part-finished
   response is found again by the client's session id, not a user id, so switching device or
   clearing storage starts over, and the server cannot refuse a second submission from a new
   session. That is the price of the confidentiality promise, and VAL1 asks respondents about
   exactly that promise.
5. **Three spelling slips were loaded as received**, because following the file identically
   means not quietly correcting wording the client approved: item 7 "la **informacion**
   necesaria", item 54 "de la **organizacion**", item 57 "¿Hay **algun** comentario". Items 46,
   47 and 48 also end without a full stop while the other 56 do not. One word from Audrey and
   they can be fixed in `/admin/question-library` or in the sheet and re-imported.

Worth a separate look, not a defect: items **30, 31 and 32** are three near-identical
development statements ("me proporciona herramientas" / "me brinda recursos" / "las condiciones
de trabajo favorecen"), and **46 and 47** both ask about clarity on client needs. They survived
two review rounds, so they are loaded as written.
