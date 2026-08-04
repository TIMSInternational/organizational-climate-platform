import { MAX_SERIES } from './palette'

/**
 * Sizing and colour-keying for `WordCloud`.
 *
 * Lives apart from the component because a file exporting both a component and a
 * helper breaks React Fast Refresh — the `only-export-components` lint rule
 * catches it, and it is right to (see `foldSlices.ts`, same reason).
 */

/**
 * The six type-scale steps a word can be rendered at, smallest first.
 *
 * Deliberately utilities from the token scale rather than a computed
 * `style={{ fontSize }}`. The legacy versions interpolated a raw pixel size
 * (12→32px in `charts/WordCloud`, 12→48px in `widgets/word-cloud`), which puts a
 * hardcoded length in the markup and steps straight over the type scale — the
 * same class of problem `tokenDiscipline` exists to stop for colour. Six discrete
 * steps also read as ranks, which is all a word cloud can honestly claim.
 */
export const WORD_SIZE_CLASSES = [
  'text-sm',
  'text-base',
  'text-lg',
  'text-xl',
  'text-2xl',
  'text-3xl',
] as const

/** The colour bucket a category folds into once the palette runs out. */
export const OTHER_CATEGORY_KEY = '__other_category__'

/**
 * Size step for one word, given the range it sits in.
 *
 * ## Why the square root
 *
 * A reader judges a word by how much ink it occupies, and ink grows with the
 * *square* of the font size. So mapping frequency linearly onto font size — which
 * both legacy versions did — makes a word mentioned twice as often look four
 * times as important. Taking the square root of the normalised frequency makes
 * area, not height, proportional to the count.
 *
 * ## Why a flat dataset lands in the middle
 *
 * When every word has the same frequency there is no ranking to show, and the
 * honest rendering is one uniform size. The middle step is that size. (`HeatMap`
 * resolves the same degenerate case to the *top* of its ramp instead, because a
 * fully-saturated cell still reads as a cell — whereas a page of words all at the
 * largest step reads as shouting rather than as "all equal".)
 */
export function wordSizeClass(value: number, min: number, max: number): string {
  const span = max - min
  if (!Number.isFinite(value) || span <= 0) {
    return WORD_SIZE_CLASSES[Math.floor(WORD_SIZE_CLASSES.length / 2)]
  }

  const normalised = Math.min(1, Math.max(0, (value - min) / span))
  const perceptual = Math.sqrt(normalised)
  const step = Math.min(WORD_SIZE_CLASSES.length - 1, Math.floor(perceptual * WORD_SIZE_CLASSES.length))
  return WORD_SIZE_CLASSES[step]
}

/**
 * Maps each category onto the key its colour is drawn from.
 *
 * The palette is six wide and `seriesColor` throws past that rather than cycling,
 * so a seventh category cannot simply be given a colour. Categories past the
 * ceiling therefore fold into one shared "Other" bucket — the same answer
 * `foldSlices` gives a pie chart, and for the same reason: two categories sharing
 * a colour under a label that says "the rest" is honest, whereas two categories
 * sharing a colour while both claim their own name is not.
 *
 * Order is first appearance, not frequency, so a colour follows a category rather
 * than its current rank — filtering the data does not repaint the survivors.
 */
export function categoryColorKeys(
  categories: readonly string[],
  max = MAX_SERIES,
): Map<string, string> {
  const unique = [...new Set(categories)]
  const named = unique.length <= max ? unique : unique.slice(0, max - 1)

  const mapping = new Map<string, string>()
  for (const category of unique) {
    mapping.set(category, named.includes(category) ? category : OTHER_CATEGORY_KEY)
  }
  return mapping
}

/**
 * The colour-key list to pass as `seriesColorFor`'s second argument.
 *
 * Derived from the same mapping so the two cannot disagree: every value the map
 * produces appears here exactly once, in assignment order.
 */
export function categoryColorKeyList(mapping: Map<string, string>): string[] {
  return [...new Set(mapping.values())]
}
