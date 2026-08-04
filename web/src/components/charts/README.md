# `charts/` — data visualisation

Progress on #79. The **palette layer** plus the first three components; eight remain.

| Component | Replaces | Status |
|---|---|---|
| `BarChart` | `AnimatedBarChart` | done — grouped and stacked |
| `LineChart` | `AnimatedLineChart` | done |
| `Counter` | `AnimatedCounter` | done |
| `PieChart` | `AnimatedPieChart` | done — folds extras into "Other" rather than cycling |
| `HeatMap` | `HeatMap` + `widgets/heatmap` | done — consolidated, real `<table>` |
| `ChartFrame` / `ChartCanvas` | — | shared scaffolding: title, loading, empty, table view, sizing |
| `WordCloud` | `WordCloud` + `widgets/word-cloud` | to do — consolidate |
| `KPIDisplay` | `KPIDisplay` | to do |
| `ParticipationTracker` | `ParticipationTracker` + `widgets/progress-bar` | to do — consolidate |
| `RealTimeChartContainer` | `RealTimeChartContainer` | to do — polling, not WebSockets |
| `SentimentVisualization` | `SentimentVisualization` | to do — stub data pending #67 |
| `RecommendationCard` | `RecommendationCard` | to do |

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
  in `--admin-font-*`; the coloured swatch beside them carries identity.
- **Identity is never colour-alone.** For ≥2 series a legend is always present, and ≤4
  series are also directly labelled.

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

Where an attribute genuinely is not observable — the 2px stacked-segment gap — the test is
**omitted with a comment saying so**, rather than written as an assertion that cannot fail.
Those belong to the visual check the acceptance criteria already require.

## Still to do for #79

- The six components still marked "to do" above.
- **Widget duplicates** for `word-cloud` and `progress-bar` in
  `climate-project/src/components/widgets/` still to consolidate (`heatmap` is done).
- **A paired ink token per sequential ramp step**, so `HeatMap`'s `showValues` can be on by
  default. The ramp inverts between light and dark mode, so one ink colour cannot be legible
  against both ends — which is why that prop currently defaults to off.
- **`RealTimeChartContainer` must poll** (3–5s), not use WebSockets, per the microclimates
  design.
- **`WordCloud` and `SentimentVisualization` have no real data source** — sentiment is
  stubbed pending #67. Build them to render whatever the stub returns.
- **Render in at least one real page**, which the acceptance criteria require and which is
  also the only way to verify the mark specs that happy-dom cannot see.
