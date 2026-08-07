# `surveys/templates/seed` is dev-only and is NOT migrated

Decided while implementing #107 (survey template endpoints). Recorded here rather than
silently omitted, so the audit that #149 will run finds an answer instead of a gap.

## What the legacy route did

`POST surveys/templates/seed` inserted a hardcoded set of "system" survey templates —
rows with no owning company, i.e. rows visible to every tenant.

## Classification

**Dev-only scaffolding. Not migrated. No replacement route.**

## Why

1. **The capability is not lost; only the hardcoded blob is.** A super-admin can create a
   global template with `POST /survey-templates` and `"companyId": null`, questions and
   all. `seed` adds no ability the migrated surface lacks — it only supplies content.

2. **The content is not ours to invent.** Since #195 every template question carries
   `text_en` *and* `text_es`, and every option carries a stable, locale-independent
   `value`. That `value` is what `question_responses.response_value` stores and what all
   aggregation joins on. Baking a guessed instrument into the codebase would push those
   values into every tenant's baseline, and a wrong one cannot be corrected by an update
   afterwards: responses already reference it, so a change splits the series in two with
   no error and reconciling row counts. Instrument text belongs to the product owner and
   should arrive through #154's loader or a reviewed admin action, not a literal in C#.

3. **A standing mass-insert route into globally visible rows is a multi-tenant write
   surface.** #207 closed a live hole of exactly that shape. `POST /survey-templates`
   creates one reviewed row per call under `CanWriteTemplate`; a seed route creates many
   with no per-row intent.

4. **There is no seeding infrastructure to hang it on.** `src/` contains no seeder, no
   idempotency key, and no source of record for template content. Building all three for
   one route is scope nobody asked for, and doing it badly (a non-idempotent seed) makes
   duplicate global templates that every tenant then sees.

## If it is ever wanted as a real operation

It should be a deployment-time data load with the instrument text held as reviewed data,
idempotent on a natural key, and *not* an authenticated HTTP route that any super-admin
session can fire twice.
