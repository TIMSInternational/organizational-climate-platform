import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'

/**
 * Ported from `climate-project/src/components/ui/button.tsx`, and since 11 Nov drawn to the
 * Apple design's `.btn` family (`occ.css`: `.btn`, `.btn.p`, `.btn.t`, `.btn.d`, `.btn.lg`).
 *
 * Three rules from the port still hold:
 *
 * 1. **No `outline-none`.** The app has one focus indicator, the global `:focus-visible`
 *    outline in index.css (`--admin-focus-ring`, 3px). Killing it here would leave every
 *    button in the product without a ring.
 * 2. **Heights come from the control tokens.** `default` is 32px (`h-control-lg`), the
 *    admin button the legacy surface used 49 times; `sm` is 28px, the desktop floor.
 * 3. **The label size lives in `size`, not in the base.** A size is a size: `lg` is 16px and
 *    the rest 13-14px. It also keeps the base free of `text-*`, so the one `text-*` class a
 *    variant adds is its ink — `styles/accentContrast.test.ts` reads the primary button's
 *    ink off this table and measures it against its fill.
 *
 * ## The variants, and the canvas class each one is
 *
 * | variant | canvas | what it is |
 * |---|---|---|
 * | `primary` | `.btn.p` | the one filled blue action of a view — `#2563eb`, white label 5.17:1 |
 * | `default`, `secondary` | `.btn` | the bordered neutral button: card ground, hairline, label ink |
 * | `outline` | `.btn` | the same, on a transparent ground, for a tinted surface |
 * | `plain` | `.btn.t` | tinted text, no ground: `#1d4ed8` (6.70:1 light, 7.08:1 dark on a card) |
 * | `ghost` | — | neutral text, no ground (toolbars, icon buttons) |
 * | `destructive` | `.btn.d` | the bordered button with its label in the danger ink |
 * | `link` | `a` | inline, in the link ink |
 *
 * `secondary` was a grey-filled button. The Apple design has no grey fill — its secondary
 * action is the bordered `.btn` — so it now draws exactly that; the name keeps working.
 *
 * ## Why `destructive` is not a red fill
 *
 * It was `bg-accent-red text-fg-on-accent`. In dark `--admin-accent-red` is `#ef4444`, and
 * white on it is **3.76:1** — under the 4.5:1 a 14px semibold label needs (WCAG 1.4.3). The
 * canvas draws `.btn.d` as the danger colour on the label, and so does Apple: HIG
 * `buttons.md` § "Role" ("a destructive button uses the system red color") and the next
 * line, "Don't assign the primary role to a button that performs a destructive action" —
 * a red FILL is the most prominent button on the screen, which is the role HIG says a
 * destructive action must not take. So the label is `text-accent-red-ink`: 6.25:1 light and
 * 6.35:1 dark on the card, 5.39:1 / 5.83:1 on its own hover tint. The hairline border stays
 * so the button keeps a visible hit region beside a bordered Cancel ("Use style — not size",
 * `buttons.md` § "Style").
 *
 * ## Touch
 *
 * HIG `buttons.md` § "Best practices": "a button needs a hit region of at least 44x44 pt".
 * The desktop sizes stay dense (28 / 32 / 34px); under `pointer-coarse` (a finger is the
 * primary pointer) every size grows to 44px. Hover is a pointer affordance, so it is
 * guarded by `not-disabled` and the press state (`active:`) is what a finger sees —
 * HIG § "Best practices": "Always include a press state for a custom button."
 */
export const buttonVariants = cva(
  cn(
    'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap',
    'rounded-md font-semibold',
    'transition-[background-color,border-color,color] ease-out',
    // The canvas's `.btn[disabled] { opacity: .45 }`.
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45',
    // Icons size themselves to the token unless the caller says otherwise.
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-icon",
  ),
  {
    variants: {
      variant: {
        // `.btn`: the card ground and the hairline, the label in the primary ink.
        default: cn(
          'border border-line-default bg-surface-card text-fg-primary',
          'hover:not-disabled:border-line-hover hover:not-disabled:bg-surface-card-hover',
          'active:not-disabled:bg-state-active',
        ),
        // `.btn.p`: `bg-accent-blue-fill`, never `bg-accent-blue`. White on the identity blue
        // is 4.02:1 light — under 4.5:1 for a 14px label — and `tokens.css` says the on-accent
        // ink may sit on the fill and on nothing else. Hover moves to the paired hover token
        // (6.70:1 light, 4.52:1 dark), never `opacity-90`, which would fade the fill toward
        // the panel and give back the contrast the fill exists to provide. No shadow: the
        // canvas's buttons are flat (`--sh: none`).
        primary: cn(
          'border border-transparent bg-accent-blue-fill text-fg-on-accent',
          'hover:not-disabled:bg-accent-blue-fill-hover active:not-disabled:bg-accent-blue-fill-hover',
        ),
        // `.btn.d`: the danger ink on the bordered button. See the header for the 3.76:1
        // that retired the red fill.
        destructive: cn(
          'border border-line-default bg-surface-card text-accent-red-ink',
          'hover:not-disabled:border-accent-red-ring hover:not-disabled:bg-accent-red-soft',
          'active:not-disabled:bg-accent-red-soft',
        ),
        outline: cn(
          'border border-line-default bg-transparent text-fg-primary',
          'hover:not-disabled:border-line-hover hover:not-disabled:bg-state-hover',
          'active:not-disabled:bg-state-active',
        ),
        // `.btn`, as `default`. The grey fill this used to draw is not in the Apple design.
        secondary: cn(
          'border border-line-default bg-surface-card text-fg-primary',
          'hover:not-disabled:border-line-hover hover:not-disabled:bg-surface-card-hover',
          'active:not-disabled:bg-state-active',
        ),
        // `.btn.t`: the tint as text. `text-accent-blue-ink`, the blue made for words —
        // `text-accent-blue` is the identity blue and 4.02:1 on white.
        plain: cn(
          'border border-transparent bg-transparent text-accent-blue-ink',
          'hover:not-disabled:bg-state-hover active:not-disabled:bg-state-active',
        ),
        ghost: cn(
          'border border-transparent bg-transparent text-fg-secondary',
          'hover:not-disabled:bg-state-hover hover:not-disabled:text-fg-primary',
          'active:not-disabled:bg-state-active',
        ),
        // Was `text-accent-blue` — the identity blue, 4.02:1 on white, which `tokens.css`
        // says is never a text ink. The link ink is 6.70:1.
        link: cn(
          'h-auto border-transparent bg-transparent p-0 font-medium text-accent-blue-ink underline-offset-4',
          'hover:underline',
        ),
      },
      size: {
        // 32px, 14px label (`--admin-text-ui`, the canvas's `font: 600 14px`).
        default: 'h-control-lg px-3 text-ui pointer-coarse:min-h-11',
        // 28px, 13px: the desktop floor, the height of a nav row.
        sm: 'h-control-md gap-1 px-2 text-sm pointer-coarse:min-h-11',
        // The canvas's `.btn.lg`: 44px, 20px across, 16px, the card radius.
        lg: 'h-11 rounded-xl px-5 text-lg',
        icon: 'size-control-lg p-0 pointer-coarse:size-11',
        // The canvas's `.btn`: 34px outside, 14px across (`padding: 0 14px`).
        canvas: 'h-control-canvas px-3.5 text-ui pointer-coarse:min-h-11',
        // The canvas's icon button: 34px square.
        'icon-canvas': 'size-control-canvas p-0 pointer-coarse:size-11',
      },
    },
    compoundVariants: [
      // `.btn.t { padding: 0 8px }`: a text button sits closer to its neighbours than a
      // bordered one, because it has no edge to keep apart.
      { variant: 'plain', size: ['default', 'canvas'], className: 'px-2' },
    ],
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export type ButtonVariantProps = VariantProps<typeof buttonVariants>
