import type { ElementType } from 'react'

/**
 * Ported from `climate-project/src/components/ui/typography.tsx`.
 *
 * The legacy file was 450 lines and 25 exports, because it also carried the
 * marketing site's scale (`BodyLarge`, `Lead`, `Quote`, `DataTextLarge`) and four
 * layout helpers (`Container`, `Section`, `Grid`, `Flex`) that have nothing to do
 * with type. index.css already styles bare `h1`–`h6` and `p` for the admin
 * surface, and the layout helpers are one-line flex/grid utilities in Tailwind.
 *
 * So this port keeps the type ramp the admin pages actually use and drops the
 * rest — see the PR description for the full list. `Container`/`Section`/`Grid`/
 * `Flex` are deliberately not ported: `<div className="flex gap-inline">` is
 * clearer than `<Flex gap="inline">` and does not need maintaining.
 */
export const typographyVariants = {
  h1: 'text-3xl font-semibold leading-tight tracking-tight text-fg-primary',
  h2: 'text-2xl font-semibold leading-tight tracking-tight text-fg-primary',
  h3: 'text-xl font-semibold leading-tight text-fg-primary',
  h4: 'text-lg font-semibold leading-normal text-fg-primary',
  body: 'text-base leading-normal text-fg-primary',
  bodySmall: 'text-sm leading-normal text-fg-secondary',
  /** Tabular figures, for numbers that should line up column-to-column. */
  data: 'text-base leading-normal tabular-nums text-fg-primary',
  caption: 'text-xs leading-snug text-fg-tertiary',
  /** The all-caps section eyebrow from the legacy sidebar. */
  sectionLabel: 'text-2xs font-medium uppercase tracking-label text-fg-label',
  code: 'rounded-sm bg-surface-icon-box px-1 py-0.5 font-mono text-sm text-fg-primary',
} as const

export type TypographyVariant = keyof typeof typographyVariants

/** The element each variant renders unless `as` overrides it. */
export const DEFAULT_ELEMENT: Record<TypographyVariant, ElementType> = {
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  body: 'p',
  bodySmall: 'p',
  data: 'span',
  caption: 'span',
  sectionLabel: 'span',
  code: 'code',
}
