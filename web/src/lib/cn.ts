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
]

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: SPACING_STEPS,
      container: ['content'],
      text: ['2xs'],
    },
  },
})

/** Merge class names, with later Tailwind utilities overriding earlier ones. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
