import { useMemo, useState } from 'react'
import { useTranslation } from '../../i18n'
import ChartFrame from './ChartFrame'
import { divergingColor, seriesColorFor } from './palette'
import {
  categoryColorKeyList,
  categoryColorKeys,
  OTHER_CATEGORY_KEY,
  wordSizeClass,
} from './wordScale'
import type { ChartStateProps } from './types'

export interface WordFrequency {
  /** The word itself. Already in the reader's language — this never translates data. */
  text: string
  /** How often it appeared. Must be positive; zero and negative are dropped. */
  value: number
  /** Polarity in -1..1, for `colorBy="sentiment"`. */
  sentiment?: number
  category?: string
}

interface WordCloudProps extends ChartStateProps {
  data: readonly WordFrequency[]
  /** Keep only the N most frequent words. */
  maxWords?: number
  /**
   * What colour encodes, if anything.
   *
   * `none` is the default on purpose — see the note on encoding below.
   */
  colorBy?: 'none' | 'sentiment' | 'category'
  /** Makes each word activatable, e.g. to drill into the responses behind it. */
  onWordSelect?: (word: WordFrequency) => void
  /** Height of the loading and empty placeholders. The words themselves flow. */
  height?: number
}

/**
 * Word frequencies from open-ended responses, sized by how often each appeared.
 *
 * Consolidates legacy `charts/WordCloud` and `widgets/word-cloud`, which were two
 * unfinished implementations of the same thing. Worth recording that
 * `widgets/word-cloud` (like the rest of `components/widgets/`) was exported from
 * a barrel and imported by **nothing** — so the "duplicate" was dead code, and
 * consolidating means the charts version survives carrying the two things the
 * widget did have that it lacked: a `maxWords` cap and a per-word click handler.
 *
 * ## Why the words flow instead of being positioned
 *
 * Both legacy versions placed words absolutely — one on an Archimedean spiral,
 * one on a jittered grid — and **neither did any collision detection**, so words
 * overlapped and became unreadable exactly when the data was interesting. The
 * widget version also called `Math.random()` inside its layout, which re-rolled
 * the positions on every render and could not be tested at all, and sorted its
 * input with a bare `data.sort()`, mutating the caller's array in place.
 *
 * This lays the words out as a flowing, wrapping list in descending frequency
 * order. Nothing can overlap, the layout is deterministic, it reflows to any
 * width, and it is a real `<ul>` — so a screen reader announces "list, 10 items"
 * and a keyboard can reach each word when `onWordSelect` makes them buttons. The
 * scatter of a classic word cloud is decoration; the ranking is the information,
 * and reading order carries it better than position does.
 *
 * ## Why colour encodes nothing by default
 *
 * Size already encodes frequency. Legacy coloured each word by
 * `hsl(index * 137.5, 70%, 50%)` — a hue per array position, which encodes
 * *nothing* while looking like it encodes something, and lands wherever it lands
 * on contrast and colour-vision separation. So `colorBy="none"` leaves every word
 * in the text token, and colour becomes available for a second, real variable:
 * `sentiment` (the validated diverging scale, with its dead band, so a
 * near-neutral word reads neutral) or `category` (the categorical palette, keyed
 * so a colour follows a category rather than its rank).
 */
export default function WordCloud({
  data,
  maxWords = 50,
  colorBy = 'none',
  onWordSelect,
  height = 280,
  title,
  isLoading,
}: WordCloudProps) {
  const { t } = useTranslation()
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  // A word with no occurrences is not a word in the cloud, and a negative count
  // is not a count. `toSorted` rather than `sort`: the legacy widget's in-place
  // sort reordered the caller's own array as a side effect of rendering.
  const ranked = useMemo(
    () =>
      data
        .filter((word) => Number.isFinite(word.value) && word.value > 0)
        .toSorted((a, b) => b.value - a.value)
        .slice(0, Math.max(0, maxWords)),
    [data, maxWords],
  )

  const categories = useMemo(
    () => [...new Set(ranked.map((word) => word.category).filter((c): c is string => Boolean(c)))],
    [ranked],
  )

  // Colour keys come from the *unfiltered* category list, so narrowing to one
  // category does not recolour it.
  const colorKeyByCategory = useMemo(() => categoryColorKeys(categories), [categories])
  const colorKeys = useMemo(() => categoryColorKeyList(colorKeyByCategory), [colorKeyByCategory])

  // The categories that ran past the palette ceiling and now share one colour.
  const foldedCategories = useMemo(
    () =>
      [...colorKeyByCategory.entries()]
        .filter(([, key]) => key === OTHER_CATEGORY_KEY)
        .map(([category]) => category),
    [colorKeyByCategory],
  )

  const visible =
    selectedCategory === null
      ? ranked
      : ranked.filter((word) => word.category === selectedCategory)

  // The size range is taken from `ranked`, not `visible`: rescaling on filter
  // would make the same word change size depending on what else is on screen,
  // which reads as the data having changed.
  const values = ranked.map((word) => word.value)
  const min = values.length > 0 ? Math.min(...values) : 0
  const max = values.length > 0 ? Math.max(...values) : 0

  function colorOf(word: WordFrequency): string | undefined {
    if (colorBy === 'sentiment') return divergingColor(word.sentiment ?? 0)
    if (colorBy === 'category' && word.category) {
      const key = colorKeyByCategory.get(word.category)
      if (key) return seriesColorFor(key, colorKeys)
    }
    return undefined
  }

  return (
    <ChartFrame
      title={title}
      isLoading={isLoading}
      isEmpty={visible.length === 0}
      height={height}
      series={[{ key: 'value', name: t('charts.frequencyColumn') }]}
      data={visible.map((word) => ({ label: word.text, values: { value: word.value } }))}
    >
      <div className="flex flex-col gap-2">
        {categories.length > 0 ? (
          <CategoryFilter
            categories={categories}
            selected={selectedCategory}
            onSelect={setSelectedCategory}
            // A folded category gets NO swatch, rather than the shared "Other"
            // colour. Showing it the shared colour reads as "this is my colour",
            // so two folded categories looked like one -- caught on the gallery,
            // where Leadership and Enablement both displayed the same purple dot.
            // No swatch is the honest signal: this category has no colour of its
            // own, and the note beneath names the ones that do not.
            swatchFor={
              colorBy === 'category'
                ? (category) => {
                    const key = colorKeyByCategory.get(category)
                    if (!key || key === OTHER_CATEGORY_KEY) return undefined
                    return seriesColorFor(key, colorKeys)
                  }
                : undefined
            }
            foldedLabel={
              colorBy === 'category' && foldedCategories.length > 0
                ? t('charts.otherCategories', { categories: foldedCategories.join(', ') })
                : undefined
            }
          />
        ) : null}

        <ul className="m-0 flex list-none flex-wrap items-baseline gap-x-4 gap-y-2 p-0">
          {visible.map((word) => {
            const sizeClass = wordSizeClass(word.value, min, max)
            const color = colorOf(word)
            // The count is in the accessible name rather than only in a `title`:
            // a tooltip is unreachable by keyboard and invisible in print, and
            // the count is the whole point of the chart.
            const label = t('charts.wordOccurrences', {
              word: word.text,
              count: String(word.value),
            })

            return (
              <li key={word.text} className="m-0">
                {onWordSelect ? (
                  <button
                    type="button"
                    onClick={() => onWordSelect(word)}
                    aria-label={label}
                    // `h-auto p-0`: the global `button` rule gives every button
                    // the 32px control height and inset, which would box each
                    // word instead of letting it sit in the text flow.
                    className={`h-auto border-0 bg-transparent p-0 font-medium ${sizeClass}`}
                    style={color ? { color } : undefined}
                  >
                    {word.text}
                  </button>
                ) : (
                  <span
                    aria-label={label}
                    className={`font-medium ${color ? '' : 'text-fg-primary'} ${sizeClass}`}
                    style={color ? { color } : undefined}
                  >
                    {word.text}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </ChartFrame>
  )
}

/**
 * Narrows the cloud to one category.
 *
 * A row of buttons rather than a `<select>` because the set is small and the
 * options double as the colour legend when `colorBy="category"` — which is what
 * keeps identity off colour alone.
 */
function CategoryFilter({
  categories,
  selected,
  onSelect,
  swatchFor,
  foldedLabel,
}: {
  categories: readonly string[]
  selected: string | null
  onSelect: (category: string | null) => void
  swatchFor?: (category: string) => string | undefined
  foldedLabel?: string
}) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-pressed={selected === null}
        className="text-sm"
      >
        {t('charts.allCategories')}
      </button>
      {categories.map((category) => {
        const swatch = swatchFor?.(category)
        return (
          <button
            key={category}
            type="button"
            onClick={() => onSelect(category)}
            aria-pressed={selected === category}
            className="flex items-center gap-2 text-sm"
          >
            {swatch ? (
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ backgroundColor: swatch }}
              />
            ) : null}
            {category}
          </button>
        )
      })}
      {foldedLabel ? (
        <span className="text-sm text-fg-tertiary">{foldedLabel}</span>
      ) : null}
    </div>
  )
}
