import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * The named steps this project adds to Tailwind's scales in
 * `src/styles/theme.css`. They have to be declared here too.
 *
 * `tailwind-merge` resolves conflicts by parsing a class into (group, value) and
 * keeping the last of each group. It only recognises values it knows, so with a
 * stock config our named steps are classified as unknown and *both* classes
 * survive:
 *
 *   twMerge('h-control-lg h-10')      -> 'h-control-lg h-10'   ✗
 *   twMerge('p-card p-4')             -> 'p-card p-4'          ✗
 *   twMerge('gap-inline gap-2')       -> 'gap-inline gap-2'    ✗
 *   twMerge('max-w-content max-w-full') -> both                ✗
 *
 * Two classes from the same group in the output means the winner is decided by
 * Tailwind's own layer order rather than by call order — so `<Button
 * className="h-10">` would not reliably be 32px or 40px. Colours happen to work
 * without this, because an unrecognised `text-*`/`bg-*` value is still grouped
 * as a colour, but the sizing scales genuinely need declaring.
 *
 * Keep in sync with `src/styles/theme.css`; `cn.test.ts` asserts the overrides.
 */
const SPACING_STEPS = [
  // Named density composites
  'card',
  'panel',
  'panel-gap',
  'gutter',
  'row',
  'inline',
  'section',
  // Control heights and icon boxes
  'control-sm',
  'control-md',
  'control-lg',
  'icon',
  'icon-box',
  // Shell widths
  'sidebar',
  'sidebar-collapsed',
  // The canvas button height and the Apple design's content-box padding
  'control-canvas',
  'box-x',
  'box-top',
  'box-bottom',
]

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: SPACING_STEPS,
      container: ['content'],
      // The named steps that are not t-shirt sizes. tailwind-merge already reads `2xs`/`3xs`
      // as font sizes; an unregistered `text-reading` or `text-kpi-hero` is read as a COLOUR
      // and silently drops the colour class beside it (`cn.test.ts`).
      //
      // The respond page's four steps were missing, and that is the defect this list exists
      // for: `<Button variant="primary" className="text-respond">` merged to a button whose
      // `text-fg-on-accent` had been dropped as "the earlier colour", so "Siguiente" printed
      // in the inherited near-black on the blue fill — 3.26:1 — on every respond screen.
      // `text-ui` is the Apple design's 14px row/control step.
      text: ['2xs', 'reading', 'kpi-lg', 'kpi-hero', 'question', 'ui', 'respond', 'respond-sm', 'respond-lg', 'respond-question'],
      tracking: ['label', 'eyebrow', 'kpi', 'tile', 'display', 'title'],
      // The Apple design's content box and sheet radii (`rounded-box`, `rounded-sheet`).
      radius: ['box', 'sheet'],
    },
  },
})

/** Merge class names, with later Tailwind utilities overriding earlier ones. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
