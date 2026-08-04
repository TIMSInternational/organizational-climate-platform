# `charts/` — data visualisation

Foundation for #79. This directory currently holds the **palette layer**; the eleven
chart components land on top of it.

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

## Still to do for #79

The eleven components, on this foundation. Notes gathered while surveying the legacy code:

- **Charting dependency is not yet chosen or added.** Legacy used `recharts ^3.1.2`. That
  is the obvious default, but confirm before adding — the acceptance criteria ask for it to
  be pinned deliberately.
- **All eleven legacy components use `framer-motion`**, which this project does not port
  (~1700 legacy lines were dropped for #75–#77 in favour of the three `index.css`
  animations plus `animate-spin`/`animate-pulse`). So the `Animated*` prefix does not
  survive as-is, and the animation approach is a decision rather than a port.
- **Widget duplicates** exist for `heatmap`, `word-cloud` and `progress-bar` in
  `climate-project/src/components/widgets/`. Consolidate; do not port both copies.
- **Empty and loading states are required per chart** — analytics pages routinely render
  before data arrives.
- **`RealTimeChartContainer` must use polling** (3–5s), not WebSockets, per the
  microclimates design.
- **`WordCloud` and `SentimentVisualization` have no real data source yet** — sentiment is
  stubbed pending #67. Build them to render whatever the stub returns.
