# Onboarding flow and in-app help (#140)

**Status: legacy behaviour ESTABLISHED from the code. RECOMMENDED DROP as a port, awaiting
Federico's sign-off; a fresh, scoped first-run story is the honest replacement if guidance
is wanted before 16 November.**
Written 2026-09-07 against `main` at `42a60436`, from the legacy repository
`TIMSInternational/climate-project` at `main` = `ab3266c` (last updated 2026-08-01, not archived), cloned and grepped whole rather than sampled.

#140's first acceptance criterion is *"Legacy behaviour established, keep/drop decision
recorded."* The 2026-09-05 audit said there was no legacy behaviour to establish because the
legacy *data* does not exist (`no-data-migration.md`). That conflated data with code: the
legacy repository is still readable, and the behaviour is entirely in code. This record
reads it. Every claim below cites a legacy file and line.

## What the legacy onboarding actually was

| Piece | What it did | Where |
|---|---|---|
| `api/onboarding` | Ten actions behind one route: list tours, contextual help by path, search help, user state, start/skip/complete a tour, update help preferences, check an auto-start trigger | `src/app/api/onboarding/route.ts:15-200` |
| `api/onboarding/help/[articleId]` | Read one help article (403 unless the caller's role is in `target_roles`); vote helpful/unhelpful | `route.ts:12-27`, `:49-95` |
| `lib/onboarding-system.ts` | A singleton holding four tours (19 steps), three help articles and three paths of contextual help — **all English, all hard-coded** | `:96-342`, `:344-598`, `:600-692` |
| `OnboardingTour.tsx` | A framer-motion overlay that highlights a DOM target per step and walks Next/Previous/Skip | `:262-403` |

Four things decide the recommendation, and none of them is a matter of taste:

1. **Nothing was persisted.** Tour progress, "onboarding completed" and help preferences
   lived in a module-level `Map` (`onboarding-system.ts:80`, written at `:766`). Article
   view counts and votes mutated an in-memory object (`help/[articleId]/route.ts:73-78`).
   Every restart, and every serverless instance, started every user from zero. The
   product never had "shows once and records completion" (criterion 2); it had "shows
   until the process dies".
2. **The component was never mounted, and could not start itself.** `OnboardingTour` is
   imported by nothing in the legacy tree (`grep -rn OnboardingTour src` at `ab3266c` finds
   only the component file and a same-named interface in `onboarding-system.ts`), and no
   file outside the subsystem calls `api/onboarding`; it renders only when a parent passes a
   `tourId` (`OnboardingTour.tsx:66-70`); the `check_auto_tour` action that would have
   chosen one has no caller. So no legacy user ever saw a tour. The 2026-08-02 triage
   said this; the full-parity reversal the same day did not dispute it, it said "mount it
   somewhere" was added scope.
3. **English only, by construction.** Step titles, article bodies and the overlay's own
   chrome (`Step {n} of {m}`, `Skip Tour`, `Complete`) are literals
   (`OnboardingTour.tsx:297-377`); there is no i18n hook anywhere in the subsystem.
   Criterion 4 ("translated in both languages") is not a port of anything — it is a
   rewrite of all 19 steps and three articles.
4. **Employees were excluded.** No tour targets the `employee` role
   (`onboarding-system.ts:98-341`), so the one population that reaches the product
   through `AcceptInvitationPage` — the entry point #140 itself names — got an empty
   tour list. The two auto-start tours are for `super_admin` and `company_admin`, both of
   whom are seeded, not invited.

Also measured, for whoever reads the legacy code later: the progress percentage divides
completed tours by *available* tours after removing the completed ones
(`onboarding-system.ts:882-925`), so it reports 100% the moment one tour is done; and
`handleNext` returns before advancing on an `action_required` step
(`OnboardingTour.tsx:182-186`), so a tour that navigates is abandoned mid-flow.

## Why "port it" is the wrong shape

The 2026-08-02 ruling — *everything migrates; "no consumer exists today" is not grounds to
skip a feature* — is a rule about not losing working product by attrition. There is no
working product here to lose: no user ever saw the tour, no state ever survived a restart,
and the content is in one language on a bilingual platform. A faithful port would ship a
component nobody mounts, holding English text nobody can translate in place, saving to
nothing.

What the ruling *does* protect is the intent: a first-run experience. That intent is better
served by a new story than by this code, and the audit already classified the same
question — whether the full-parity ruling binds an abstraction with zero consumers — as
`NEEDS-RULING` for #148. This is the same ruling, asked a second time.

## What the product has today, and what a first-run story would need

- `AcceptInvitationPage` (`web/src/features/org-structure/pages/AcceptInvitationPage.tsx`)
  navigates to a role-derived destination on success (`:62`). It is the one place a new
  employee arrives, and nothing greets them there.
- `User.Preferences` (`src/ClimateProject.Domain/Entities/User.cs:67-73`) already holds
  the display preferences and is the one per-user store (`docs/decisions` on #136). An
  `OnboardingCompletedAt` beside it — nullable, set once — is what "shows once and records
  completion" needs, and it is one column, not a subsystem.
- UI strings are bilingual by an absolute test (`web/src/i18n/noHardcodedStrings.test.ts`),
  so any guidance written in this product is bilingual on day one.

If first-run guidance is wanted, file it fresh with this scope: a dismissible, role-aware
panel on the destination `AcceptInvitationPage` lands on; four or five steps per role at
most, written in both languages; completion stored on the user; no help-article system, no
votes, no view counts, no contextual-help-by-path — none of which had a consumer. Do not
port `onboarding-system.ts`.

## What closes #140's criteria

| # | Criterion | Answer |
|---|---|---|
| 1 | Legacy behaviour established, keep/drop decision recorded | Established above; **drop** recommended, decision below |
| 2 | If kept, onboarding shows once and records completion | Not kept. The legacy never did this either |
| 3 | Role-appropriate content | Not kept. The legacy excluded employees |
| 4 | Translated in both languages | Not kept. The legacy was English-only; any replacement is bilingual by the i18n gate |

## Decision

```
Legacy onboarding/help subsystem:  ____  (drop | port, with the four findings above accepted)
Fresh first-run story before 16 Nov:  ____  (yes, file it | no, after go-live | no)
Decided by: ____
Date: ____
```
