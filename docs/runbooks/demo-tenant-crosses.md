# Seeding a demo tenant whose demographic crosses answer

**Written 2026-10-09**, for the PROCOMER demonstration. This is the runbook for making
`/surveys/:id/results`'s cross panel show something — and for understanding why, on a real
survey, it often correctly shows nothing.

## The problem this solves

The cross panel offers only the fields the unfiltered results payload already lists
(`crossOptions.crossFieldsOf`), and a payload lists a demographic field only when the
collected responses carry values for it. Responses do not invent those values:
`SurveyResponseEndpoints.CaptureDemographicsAsync` copies them from the respondent's stored
`user_demographics` rows at completion.

So a tenant whose people carry no demographic values produces responses with none, every
demographic breakdown is empty, `crossFieldsOf` returns `[]`, and the panel returns `null` —
the feature is not degraded, it is invisible. Departments are unaffected, because a department
is a column on the response rather than a demographic.

**That is exactly the state of the live TIMS survey** `1d8b7e54`, for two independent reasons,
and neither is a defect:

1. It is anonymous and no TIMS department holds 5 people, so
   `SurveyResponsePrivacy.DepartmentFor` stripped the department from all 9 responses **at
   write time**. That is unrecoverable: the value was never stored.
2. Its demographic fields `edad` and `tiempo_de_laborar` are of type `number`. A number never
   splits into cohorts, so it can be collected for ever and still offer no cross.

## Order matters, and it is not recoverable

A response copies demographics **at completion**. A value assigned after a response exists
never reaches it. So the demographics step runs in `--phase company`, before any survey is
answered:

```
node scripts/seed-demo-company.mjs --phase company …   # company, departments, people, DEMOGRAPHICS
node scripts/seed-surveys.mjs …                        # three closed waves + one open
node scripts/seed-demo-company.mjs --phase content …   # plans, microclimate, reports, template
```

Running the demographics step against a tenant that has already answered leaves those
responses blank for ever. Seed a fresh tenant instead — the scripts are idempotent by email
domain, so `--domain` is how you get one.

## Why the numbers are what they are

A cross is answered only when **every** selector survives `SurveyResultsFilter.MayDisclose`,
which runs the breakdown's own complement withholding per selector against the scope the other
selectors define. For `puesto:gerencia + department:D` that is two conditions at once:

- inside D's respondents, every `puesto` cohort is 0 or ≥ 5 — otherwise a cohort of 1–4 is a
  subtractable remainder and `WithholdComplement` withholds the disclosed cohort too; and
- inside `gerencia`, every department cohort is 0 or ≥ 5.

Satisfying one and not the other produces a cross that silently answers nothing, which is why
`seed-demo-company.test.mjs` computes **both** from the profile's own numbers. Lowering a
respondent count fails a test rather than emptying a screen the morning of a demo.

The resulting shape, for `PROFILES.procomer`:

| Department | people | answer | gerencia | colaborador |
|---|---|---|---|---|
| Promoción Comercial | 14 | 12 | 6 | 6 |
| Ventanilla Única de Comercio Exterior | 12 | 10 | 5 | 5 |
| Inversión y Encadenamientos | 12 | 10 | 5 | 5 |
| Servicios Corporativos | 12 | 10 | 5 | 5 |
| Tecnologías de Información | 6 | 5 | **0** | 5 |

Tecnologías de Información carries no `gerencia` on purpose: that one cross comes back
**Protegido**, so the demonstration shows the floor working rather than implying it does not
exist. `antigüedad` behaves the same way by arithmetic rather than by design — its three bands
each clear the floor company-wide, so the field discloses on its own, but a department of 12
split three ways holds no cohort of 5, so crossing it with a department is refused.

## It sends no mail

Not "the addresses cannot receive it" — nothing is attempted. `Notifications.Add` appears in
four API files; in `SurveyDistributionEndpoints` it is confined to `CreateInvitationsAsync`,
`SendRemindersAsync` and `ResendInvitationAsync`, and `MicroclimateEndpoints.ActivateAsync`
adds none. The two seeders call `PUT /{surveyId}/distribution` and never
`POST /{surveyId}/invitations`, so no notification row is written for anyone.

The `.test` domain is the second belt: RFC 2606 reserves it, so an address there cannot resolve
even if a later change did try to send. Override it with `--domain` only knowing that.

## Local

```
cd src/ClimateProject.Api && dotnet run        # API on 5080
node scripts/seed-demo-company.mjs --phase company --profile procomer --domain cruces.test --company-name "PROCOMER — Demostración de cruces"
node scripts/seed-surveys.mjs --profile procomer --email marcela.induni@cruces.test --password 'Demo1234!'
```

## Production

Production writes are Federico's. The commands are the same with `--api` and a super-admin
credential; everything they create is a demo tenant whose name says so.

```
node scripts/seed-demo-company.mjs --phase company --profile procomer \
  --api https://api.climate.timsint.com \
  --superEmail <super-admin email> --superPassword '<password>'
node scripts/seed-surveys.mjs --profile procomer \
  --api https://api.climate.timsint.com \
  --email marcela.induni@procomer.test --password 'Demo1234!'
```

Expect roughly 12 minutes: signup and login are rate limited to 20/min per IP, so the scripts
pace themselves at 3.1s between them — 64 signups and 47 logins is most of the wall clock.

**It creates an ACTIVE survey.** Nobody can reach it without an invitation and none is sent,
but the survey does accept answers, so treat the tenant as visible to anyone who can
administer that company.

## Measured, 2026-10-09

Seeded into a fresh local tenant (`--domain cruces.test`), 56 people, 47 answering each of
three closed waves. Read back from the running API, not inferred:

```
picker offered:  department (5 values) · antiguedad 18/15/14 · puesto colaborador:26 gerencia:21

whole survey                            belonging=3.79  growth=3.72  psych_safety=3.64
puesto:gerencia                         belonging=3.71  growth=3.67  psych_safety=3.57
puesto:colaborador                      belonging=3.85  growth=3.77  psych_safety=3.69
gerencia × Servicios Corporativos       belonging=3.60  growth=3.60  psych_safety=3.60
gerencia × Promoción Comercial          belonging=4.00  growth=4.00  psych_safety=4.00
gerencia × Tecnologías de Información   PROTECTED
antiguedad:5+                           belonging=3.71  growth=3.79  psych_safety=3.57
antiguedad:5+ × Servicios Corporativos  PROTECTED
```

Every prediction the sizing makes held: the four departments carrying 5+ gerencia disclose,
Tecnologías de Información is refused, and `antigüedad` discloses alone but not crossed.

In the browser, the panel lists **Departamento · Años de servicio · Puesto** and the comparison
renders with a signed difference per category and a follow-up button for the cohort.

## Two things the first run exposed

**The open survey has no responses.** `seed-surveys.mjs` creates three CLOSED waves that are
answered and one OPEN survey that nobody has answered yet — correctly, since it is open. Demo
the results from a closed wave (Q3); the open one's results are empty and would look broken.

**The picker had to learn the tenant's own words.** `SurveyBreakdown` carries `Dimension`, the
stored field key, and no label; a demographic segment's `Label` is null because the results
aggregation never joins the option's label. So the panel read `puesto` / `gerencia` where the
company wrote "Puesto" / "Jefaturas y gerencias". It now overlays both from
`GET /admin/demographic-fields`, which resolves them for the reader's locale. Resolving them
server-side into the breakdown would be better and is a `.cs` change — worth doing when
something else takes the API deploy.
