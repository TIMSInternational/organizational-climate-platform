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

They are imported, in that order, from `src/index.css`. Order matters:
`tailwindcss` first (it establishes layer order), then the fonts, then the
values, then the mapping that consumes them.

## How the pages consume tokens

The twelve pages are plain semantic markup — `<h1>`, `<table>`, `<label>`,
`<button>`, `<p role="alert">` — with no classes and no inline styles. That is
deliberate and worth preserving: the base element layer in `src/index.css`
styles those elements from tokens, so every page is in the design language
without naming a single value, and a token change moves all twelve at once.

Consequences for new work:

- **Prefer plain semantic markup.** A `<table>` is already dense and themed.
- **Reach for a utility** (`p-card`, `text-fg-secondary`, `bg-surface-panel`)
  when you need something the element layer cannot express.
- **Use `var(--admin-*)` directly** for inline styles in layout/shell code, as
  `AdminLayout` and `RoleBasedNav` do.
- **Never introduce a raw hex or a bare px colour/spacing value.** If nothing
  here fits, add a token rather than a one-off.

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

Twenty-CRM's admin palette. Values are the legacy ones unchanged, which is what
makes "no visual regression against the legacy admin pages" a checkable claim.

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
| `--admin-bg-active` | `bg-state-active` | Selected nav row |

`--admin-bg-hover` / `-active` are deliberately translucent so they read
correctly on top of whatever surface they land on. Do not swap in a solid.

### Lines

`--admin-border-default` (`border-line-default`) · `-hover` · `-light`
(subtle dividers, table rules) · `-panel` (panel edges).

### Foreground

| Token | Utility | Use |
| --- | --- | --- |
| `--admin-font-primary` | `text-fg-primary` | Headings, active nav, primary text |
| `--admin-font-secondary` | `text-fg-secondary` | Body copy, table cells |
| `--admin-font-tertiary` | `text-fg-tertiary` | Meta, timestamps, icons |
| `--admin-font-light` | `text-fg-light` | Disabled |
| `--admin-font-section-label` | `text-fg-label` | Uppercase section labels, `<th>` |

### Accents

Six hues — `green`, `red`, `blue`, `purple`, `amber`, `orange` — each in four
strengths:

| Pattern | Utility | Use |
| --- | --- | --- |
| `--admin-accent-<hue>` | `text-accent-<hue>` | Text, icons, solid fills |
| `--admin-accent-bg-<hue>` | `bg-accent-<hue>-soft` | Badge/callout fill |
| `--admin-accent-bg-<hue>-subtle` | `bg-accent-<hue>-subtle` | Barely-there row tint (green/blue/purple/orange only) |
| `--admin-accent-border-<hue>` | `border-accent-<hue>-ring` | Hairline around a soft fill |

`blue` is the brand accent (`#2E9098`) and the focus-ring colour. `green` =
success, `red` = destructive/error, `amber`/`orange` = warning.

## Type

13px base, not 16px. The shell is one step denser than a marketing page; this is
the most load-bearing decision in the system and every other size hangs off it.

| Token | Value | Utility | Use |
| --- | --- | --- | --- |
| `--admin-text-2xs` | 10px | `text-2xs` | All-caps section labels |
| `--admin-text-xs` | 11px | `text-xs` | Badges, table meta, `<th>` |
| `--admin-text-sm` | 12px | `text-sm` | Secondary body, help text |
| `--admin-text-base` | 13px | `text-base` | Shell default |
| `--admin-text-lg` | 14px | `text-lg` | Emphasised body, h5/h6 |
| `--admin-text-xl` | 16px | `text-xl` | h3/h4 |
| `--admin-text-2xl` | 20px | `text-2xl` | h2 |
| `--admin-text-3xl` | 24px | `text-3xl` | h1 — a page title, not a hero |

Leading: `tight` 1.2 (headings) · `snug` 1.35 (dense rows) · `normal` 1.5 (body).
Weight: `regular` 400 · `medium` 500 (nav, buttons, labels) · `semibold` 600
(headings) · `bold` 700. Tracking: `tight` -0.01em · `normal` 0 · `label` 0.06em
(uppercase labels only).

## Space

`--admin-space-N` is **always `N × 2px`**. The 2px unit expresses every real
value in the legacy admin surfaces exactly, so nothing in between gets invented.

`0 · px · 1 (2px) · 2 (4px) · 3 (6px) · 4 (8px) · 5 (10px) · 6 (12px) · 7 (14px)
· 8 (16px) · 10 (20px) · 12 (24px) · 16 (32px) · 20 (40px)`

Tailwind's `--spacing` points at `--admin-space-2` (4px), so the numeric
utilities stay **identical to stock Tailwind** — `p-4` is still 16px. You do not
have to relearn the scale; you just get one source for it.

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
| `--admin-size-section-gap` | 24px | `gap-section` | Between sections; page padding |

### Control sizes

| Token | Value | Utilities | Use |
| --- | --- | --- | --- |
| `--admin-size-control-sm` | 24px | `h-control-sm`, `w-`, `size-` | Icon button |
| `--admin-size-control-md` | 28px | `h-control-md`, … | Nav row, input, select |
| `--admin-size-control-lg` | 32px | `h-control-lg`, … | Primary button |
| `--admin-size-icon` | 16px | `size-icon` | Inline icon |
| `--admin-size-icon-box` | 28px | `size-icon-box` | Icon tile |
| `--admin-size-sidebar` | 240px | `w-sidebar` | Sidebar |
| `--admin-size-sidebar-collapsed` | 52px | `w-sidebar-collapsed` | Collapsed sidebar |
| `--admin-size-content-max` | 1280px | `max-w-content`, `w-content` | Content column cap |

These are registered in Tailwind's `--spacing-*` namespace rather than
`--size-*`. That is deliberate and worth not "tidying up": `--size-*` only
generates the square `size-<name>` utility and produces no `w-*` or `h-*`, so a
sidebar width or a control height registered there would silently have no
utility. `--spacing-*` generates the full set.

## Radius, elevation, motion, stacking

Radius: `sm` 2px (hairline joins) · `md` 4px (controls) · `lg` 6px (badges,
chips) · `xl` 8px (panels, cards, dialogs) · `full` 999px.

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

Light is the default, matching the legacy default mode.

```html
<html>                          <!-- light -->
<html data-admin-theme="light"> <!-- light -->
<html data-admin-theme="dark">  <!-- dark  -->
```

Set the attribute on `<html>`. Anything built on `var(--admin-*)` or on a
token-backed utility re-themes with no extra work, because `theme.css` uses
`@theme inline` — utilities compile to `var(--admin-*)` references rather than
to a snapshot copy, so they re-resolve under the dark selector.

There is deliberately **no** `prefers-color-scheme` block and no "system" mode: a
`@media` rule cannot share a declaration block with a non-`@media` one, so a
third mode would mean a third copy of the palette, and a duplicated palette is
the drift this layer exists to prevent (#169). Resolving "follow the OS" to a
concrete `light`/`dark` is the job of whatever sets the attribute.

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
