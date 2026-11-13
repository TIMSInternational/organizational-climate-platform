# ui/ primitives

Ported from `climate-project/src/components/ui/` — shadcn/ui, i.e. Radix primitives
plus `class-variance-authority` and `tailwind-merge`. Batch 1 of three (#75): the 15
that unblock form-heavy pages.

## Using them

```tsx
import { Button, TextField, Card, CardHeader, CardTitle } from '../../components/ui'
```

Copy is not the primitives' business — pass translated strings in. See
`src/i18n/README.md`.

## What the port changed, and why

### `outline-none` is not ported

Every legacy primitive killed the outline and rebuilt a focus ring from
`focus-visible:ring-*` against shadcn's `--ring` token. This app has one focus
indicator already — `:focus-visible { outline: 2px solid var(--admin-focus-ring) }`
in `index.css`, applied globally. Porting `outline-none` would have deleted the
app's only focus indicator and replaced it with a ring pointing at a token that
does not exist here. `button.test.tsx` asserts the class is absent.

### Button sizes are remapped onto control-height tokens

Legacy sizes were raw `h-8` / `h-9` / `h-10`. `index.css` records that the legacy
admin surface used `size="sm"` (32px) 49 times and the 36px default never — so 32px
is *the* admin button and is now the default.

| | legacy | here |
|---|---|---|
| `sm` | 32px | 28px (`h-control-md`, matches a nav row) |
| `default` | 36px | **32px** (`h-control-lg`) |
| `lg` | 40px | 40px |
| `icon` | 36px square | 32px square |

**A ported call site should drop its `size="sm"`** — the default is now that size.

### Badge variants use soft accent fills

The legacy variants were solid saturated fills. Here they are the token layer's
`--admin-accent-bg-*` over `--admin-accent-border-*`, which is what the legacy admin
status pills actually looked like and what stays legible in both themes.
`destructive` keeps a solid fill.

### `Chip` sits beside `Badge`, and is not a Badge variant

`Chip` (UI-0) is the redesign's **status** pill: a fixed 20px box, 11px semibold,
five tones — `good` / `warning` / `critical` / `accent` / `neutral` — and a `label`
that is a required `string`, so colour can never be the only carrier of the state
(WCAG 1.4.1).

It is separate from `Badge` because Badge's hued variants take their ink from the
accents, and `styles/badgeVariantContrast.test.ts` measures three of them failing
WCAG AA in light. A chip that passes cannot reuse those pairings, and re-inking
Badge would move 50 call sites across 34 files. `chip.tsx` sets out the full
argument; if Badge's inks are ever fixed the two can merge.

Each tone wears a `text-chip-*-ink` token measured against the fill beneath it,
per theme. `styles/chipVariantContrast.test.ts` re-derives all ten pairings from
the real variant table, `theme.css` and `tokens.css`, so re-pairing a tone fails
the build.

### `Form` and the `FormField` Controller are not ported

The legacy `form.tsx` was shadcn's `react-hook-form` binding. Nothing in this app
uses react-hook-form — all twelve pages and every existing form component are plain
controlled inputs. Porting the binding would add a dependency and a second form
paradigm for no current caller.

What is ported is the part that is easy to get wrong by hand: `FormItem` mints the
ids, `FormControl` attaches `aria-describedby` / `aria-invalid`, `FormLabel` points
at the control. That works for controlled inputs and would still work under
react-hook-form later.

### framer-motion is not ported

Legacy `FormField.tsx` imported it to fade in the error message. `index.css` already
ships `--animate-fade-in` and honours `prefers-reduced-motion`, so `animate-fade-in`
does the same thing with no dependency.

### Typography is 10 variants, not 25

The legacy file was 450 lines because it also carried the marketing scale
(`BodyLarge`, `Lead`, `Quote`, `DataTextLarge`, `LabelLarge`, `Caption` variants) and
four layout helpers. Dropped: the marketing ramp, and `Container` / `Section` /
`Grid` / `Flex` — `<div className="flex gap-inline">` is clearer than
`<Flex gap="inline">` and needs no maintaining.

### The radio dot is a dot

Legacy used a lucide `Circle` icon inside a 14px control, which renders as a smudge.
A filled `<span>` needs no glyph.

## Rules the tests enforce

- **`tokenDiscipline.test.ts`** — no hex/rgb colour, no stock Tailwind palette
  colour, no `text-white`/`bg-black`, and no arbitrary `[...]` value anywhere in
  `ui/`. If a value has no token, add it to `styles/theme.css`, not here.
- **`cn.test.ts`** — `src/lib/cn.ts` extends `tailwind-merge` with this project's
  named scales. Without that, `cn('h-control-lg', 'h-10')` keeps *both* classes and
  the winner is decided by Tailwind's layer order rather than by the caller, so
  `<Button className="h-10">` would not reliably be 40px.
- One behavioural test per primitive — interaction and accessibility, not snapshots.

## Known environment limit

`radio-group.test.tsx` verifies arrow-key roving focus but not
selection-follows-focus. Radix implements the latter by tracking arrow keydown on
`document` and reading that flag in the item's focus handler; happy-dom dispatches
focus asynchronously relative to the flag being cleared, so the selection never
lands. The failure is environmental, not a component bug — noted in the test.

---

# Batch 2 (#76): overlays and feedback

`dialog` · `alert-dialog` · `confirmation-dialog` · `success-dialog` · `sheet` ·
`popover` · `tooltip` · `dropdown-menu` · `toast` · `alert` · `spinner` · `skeleton` ·
`progress` · `error-state`

## Accessibility is asserted, not assumed

#76 names focus trapping as the most common place a port silently regresses, so the
tests check the mechanism rather than trusting Radix:

- focus moves **into** the dialog on open, and `Tab` cycles without escaping
- focus is **restored to the trigger** on close — the half that regresses quietly
- the rest of the page is `aria-hidden` while a modal is open. Radix implements
  modality that way, **not** via `aria-modal`; that was verified against the rendered
  output after an `aria-modal` assertion failed.
- `AlertDialog` uses `role="alertdialog"`, has no close button, and cannot be
  dismissed by backdrop click — it must be answered
- `Popover` is *not* modal, and a test asserts it leaves the page readable
- `Tooltip` opens on keyboard focus, not only on hover

## Copy is always passed in

No primitive defaults an English string. `DialogContent` uses a union type:

```ts
{ showCloseButton?: true; closeLabel: string } | { showCloseButton: false; closeLabel?: never }
```

so rendering a close button with no accessible name is a **type error**, and there is
no English default to leak into a Spanish UI. Pass `t('common.close')`. Same for
`ConfirmationDialog` (`confirmText`/`cancelText`), `SuccessDialog` (`dismissText`) and
`NetworkError` (`retryText`) — `NetworkError` omits its retry button entirely rather
than invent a label.

`src/i18n/noHardcodedStrings.test.ts` caught the two `sr-only` "Close" strings that
started out hardcoded here. It works.

## Behavioural fixes to the legacy components

**`ConfirmationDialog` waits for `onConfirm`.** The legacy version closed immediately
and left the returned promise unobserved, so a *failed* confirm looked exactly like a
successful one. It now stays open until the promise settles, stays open on rejection so
the caller has somewhere to show the error, and swallows the rejection only to avoid an
unhandled-rejection warning — reporting is the caller's job.

**`Progress` was rebuilt on Radix.** The legacy version was divs with no ARIA at all —
no `role="progressbar"`, no `aria-valuenow` — so a screen reader saw a coloured box.

**`Toaster` reads `data-admin-theme`.** The legacy version read `next-themes`, which
does not exist here. The resolution lives in `toasterTheme.ts` and is unit-tested,
because sonner renders a bare `<section>` that forwards neither `data-slot` nor
`data-theme`, so the wiring cannot be asserted from the DOM.

## Not ported, and why

- **`LoadingErrorBoundary`** — #76 asked that error handling integrate with the
  existing boundary rather than duplicate it. `src/app/RouteErrorBoundary.tsx` is the
  router's `errorElement` and now renders `ErrorState`.
- **`SuccessDisplay`** — a success message is a toast or an `Alert`; a third spelling
  would be a third thing to keep in sync.
- **`ValidationError`** — field errors belong to `FormMessage` (#75), which already
  wires `aria-invalid` and `aria-describedby`.
- **framer-motion**, again — `Loading`, `LoadingSpinner` and `skeleton` were 640 lines
  of it. `animate-spin` and `animate-pulse` do the same job, and `index.css` already
  honours `prefers-reduced-motion`.
- **The legacy skeleton presets** (`LoadingCard`, `LoadingTable`, dashboard skeletons)
  encoded the *legacy* page layouts, which is what this migration replaces. Shipping
  them would ship dead shapes. `Skeleton` + `SkeletonText` remain.
- **`LoadingButton`** — `Button` already has `disabled`, and a caller composes
  `<Spinner />` as a child.

What *did* survive from `Loading.tsx` is `LoadingRegion`, because it carries behaviour
rather than layout: it is where `aria-busy` and the polite announcement belong, and it
keeps children mounted so content is not replaced by a spinner.

---

# Batch 3 (#77): data display and navigation

Ported: `table` · `tabs` · `pagination` · `accordion` · `collapsible` · `breadcrumb` ·
`scroll-area` · `slider` · `notification-dropdown` · `SkipLink` · `LiveRegion`

## Added, because #77 asked for it

`table` **owns table width and the scroll container** (#218). `Table` renders
`<div data-slot="table-container" class="relative w-full overflow-x-auto">` around a
`w-full` table, and `TableHead` is `whitespace-nowrap`. Those two declarations are only
safe together — see "Tables" in `src/styles/README.md` for why they are no longer element
rules, and what shipped twice while they were. `relative` makes the scroller the
containing block of its cells' `sr-only` labels: without it they escape the clip, and the
climate map's labels gave /dashboard a 646px-wide page at 390 (11 Nov).

**Anything that renders a table goes through `Table`**, including the classless pages:
plain `<thead>/<tr>/<th>/<td>` children still get their padding, type and rules from
the base element layer, so a page gains the container without restating its markup.
`src/styles/tableOverflow.test.ts` sweeps for a bare `<table>` and fails the build on
one; `HeatMap` is the one caller that opts out of full width, with
`<Table className="w-auto">`.

`table` gained **sort and empty-state support**; the legacy table had neither.
`TableSortHeader` sets `aria-sort` on the `<th>` — the part a hand-rolled sort control
almost always misses, and without which a screen-reader user cannot tell which column
is sorted or which way. `TableEmpty` renders a real `<tr>` with `colSpan` so the table's
semantics survive an empty result.

`usePagination` handles the window: first, last, a window around the current page, and
`null` where pages were elided. A **single** skipped page renders as that page, not as
an ellipsis hiding exactly one number.

## Rebuilt

**`Slider`** now sits on `@radix-ui/react-slider`. The legacy version was an
`<input type="range">` wrapper with no label plumbing and no range support, which the M4
results screens need.

Note where the label goes: Radix puts `role="slider"` on the **thumb**, not the root, so
an `aria-label` on the root names nothing. A test caught the first version rendering an
unnamed slider. Pass `thumbLabels` for a range so each end is named separately.

**`NotificationDropdown`** was 447 framer-motion lines that also **fetched its own data**
and knew the legacy notification row shape. #77 says keep the contract generic for #99,
so the fetch is gone: it takes a list and callbacks, and the caller owns loading, paging
and date formatting. Built on the #76 `DropdownMenu`, so focus handling and Escape are
inherited rather than re-implemented.

## Not ported, and why

| | |
|---|---|
| `sidebar` (726 lines) | #77 says reconcile with the existing nav, not replace it. The role-aware logic in `AdminLayout.tsx` and `navigation/` is deliberate and tested (`navSections.test.ts`). Dropping shadcn's sidebar on top would replace tested behaviour with untested behaviour. |
| `navigation-menu` | A top-level mega-menu. This app navigates from the sidebar; no planned page has a horizontal menu bar. |
| `command` (+ `cmdk`) | A command palette. No planned page uses one — #77 explicitly says to skip rather than port dead code. |
| `calendar` (+ `react-day-picker`), `date-picker` (+ `date-fns`) | **The app already uses native `type="date"` and `type="datetime-local"`** in `ActionPlanForm` and `MicroclimateForm`, styled by `index.css`. Native pickers are localised by the browser for free; a custom one needs locale wiring, and Spanish is a first-class language here (#78). Two dependencies for a **downgrade** in i18n behaviour. |
| `enhanced-tabs` | `tabs` plus a framer-motion sliding indicator. The indicator is a `transition` on the active trigger's border, so it needs no library — and two tab components would be two things to keep in sync. |
| `animated` (516 lines) | framer-motion decoration. `index.css` ships the three animations the legacy admin surface actually used. |
| most of `accessible-components` | Superseded by batch 2: `AccessibleModal`→`Dialog`, `ProgressBar`→`Progress`, `AccessibleLoadingSpinner`→`Spinner`/`LoadingRegion`, `AccessibleBreadcrumb`→`Breadcrumb`. Only `SkipLink` and `LiveRegion` were genuinely new. |

**Total: 6 of the 17 listed components deliberately skipped, 2 folded into others.** Each
skip avoids either a dependency, dead code, or overwriting tested behaviour — and none of
them is needed by a planned page. Say the word if any is wanted and it can be added.

---

# Follow-up: `calendar` and `date-picker` (reversing a #77 skip)

#77 shipped with these two **skipped**, on the argument that the app's native
`type="date"` / `datetime-local` inputs are localised by the browser for free, so a
custom picker plus `react-day-picker` and `date-fns` would be two dependencies for an
i18n *downgrade*.

They are now ported, with that objection answered rather than ignored: **`Calendar`
reads the active locale from `useTranslation()`** and hands react-day-picker the
matching date-fns locale. Month names, weekday initials, the day `aria-label`s and the
**week-start day** all follow the UI language. `DatePicker` formats its trigger the
same way, so a Spanish user sees *3 de agosto de 2026*, not *August 3rd, 2026*.

Four tests exist specifically to hold that line — English vs Spanish captions, a
localised day label, and the Monday-vs-Sunday week start.

**The native inputs in `ActionPlanForm` and `MicroclimateForm` are deliberately left
alone.** This is available for screens that want a styled picker; a native input is
still the better default when one will do, and churning working controls was not part
of the ask.

## Two things worth knowing when testing this

Days are addressed by **`td[data-day="YYYY-MM-DD"]`**, and the clickable element is a
`<button>` *inside* that cell — clicking the `gridcell` itself does nothing. Querying
by accessible name is not an option either: the button's `aria-label` is a fully
localised date, so a name-based query would be locale-dependent in a suite whose
entire purpose is switching locale.

`DayPickerProps` is a **discriminated union on `mode`**. A plain
`Omit<DayPickerProps, 'locale'>` collapses it into the no-mode branch and makes
`<Calendar mode="range">` a type error; `CalendarProps` uses a distributive omit to
keep each branch intact, with one documented cast on the rest-spread.

---

# The Apple design (11 Nov): the primitives drawn to `occ.css`

The canvas's component classes, translated onto the token layer. What a page should reach for,
and the one or two decisions per primitive that were measured rather than copied.

| canvas | primitive | use |
|---|---|---|
| `.btn.p` | `<Button variant="primary">` | the one filled blue action of a view (`#2563eb`, white 5.17:1) |
| `.btn` | `<Button>` / `variant="secondary"` / `"outline"` | the bordered neutral button |
| `.btn.t` | `<Button variant="plain">` | tinted text, no ground (`#1d4ed8`) |
| `.btn.d` | `<Button variant="destructive">` | the danger INK on the bordered button |
| `.btn.lg` | `<Button size="lg">` | 44px |
| `.seg` | `<SegmentedControl label value options onChange>` | a view/filter control: `role="group"` of `aria-pressed` buttons |
| `.card` | `<Card>` + slots | bordered, flat, 18/20px padding, serif `CardTitle` |
| `.card.kpi` | `<KpiCard label value unit? footnote?>` | 11px tracked eyebrow, 30px tabular reading |
| `.tbl` | `<Table zebra?>`, `<TableHead numeric>`, `<TableCell numeric>` | 13px semibold head, 15px rows, right-aligned figures |
| `.chip` | `<Chip label>` | neutral grey status |
| `.chip.live` | `<Chip tone="live" label="Activa">` | the ONE blue status chip, with its dot |
| `.chip.s/.o/.c` | `<Chip tone="good" / "warning" / "critical">` | the result areas; the glyph + name chip is `charts/BandChip` |
| `.note` / `.note.info` | `<Note icon? tone="neutral" / "info">` | a standing fact about the screen; no `warn` (amber is Oportunidad) |
| `.prot` | `<ProtectedState floor={payload.floor}>` | padlock + "Menos de {floor}"; takes no count |
| `.sk` | `<LoadingState rows? label?>`, `<Skeleton>` | placeholder rows + one polite announcement |
| — | `<ErrorState title onRetry? retryLabel?>` | a failure with its recovery action |
| `.sheet` | `Dialog` / `AlertDialog` / `Sheet` | 16px radius, 22/24px padding, serif title, scrim |
| `.tg` | `<Switch>` | 26×42, blue when on |
| `.in` | `<Input>`, `<Textarea>`, `<SelectTrigger>` | 36px, 15px text, the 3:1 control edge |
| `.meter` | `<Progress value>` | 6px, blue on the fill track |
| `.scale` | `<SegmentedScale>` | the respondent's 1–5: 56px, chosen point blue |

## Measured, and why it differs from the canvas

- **Destructive is not a red fill.** White on the dark danger fill (`#ef4444`) is 3.76:1, under the
  4.5:1 a 14px label needs; HIG `buttons.md` § "Role" keeps the primary (most prominent) style off
  a destructive action. The danger ink on the bordered button is 6.25:1 light, 6.35:1 dark.
- **The switch and the meter are the identity blue, not the fill blue.** Both are graphics with no
  word on them. In dark, the fill blue `#2563eb` sits 2.36:1 from the switch's off track and 2.16:1
  from the meter's track — under the 3:1 WCAG 1.4.11 asks. The identity blue: 4.79:1 and 4.39:1.
  The fill blue is for surfaces that carry a white word (the primary button, the chosen scale point).
- **The segmented control's track is the recessed tile, not `--fill`.** On `--fill` the chosen
  segment (card ground) is darker than the track in dark, so it sinks instead of rising (HIG
  `dark-mode.md`: elevated is brighter). A dedicated `--admin-bg-segment-on` token (white light,
  `#3a4767` dark, the canvas's `--segon`) would let the track be `--fill`; that is a tokens change.
- **Touch.** Every button size, the segmented control and the inputs grow to 44px under
  `pointer-coarse` (HIG `buttons.md`: "a hit region of at least 44x44 pt"); the switch grows an
  invisible hit ring instead, so its drawing does not change.
