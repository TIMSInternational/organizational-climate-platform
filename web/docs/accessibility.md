# Accessibility

The target this front end is built to, how it is measured, and what was measured.
Written for #83; the constants it quotes live in `src/test/a11y.ts`, and
`src/test/a11y.test.ts` fails the build if this file and that module ever disagree.

## Target

**WCAG 2.1, level AA.**

PROCOMER is a Costa Rican public institution, and AA is the level public-sector
procurement asks for. It is also what the client's §7 describes in substance: staff
with 30+ years' tenure and low digital literacy, reading reports that get printed in
greyscale, for whom the semáforo (traffic light) is the primary signal. So the
load-bearing criteria here are 1.4.1 Use of Colour, 1.4.3 Contrast (Minimum), 1.4.11
Non-text Contrast, 2.1.1 Keyboard, 2.1.2 No Keyboard Trap and 2.4.7 Focus Visible —
not an abstract checklist.

**AAA is deliberately not claimed.** Its 7:1 floor would forbid the 13px shell this product's
density depends on, and a level claimed and not met is worse than a level met.

In axe-core's vocabulary the scope is the tags `wcag2a`, `wcag2aa`, `wcag21a`,
`wcag21aa`. The 2.0 tags are included because 2.1 subsumes 2.0 — dropping either
would leave `image-alt`, `label` and `button-name` unchecked under a heading that
still said "2.1 AA".

## How it is measured

Everything below runs inside `npm test`, so a regression fails CI rather than waiting
for somebody to look at a screen.

| What | Where | What it would catch |
|---|---|---|
| axe over every `ui/` primitive, in Spanish | `src/components/ui/a11y.axe.test.tsx` | an unnamed control, a mislabelled field, a broken ARIA relationship |
| axe over the app shell, rail expanded / collapsed / group open | `src/app/shellKeyboard.test.tsx` | the same, on the chrome every page is rendered inside |
| keyboard-only walkthrough of the shell | `src/app/shellKeyboard.test.tsx` | a destination no Tab stop reaches; a collapsed rail row with no accessible name |
| Tab reaches and activates every interactive primitive | `src/components/ui/keyboardOperable.test.tsx` | a control out of the tab order, or one that focuses but does nothing |
| no module suppresses the focus outline | `src/components/ui/keyboardOperable.test.tsx` | `outline-none` / `outline: none` deleting the app's only focus indicator |
| dialog focus trap | `src/components/ui/focusTrap.test.tsx` | focus escaping a modal into the `aria-hidden` page behind it |
| axe over the semáforo, plus its accessible names | `src/features/tracking/semaforoA11y.test.tsx` | a state announced by wire value instead of its Spanish word; an unnamed counts strip |
| base ink × surface contrast, both themes | `src/styles/inkContrast.test.ts` | a text token repainted below 4.5:1 |
| focus-ring contrast, both themes | `src/styles/inkContrast.test.ts` | a ring that disappears against a surface, or a 0px ring |
| accent / badge / chip / heatmap / shell contrast | the six suites already in `src/styles/` and `src/features/` | a family-specific pairing going below AA |

Two rules are deliberately **not** enforced by axe here:

- **`color-contrast`** is disabled. The Vitest environment is happy-dom, which has no
  layout or cascade engine; axe reports the rule *incomplete* rather than passing
  there, so leaving it on would imply a check that never ran. Contrast is measured
  against `src/styles/tokens.css` directly instead — the table below.
- **`aria-hidden-focus`** still runs, but two selectors are excluded from the scan:
  `[data-radix-focus-guard]` and `[data-aria-hidden]`. Those are the sentinels a Radix
  focus trap uses and the page it hides behind an open modal. A guard with
  `tabindex="-1"` — axe's suggested repair — would not catch a Tab, and the trap would
  leak. The exclusion is only sound while the trap works, so the trap is tested:
  `focusTrap.test.tsx` drives Tab and Shift+Tab around an open dialog, requires focus
  to stay inside, and requires Escape to give the page back.

## Token contrast, measured

Read off `src/styles/tokens.css` on 2026-08-25. Every ink is measured against every
ground it can print on, and the binding case is shown. The grounds are the six opaque
surfaces `--admin-bg-{outer,panel,card,card-hover,input,icon-box}` **plus the four the
design system's own state layers make out of them**: `--admin-bg-hover` and
`--admin-bg-active` are `rgba()` tints, and `ui/table.tsx` paints them on every
`TableRow`, `ui/dropdown-menu.tsx` and `ui/select.tsx` on the highlighted item, and
`CommandPalette` on the selected row. A tint has no colour of its own but the pixel
does — the alpha and the surface under it are constants in the same file — so
`inkContrast.test.ts` composites them and measures there too. That is where the
binding case now is for every ink in the table.

### Text inks — WCAG 1.4.3, 4.5:1

Every string in this product is under 18.66px (the shell body is 13px, an eyebrow
10px), so the large-text allowance never applies.

| Token | Light | worst | Dark | worst | Carries |
|---|---|---|---|---|---|
| `--admin-font-primary` | `#0d1626` | 15.19:1 | `#eef3f9` | 9.86:1 | headings, table cells, a filled input |
| `--admin-font-secondary` | `#44536b` | 6.54:1 | `#a8b6c9` | 5.34:1 | body copy, nav row labels |
| `--admin-font-tertiary` | `#5d6b7f` | 4.55:1 | `#99a7bd` | 4.51:1 | card/dialog descriptions, captions, breadcrumbs, placeholders |
| `--admin-font-section-label` | `#5d6b7f` | 4.55:1 | `#99a7bd` | 4.51:1 | 10px uppercase eyebrows, rail and ⌘K palette group headings |
| `--admin-font-on-accent` | `#ffffff` | 5.47:1 | `#ffffff` | 5.47:1 | text on `--admin-accent-blue-fill` only (see `accentContrast.test.ts`) |

The last three rows are **repairs made under #83**, and they are the reason the issue
says a token that fails contrast fails everywhere at once:

| Token | was | measured | now | Call sites affected |
|---|---|---|---|---|
| `--admin-font-tertiary` (light) | `#78879c` | **3.66:1** on white | `#637287` | 144 |
| `--admin-font-tertiary` (dark) | `#74839a` | **3.46:1** on `bg-card-hover` | `#8b97ab` | 144 |
| `--admin-font-section-label` (light) | `#9aa7b9` | **2.44:1** on white | `#637287` | 14 |
| `--admin-font-section-label` (dark) | `#5d6b80` | **2.46:1** on `bg-card-hover` | `#8b97ab` | 14 |

…and then a second time, when the matrix learned to composite the state layers and the
first repair turned out to have cleared the opaque grounds by about 1% and lost it on
the row underneath:

| Token | was | measured | now |
|---|---|---|---|
| `--admin-font-tertiary` (light) | `#637287` | **4.11:1** on `bg-active` over white (#ebebeb), 4.49:1 on `bg-hover` (#f5f5f5) | `#5d6b7f` |
| `--admin-font-tertiary` (dark) | `#8b97ab` | **3.72:1** on `bg-active` over `bg-card` (#343d49) | `#99a7bd` |
| `--admin-font-light` (light) | `#8090a7` | **2.72:1** on `bg-active` over white | `#79889e` |
| `--admin-font-light` (dark) | `#697990` | **2.48:1** on `bg-active` over `bg-card` | `#7587a0` |

The 4.49:1 case is not hypothetical: it was measured live in Chromium on the ⌘K
palette's ESC chip and on the description line of the selected row. The dark case is
reachable because four files render a `<Table>` inside a `<Card>`
(`ConsentRecordPanel`, `ProfileActivityList`, `DataAccessPanel`, `QuestionResultCard`).

The new values are the lightest hue- and chroma-matched greys that clear 4.5:1 on the
darkest ground they print on, so the ramp moves as little as it can.

### Non-text ink — WCAG 1.4.11, 3:1

| Token | Light | worst | Dark | worst | Carries |
|---|---|---|---|---|---|
| `--admin-font-light` | `#79889e` | 3.02:1 | `#7587a0` | 3.00:1 | the inactive sort glyph; the calendar's outside-month (disabled) days; the two `:disabled` rules in `index.css` |

This is the only ink held to 3:1, and it is defensible only while nothing it paints is
text. `inkContrast.test.ts` sweeps `src/` and fails if `text-fg-light` appears outside
those two files — **and sweeps the stylesheets too**, where it allows the token to
paint text only from a `:disabled` selector, the one category 1.4.3 exempts by name.
That second sweep is there because the first one could not see `index.css`:
`.nav-section-title` painted with this ink, and `CommandPalette` renders the ⌘K
palette's group headings with that class outside `.on-shell`, so they printed at
**3.25:1** in light and 3.94:1 in dark — the palest text on the screen. The class now
uses `--admin-font-section-label`. Placeholders used to wear it — a placeholder *is* text — and were
moved to `--admin-font-tertiary` under #83, along with the notification timestamp and
the ⌘K hint.

### Focus indicator — WCAG 1.4.11 and 2.4.7

`--admin-focus-ring` is `--admin-accent-blue` `#0d9488`, drawn 2px solid with a 2px
offset by the single `:focus-visible` rule in `src/index.css`. Worst case 3.14:1 in
light and 4.42:1 in dark, both on `--admin-bg-active` over a surface — above the 3:1
floor on every ground, in both themes.

Nothing suppresses that ring, and this is checked three ways, because one was not
enough. `keyboardOperable.test.tsx` blocks `outline-none` / `outline-0` /
`outline: none` **and `outline-hidden`, which is Tailwind v4's spelling of the same
thing** — this project is on v4, and four primitives (`tabs`, `popover`,
`dropdown-menu`, `select`) were shipping it while the sweep was green. It then
enumerates every `outline-*` utility in the app against a four-entry reviewed
allowlist, so the next rename does not need the blocklist to have heard of it. And it
sweeps the stylesheets, which the component walk never read — a rule in
`@layer components` outranks `:focus-visible` in `@layer base`, so three lines of CSS
could take the ring off every button and link in the product.

`CommandPalette`'s search field carried the last `outline-none` and was repaired under
#83; the four `outline-hidden` primitives were repaired in the same issue.

### One pairing that is not a token pair

`.on-shell` re-points the ink tokens at the navy palette for the rail and the top
strip. The base element layer paints every `input`/`select`/`textarea` with
`color: var(--admin-font-primary)` on `background: var(--admin-bg-input)` — and until
#83 that rule re-pointed the ink but not the ground. The one form control that lives
in the chrome, `CompanyContextSwitcher` (the SuperAdmin's tenant selector), therefore
printed `#eef3f9` on `#ffffff` in the light theme: **1.12:1**. It is now on
`--admin-shell-bg-raised`, at 10.46:1 in light and 11.93:1 in dark, and
`inkContrast.test.ts` reads the rule rather than the tokens so the guard cannot go
stale.

The collapsed rail's flyout was the same defect one component away, and the reason the
guard is no longer a single named pairing. `RoleBasedNav` paints the flyout — the ONLY
route to a group's children while the rail is collapsed — and it painted itself with
`--admin-bg-panel`, a ground `.on-shell` does not re-point. In light theme it printed
`--admin-shell-font` `#c8d8ec` on `#ffffff`: **1.45:1** for the links and 2.15:1 for
the heading, measured live in Chromium at /dashboard. It now paints
`--admin-bg-overlay`, which `.on-shell` re-points to the raised navy (8.05:1 / 5.43:1
in light, 9.18:1 / 5.13:1 in dark). `inkContrast.test.ts` now reads the chrome's
components out of `AdminLayout` — whatever it renders inside an element carrying
`on-shell` — and requires every `--admin-bg-*` token they paint to be re-pointed by
that rule, so the class of defect is covered rather than the two instances.

### Deliberately out of scope

`--admin-chart-axis` (`#9aa7b9` light, `#74839a` dark) is 2.44:1 and 3.46:1 against
the panel. Chart gridlines and axis rules are decorative under 1.4.11 while every
value they scale is separately labelled, which it is in every chart here — the
diverging and sequential ramps carry their own paired inks, measured in
`divInkContrast.test.ts` and `seqInkContrast.test.ts`. Recorded so it is a known
number rather than an oversight.

`--admin-accent-blue` set as a **link** is the other one, and it is a real gap rather
than a decorative exemption. `index.css` gives every bare `<a>` `color:
var(--admin-accent-blue)`, which measures **3.74:1** on white and 3.43:1 on a hovered
row (measured live in Chromium at /admin/companies, where each company name is such a
link); dark is fine at 7.02:1. The token clears the 3:1 its identity role asks, and
the house pattern for an accent set as text is the separate `--admin-accent-*-ink`
step — there is no `--admin-accent-blue-ink` yet, and adding one touches 83
`text-accent-*` call sites plus the base `a` rule, which is a slice of its own. It is
recorded here with its number so the next person starts from a measurement.

## Colour is never the only signal

The client's §7 audience reads printed greyscale reports, so the semáforo carries
three things and colour is the third:

| State | Silhouette | Word | Tone |
|---|---|---|---|
| Rojo | octagon | Atrasado | critical |
| Amarillo | triangle | En riesgo | warning |
| Verde | circle | Al día | good |

One table (`src/features/tracking/semaforo.ts`), one component
(`SemaforoChip`), and `semaforoTable.test.ts` fails if a second icon map appears.
The glyph is `aria-hidden` and the word is the accessible name, so a reader hears
"Atrasado" once rather than hearing a shape described at it; `semaforoA11y.test.tsx`
pins that, and pins the counts strip being a *named* list rather than four bare
numbers.
`ui/chip.tsx` makes the rule structural for every status chip in the product: `label`
is a required `string` and there is no icon-only form, so a chip that carries colour
alone is unspellable. A state this build has never seen renders neutral with a
question mark and the raw wire value, rather than being mapped to whichever branch
happened to be the default.

## Keyboard

- The skip link is the first focusable element in the document and targets the
  `<main>` that holds the routed page.
- Every rail destination is reachable by Tab with the rail expanded.
- With the rail collapsed to 52px, every row still has an accessible name (there is no
  visible text to take one from), and a grouped row's children — which are not
  rendered in the rail at all — open in a flyout on **focus**, not only on hover, and
  close on Escape without moving focus.
- An open dialog traps Tab and Shift+Tab, and Escape releases it.

All of the above are assertions in `src/app/shellKeyboard.test.tsx` and
`src/components/ui/focusTrap.test.tsx`, driven through `@testing-library/user-event`
in Spanish. They are scoped to the `<aside>` rail on purpose: `MobileNav` renders a
second navigation into the same document, hidden by `md:hidden`, and happy-dom has no
layout engine to honour that — an unscoped assertion would be satisfied by the phone
bar while the rail was empty.

## What is not covered

- **Real-browser contrast.** Everything above composites token values. A translucent
  fill over an unexpected ground is invisible to it; `chipVariants.ts` documents one
  such case that was only found by measuring in Chromium.
- **Screen-reader announcement order.** axe checks names and roles, not how a given
  reader narrates a page.
- **The pages' own composition.** The sweep covers the primitives and the shell. A page
  that puts an `<h4>` directly under an `<h1>`, or repeats a landmark, is not caught
  today; extending the sweep to page compositions is the obvious next step.
