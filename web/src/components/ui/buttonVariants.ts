import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'

/**
 * Ported from `climate-project/src/components/ui/button.tsx`.
 *
 * Two changes from the legacy classes, both deliberate:
 *
 * 1. **No `outline-none`.** The legacy base killed the outline and rebuilt a
 *    focus ring out of `focus-visible:ring-*`, against shadcn's `--ring` token.
 *    This app already has one focus indicator, `:focus-visible { outline: 2px
 *    solid var(--admin-focus-ring) }` in index.css, applied globally. Porting
 *    `outline-none` would have deleted the app's only focus indicator and
 *    replaced it with a ring pointing at a token that does not exist here.
 *
 * 2. **Sizes are remapped onto the control-height tokens.** The legacy sizes were
 *    raw `h-8`/`h-9`/`h-10`. index.css records that the legacy admin surface used
 *    `size="sm"` (32px) 49 times and the 36px default never — so 32px is *the*
 *    admin button and is the default here. A ported call site can drop its
 *    `size="sm"`; `size="sm"` now means the 28px compact button that matches a
 *    nav row.
 */
export const buttonVariants = cva(
  cn(
    'inline-flex shrink-0 items-center justify-center gap-inline whitespace-nowrap',
    'rounded-md text-base font-medium',
    'transition-[background-color,border-color,color] ease-out',
    'disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed',
    // Icons size themselves to the token unless the caller says otherwise.
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-icon",
  ),
  {
    variants: {
      variant: {
        // The base `button` element style in index.css is already this — card
        // surface, hairline border. Naming it explicitly keeps the variant set
        // readable rather than relying on the absence of classes.
        default: cn(
          'border border-line-default bg-surface-card text-fg-primary',
          'hover:not-disabled:border-line-hover hover:not-disabled:bg-surface-card-hover',
        ),
        // `bg-accent-blue-fill`, never `bg-accent-blue`: white on the identity
        // accent measures 3.74:1 in light and 2.49:1 in dark, and this button's
        // label is `text-base` (0.8125rem = 13px), which WCAG 1.4.3 counts as
        // normal text at 4.5:1. `tokens.css` says the on-accent ink may sit on
        // `--admin-accent-blue-fill` and on nothing else; `accentContrast.test.ts`
        // measures that fill at 5.47:1 with white in both themes and asserts the
        // identity accent does NOT clear 4.5:1. Hover moves to the paired hover
        // token rather than to `opacity-90`, which would fade the fill toward the
        // panel and give back the contrast the fill exists to provide.
        primary: cn(
          'border border-transparent bg-accent-blue-fill text-fg-on-accent shadow-sm',
          'hover:not-disabled:bg-accent-blue-fill-hover',
        ),
        destructive: cn(
          'border border-transparent bg-accent-red text-fg-on-accent shadow-sm',
          'hover:not-disabled:opacity-90',
        ),
        outline: cn(
          'border border-line-default bg-transparent text-fg-primary',
          'hover:not-disabled:border-line-hover hover:not-disabled:bg-state-hover',
        ),
        secondary: cn(
          'border border-transparent bg-surface-icon-box text-fg-primary',
          'hover:not-disabled:bg-state-hover',
        ),
        ghost: cn(
          'border border-transparent bg-transparent text-fg-secondary',
          'hover:not-disabled:bg-state-hover hover:not-disabled:text-fg-primary',
        ),
        link: cn(
          'h-auto border-transparent bg-transparent p-0 text-accent-blue underline-offset-4',
          'hover:underline',
        ),
      },
      size: {
        default: 'h-control-lg px-3',
        sm: 'h-control-md gap-1.5 px-2',
        lg: 'h-10 px-6',
        icon: 'size-control-lg p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export type ButtonVariantProps = VariantProps<typeof buttonVariants>
