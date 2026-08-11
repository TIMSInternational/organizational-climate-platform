# Design tokens

The `--admin-*` custom properties are the single source of truth for colour,
type, space, radius, elevation and motion in this app. Ported from the legacy
Next.js app, where the same set lived in `src/styles/tokens/colors.ts` and was
written onto `document.documentElement` at runtime by `AdminThemeContext`.

**If you are about to type a hex value, a px padding or a font size into a
component, the value you want is almost certainly already here.**

## Files

| File | Contains |
| --- | --- |
| `fonts.css` | Poppins `@font-face` (self-hosted) + the metric-matched fallback face |
| `tokens.css` | The `--admin-*` values. Light palette on `:root`, dark on `[data-admin-theme="dark"]` |
| `theme.css` | Tailwind `@theme` mapping tokens to utilities. Holds no values of its own |
| `tokens.test.ts` | Asserts the ported values and the invariants below, so drift fails the build |

They are imported, in that order, from `src/index.css`. Order matters:
`tailwindcss` first (it establishes layer order), then the fonts, then the
values, then the mapping that consumes them. `src/index.css` also holds the base
element layer, and `src/theme/adminTheme.ts` selects the palette.

## ⚠ The one thing that will catch you out

`p-4` is **16px**. `var(--admin-space-4)` is **4px**. They are two numbering
systems that share a digit:

| | Means | `4` is |
| --- | --- | --- |
| Tailwind utility `p-4` | 4 **steps** of `--spacing` (4px) | 16px |
| Token `var(--admin-space-4)` | 4 **pixels** — the name is the value | 4px |

The tokens are named by pixel value precisely so the two never look
interchangeable. `--admin-space-16` is 16px and is what `p-4` compiles to; if
you want the utility's value inline, that is the token to reach for. Nothing
warns you at build time, which is why it is written here, in `theme.css` next to
the `--spacing` declaration, in `tokens.css` above the scale, and asserted in
`tokens.test.ts`.

## How the pages consume tokens

The twelve pages are plain semantic markup — `<h1>`, `<table>`, `<label>`,
`<button>`, `<p role="alert">` — with no classes and no inline styles. That is
deliberate and worth preserving: the base element layer in `src/index.css`
styles those elements from tokens, so every page is in the design language
without naming a single value, and a token change moves all twelve at once.

Consequences for new work:

- **Prefer plain semantic markup.** A `<table>` is already dense and themed —
  but wrap it in `<Table>` (`components/ui`); see "Tables" below.
- **Reach for a utility** (`p-card`, `text-fg-secondary`, `bg-surface-panel`)
  when you need something the element layer cannot express.
- **Use `var(--admin-*)` directly** for inline styles in layout/shell code, as
  `AdminLayout` and `RoleBasedNav` do.
- **Never introduce a raw hex or a bare px colour/spacing value.** If nothing
  here fits, add a token rather than a one-off.

### Class detection is explicit

`src/index.css` imports Tailwind with `source(none)` and then declares two
`@source` globs: `index.html` and `src/**/*.{ts,tsx}`. Do not remove them and go
back to automatic detection. The automatic scan walks every non-ignored file in
the project, **including this README and the comments in `theme.css`** — so a
utility merely *named in prose here* was being compiled into the production
bundle as though a component used it (about 200 rules of dead CSS), and editing
a docs file silently changed the shipped stylesheet. It also makes "I verified
the utility compiles" circular: it compiled because the doc mentioned it.

The class names in the tables below are therefore documentation only. They exist
in the bundle when, and only when, a `.ts`/`.tsx` file uses them.

## Tables

**Decision (#218): the `ui/table.tsx` primitive owns table width and the scroll
container. The element layer owns cell styling only.** Written down here so it is
not re-litigated per page.

`table { width: 100% }` and `th { white-space: nowrap }` used to be element rules,
copied from `ui/table.tsx` along with the padding and colour. They are the one part
of that component that does not survive the copy. In the component they sit *inside*
`<div data-slot="table-container" class="overflow-x-auto">`, so a table wider than
its parent scrolls. As element rules they arrive without the container: the table is
told to fill its parent and forbidden to shrink, so it renders outside it.

That shipped twice, and each time was patched at the call site rather than at the
cause — which is why it shipped a second time:

| | Symptom | Local patch |
| --- | --- | --- |
| #79 | `HeatMap` stretched until its coloured cells were stranded against the right edge — a grid you cannot read a row off | `w-auto` + a local `overflow-x-auto` wrapper |
| #80 | Tables rendered **up to 150px outside the content panel** at 320/390px on Users, Companies, Action Plans, Demographic fields | `overflow-x-auto` on the `AdminLayout` panel |

Of the three options on #218, this is option 2 ("make the primitive own the scroll")
plus the half of option 1 it implies. Option 3 (a lint rule around the global) keeps
the trap and adds a rule to remember it by. Option 2 matches how this repo already
absorbs shared behaviour into `ui/`, and gives one place to change.

What that means when you write a table:

- **Use `<Table>` from `components/ui`.** Plain `<thead>/<tr>/<th>/<td>` children are
  fine and still get their padding, type and rules from the element layer — the
  classless pages do exactly that. You are wrapping for the container, not opting
  into a component API.
- **A bare `<table>` fails the build.** `tableOverflow.test.ts` sweeps every `.tsx`.
- **Full width is `Table`'s default**; `<Table className="w-auto">` shrink-wraps
  (`HeatMap` is the one caller that wants that).
- **`th` wraps by default now.** `TableHead` opts back into `whitespace-nowrap`,
  which is safe because its container scrolls.
- `th, td` carry `overflow-wrap: break-word` as the last line of defence: an
  unbreakable run — an email, a UUID, a URL — is the one thing that can still push a
  table past `max-width: 100%`. It only breaks a word that cannot fit a line of its
  own, so prose wraps as before.

`AdminLayout`'s panel keeps its `overflow-x-auto`. It is no longer the table fix, and
is documented there as a generic guard for anything else too wide to fit the card.

### Layout and overflow are browser-verified only

`happy-dom` computes no layout, so **width, overflow, clipping and horizontal scroll
are unobservable to the test suite**. Both defects above were found by rendering in a
real browser, and neither was visible to a green suite of 750+ tests. Do not read a
passing run as coverage of them.

`tableOverflow.test.ts` gets as close as the environment allows: it compiles the real
`index.css` through the real Tailwind compiler, puts the output in the document and
asserts what a `<th>` *computes* to. That pins the declarations — the width is not
100%, the header is not nowrap, the container is `overflow-x: auto` — and it pins that
every table goes through the primitive. It does not, and cannot, prove that a wide
table stays inside its card.

That was measured separately, in headless Chrome driven over CDP at **320px and
390px**, in **both themes** (theme is checked because #80's four contrast failures were
light-mode-only while the dark palette passed all four — see
`components/layout/README.md`). The page under test was the built
`dist/assets/index-*.css` over a replica of `AdminLayout`'s `main` + panel, holding a
seven-column users table with a 52-character email — not the running app, which needs
an API and a session. Both themes measured identically at both widths, as layout
should:

| | Panel overflows | Table's own container scrolls | `th` | Table / panel |
| --- | --- | --- | --- | --- |
| Bare `<table>` + the old globals | **yes** | — | `nowrap` | 784px / 294px |
| …plus #80's panel `overflow-x-auto` | **yes** (the whole panel scrolls, `<h1>` and all) | — | `nowrap` | 784px / 294px |
| `<Table>` + this layer | no | **yes** | `normal` | 752px / 294px |

The document never scrolled horizontally in any of the six runs, and with `<Table>` the
table's painted right edge sits 17px *inside* the panel border (its padding) instead of
past it.

## Naming

```
--admin-<group>-<role>[-<variant>]
```

Groups: `bg`, `border`, `font`, `accent`, `accent-bg`, `accent-border`, `space`,
`radius`, `text`, `leading`, `weight`, `tracking`, `size`, `shadow`, `duration`,
`ease`, `z`.

Note `font` is the **foreground/text colour** group (`--admin-font-primary` is a
colour, not a typeface). The typefaces are `--admin-font-sans` / `-mono`. That
overload is inherited from the legacy `font: { primary, secondary, … }` token
object and was kept so the two apps stay diffable.

## Colour

Twenty-CRM's admin palette. Values are the legacy ones unchanged.

### Surfaces

| Token | Utility | Use |
| --- | --- | --- |
| `--admin-bg-outer` | `bg-surface-outer` | App background, behind panels |
| `--admin-bg-panel` | `bg-surface-panel` | Sidebar, headers, chrome |
| `--admin-bg-card` | `bg-surface-card` | Cards, dialogs, raised surfaces |
| `--admin-bg-card-hover` | `bg-surface-card-hover` | Card hover |
| `--admin-bg-input` | `bg-surface-input` | Form controls |
| `--admin-bg-icon-box` | `bg-surface-icon-box` | Icon tiles, code chips |
| `--admin-bg-overlay` | `bg-surface-overlay` | Dialog scrim |
| `--admin-bg-hover` | `bg-state-hover` | Row/nav hover — translucent, layers over any surface |
| `--admin-bg-active` | `bg-state-active` | Selected row on a panel |

`--admin-bg-hover` / `-active` are deliberately translucent so they read
correctly on top of whatever surface they land on. Do not swap in a solid.

### Lines

`--admin-border-default` (`border-line-default`) · `-hover` · `-light`
(subtle dividers, table rules) · `-panel` (panel edges).

### Foreground

| Token | Utility | Use |
| --- | --- | --- |
| `--admin-font-primary` | `text-fg-primary` | Headings, active nav, primary text |
| `--admin-font-secondary` | `text-fg-secondary` | Labels, muted body copy |
| `--admin-font-tertiary` | `text-fg-tertiary` | Meta, timestamps, icons, `<th>` |
| `--admin-font-light` | `text-fg-light` | Disabled, section labels |
| `--admin-font-section-label` | `text-fg-label` | Uppercase section labels |
| `--admin-font-on-accent` | `text-fg-on-accent` | Text on a solid accent fill (selected nav row) |

### Accents

Six hues — `green`, `red`, `blue`, `purple`, `amber`, `orange` — each in four
strengths:

| Pattern | Utility | Use |
| --- | --- | --- |
| `--admin-accent-<hue>` | `text-accent-<hue>` | Text, icons, solid fills |
| `--admin-accent-bg-<hue>` | `bg-accent-<hue>-soft` | Badge/callout fill |
| `--admin-accent-bg-<hue>-subtle` | `bg-accent-<hue>-subtle` | Barely-there row tint (green/blue/purple/orange only) |
| `--admin-accent-border-<hue>` | `border-accent-<hue>-ring` | Hairline around a soft fill |

`blue` is the brand accent (`#0d9488` in light, `#14b8a6` in dark — revalued in
UI-0 off the legacy `#2E9098`, which measured below the chroma floor and read
grey), the selected-nav fill and the focus-ring colour. `green` = success,
`red` = destructive/error, `amber`/`orange` = warning.

### Status-chip ink

An accent is chosen to clear 3:1 against the **panel**, which is right for a
border or an icon and not enough for 11px text sitting on a *tint of itself*.
So a status chip does not wear the accent:

| Pattern | Utility | Use |
| --- | --- | --- |
| `--admin-chip-ink-<tone>` | `text-chip-<tone>-ink` | The word inside a `ui/Chip`, on its `bg-accent-*-soft` fill |

Five tones — `good`, `warning`, `critical`, `accent`, `neutral` — selected per
theme, worst measured pairing 4.64:1 against WCAG AA's 4.5. Never separate an ink
from the fill it was measured against; `chipVariantContrast.test.ts` re-derives
every pairing from `ui/chipVariants.ts` and fails if one drifts.

## Type

13px base, not 16px — the legacy shell (`AppShell.tsx`, `Sidebar.tsx`) sets
`fontSize: 13` and every legacy control primitive hardcodes `text-[13px]`.

The scale is in **`rem`**, and `src/index.css` deliberately does **not** override
the root font size. The 13px is applied to `body`. A user who raises their
browser's default font size scales the entire app with it (WCAG 1.4.4), exactly
as the legacy app did — its scale was `0.75rem` / `0.875rem` / `1.125rem`. The px
column below is the rendered size at a 16px browser default.

| Token | rem | @16px | Utility | Use |
| --- | --- | --- | --- | --- |
| `--admin-text-2xs` | 0.625 | 10px | `text-2xs` | All-caps section labels |
| `--admin-text-xs` | 0.6875 | 11px | `text-xs` | Badges |
| `--admin-text-sm` | 0.75 | 12px | `text-sm` | Help text, `<th>` |
| `--admin-text-base` | 0.8125 | 13px | `text-base` | Shell default |
| `--admin-text-lg` | 0.875 | 14px | `text-lg` | Labels, alerts, `h5`/`h6` |
| `--admin-text-xl` | 1 | 16px | `text-xl` | `h3`/`h4` |
| `--admin-text-2xl` | 1.25 | 20px | `text-2xl` | `h2` |
| `--admin-text-3xl` | 1.5 | 24px | `text-3xl` | `h1` — a page title, not a hero |

Element mapping (`src/index.css`): `h1` → `3xl`, `h2` → `2xl`, `h3`/`h4` → `xl`,
`h5`/`h6` → `lg`. Control heights are in `rem` for the same reason the type scale
is — a control is a box around text and has to grow when the text does.

Leading: `tight` 1.2 (headings) · `snug` 1.35 (dense rows) · `normal` 1.5 (body).
Weight: `regular` 400 · `medium` 500 (nav, buttons, labels) · `semibold` 600
(headings) · `bold` 700 (selected parent nav row). Tracking: `tight` -0.025em ·
`normal` 0 · `label` 0.06em (uppercase labels only).

## Space

`--admin-space-N` is **N pixels**. Not N steps — see the warning at the top.

`0 · 1 · 2 · 4 · 6 · 8 · 10 · 12 · 14 · 16 · 20 · 24 · 32 · 40`

The scale is 2px-granular at the bottom because the legacy admin surfaces are:
`padding: '4px 8px'`, `padding: '8px 10px'`, `py-2.5`. Tailwind's `--spacing` is
`--admin-space-4` (4px), so the numeric utilities stay **identical to stock
Tailwind** — `p-4` is still 16px. You do not have to relearn the utilities; you
just get one source for the values.

### Density primitives

Named composites, so a card is a card everywhere. Prefer these over raw steps
when the thing you are spacing has a name:

| Token | Value | Utility | Use |
| --- | --- | --- | --- |
| `--admin-size-card-padding` | 12px | `p-card` | Card interior |
| `--admin-size-panel-padding` | 16px | `p-panel` | Panel interior |
| `--admin-size-panel-gap` | 8px | `gap-panel-gap` | Between panels |
| `--admin-size-shell-gutter` | 12px | `p-gutter` | Shell inset |
| `--admin-size-row-gap` | 2px | `gap-row` | Nav/list rows |
| `--admin-size-inline-gap` | 8px | `gap-inline` | Icon-to-label |
| `--admin-size-section-gap` | 24px | `gap-section` | Between sections |

### Control sizes

| Token | @16px | Utilities | Use |
| --- | --- | --- | --- |
| `--admin-size-control-sm` | 24px | `h-control-sm`, `w-`, `size-` | Icon button |
| `--admin-size-control-md` | 28px | `h-control-md`, … | Nav row |
| `--admin-size-control-lg` | 32px | `h-control-lg`, … | Button, input, select |
| `--admin-size-icon` | 16px | `size-icon` | Inline icon |
| `--admin-size-icon-box` | 28px | `size-icon-box` | Icon tile |
| `--admin-size-sidebar` | 220px | `w-sidebar` | Sidebar |
| `--admin-size-sidebar-collapsed` | 52px | `w-sidebar-collapsed` | Collapsed sidebar |
| `--admin-size-content-max` | 1280px | `max-w-content`, `w-content` | Content column cap. **Not** applied by `AdminLayout` any more — the shell panel fills; its remaining callers are `PublicSurveyRespondPage` and the dev chart gallery |
| `--admin-size-measure` | 70ch | `max-w-measure` | The prose measure. Only prose is capped; tables and charts fill the width. Not `max-w-prose`, which Tailwind emits as a static 65ch |

These are registered in Tailwind's `--spacing-*` namespace rather than
`--size-*`. That is deliberate and worth not "tidying up": `--size-*` only
generates the square `size-<name>` utility and produces no `w-*` or `h-*`, so a
sidebar width or a control height registered there would silently have no
utility. `--spacing-*` generates the full set.

## Radius, elevation, motion, stacking

Radius: `sm` 2px (hairline joins) · `md` 4px (controls — legacy
`rounded-[4px]`) · `lg` 6px (badges, chips) · `xl` 8px (panels, cards, dialogs,
alerts — legacy `borderRadius: 8`) · `full` 999px.

Shadow: `sm` (resting card) · `md` (dropdown, popover) · `lg` (dialog). Darker
and more opaque in dark mode, since a light shadow is invisible there.

Motion: `--admin-duration-fast` 120ms (hover/active) · `-base` 200ms
(expand/collapse) · `-slow` 300ms (enter/exit), with `--admin-ease-out` and
`--admin-ease-in-out`. `src/index.css` collapses all of it under
`prefers-reduced-motion`. Three animation utilities exist: `animate-fade-in`,
`animate-slide-up`, `animate-scale-in`.

Z-index: `base` 0 · `sticky` 10 · `dropdown` 100 · `overlay` 200 · `dialog` 300
· `toast` 400. Use these rather than inventing a number.

## Focus

`--admin-focus-ring` (blue accent), `--admin-focus-ring-width` 2px,
`--admin-focus-ring-offset` 2px, applied globally to `:focus-visible`.

The legacy ring pointed at `--ring`, which was set to the *lightest* font colour
and then wrapped in `hsl()` around a hex value — invalid CSS, so no ring
rendered anywhere. Fixed rather than ported; the blue clears 3:1 against every
surface in both themes.

## Theming

Two palettes, selected by `data-admin-theme` on `<html>`:

```html
<html data-admin-theme="light">
<html data-admin-theme="dark">
```

`src/theme/adminTheme.ts` sets it, on the same contract as the legacy
`AdminThemeContext` so a returning user's preference carries over:

| | |
| --- | --- |
| localStorage key | `admin-theme` |
| values | `light` \| `dark` \| `system` |
| default | `light` |

`src/main.tsx` calls `initAdminTheme()` before the first render, so the attribute
is set before anything paints. `setAdminThemeMode(mode)` persists and applies a
choice — that is the function a theme switcher should call; there is no switcher
UI yet, and adding one is a matter of wiring a control to it.

Anything built on `var(--admin-*)` or on a token-backed utility re-themes with no
extra work, because `theme.css` uses `@theme inline` — utilities compile to
`var(--admin-*)` references rather than to a snapshot copy, so they re-resolve
under the dark selector.

There is deliberately **no** `prefers-color-scheme` block in the CSS: a `@media`
rule cannot share a declaration block with a non-`@media` one, so it would mean a
third copy of the palette, and a duplicated palette is the drift this layer
exists to prevent (#169). `system` is resolved in `adminTheme.ts` instead, which
also re-resolves when the OS preference changes.

## Poppins

Self-hosted via `@fontsource/poppins` (400/500/600/700, latin) rather than the
Google Fonts CDN, so the font is a first-party, fingerprinted, immutably-cached
asset with no third-party connection on first paint.

`fonts.css` also defines **`'Poppins Fallback'`**, which renders local
Arial/Helvetica outlines but reports Poppins' metrics (`size-adjust: 112.16%`
and matching ascent/descent/line-gap overrides). It sits directly behind Poppins
in `--admin-font-sans`, so the pre-swap and post-swap text occupy the same box
and `font-display: swap` costs no layout shift.

Two things follow, and both are easy to break:

- Do not set `font-synthesis: none` globally. The fallback is a single regular
  weight and relies on synthesised bold; disabling synthesis makes bold text
  snap weight on swap, reintroducing the shift.
- Keep `'Poppins Fallback'` immediately after `'Poppins'` in the stack. Move it
  and the metric matching stops applying.

## Provenance

The legacy admin surface kept its density in **component primitives and shell
inline styles**, not in a stylesheet — `globals.css` is the Montserrat marketing
surface. So the base element layer in `src/index.css` reproduces the primitives,
and every rule cites the declaration it came from. `tokens.test.ts` asserts these
values, so a later "tidy-up" that drifts from the legacy surface fails the build
rather than the eye.

| Rule (`src/index.css`) | Value | Legacy source |
| --- | --- | --- |
| `body` size/leading | 13px / 1.5 | `AppShell.tsx` `fontSize: 13`; `globals.css body` |
| `h1..h6` weight/leading/tracking | 600 / 1.2 / -0.025em | `globals.css h1..h6` |
| `h1` size | 24px | admin pages: `<h1 className="text-2xl font-bold">` |
| `h3` size | 16px | admin pages: `<h3 className="text-lg font-semibold">` (18px) — compressed onto the admin scale |
| `label` | 14px / 500 | `globals.css label` (0.875rem/500); `ui/label.tsx` `text-sm font-medium` |
| `button` | h 32px, pad 0 12px, gap 6px, r 4px, 13px, 500 | `ui/button.tsx` `size="sm"`: `h-8 rounded-[4px] gap-1.5 px-3` — used 49× in the legacy admin components, the `h-9` default 0× |
| `input`, `select` | h 32px, pad 0 12px, r 4px, 13px | `ui/input.tsx` `h-8 px-3 rounded-[4px] text-[13px]`; `ui/select.tsx` idem |
| `label > input` full width | `width: 100%` | `ui/input.tsx` `w-full`, scoped to the form row |
| `textarea` | min-h 80px, pad 8px 12px | `ui/textarea.tsx` `min-h-[80px] px-3 py-2` |
| `table` | 13px (**not** `w-full` — see Tables) | `ui/table.tsx` `w-full text-[13px]` |
| `th` | pad 8px 12px, 12px, 500, tertiary (**not** nowrap — see Tables) | `ui/table.tsx` `px-3 py-2 text-xs font-medium text-muted-foreground` |
| `td` | pad 10px 12px, inherits colour | `ui/table.tsx` `px-3 py-2.5` |
| `tr` | bottom rule + hover fill | `ui/table.tsx` `border-b hover:bg-accent/60` |
| `[role=alert]` | pad 12px 16px, r 8px, 14px | `ui/alert.tsx` `rounded-lg border px-4 py-3 text-sm` |
| `small` | 12px | `globals.css small` (0.75rem) |
| reduced motion | verbatim | `globals.css` |
| `.nav-section-title` | 10px, 600, uppercase, 0.06em, `--admin-font-light` | legacy `navigation/RoleBasedNav.tsx` `pt-2 pb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.06em]` |
| `.nav-icon` | 16px | legacy nav `h-4 w-4` |
| nav row (`RoleBasedNav.tsx`) | min-h 28px, pad 4px 8px, 13px, gap 8px, r 4px; selected leaf = white on blue, selected parent = primary + 700 | legacy `RoleBasedNav.tsx` row style, verbatim |
| `.nav-row`, `.nav-sub-row` | resting secondary text on no fill; `--admin-bg-hover` + primary text on hover/`:focus-visible`; `--admin-accent-blue` + on-accent when `[data-nav-state='selected']` | NO LEGACY COUNTERPART for the hover half — the legacy rail had none, and could not have had one while the row's fill was an inline style (#169). The selected/resting colours are the legacy row style, moved off the element |
| content panel (`AdminLayout.tsx`) | panel fill, hairline, r 8px, 12px shell inset, 1280px cap | `AppShell.tsx` `<main>` + `paddingRight/Bottom: 12` |

### Deliberate deviations

| Rule | Legacy | Here | Why |
| --- | --- | --- | --- |
| `table` width, `th` nowrap | element rules | on `ui/table.tsx` instead | An element rule cannot bring the scroll container the pair needs — see Tables (#218) |
| `th`, `td` `overflow-wrap` | — | `break-word` | Last line of defence for a bare table: an unbreakable email/UUID/URL is the only thing that can still exceed `max-width: 100%` |
| Focus ring | `hsl(<hex>)` on the lightest font colour | 2px blue accent | The legacy declaration was invalid CSS; no ring rendered anywhere |
| `[role=alert]` fill | `bg-card` | soft red accent + hairline | An alert on a card has to be distinguishable from the card |
| `small` colour | inherited | `--admin-font-tertiary` | Only used for meta text here |
| `p`, `td` colour | — | inherited (unchanged from legacy) | Noted because an earlier draft made them secondary |
| Root font size | not set | still not set | An earlier draft pinned it to 13px, which discards the user's preference |

### Rules with no legacy counterpart

`label { display: block }` + its bottom margin (the pages render
`<label>Text <input/></label>`, so the label *is* the form row, where legacy had
a `FormItem` wrapper); the `h1..h6` bottom margin (legacy carried it
per-instance as `mb-2`); `code`/`pre`; `ul`/`ol`/`li`; `.nav-badge`. Each is
marked `NO LEGACY COUNTERPART` in `src/index.css` with its reasoning.

### Status of "visual comparison shows no regression"

**Not performed as a side-by-side render.** The legacy app is a Next.js
application that needs its own environment to boot, and the twelve pages here
are new markup that has no pixel-for-pixel counterpart there in the first place
— nothing in the legacy app renders "the users page of this React app".

What was done instead, and what a reviewer can re-check without booting
anything:

1. Every colour value is byte-for-byte the legacy palette (`tokens.css`).
2. Every density value in the base layer is traced to a named legacy
   declaration in the table above, quoted with the file it came from.
3. Both are asserted in `tokens.test.ts`, so they cannot drift silently.

A live comparison of the two shells side by side is still worth doing once the
M1 primitives (#75/#76/#77) exist and there are comparable pages to compare;
until then, treating the criterion as "met" would be a claim nobody made.
