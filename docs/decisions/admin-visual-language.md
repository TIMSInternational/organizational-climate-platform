# Decision: a second visual direction for the admin screens — RULED 2026-09-21

**Status: RULED. Federico chose to apply it to real screens.** He asked on 2026-09-21 for
the UI to be built from a reference site (aaru.com); shown the three options below, he
chose the second — **adopt the primitives on the real screens now.** This file records what
the reference actually contains, what was taken, what was refused, and the risks that were
put to him before he ruled. Owner: Federico.

## What that ruling covers, as built

- The company dashboard's five sections, and a new "Quién respondió" population block.
- Ten-plus screens through `SectionHead` and `Panel` (`org-structure/next/super/parts.tsx`):
  the platform dashboard, departments, company settings, admin users, demographic fields,
  action plans, profile, privacy, survey templates.
- `/dev/signal` stays as the gallery for the language itself.

**Every `<h2 id>` survives.** `SectionRule`'s `labelAs="plain"` passes the caller's real
heading through, because those ids are what `aria-labelledby` and several tests point at.
The rule and the meta are what was added; the heading is still a heading.

**Not covered, and still the approved canvas:** the respond flow, the survey builder, the
results screens, and every artboard in #492. Those were not touched.

## What the reference is, having looked at it

It is two different things, and conflating them is the first mistake available here.

**The marketing site** is a deep electric-blue field, very large geometric sans headlines,
circular photographic lenses floating at varied scale, white pill CTAs, and a near-black
lower half carrying a dotted matrix that stands for a simulated population. It is a brand
statement for an AI-simulation company.

**The product screens it shows** are the opposite: light, near-white, low chrome. A compact
sidebar with tiny grey section labels and a soft pill on the active row; a breadcrumb over a
large, un-bold page title; pill tabs rather than underlines; a two-column card grid where
each card carries a small grey label and a count; grey ordinals down the left of enumerated
lists; a right rail of label → value rows; and **one** small accent-coloured action on the
whole screen.

An admin tool can use the second. The first is a brand, and it is not ours.

## What was taken

`web/src/components/signal/SignalPrimitives.tsx`, shown at `/dev/signal`:

| Primitive | What it is |
|---|---|
| `SectionRule` | eyebrow ——— meta over a hairline, before every band |
| `DisplayPair` | a two-line display, second line dropped to muted ink |
| `PopulationGrid` | one dot per respondent, group by group |
| `ContrastCard` | one thing read two ways, muted left / accented right, one consequence line |
| `FactRail` | label → value rows for the attributes of one thing |
| `OrdinalList` | quiet monospaced ordinals |
| `PillTabs` | pill active state (presentational only — the live tab set stays `ui/tabs.tsx`) |
| `QuietCard` | a card whose header is a label and a count |

Every colour and measure is a token from `styles/tokens.css`, so the set flips with the
theme; both themes are shot and were read.

## What was refused, and why it is not a matter of taste

Not the electric-blue field, the circular lenses, the mark, or a line of the copy. Those are
another company's identity. Putting them on a deliverable for this client would misrepresent
whose product this is, and it is also simply worse work: the client has their own identity
and an approved design.

## `PopulationGrid` found a real privacy trap, and this is the part worth keeping whatever is decided

A dot per respondent **is** the count. Drawing `responses` dots for a group under the floor
of 5 discloses its headcount exactly as surely as printing the number — a reader counts four
dots and knows there are four people. **It would also pass every test this repository has**,
because those check that no *number* is rendered and the leak is in the geometry.

So a withheld band draws a constant seven hatched marks and the word, never `n` marks and
never a count. The group keeps its row and its name, because absent and withheld are
different statements. See `SurveyResultsPrivacy.MinimumRespondents` and the floor rule in
`CLAUDE.md`.

This generalises: **any new visualisation has to be checked for whether its geometry
encodes a suppressed count.** That applies to the existing climate map's hatching too, which
is already correct, and to anything added later.

## The three facts that make this a decision

1. **There is an approved design.** The redesign was built against a multi-artboard canvas,
   with a recorded ruling that every artboard is coded at its real route and matches its PNG.
   **#492 — the last ten artboards — is open and green right now.** A second direction
   supersedes work the client already approved and paid for.
2. **Go-live is 16 November 2026**, eight weeks out. There are 42 routes across five roles.
3. **The remaining risk is not visual.** The open blockers are secret rotation (#70, measured
   NOT STARTED), alerting written but undeployed (#158, zero SNS topics), no staging (#156),
   an untested rollback (#159) and UAT not run (#161). None of those move because a screen
   looks different.

## The options as they were put, and the one chosen

- Keep the approved canvas for 16 Nov; hold this for v2. Lowest risk.
- **← CHOSEN. Adopt selected primitives now.** Additive: the rule and the population grid
  land without redrawing a single artboard, and the population grid says something true
  that no current screen says.
- Full reskin before go-live. Possible and not advisable at eight weeks with the
  operational work outstanding. **Not chosen, and this file is the record that it was not:**
  if a later session finds a screen that does not match the canvas, the answer is that only
  the headers and the dashboard's population block changed.

Ruled 2026-09-21. Reopen by editing this file with a new date, never by editing the above.
