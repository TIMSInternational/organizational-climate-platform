# `charts/` — data visualisation

#79, complete: the palette layer plus all eleven components, rendered together at
[`/dev/chart-gallery`](../../features/charts/pages/ChartGalleryPage.tsx) — a route that
exists **in development builds only**. `import.meta.env.DEV` gates it in
[`app/router.tsx`](../../app/router.tsx), and because the dynamic `import()` sits inside
that branch, Rollup never reaches the module: a production build emits no chunk for the
gallery or its sample data. Verified against a real build, and asserted three ways in
`app/router.test.ts` — including that nothing in the production graph statically imports
it, which is the regression that would ship the chunk while the route stayed hidden.

| Component | Replaces | Status |
|---|---|---|
| `BarChart` | `AnimatedBarChart` | done — grouped and stacked |
| `LineChart` | `AnimatedLineChart` | done |
| `Counter` | `AnimatedCounter` | done |
| `PieChart` | `AnimatedPieChart` | done — folds extras into "Other" rather than cycling |
| `HeatMap` | `HeatMap` + `widgets/heatmap` | done — consolidated, real `<table>` |
| `ChartFrame` / `ChartCanvas` | — | shared scaffolding: title, loading, empty, table view, sizing |
| `WordCloud` | `WordCloud` + `widgets/word-cloud` | done — consolidated, flowing layout |
| `KPIDisplay` | `KPIDisplay` | done |
| `ParticipationTracker` | `ParticipationTracker` + `widgets/progress-bar` | done — consolidated |
| `RealTimeChartContainer` | `RealTimeChartContainer` | done — polls at 3–5s, no WebSockets |
| `SentimentVisualization` | `SentimentVisualization` | done — placeholder data pending #67 |
| `RecommendationCard` | `RecommendationCard` | done |

Pure logic sits beside the components in its own modules, because a file exporting
both a component and a helper breaks React Fast Refresh: `foldSlices`, `palette`,
`wordScale`, `formatMetric`, `participation`, `sentiment`, `usePolling`. That is
also where most of the real test coverage lives — see "Testing charts under
happy-dom" below for why the rendered marks cannot carry it.

## The widget duplicates, and what consolidating them meant

Legacy had a second copy of three of these under `climate-project/src/components/widgets/`
(`heatmap`, `word-cloud`, `progress-bar`). Worth recording what was found: **that
whole directory was imported by nothing.** It is exported from `widgets/index.ts` and
no file outside `widgets/` references either the barrel or any member of it. So the
"duplicates" were dead code, and consolidation meant keeping the `charts/` version and
lifting across only what the widget copy genuinely did better:

- **`word-cloud`** contributed a `maxWords` cap and a per-word click handler. Its own
  layout was worse — a jittered grid with `Math.random()` *inside* the layout function,
  so positions re-rolled on every render — and it sorted its input with a bare
  `data.sort()`, mutating the caller's array as a side effect of rendering.
- **`progress-bar`** contributed nothing: its linear bar is `ui/progress` (Radix, so it
  has `role="progressbar"` and `aria-valuenow`, which the widget's animated `<div>` did
  not), and its `CircularProgress`/`StepProgress` already existed in legacy
  `ui/Progress.tsx` — the widget file was a third copy of primitives that belong in
  `ui/`, not a participation view.

**Dependency:** `recharts` pinned at `3.10.1` (exact, not a range). Legacy used
`^3.1.2`, so this is the same major; 3.10.1 declares React 19 support and `npm audit`
stays at 0.

**No `framer-motion`.** All eleven legacy components used it, and this project does not
port it (~1700 legacy lines dropped in #75–#77). That is why the `Animated*` prefix is
gone: recharts' own `isAnimationActive` covers bars growing from the baseline, and
`Counter` counts up with `requestAnimationFrame` in a few lines — while also respecting
`prefers-reduced-motion`, which the legacy version did not.

## Why a chart palette exists separately from the accents

The `--admin-accent-*` colours are a UI palette. They are not a categorical series
palette, and that was **measured, not argued**. Handing the six accents to a
colour-vision validator as a categorical palette fails three of six checks:

| Check | Result |
|---|---|
| Chroma floor | **FAIL** — `--admin-accent-blue` `#2e9098` has chroma 0.089, below the 0.1 floor. As a fill it reads gray. |
| CVD separation | **FAIL** — orange `#ea580c` vs amber `#d97706` is ΔE **1.6** for deuteranopia. |
| Normal-vision floor | **FAIL** — that same pair is ΔE **6.7** for *normal* vision, i.e. hard to tell apart with full colour vision. |

On top of that, four of the six are status colours. Status is reserved: green/amber/red
mean good/warning/critical throughout the UI, and a palette where "critical" also means
"series 3" makes a dashboard ambiguous — the reader cannot tell an encoding from a
judgement.

So charts get their own tokens, `--admin-chart-*`, defined in
[`../../styles/tokens.css`](../../styles/tokens.css) and exposed as utilities in
[`../../styles/theme.css`](../../styles/theme.css).

## The palettes, and how to re-check them

Both were selected by running a validator, not by eye, and both pass all six checks.

**Light** (surface `#ffffff`) — lightness band, chroma floor, CVD separation (worst
adjacent ΔE 13.6 deutan), normal-vision floor (24.8), contrast: all PASS.

```
#0d9488  #a21caf  #c2410c  #1d4ed8  #4d7c0f  #7c3aed
```

**Dark** (surface `#171717`) — worst adjacent CVD ΔE 12.8 deutan, normal-vision 29.4.

```
#0d9488  #c026d3  #ea580c  #3b82f6  #65a30d  #8b5cf6
```

**Dark is selected, not flipped.** The dark lightness band is narrower (L 0.48–0.67 vs
0.43–0.77), so the light steps fail it — teal-500 `#14b8a6` measures L 0.704 and is
rejected. Series 1 is the same in both modes because the brand teal already sits inside
both bands and clears 3:1 against both surfaces, so the common single-series chart reads
as this product in either theme.

`palette.test.ts` pins every value, so a well-meaning nudge to one hex fails the build
rather than silently breaking colourblind separation.

## Rules the palette module enforces

Read colours from [`palette.ts`](./palette.ts). Never write a colour literal in a chart —
[`../ui/tokenDiscipline.test.ts`](../ui/tokenDiscipline.test.ts) sweeps this directory as
well as `ui/`, and a raw hex fails the build.

- **Fixed order, never cycled.** `seriesColor(6)` *throws*. Cycling would give two series
  the same colour, and that fails in the worst way: the chart still renders and the reader
  cannot detect the duplicate. A seventh series folds into "Other", becomes small
  multiples, or means the chart is the wrong form.
- **Colour follows the entity, not its rank.** Use `seriesColorFor(key, allKeys)` with the
  full key list, so filtering the data does not repaint the survivors.
- **Sequential = one hue, light→dark** (reversed in dark mode, so "more" stays "more
  visible"). Never a rainbow.
- **Diverging = two hues with a neutral gray midpoint.** A hue at the midpoint reads as a
  third category rather than as "neither". `divergingColor` also has a dead band, so +0.02
  sentiment renders neutral instead of overstating the data.
- **Never a dual-axis chart.** Two measures of different scale are two charts, small
  multiples, or indexed to a common base.
- **Text wears text tokens, never the series colour.** Values, labels and legend text stay
  in `--admin-font-*`; the coloured swatch beside them carries identity. The one carve-out
  is text drawn *inside* a sequential swatch — see the paired ink below.
- **Identity is never colour-alone.** For ≥2 series a legend is always present, and ≤4
  series are also directly labelled.

## Text on a swatch: the paired sequential ink (#208)

`HeatMap showValues` paints the number *on* the ramp, so the ramp is that text's
background. One ink cannot serve a ramp — a ramp spans light to dark by definition — and
the measurement said so: `--admin-font-primary` on dark-mode `seq-7` was **1.56:1**, with
3 of 11 rendered cells under 3:1.

So each step has a paired ink, `--admin-chart-seq-N-ink`, in both theme blocks. Reach for
them through `sequentialPair(fraction)`, which returns `{ fill, ink }` from a single step
calculation; `sequentialColor` and `sequentialInk` exist for the cases that genuinely need
one of the two. Never index `SEQUENTIAL_COLORS` and `SEQUENTIAL_INKS` separately — that is
how a fill gets paired with an ink nobody measured against it.

Two ink values do all the work, and the flip point differs per theme because the ramp is
selected per theme rather than flipped: light flips at step 7, dark at step 5. Both are
outside the ramp on purpose — `#0d9488` is the pinch point in *both* themes, and the
darkest ramp step (`#042f2e`) only reaches 3.86:1 against it.

| step | light fill | light ink | ratio | dark fill | dark ink | ratio |
|---|---|---|---|---|---|---|
| 1 | `#ccfbf1` | `#02100f` | 17.20:1 | `#042f2e` | `#f0fdfa` | 13.87:1 |
| 2 | `#99f6e4` | `#02100f` | 15.37:1 | `#134e4a` | `#f0fdfa` | 9.09:1 |
| 3 | `#5eead4` | `#02100f` | 13.10:1 | `#115e59` | `#f0fdfa` | 7.27:1 |
| 4 | `#2dd4bf` | `#02100f` | 10.41:1 | `#0f766e` | `#f0fdfa` | 5.25:1 |
| 5 | `#14b8a6` | `#02100f` | 7.79:1 | `#0d9488` | `#02100f` | 5.18:1 |
| 6 | `#0d9488` | `#02100f` | 5.18:1 | `#14b8a6` | `#02100f` | 7.79:1 |
| 7 | `#0f766e` | `#f0fdfa` | 5.25:1 | `#2dd4bf` | `#02100f` | 10.41:1 |

Re-measure rather than adjust by eye, and check **both** themes — a one-theme failure is
this project's recurring blind spot (#80 shipped four light-mode-only AA failures while
the dark palette passed all four):

```
npm run check:contrast          # or: node scripts/check-seq-contrast.mjs
```

`styles/seqInkContrast.test.ts` runs that same script, so a nudge to any of these hexes —
ink *or* fill — fails the build rather than silently making a cell unreadable.

## Bars start at zero. Lines do not.

The single most re-litigated question about an axis, so it is written down once here and
again at both `<YAxis>` call sites.

**A bar encodes value as length**, measured from the axis. Move the axis off zero and a
bar twice as long stops meaning twice as much — the classic misleading chart. So
`BarChart` passes no `domain` and keeps recharts' zero-anchored default.

**A line encodes value as position**, and the reader takes meaning from the slope between
points, not from the distance down to the axis. Zero therefore buys nothing and costs the
vertical space the slope needs. So `LineChart` passes `domain={['auto', 'auto']}`.

This was measured rather than argued. The gallery's six-month 65→78 climb — a 20%
improvement — rendered as a **39px** rise inside a 280px chart under the zero-anchored
default, which is a horizontal line to any reader. Fitted, it is **195px**.

`['auto', 'auto']` rather than `['dataMin', 'dataMax']`: the latter puts the extreme
points exactly on the plot edges, where the markers clip against the axis. `auto` picks
round bounds just outside the data (64–80 for 65–78). Fitting the domain is also not the
same as hiding zero — a series running from −12 to 4 still gets a zero tick, because
there the baseline is real information.

Both halves are pinned: `LineChart.test.tsx` fails if the domain re-anchors (on ticks
*and* on the measured pixel span), and `BarChart.test.tsx` fails if a future tidy-up
makes the two "consistent" by fitting the bar domain. The inconsistency is the point.

## Testing charts under happy-dom

Two things were **probed, not assumed**, and both shape how these tests are written.

**1. `ResponsiveContainer` renders nothing.** It measures its parent with
`getBoundingClientRect`, which returns 0 under happy-dom:

```
explicit width/height  ->  1 <svg>, 2 bar rectangles, ticks ['a','b']
ResponsiveContainer    ->  0 <svg>, 0 rectangles, an empty inner <div style="width:0px">
```

So **every chart test passes an explicit `width`**; the app omits it and gets the
responsive path. This is deliberately not solved by stubbing `getBoundingClientRect`
globally — that makes every chart test depend on a fixture that silently governs layout.

**2. Marks have no observable fill.** For bars, recharts renders each bar as an empty group,
`<g class="recharts-bar-rectangle"><g class="recharts-inactive-bar"></g></g>`, with no
`<path>` inside. So a bar's `fill` and `stroke-width` cannot be asserted here. Colour is
asserted on the **legend icon** instead, which is a fair proxy — the swatch is exactly what
a reader matches a bar against — but it cannot catch a bar drawn in a different colour from
its own swatch. **Pie charts are worse still**: they render a bare `.recharts-pie` layer with
*no sectors and no `[fill]` elements anywhere* — not even legend icons, because the legend
payload derives from sector geometry that never happens. So `PieChart`'s real behaviour is
covered by unit-testing `foldSlices.ts` and by the table view, and its wedge assertions are
omitted with a comment. Line charts are the lucky case: `.recharts-line-curve` carries a real
`stroke`.

`HeatMap` sidesteps all of this by not being a recharts chart at all — it is an HTML
`<table>`, so every cell's `backgroundColor` and accessible name are directly assertable.

**Axis tick labels are not inside the axis group.** recharts renders them into a sibling
`recharts-yAxis-tick-labels` / `recharts-xAxis-tick-labels` layer, so
`.recharts-yAxis .recharts-cartesian-axis-tick-value` matches **nothing** — probed, not
assumed, after that selector silently returned an empty array. Use the `*-tick-labels`
layer as the hook when a test needs one axis's ticks rather than both, as the y-domain
tests do.

Where an attribute genuinely is not observable — the 2px stacked-segment gap — the test is
**omitted with a comment saying so**, rather than written as an assertion that cannot fail.
Those belong to the visual check the acceptance criteria already require.

## What rendering them in a real page found

The gallery is an acceptance criterion, and it earned its place: **five defects were
invisible to the whole test suite** because happy-dom does no layout and computes no
colour. All five are fixed, each now with a regression test.

1. **Four classes that compiled to nothing.** `ChartFrame`, `Counter` and `HeatMap` used
   `text-primary`, `text-secondary`, `border-default` and `font-regular`. None exist —
   `theme.css` declares `--color-fg-primary`, `--color-line-default` and
   `--font-weight-normal`, so the real names are `text-fg-primary`,
   `border-line-default` and `font-normal`. Tailwind emits no rule for a candidate it
   cannot resolve, so the text simply inherited its colour. `tokenDiscipline` cannot
   catch this: it rejects raw *values*, not names that do not exist. Now guarded by
   [`styles/utilityExistence.test.ts`](../../styles/utilityExistence.test.ts), which
   resolves every class in every `.tsx` through the real Tailwind compiler.
2. **`HeatMap` was stretched across the content width.** `index.css` set
   `table { width: 100% }`, which gave the row-label column all the slack and stranded
   the coloured cells against the right edge — a grid you could not read a row off. Fixed
   with `w-auto` *and* a block wrapper; neither alone is enough, because the `<figure>`
   is a flex column and stretched the table again. #218 later found the same global was
   the cause of #80's overflow too and moved it into `ui/table.tsx`; the local wrapper
   here is now `Table`'s own container, so this is `<Table className="w-auto">`. Every
   chart table (`HeatMap`, `ChartFrame`'s data table, `SentimentVisualization`) goes
   through that primitive — see "Tables" in [`styles/README.md`](../../styles/README.md).
3. **`usePolling` skipped its first fetch on every effect restart.** The in-flight guard
   was a `useRef`, shared across runs, so an incoming run saw the outgoing run's request
   still pending and waited a whole interval instead of fetching. React 19 StrictMode
   re-runs effects on mount, so in development *every* live chart was 3–5s late on first
   paint. Now scoped per effect run.
4. **`SentimentVisualization` wore a fill colour as text.** The net score was coloured
   with `divergingColor`, which breaks this palette's own rule ("text wears text tokens,
   never the series colour") — a score inside the inner band rendered as pale blue on
   white, measured at **1.6:1**. The polarity moved to a swatch.
5. **`ParticipationTracker` disagreed with itself at a band boundary.** The band was
   computed on the raw ratio while the label showed a rounded one, so 190 of 480 (39.58%)
   displayed "40%" — the documented threshold for Fair — while banding as Low. Rounded
   once now, and that one figure drives the label, the band and the bar.

Plus one thing that was merely *misleading* rather than broken: a `WordCloud` category
that folded past the six-colour ceiling was showing the shared "Other" swatch, so two
folded categories displayed the same dot and looked like one category. Folded categories
now get no swatch at all, and the note names them.

### Verified, and only verifiable, in a browser

The palette resolves correctly and flips with the theme — measured off computed styles,
not asserted from source: light bars `#0d9488 #a21caf #c2410c`, dark `#0d9488 #c026d3
#ea580c`; all six pie sectors present and distinct (happy-dom renders *no* sectors at
all); the 4px top-corner arc in the bar path; the 2px surface gap as a stroke on stacked
segments; `ResponsiveContainer` producing a real 1216×280 `<svg>` where happy-dom yields
zero; no horizontal overflow at 1440px in either theme; and no untranslated key paths in
Spanish.

## Still open

- **`SentimentVisualization` has no real data source.** Sentiment needs an AI provider,
  which is #67. It renders `sentimentStub` — deliberately a separate module, so
  `grep sentimentStub` finds every caller and deleting it turns a survivor into a compile
  error rather than a page quietly showing invented numbers. Pass `isPlaceholder` and the
  chart says so on screen.
- **`PieChart`'s legend order does not follow slice order.** recharts sorts the payload it
  derives **alphabetically by name**, so a 45/35/20 pie legends as "Disengaged, Engaged,
  Neutral" while the wedges run largest-first. Each label carries the *correct* colour —
  verified in a browser — so this is a reading-order annoyance, not a misattribution.

  Not fixed, and the reason is worth recording so nobody repeats the attempt:
  `Legend payload={...}` is the obvious fix, and **recharts 3.10.1 deliberately removes
  `payload` from `Legend`'s props type** (`Omit<Props, 'ref' | 'payload' | 'layout' |
  'verticalAlign'>`), so supplying it means casting past the library's own contract. It
  would also have been a testability win — an explicit payload renders a legend even
  without sector geometry, the one part of a pie happy-dom could then assert — so it is
  worth revisiting if a later recharts restores the prop.

- **~1.8 kB gzipped of gallery-only copy still ships.** The 46 `charts.gallery*` keys live
  in `i18n/{en,es}.json`, which are statically imported and cannot be tree-shaken per key,
  so they survive in production even though the page does not. Dropping them would mean
  exempting the gallery from `noHardcodedStrings`, and weakening a guard is a worse trade
  than 1.8 kB of unreferenced strings — but it is a real cost, recorded rather than hidden.
