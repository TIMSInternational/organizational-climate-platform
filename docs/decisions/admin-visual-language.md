# Decision: a second visual direction for the admin screens — OPEN

**Status: OPEN. Nothing is decided and nothing shipping has changed.** Federico asked on
2026-09-21 for the UI to be built from a reference site (aaru.com). This file records what
the reference actually contains, what was taken, what was refused, and the three facts that
make "apply it to all the pages" a decision rather than a task.

Owner: Federico. The build is at `/dev/signal`, dev-only, linked from nowhere.

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

## The options, as they actually stand

- **Keep the approved canvas for 16 Nov; hold this for v2.** Lowest risk. `/dev/signal`
  costs nothing to keep and is ready when the client wants a refresh.
- **Adopt selected primitives now.** `PopulationGrid` and `SectionRule` are additive and
  could land on one or two screens without disturbing the canvas. The population grid in
  particular says something true that no current screen says.
- **Full reskin before go-live.** Possible and not advisable at eight weeks with the
  operational work outstanding.

Federico decides. This file is updated with the ruling and its date when he does.
